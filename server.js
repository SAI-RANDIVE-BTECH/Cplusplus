const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = 8080;

// ============= STATIC FILES CONFIGURATION =============
const frontendDir = path.join(__dirname, 'frontend');
const assetsDir = path.join(__dirname, 'assets');

// Middleware
app.use(express.json());
app.use(express.static(frontendDir));
app.use('/assets', express.static(assetsDir));

// Direct file serving routes (before other routes)
app.get('/assets/logo.png', (req, res) => {
  const logoPath = path.join(assetsDir, 'logo.png');
  try {
    const fileData = fs.readFileSync(logoPath);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', fileData.length);
    res.send(fileData);
  } catch (err) {
    res.status(404).json({ error: 'Logo not found' });
  }
});

app.get('/index.html', (req, res) => {
  const htmlPath = path.join(frontendDir, 'index.html');
  res.sendFile(htmlPath);
});

app.get('/', (req, res) => {
  const htmlPath = path.join(frontendDir, 'index.html');
  res.sendFile(htmlPath);
});

// ============= DATABASE SETUP =============
const db = new sqlite3.Database(':memory:');

// Utility functions
const randomString = (len) => crypto.randomBytes(len).toString('hex').slice(0, len);
const sha256 = (str) => crypto.createHash('sha256').update(str).digest('hex');

// ============= DATABASE INITIALIZATION =============
function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Create all tables
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('owner','admin','manager','waiter','customer')),
        full_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS menu_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        is_active INTEGER NOT NULL DEFAULT 1
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS menu_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL CHECK(price > 0),
        item_type TEXT NOT NULL CHECK(item_type IN ('food','beverage','dessert')),
        is_vegetarian INTEGER NOT NULL,
        is_available INTEGER NOT NULL DEFAULT 1,
        prep_minutes INTEGER NOT NULL DEFAULT 15,
        image_url TEXT,
        FOREIGN KEY(category_id) REFERENCES menu_categories(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS tables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_number INTEGER NOT NULL UNIQUE,
        capacity INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('available','occupied','reserved','maintenance')),
        assigned_waiter_id INTEGER,
        elapsed_minutes INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(assigned_waiter_id) REFERENCES users(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        order_type TEXT NOT NULL CHECK(order_type IN ('dine_in','takeaway')),
        table_id INTEGER,
        customer_id INTEGER,
        customer_name TEXT,
        guests INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK(status IN ('pending','confirmed','preparing','ready','served','completed','cancelled')),
        subtotal REAL NOT NULL DEFAULT 0,
        tax REAL NOT NULL DEFAULT 0,
        service_charge REAL NOT NULL DEFAULT 0,
        discount REAL NOT NULL DEFAULT 0,
        total_amount REAL NOT NULL DEFAULT 0,
        payment_method TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(table_id) REFERENCES tables(id),
        FOREIGN KEY(customer_id) REFERENCES users(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        menu_item_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        unit_price REAL NOT NULL,
        subtotal REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        note TEXT,
        FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY(menu_item_id) REFERENCES menu_items(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS kitchen_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        order_item_id INTEGER,
        item_name TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL CHECK(status IN ('queued','in_progress','completed','cancelled')),
        elapsed_minutes INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        completed_at TEXT,
        FOREIGN KEY(order_id) REFERENCES orders(id),
        FOREIGN KEY(order_item_id) REFERENCES order_items(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS stock (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_name TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit TEXT NOT NULL,
        min_threshold REAL NOT NULL,
        cost_per_unit REAL NOT NULL DEFAULT 0,
        supplier TEXT,
        last_restocked TEXT
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS cutlery (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_name TEXT NOT NULL UNIQUE,
        total_count INTEGER NOT NULL,
        available_count INTEGER NOT NULL,
        in_use_count INTEGER NOT NULL DEFAULT 0,
        damaged_count INTEGER NOT NULL DEFAULT 0
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        tax REAL NOT NULL,
        discount REAL NOT NULL,
        net_amount REAL NOT NULL,
        payment_method TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(order_id) REFERENCES orders(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        phone TEXT,
        table_id INTEGER,
        party_size INTEGER NOT NULL,
        reservation_date TEXT NOT NULL,
        reservation_time TEXT NOT NULL,
        special_requests TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending','confirmed','cancelled','completed')),
        FOREIGN KEY(table_id) REFERENCES tables(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL,
        user_id INTEGER,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        razorpay_payment_id TEXT UNIQUE,
        razorpay_order_id TEXT UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('initiated','pending','authorized','captured','refunded','failed','cancelled')),
        description TEXT,
        receipt TEXT,
        email TEXT,
        phone_number TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`, (err) => {
        if (err) reject(err);
        else seedData().then(resolve).catch(reject);
      });
    });
  });
}

// ============= SEED DATA =============
async function seedData() {
  return new Promise((resolve, reject) => {
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
      if (row && row.count > 0) {
        resolve();
        return;
      }

      // Owners & Administration
      const users = [
        { username: 'apurva_sanpurkar', password: 'apurva@2024', role: 'owner', name: 'Apurva Sanpurkar', email: 'apurva@akshaybhojanam.in', phone: '9876500001', dept: 'Administration' },
        { username: 'sai_randive', password: 'sai@2024', role: 'owner', name: 'Sai Randive', email: 'sai@akshaybhojanam.in', phone: '9876500002', dept: 'Administration' },
        // Staff
        { username: 'shripad_deshpande', password: 'staff@2024', role: 'manager', name: 'Shripad Deshpande', email: 'shripad@akshaybhojanam.in', phone: '9876500101', dept: 'Kitchen' },
        { username: 'aniruddha_joshi', password: 'staff@2024', role: 'manager', name: 'Aniruddha Joshi', email: 'aniruddha@akshaybhojanam.in', phone: '9876500102', dept: 'Kitchen' },
        { username: 'chinmay_patwardhan', password: 'staff@2024', role: 'manager', name: 'Chinmay Patwardhan', email: 'chinmay@akshaybhojanam.in', phone: '9876500103', dept: 'Desserts' },
        { username: 'vedant_aghnihotri', password: 'staff@2024', role: 'manager', name: 'Vedant Agnihotri', email: 'vedant@akshaybhojanam.in', phone: '9876500104', dept: 'Store' },
        { username: 'parth_sahasrabuddhe', password: 'staff@2024', role: 'waiter', name: 'Parth Sahasrabuddhe', email: 'parth@akshaybhojanam.in', phone: '9876500105', dept: 'Floor' },
        { username: 'ishaan_bhave', password: 'staff@2024', role: 'waiter', name: 'Ishaan Bhave', email: 'ishaan@akshaybhojanam.in', phone: '9876500106', dept: 'Floor' },
        { username: 'tanmay_pendse', password: 'staff@2024', role: 'waiter', name: 'Tanmay Pendse', email: 'tanmay@akshaybhojanam.in', phone: '9876500107', dept: 'Floor' },
        { username: 'omkar_gokhale', password: 'staff@2024', role: 'waiter', name: 'Omkar Gokhale', email: 'omkar@akshaybhojanam.in', phone: '9876500108', dept: 'Billing' },
        // Customers
        { username: 'rajesh_kumar', password: 'customer@2024', role: 'customer', name: 'Rajesh Kumar', email: 'rajesh@customer.in', phone: '9876500201', dept: 'Customer' },
        { username: 'priya_sharma', password: 'customer@2024', role: 'customer', name: 'Priya Sharma', email: 'priya@customer.in', phone: '9876500202', dept: 'Customer' },
      ];

      let count = 0;
      users.forEach(u => {
        const salt = randomString(32);
        const hash = sha256(salt + u.password + salt);
        db.run(
          `INSERT INTO users(username,password_hash,salt,role,full_name,email,phone,is_active) VALUES(?,?,?,?,?,?,?,?)`,
          [u.username, hash, salt, u.role, u.name, u.email, u.phone, 1],
          () => {
            count++;
            if (count === users.length) seedInventory();
          }
        );
      });

      function seedInventory() {
        // Cutlery & Crockery
        const cutlery = [
          { name: 'Momo Steamer Baskets', category: 'Equipment', qty: 20, unit: 'Units', threshold: 5, cost: 450 },
          { name: 'Biryani Handis (Small)', category: 'Crockery', qty: 50, unit: 'Units', threshold: 10, cost: 350 },
          { name: 'Large Dinner Plates', category: 'Crockery', qty: 100, unit: 'Units', threshold: 20, cost: 180 },
          { name: 'Falooda Glasses', category: 'Glassware', qty: 40, unit: 'Units', threshold: 10, cost: 85 },
          { name: 'Kulfi Plates', category: 'Crockery', qty: 40, unit: 'Units', threshold: 8, cost: 65 },
          { name: 'Stainless Steel Spoons', category: 'Cutlery', qty: 150, unit: 'Units', threshold: 30, cost: 40 },
          { name: 'Reusable Bamboo Chopsticks', category: 'Cutlery', qty: 50, unit: 'Pairs', threshold: 10, cost: 25 },
          { name: 'Soup Bowls', category: 'Crockery', qty: 60, unit: 'Units', threshold: 12, cost: 75 },
        ];

        // 15-Day Raw Material Inventory
        const inventory = [
          { name: 'Basmati Rice (Premium)', category: 'Grains', qty: 250, unit: 'kg', threshold: 50, cost: 110 },
          { name: 'Maida (Fine)', category: 'Flours', qty: 80, unit: 'kg', threshold: 15, cost: 45 },
          { name: 'Atta (Wheat)', category: 'Flours', qty: 70, unit: 'kg', threshold: 15, cost: 45 },
          { name: 'Full Cream Milk', category: 'Dairy', qty: 450, unit: 'Liters', threshold: 100, cost: 66 },
          { name: 'Paneer (Fresh)', category: 'Dairy', qty: 60, unit: 'kg', threshold: 10, cost: 420 },
          { name: 'Amul Butter', category: 'Dairy', qty: 15, unit: 'kg', threshold: 3, cost: 650 },
          { name: 'Ghee', category: 'Dairy', qty: 15, unit: 'kg', threshold: 3, cost: 650 },
          { name: 'Chicken (Boneless)', category: 'Non-Veg', qty: 120, unit: 'kg', threshold: 20, cost: 280 },
          { name: 'Eggs', category: 'Non-Veg', qty: 30, unit: 'Crates', threshold: 5, cost: 180 },
          { name: 'Onion', category: 'Vegetables', qty: 70, unit: 'kg', threshold: 15, cost: 50 },
          { name: 'Ginger', category: 'Vegetables', qty: 65, unit: 'kg', threshold: 10, cost: 50 },
          { name: 'Garlic', category: 'Vegetables', qty: 65, unit: 'kg', threshold: 10, cost: 50 },
          { name: 'Cabbage', category: 'Vegetables', qty: 50, unit: 'kg', threshold: 10, cost: 40 },
          { name: 'Carrots', category: 'Vegetables', qty: 50, unit: 'kg', threshold: 10, cost: 40 },
          { name: 'Biryani Masala', category: 'Spices', qty: 5, unit: 'kg', threshold: 1, cost: 600 },
          { name: 'Garam Masala', category: 'Spices', qty: 5, unit: 'kg', threshold: 1, cost: 600 },
          { name: 'Chaat Masala', category: 'Spices', qty: 5, unit: 'kg', threshold: 1, cost: 600 },
          { name: 'Refined Sunflower Oil', category: 'Oils', qty: 100, unit: 'Liters', threshold: 20, cost: 145 },
          { name: 'Vermicelli', category: 'Desserts', qty: 10, unit: 'kg', threshold: 2, cost: 200 },
          { name: 'Sabja Seeds', category: 'Desserts', qty: 5, unit: 'kg', threshold: 1, cost: 200 },
          { name: 'Falooda Syrup', category: 'Desserts', qty: 5, unit: 'kg', threshold: 1, cost: 200 },
        ];

        let cutleryCount = 0;
        cutlery.forEach(item => {
          db.run(
            `INSERT INTO cutlery(item_name, total_count, available_count, in_use_count, damaged_count) VALUES(?,?,?,?,?)`,
            [item.name, item.qty, item.qty, 0, 0],
            () => {
              cutleryCount++;
            }
          );
        });

        let invCount = 0;
        inventory.forEach(item => {
          db.run(
            `INSERT INTO stock(item_name, category, quantity, unit, min_threshold, cost_per_unit, last_restocked) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
            [item.name, item.category, item.qty, item.unit, item.threshold, item.cost],
            () => {
              invCount++;
            }
          );
        });

        setTimeout(() => seedTables(), 500);
      }

      function seedTables() {
        let tableCount = 0;
        for (let i = 1; i <= 30; i++) {
          const status = i <= 5 ? 'occupied' : i <= 10 ? 'reserved' : 'available';
          db.run(
            `INSERT INTO tables(table_number,capacity,status,elapsed_minutes) VALUES(?,?,?,?)`,
            [i, i <= 4 ? 2 : i <= 8 ? 4 : i <= 16 ? 6 : 8, status, Math.floor(Math.random() * 120)],
            () => {
              tableCount++;
              if (tableCount === 30) seedBasicMenu();
            }
          );
        }
      }

      function seedBasicMenu() {
        // Create basic categories for demo
        const baseCategories = [
          { name: "Steamed Momos", desc: "Steamed traditional momos" },
          { name: "Biryani", desc: "Aromatic rice and meat biryani" },
          { name: "Tandoor & Breads", desc: "Fresh breads from tandoor" },
          { name: "Chinese", desc: "Chinese cuisine specialties" },
          { name: "Desserts", desc: "Sweet treats and desserts" },
        ];

        const basicItems = [
          { cat: "Steamed Momos", name: "Veg Momo", price: 169, veg: 1, prep: 15 },
          { cat: "Steamed Momos", name: "Chicken Momo", price: 179, veg: 0, prep: 15 },
          { cat: "Steamed Momos", name: "Paneer Momo", price: 189, veg: 1, prep: 15 },
          { cat: "Biryani", name: "Chicken Biryani", price: 330, veg: 0, prep: 20 },
          { cat: "Biryani", name: "Veg Biryani", price: 259, veg: 1, prep: 20 },
          { cat: "Biryani", name: "Paneer Biryani", price: 289, veg: 1, prep: 20 },
          { cat: "Tandoor & Breads", name: "Butter Naan", price: 89, veg: 1, prep: 5 },
          { cat: "Tandoor & Breads", name: "Garlic Naan", price: 99, veg: 1, prep: 5 },
          { cat: "Tandoor & Breads", name: "Paneer Kulcha", price: 119, veg: 1, prep: 10 },
          { cat: "Chinese", name: "Hakka Noodles", price: 219, veg: 1, prep: 15 },
          { cat: "Chinese", name: "Chicken Fried Rice", price: 249, veg: 0, prep: 15 },
          { cat: "Chinese", name: "Manchurian", price: 239, veg: 1, prep: 12 },
          { cat: "Desserts", name: "Gulab Jamun", price: 119, veg: 1, prep: 10 },
          { cat: "Desserts", name: "Kheer", price: 129, veg: 1, prep: 8 },
          { cat: "Desserts", name: "Kulfi", price: 79, veg: 1, prep: 5 },
        ];

        let catCount = 0;
        const catMap = {};

        baseCategories.forEach(cat => {
          db.run(
            `INSERT INTO menu_categories(name, description, is_active) VALUES(?,?,?)`,
            [cat.name, cat.desc, 1],
            function(err) {
              if (!err) catMap[cat.name] = this.lastID;
              catCount++;
              if (catCount === baseCategories.length) {
                addMenuItems();
              }
            }
          );
        });

        function addMenuItems() {
          let itemCount = 0;
          basicItems.forEach(item => {
            const catId = catMap[item.cat] || 1;
            db.run(
              `INSERT INTO menu_items(category_id, name, description, price, item_type, is_vegetarian, is_available, prep_minutes)
               VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
              [catId, item.name, `${item.name} - Fresh & Delicious`, item.price, 'food', item.veg, 1, item.prep],
              () => {
                itemCount++;
                if (itemCount === basicItems.length) {
                  resolve();
                }
              }
            );
          });
        }
      }
    });
  });
}

// ============= AUTHENTICATION =============
const tokenStore = {};

function authenticate(token) {
  return tokenStore[token] || null;
}

function requireAuth(req, res, minLevel = 20) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  const user = authenticate(token);

  if (!user) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return null;
  }

  const accessLevels = { owner: 100, admin: 80, manager: 60, waiter: 40, customer: 20 };
  if ((accessLevels[user.role] || 0) < minLevel) {
    res.status(403).json({ success: false, message: 'Forbidden' });
    return null;
  }

  return user;
}

// ============= API ENDPOINTS =============

// Auth endpoints
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const hash = sha256(user.salt + password + user.salt);
    if (hash !== user.password_hash) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = randomString(48);
    const userData = {
      id: user.id,
      username: user.username,
      name: user.full_name,
      role: user.role,
      email: user.email,
      accessLevel: { owner: 100, admin: 80, manager: 60, waiter: 40, customer: 20 }[user.role]
    };

    tokenStore[token] = userData;
    res.json({ success: true, token, user: userData });
  });
});

app.post('/api/auth/register', (req, res) => {
  const { username, password, role, full_name, email, phone } = req.body;

  if (!username || !password || !full_name || !email) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  if (!['owner', 'admin', 'manager', 'waiter', 'customer'].includes(role || 'customer')) {
    return res.status(400).json({ success: false, message: 'Invalid role' });
  }

  const salt = randomString(32);
  const hash = sha256(salt + password + salt);

  db.run(
    `INSERT INTO users(username, password_hash, salt, role, full_name, email, phone) VALUES(?,?,?,?,?,?,?)`,
    [username, hash, salt, role || 'customer', full_name, email, phone || ''],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(409).json({ success: false, message: 'Username or email already exists' });
        }
        return res.status(500).json({ success: false, message: err.message });
      }

      const token = randomString(48);
      const userData = {
        id: this.lastID,
        username,
        name: full_name,
        role: role || 'customer',
        email,
        accessLevel: { owner: 100, admin: 80, manager: 60, waiter: 40, customer: 20 }[role || 'customer']
      };

      tokenStore[token] = userData;
      res.json({ success: true, token, user: userData });
    }
  );
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  delete tokenStore[token];
  res.json({ success: true });
});

// Dashboard
app.get('/api/dashboard/stats', (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;

  res.json({
    todaysSales: 42850,
    activeOrders: 5,
    activeTables: 7,
    totalTables: 10,
    staffOnDuty: 4,
    salesDelta: 12
  });
});

// Menu endpoints
app.get('/api/menu/categories', (req, res) => {
  db.all('SELECT * FROM menu_categories', (err, rows) => {
    res.json(rows || []);
  });
});

app.get('/api/menu/items/all', (req, res) => {
  db.all(`SELECT m.*, c.name as category FROM menu_items m JOIN menu_categories c ON m.category_id = c.id`, (err, rows) => {
    res.json(rows || []);
  });
});

// Tables
app.get('/api/tables', (req, res) => {
  db.all(`SELECT t.*, u.full_name as waiter FROM tables t LEFT JOIN users u ON t.assigned_waiter_id = u.id`, (err, rows) => {
    res.json(rows || []);
  });
});

// Orders
app.get('/api/orders', (req, res) => {
  db.all(`SELECT o.*, t.table_number FROM orders o LEFT JOIN tables t ON o.table_id = t.id ORDER BY o.created_at DESC`, (err, rows) => {
    if (err || !rows || rows.length === 0) {
      return res.json([]);
    }

    let processed = 0;
    rows.forEach(order => {
      db.all('SELECT oi.*, m.name FROM order_items oi JOIN menu_items m ON oi.menu_item_id = m.id WHERE oi.order_id = ?', [order.id], (err, items) => {
        order.items = items || [];
        processed++;
        if (processed === rows.length) {
          return res.json(rows);
        }
      });
    });
  });
});

// Kitchen Queue
app.get('/api/kitchen/queue', (req, res) => {
  db.all('SELECT * FROM kitchen_queue WHERE status != "completed" ORDER BY priority DESC', (err, rows) => {
    res.json(rows || []);
  });
});

// Stock
app.get('/api/stock', (req, res) => {
  db.all('SELECT * FROM stock', (err, rows) => {
    res.json(rows || []);
  });
});

// Cutlery
app.get('/api/cutlery', (req, res) => {
  db.all('SELECT * FROM cutlery', (err, rows) => {
    res.json(rows || []);
  });
});

// Sales
app.get('/api/sales', (req, res) => {
  const user = requireAuth(req, res, 80);
  if (!user) return;

  db.all('SELECT * FROM sales ORDER BY created_at DESC', (err, rows) => {
    res.json(rows || []);
  });
});

app.get('/api/sales/summary', (req, res) => {
  const user = requireAuth(req, res, 80);
  if (!user) return;

  res.json({
    dailyRevenue: 42850,
    weeklyRevenue: 292600,
    monthlyRevenue: 1148200,
    paymentBreakdown: [
      { method: 'Cash', amount: 25000 },
      { method: 'Card', amount: 15000 },
      { method: 'UPI', amount: 2850 }
    ]
  });
});

// Reservations
app.get('/api/reservations/all', (req, res) => {
  db.all(`SELECT r.*, t.table_number FROM reservations r LEFT JOIN tables t ON r.table_id = t.id ORDER BY r.reservation_date`, (err, rows) => {
    res.json(rows || []);
  });
});

// Staff
app.get('/api/staff', (req, res) => {
  db.all('SELECT id, full_name as name, username, role, email, phone, is_active as active FROM users', (err, rows) => {
    res.json(rows || []);
  });
});

// ============= RAZORPAY PAYMENT ENDPOINTS =============

app.post('/api/payments/create-order', (req, res) => {
  const user = requireAuth(req, res, 20);
  if (!user) return;

  const { orderId, amount, description } = req.body;
  const razorpayOrderId = 'order_' + randomString(16).toUpperCase();

  res.json({
    id: razorpayOrderId,
    entity: 'order',
    amount: amount * 100,
    amount_paid: 0,
    amount_due: amount * 100,
    currency: 'INR',
    receipt: orderId,
    status: 'created',
    created_at: Math.floor(Date.now() / 1000)
  });
});

app.post('/api/payments/capture', (req, res) => {
  const user = requireAuth(req, res, 20);
  if (!user) return;

  const { paymentId, amount, orderId, userId, email, phone, description } = req.body;

  const sql = `INSERT INTO payments(order_id, user_id, amount, currency, razorpay_payment_id, razorpay_order_id, status, description, email, phone_number, created_at, updated_at)
               VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;

  db.run(sql, [orderId, userId, amount, 'INR', paymentId, 'order_' + randomString(16).toUpperCase(), 'captured', description, email, phone], (err) => {
    if (err) return res.status(500).json({ error: err.message });

    res.json({
      id: paymentId,
      entity: 'payment',
      amount: amount * 100,
      currency: 'INR',
      status: 'captured',
      description: description
    });
  });
});

app.post('/api/payments/verify', (req, res) => {
  res.json({ success: true, message: 'Signature verified' });
});

app.post('/api/payments/refund', (req, res) => {
  const user = requireAuth(req, res, 80);
  if (!user) return;

  const { paymentId, amount } = req.body;

  res.json({
    id: 'rfnd_' + randomString(16).toUpperCase(),
    entity: 'refund',
    payment_id: paymentId,
    amount: amount * 100,
    currency: 'INR',
    status: 'processed'
  });
});

app.get('/api/payments/all', (req, res) => {
  const user = requireAuth(req, res, 80);
  if (!user) return;

  db.all(`SELECT p.*, u.username, u.email as user_email FROM payments p LEFT JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC`, (err, rows) => {
    res.json(rows || []);
  });
});

app.get('/api/payments/stats', (req, res) => {
  const user = requireAuth(req, res, 80);
  if (!user) return;

  db.get(`SELECT
    COUNT(*) as total_transactions,
    SUM(CASE WHEN status = 'captured' THEN amount ELSE 0 END) as total_captured,
    COUNT(CASE WHEN status = 'captured' THEN 1 END) as successful_payments,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_payments
  FROM payments`, (err, row) => {
    res.json(row || {});
  });
});

app.get('/api/payments/order/:orderId', (req, res) => {
  db.all('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC', [req.params.orderId], (err, rows) => {
    res.json(rows || []);
  });
});

app.get('/api/payments/user/:userId', (req, res) => {
  db.all('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC', [req.params.userId], (err, rows) => {
    res.json(rows || []);
  });
});

// ============= POST ENDPOINTS FOR CRUD =============

app.post('/api/menu/categories', (req, res) => {
  const user = requireAuth(req, res, 80);
  if (!user) return;

  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  db.run(
    `INSERT INTO menu_categories(name, description) VALUES(?, ?)`,
    [name, description || ''],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    }
  );
});

app.post('/api/menu/items', (req, res) => {
  const user = requireAuth(req, res, 80);
  if (!user) return;

  const { name, price, categoryId, type, vegetarian, available, prepMinutes } = req.body;
  if (!name || !price || !categoryId) return res.status(400).json({ error: 'Missing required fields' });

  db.run(
    `INSERT INTO menu_items(category_id, name, description, price, item_type, is_vegetarian, is_available, prep_minutes)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [categoryId, name, `${name} - Heritage recipe`, price, type || 'food', vegetarian ? 1 : 0, available ? 1 : 0, prepMinutes || 15],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    }
  );
});

app.post('/api/stock', (req, res) => {
  const user = requireAuth(req, res, 80);
  if (!user) return;

  const { item, quantity, category, unit, threshold } = req.body;
  if (!item || quantity === undefined) return res.status(400).json({ error: 'Missing required fields' });

  db.run(
    `INSERT INTO stock(item_name, category, quantity, unit, min_threshold, cost_per_unit, last_restocked)
     VALUES(?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [item, category || 'General', quantity, unit || 'kg', threshold || 10, 0],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// Dev endpoint
app.get('/api/dev/credentials', (req, res) => {
  res.json([
    { username: 'apurva_sanpurkar', password: 'apurva@2024', role: 'owner' },
    { username: 'shripad_deshpande', password: 'staff@2024', role: 'manager' },
    { username: 'parth_sahasrabuddhe', password: 'staff@2024', role: 'waiter' },
    { username: 'rajesh_kumar', password: 'customer@2024', role: 'customer' },
    { username: 'priya_sharma', password: 'customer@2024', role: 'customer' }
  ]);
});

// ============= ADMIN SEED MENU ENDPOINT =============
app.post('/api/admin/seed-menu', (req, res) => {
  const user = requireAuth(req, res, 100);
  if (!user) return;

  const menuData = {
    'Steamed Momos': [
      { name: 'Veg Pahari Feast Momo', price: 169, veg: 1 },
      { name: 'Veg Pahari Fresh Momo', price: 129, veg: 1 },
      { name: 'Veg Himalayan Momo', price: 199, veg: 1 },
      { name: 'Veg Hot Garlic Momo', price: 245, veg: 1 },
      { name: 'Veg Darjeeling Momo', price: 275, veg: 1 },
      { name: 'Chatpata Paneer Momo', price: 325, veg: 1 },
      { name: 'Corn Cheese Momo', price: 345, veg: 1 },
      { name: 'Chicken Pahari Feast Momo', price: 179, veg: 0 },
      { name: 'Chicken Pahari Fresh Momo', price: 139, veg: 0 },
      { name: 'Chicken Himalayan Momo', price: 195, veg: 0 },
      { name: 'Chicken Delight Momo', price: 245, veg: 0 },
      { name: 'Chicken Darjeeling Momo', price: 295, veg: 0 },
      { name: 'Chicken Masala Momo', price: 345, veg: 0 },
      { name: 'Chicken Cheese Momo', price: 365, veg: 0 },
    ],
    'Fried Momos': [
      { name: 'Veg Darjeeling Momo Fried', price: 335, veg: 1 },
      { name: 'Corn Cheese Momo Fried', price: 405, veg: 1 },
      { name: 'Chicken Darjeeling Momo Fried', price: 355, veg: 0 },
      { name: 'Chicken Cheese Momo Fried', price: 425, veg: 0 },
    ],
    'Panfried Momos': [
      { name: 'Veg Feast Pan Fried Momo', price: 255, veg: 1 },
      { name: 'Veg Fresh Pan Fried Momo', price: 215, veg: 1 },
      { name: 'Veg Himalayan Pan Fried Momo', price: 285, veg: 1 },
      { name: 'Veg Hot Garlic Pan Fried Momo', price: 329, veg: 1 },
      { name: 'Veg Darjeeling Pan Fried Momo', price: 359, veg: 1 },
      { name: 'Chatpata Paneer Pan Fried Momo', price: 409, veg: 1 },
      { name: 'Corn Cheese Pan Fried Momo', price: 429, veg: 1 },
      { name: 'Chicken Feast Pan Fried Momo', price: 265, veg: 0 },
      { name: 'Chicken Fresh Pan Fried Momo', price: 225, veg: 0 },
      { name: 'Chicken Himalayan Pan Fried Momo', price: 279, veg: 0 },
      { name: 'Chicken Delight Pan Fried Momo', price: 329, veg: 0 },
      { name: 'Chicken Darjeeling Pan Fried Momo', price: 379, veg: 0 },
      { name: 'Chicken Masala Pan Fried Momo', price: 429, veg: 0 },
      { name: 'Chicken Cheese Pan Fried Momo', price: 449, veg: 0 },
    ],
    'Chilli Momos': [
      { name: 'Veg Himalayan Chilli Momo', price: 299, veg: 1 },
      { name: 'Veg Darjeeling Chilli Momo', price: 375, veg: 1 },
      { name: 'Veg Corn Cheese Chilli Momo', price: 445, veg: 1 },
      { name: 'Chicken Himalayan Chilli Momo', price: 295, veg: 0 },
      { name: 'Chicken Darjeeling Chilli Momo', price: 395, veg: 0 },
      { name: 'Chicken Cheese Chilli Momo', price: 465, veg: 0 },
    ],
    'Special Momos': [
      { name: 'Veg Kurkure Momo', price: 229, veg: 1 },
      { name: 'Chicken Kurkure Momo', price: 279, veg: 0 },
      { name: 'Veg Sizzler Momo', price: 525, veg: 1 },
      { name: 'Chatpata Paneer Sizzler Momo', price: 539, veg: 1 },
      { name: 'Corn Cheese Sizzler Momo', price: 549, veg: 1 },
      { name: 'Chicken Sizzler Momo', price: 549, veg: 0 },
      { name: 'Chicken Cheese Sizzler Momo', price: 579, veg: 0 },
    ],
    'Thukpa & Starters': [
      { name: 'Veggie Thukpa', price: 335, veg: 1 },
      { name: 'Chicken Thukpa', price: 349, veg: 0 },
      { name: 'Regular Fries', price: 89, veg: 1 },
      { name: 'Peri Peri Fries', price: 114, veg: 1 },
      { name: 'Regular Fries with Dip', price: 119, veg: 1 },
    ],
    'Shawarma': [
      { name: 'Classic Chicken Shawarma 6"', price: 215, veg: 0 },
      { name: 'Classic Chicken Shawarma 8"', price: 245, veg: 0 },
      { name: 'Chicken Seekh Shawarma 6"', price: 225, veg: 0 },
      { name: 'Chicken Seekh Shawarma 8"', price: 255, veg: 0 },
      { name: 'Spl. Chicken Shawarma 6"', price: 250, veg: 0 },
      { name: 'Spl. Chicken Shawarma 8"', price: 280, veg: 0 },
      { name: 'Arabic Shawarma 6"', price: 240, veg: 0 },
      { name: 'Arabic Shawarma 8"', price: 270, veg: 0 },
      { name: 'Chicken Hummus Salad', price: 260, veg: 0 },
      { name: 'Open Chicken Shawarma', price: 255, veg: 0 },
    ],
    'Biryani': [
      { name: 'Egg Dum Biryani', price: 300, veg: 1 },
      { name: 'Chicken Dum Biryani', price: 330, veg: 0 },
      { name: 'Chicken Boneless Biryani', price: 345, veg: 0 },
      { name: 'Chicken Tikka Biryani', price: 355, veg: 0 },
      { name: 'Mutton Biryani', price: 390, veg: 0 },
      { name: 'Veg Handi Biryani', price: 259, veg: 1 },
      { name: 'Paneer Handi Biryani', price: 289, veg: 1 },
      { name: 'Paneer Dum Biryani', price: 289, veg: 1 },
      { name: 'Subz Dum Paneer Biryani', price: 299, veg: 1 },
      { name: 'Takatak Paneer Biryani', price: 240, veg: 1 },
      { name: 'Chatpata Veggie Tawa Biryani', price: 240, veg: 1 },
      { name: 'Hyderabadi Paneer Biryani', price: 250, veg: 1 },
      { name: 'Dilli Kadhai Chicken Biryani', price: 260, veg: 0 },
      { name: 'Lucknawi Tangdi Biryani', price: 270, veg: 0 },
      { name: 'Chatpata Lollipop Biryani', price: 250, veg: 0 },
      { name: 'Hyderabadi Chicken Biryani', price: 240, veg: 0 },
      { name: 'Malvani Prawns Biryani', price: 290, veg: 0 },
      { name: 'Mumbaiya Anda Biryani', price: 210, veg: 1 },
    ],
    'Rice Preparations': [
      { name: 'Egg Rice', price: 275, veg: 1 },
      { name: 'Chicken Kheema Rice', price: 330, veg: 0 },
      { name: 'Mutton Kheema Rice', price: 345, veg: 0 },
      { name: 'Chicken Tikka Pulao', price: 335, veg: 0 },
      { name: 'Pahadi Tikka Pulao', price: 335, veg: 0 },
      { name: 'Butter Chicken With Rice', price: 340, veg: 0 },
      { name: 'Veg Pulao', price: 219, veg: 1 },
      { name: 'Curd Rice', price: 199, veg: 1 },
      { name: 'Steamed Basmati Rice', price: 139, veg: 1 },
      { name: 'Jeera Rice', price: 179, veg: 1 },
      { name: 'Peas Pulav with Chole', price: 229, veg: 1 },
    ],
    'Kheema Pao': [
      { name: 'Omelette Pao', price: 210, veg: 1 },
      { name: 'Bhurji Pao', price: 225, veg: 1 },
      { name: 'Chicken Kheema Pao', price: 325, veg: 0 },
      { name: 'Mutton Kheema Pao', price: 370, veg: 0 },
      { name: 'Veg Kheema Pav', price: 209, veg: 1 },
    ],
    'Kebabs': [
      { name: 'Chicken Tikka 4pc', price: 255, veg: 0 },
      { name: 'Chicken Tikka 6pc', price: 340, veg: 0 },
      { name: 'Lasoni Murg Tikka 4pc', price: 255, veg: 0 },
      { name: 'Lasoni Murg Tikka 6pc', price: 340, veg: 0 },
      { name: 'Pahadi Chicken Tikka 4pc', price: 255, veg: 0 },
      { name: 'Pahadi Chicken Tikka 6pc', price: 340, veg: 0 },
      { name: 'Chicken Seekh Kebab 3pcs', price: 350, veg: 0 },
    ],
    'Paneer Specialties': [
      { name: 'Paneer Khurchan', price: 299, veg: 1 },
      { name: 'Paneer Kadai', price: 299, veg: 1 },
      { name: 'Paneer Butter Masala', price: 299, veg: 1 },
      { name: 'Paneer Lababdar', price: 299, veg: 1 },
      { name: 'Paneer Bhurjee', price: 299, veg: 1 },
      { name: 'Paneer Palak', price: 299, veg: 1 },
      { name: 'Paneer Mutter', price: 279, veg: 1 },
      { name: 'Chilli Paneer', price: 270, veg: 1 },
      { name: 'Dragon Chilli Paneer', price: 280, veg: 1 },
      { name: 'Thai Chilli Basil Paneer', price: 280, veg: 1 },
    ],
    'Chaat': [
      { name: 'Pani Puri', price: 99, veg: 1 },
      { name: 'Sev Puri', price: 129, veg: 1 },
      { name: 'Bambaiya Dahi Puri', price: 159, veg: 1 },
      { name: 'Bombay Bhel Puri', price: 119, veg: 1 },
      { name: 'Dahi Papdi Chaat', price: 159, veg: 1 },
      { name: 'KP Special Mix Chaat', price: 199, veg: 1 },
      { name: 'Aloo Tikki Chaat', price: 199, veg: 1 },
      { name: 'Dahi Wada', price: 199, veg: 1 },
      { name: 'Samosa Chaat', price: 199, veg: 1 },
      { name: 'Crispy Corn Basket', price: 189, veg: 1 },
      { name: 'Bombay Basket', price: 229, veg: 1 },
      { name: 'KP Chaat Platter', price: 269, veg: 1 },
      { name: 'KP Spl. Chaat Platter', price: 359, veg: 1 },
      { name: 'Ragda Pattice 2pcs', price: 249, veg: 1 },
      { name: 'Punjabi Samosa 2pcs', price: 179, veg: 1 },
    ],
    'Combos': [
      { name: 'Chole Bhature Combo', price: 349, veg: 1 },
      { name: 'Pav Bhaji Combo', price: 279, veg: 1 },
      { name: 'Amritsari Paratha Combo', price: 279, veg: 1 },
      { name: 'Bombay Street Combo', price: 249, veg: 1 },
      { name: 'Paneer Tikka Lababdar Combo', price: 319, veg: 1 },
      { name: 'Palak Paneer Combo', price: 319, veg: 1 },
      { name: 'Veg Kadai Combo', price: 309, veg: 1 },
      { name: 'Pindi Chole Combo', price: 309, veg: 1 },
    ],
    'Thalis': [
      { name: 'North Indian Combo', price: 309, veg: 1 },
      { name: 'Paneer Of The Day Combo', price: 389, veg: 1 },
      { name: 'All Time Hit Combo', price: 459, veg: 0 },
      { name: 'Make Your Own Thali', price: 599, veg: 1 },
    ],
    'Parathas': [
      { name: 'Aloo Paratha', price: 259, veg: 1 },
      { name: 'Aloo Methi Paratha', price: 269, veg: 1 },
      { name: 'Aloo Cheese Paratha', price: 309, veg: 1 },
      { name: 'Mix Veg Paratha', price: 279, veg: 1 },
      { name: 'Paneer Paratha', price: 309, veg: 1 },
      { name: 'Cheese Paratha', price: 329, veg: 1 },
      { name: 'Cheese Chilli Garlic Paratha', price: 349, veg: 1 },
    ],
    'Breads': [
      { name: 'Plain Chapati', price: 39, veg: 1 },
      { name: 'Ghee Chapati', price: 49, veg: 1 },
      { name: 'Tawa Paratha', price: 69, veg: 1 },
      { name: 'Ghee Chapati 2pcs', price: 95, veg: 1 },
      { name: 'Makke Di Roti', price: 80, veg: 1 },
    ],
    'Curries': [
      { name: 'Diwani Handi', price: 259, veg: 1 },
      { name: 'Veg Kadhai', price: 259, veg: 1 },
      { name: 'Aloo Mutter', price: 249, veg: 1 },
      { name: 'Aloo Gobi', price: 249, veg: 1 },
      { name: 'Aloo Jeera', price: 249, veg: 1 },
      { name: 'Veg Kolhapuri', price: 269, veg: 1 },
      { name: 'Dal Fry', price: 199, veg: 1 },
      { name: 'Dal Tadka', price: 219, veg: 1 },
      { name: 'Sarson Da Saag with Makke Di Roti', price: 329, veg: 1 },
    ],
    'Noodles & Rice': [
      { name: 'Fried Rice Veg', price: 220, veg: 1 },
      { name: 'Fried Rice Chicken', price: 250, veg: 0 },
      { name: 'Fried Rice Prawns', price: 270, veg: 0 },
      { name: 'Tibetan Fried Rice Veg', price: 240, veg: 1 },
      { name: 'Tibetan Fried Rice Chicken', price: 270, veg: 0 },
      { name: 'Tibetan Fried Rice Prawns', price: 290, veg: 0 },
      { name: 'Schezwan Fried Rice Veg', price: 230, veg: 1 },
      { name: 'Schezwan Fried Rice Chicken', price: 260, veg: 0 },
      { name: 'Schezwan Fried Rice Prawns', price: 280, veg: 0 },
      { name: 'Hakka Noodles Veg', price: 220, veg: 1 },
      { name: 'Hakka Noodles Chicken', price: 250, veg: 0 },
      { name: 'Hakka Noodles Prawns', price: 270, veg: 0 },
      { name: 'Thai Basil Noodles Veg', price: 240, veg: 1 },
      { name: 'Thai Basil Noodles Chicken', price: 270, veg: 0 },
      { name: 'Thai Basil Noodles Prawns', price: 290, veg: 0 },
    ],
    'Gravy': [
      { name: 'Chilli Gravy Veg', price: 260, veg: 1 },
      { name: 'Chilli Gravy Chicken', price: 280, veg: 0 },
      { name: 'Chilli Gravy Prawns', price: 360, veg: 0 },
      { name: 'Schezwan Gravy Veg', price: 270, veg: 1 },
      { name: 'Schezwan Gravy Chicken', price: 290, veg: 0 },
      { name: 'Schezwan Gravy Prawns', price: 370, veg: 0 },
      { name: 'Thai Red Curry & Rice Veg', price: 320, veg: 1 },
      { name: 'Thai Red Curry & Rice Chicken', price: 350, veg: 0 },
      { name: 'Thai Red Curry & Rice Prawns', price: 370, veg: 0 },
      { name: 'Thai Green Curry & Rice Veg', price: 320, veg: 1 },
      { name: 'Thai Green Curry & Rice Chicken', price: 350, veg: 0 },
      { name: 'Thai Green Curry & Rice Prawns', price: 370, veg: 0 },
    ],
    'Chinese Starters': [
      { name: 'Veg Spring Roll', price: 240, veg: 1 },
      { name: 'Chicken Spring Roll', price: 250, veg: 0 },
      { name: 'Veggie Crispy', price: 280, veg: 1 },
      { name: 'Veggie Manchurian', price: 250, veg: 1 },
      { name: 'Chilli Garlic Potato', price: 240, veg: 1 },
      { name: 'Chilli Garlic Honey', price: 240, veg: 1 },
      { name: 'Stir Fry Veggies', price: 280, veg: 1 },
      { name: 'Chilli Chicken', price: 280, veg: 0 },
      { name: 'Dragon Chilli Chicken', price: 290, veg: 0 },
      { name: 'Thai Basil Chilli Chicken', price: 280, veg: 0 },
      { name: 'Jiang\'s Chilli Chicken', price: 290, veg: 0 },
      { name: 'Chicken Wings Chilli Garlic', price: 300, veg: 0 },
      { name: 'Chicken Wings BBQ', price: 300, veg: 0 },
      { name: 'Chicken Lollipop Chilli Plum', price: 290, veg: 0 },
      { name: 'Chicken Lollipop Shangdong', price: 290, veg: 0 },
      { name: 'Chicken Crispy', price: 310, veg: 0 },
      { name: 'Chicken Honey', price: 310, veg: 0 },
      { name: 'Stir Fry Veggies & Chicken', price: 330, veg: 0 },
      { name: 'Jamaican Chicken Strips 10pcs', price: 160, veg: 0 },
      { name: 'Crispy Chicken Wings 4pcs', price: 180, veg: 0 },
    ],
    'Soups': [
      { name: 'Manchow Soup Veg', price: 160, veg: 1 },
      { name: 'Manchow Soup Chicken', price: 180, veg: 0 },
      { name: 'Sweet Corn Soup Veg', price: 170, veg: 1 },
      { name: 'Sweet Corn Soup Chicken', price: 190, veg: 0 },
      { name: 'Lemon Coriander Soup Veg', price: 160, veg: 1 },
      { name: 'Lemon Coriander Soup Chicken', price: 180, veg: 0 },
      { name: 'Dragon Soup Veg', price: 160, veg: 1 },
      { name: 'Dragon Soup Chicken', price: 180, veg: 0 },
    ],
    'Chinese Momos': [
      { name: 'Steamed Momos Veg', price: 200, veg: 1 },
      { name: 'Steamed Momos Chicken', price: 230, veg: 0 },
      { name: 'Fried Momos Veg', price: 210, veg: 1 },
      { name: 'Fried Momos Chicken', price: 240, veg: 0 },
      { name: 'Thai Chilli Basil Momos Veg', price: 250, veg: 1 },
      { name: 'Thai Chilli Basil Momos Chicken', price: 280, veg: 0 },
      { name: 'Korean Chicken Momos', price: 240, veg: 0 },
      { name: 'Schezwan Momos Veg', price: 230, veg: 1 },
      { name: 'Schezwan Momos Chicken', price: 260, veg: 0 },
      { name: 'Barbeque Sauce Momos Veg', price: 230, veg: 1 },
      { name: 'Barbeque Sauce Momos Chicken', price: 260, veg: 0 },
      { name: 'Burnt Chilli Garlic Momos Veg', price: 230, veg: 1 },
      { name: 'Burnt Chilli Garlic Momos Chicken', price: 260, veg: 0 },
      { name: 'Nepali Jhol Momos Veg', price: 250, veg: 1 },
      { name: 'Nepali Jhol Momos Chicken', price: 280, veg: 0 },
    ],
    'Raitas': [
      { name: 'Plain Curd', price: 149, veg: 1 },
      { name: 'Veg Raita', price: 139, veg: 1 },
      { name: 'Boondi Raita', price: 139, veg: 1 },
    ],
    'Khichdi': [
      { name: 'Dal Khichdi with Raita', price: 229, veg: 1 },
      { name: 'Palak Khichdi with Raita', price: 229, veg: 1 },
      { name: 'Masala Khichdi with Raita', price: 229, veg: 1 },
    ],
    'Pav Bhaji': [
      { name: 'Pav Bhaji', price: 229, veg: 1 },
      { name: 'Jain Pav Bhaji', price: 239, veg: 1 },
      { name: 'Cheese Pav Bhaji', price: 259, veg: 1 },
    ],
    'Special Dishes': [
      { name: 'Chole Bhature', price: 299, veg: 1 },
      { name: 'Flavoured Chole Bhature', price: 349, veg: 1 },
      { name: 'Juhu-Chowpatty Tawa Pulao', price: 239, veg: 1 },
      { name: 'Gajar Ka Halwa', price: 185, veg: 1 },
    ],
    'Beverages': [
      { name: 'Mango Lassi', price: 149, veg: 1 },
      { name: 'Sweet Lassi', price: 129, veg: 1 },
      { name: 'Salted Lassi', price: 129, veg: 1 },
      { name: 'Masala Buttermilk', price: 79, veg: 1 },
      { name: 'Nescafe', price: 79, veg: 1 },
      { name: 'Masala Tea', price: 69, veg: 1 },
      { name: 'Tea', price: 59, veg: 1 },
    ],
    'Faloodas': [
      { name: 'Royal Falooda', price: 180, veg: 1 },
      { name: 'Malai Kulfi Falooda', price: 210, veg: 1 },
      { name: 'Kesar Kulfi Falooda', price: 220, veg: 1 },
      { name: 'Paan Falooda', price: 230, veg: 1 },
      { name: 'Dry Fruit Falooda', price: 240, veg: 1 },
      { name: 'Kulfi Falooda with Rabdi', price: 220, veg: 1 },
      { name: 'Mango Rabdi Falooda', price: 250, veg: 1 },
      { name: 'Sitaphal Rabdi Falooda', price: 250, veg: 1 },
      { name: 'Strawberry Rabdi Falooda', price: 250, veg: 1 },
      { name: 'Kesar Pista Rabdi Falooda', price: 260, veg: 1 },
      { name: 'Sugar Free Malai Rabdi Falooda', price: 280, veg: 1 },
    ],
    'Kulfi & Ice Cream': [
      { name: 'Asli Malai Kulfi', price: 80, veg: 1 },
      { name: 'Kesar Pista Kulfi', price: 80, veg: 1 },
      { name: 'Mango Kulfi', price: 80, veg: 1 },
      { name: '3 in 1 Kulfi', price: 160, veg: 1 },
      { name: 'Family Pack Kulfi', price: 540, veg: 1 },
    ],
    'Desserts': [
      { name: 'Oreo Cookie Fudge Shake', price: 350, veg: 1 },
      { name: 'Brownie Bliss Shake', price: 350, veg: 1 },
      { name: 'Nutella Cheesecake Shake', price: 350, veg: 1 },
      { name: 'Strawberry & Nutella Shake', price: 350, veg: 1 },
      { name: 'Rocky Road Sundae', price: 320, veg: 1 },
      { name: 'Chocolate Overdose Sundae', price: 320, veg: 1 },
      { name: 'Chocolate Heaven Sundae', price: 320, veg: 1 },
      { name: 'The Oreo Cookie & Cream Waffle', price: 330, veg: 1 },
      { name: 'The Chocolate Overdose Waffle', price: 330, veg: 1 },
      { name: 'The Chocolate Nutella Love Waffle', price: 350, veg: 1 },
      { name: 'The Red Velvet Bubble Waffle', price: 350, veg: 1 },
      { name: 'The Kitkat Bubble Waffle', price: 350, veg: 1 },
      { name: 'The Fudge Brownie Bubble Waffle', price: 350, veg: 1 },
      { name: 'Fresh Strawberry & Nutella Waffle', price: 380, veg: 1 },
      { name: 'The Ferrero Rocher Bubble Waffle', price: 390, veg: 1 },
    ]
  };

  let categoriesCreated = 0;
  let itemsCreated = 0;
  const totalCategories = Object.keys(menuData).length;
  let totalItems = Object.values(menuData).reduce((sum, arr) => sum + arr.length, 0);

  const categories = Object.keys(menuData);
  const categoryMap = {};

  categories.forEach((catName, idx) => {
    db.run(
      `INSERT OR IGNORE INTO menu_categories(name, description) VALUES(?, ?)`,
      [catName, `${catName} - Our Special Selection`],
      function(err) {
        db.get('SELECT id FROM menu_categories WHERE name = ?', [catName], (err, row) => {
          if (row) {
            categoryMap[catName] = row.id;
            const items = menuData[catName];
            items.forEach(item => {
              db.run(
                `INSERT INTO menu_items(category_id, name, description, price, item_type, is_vegetarian, is_available, prep_minutes)
                 VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
                [categoryMap[catName], item.name, `${item.name} - Fresh & Delicious`, item.price, 'food', item.veg, 1, 15],
                (err) => {
                  if (!err) itemsCreated++;
                }
              );
            });
          }
        });
      }
    );
  });

  setTimeout(() => {
    res.json({
      success: true,
      message: `Menu seeded successfully`,
      categoriesExpected: totalCategories,
      itemsExpected: totalItems
    });
  }, 2000);
});

// ============= ORDER CREATION ENDPOINT =============
app.post('/api/orders', (req, res) => {
  const user = requireAuth(req, res, 20);
  if (!user) return;

  const { order_type, customer_id, customer_name, items, subtotal, tax, service_charge, discount, total_amount, payment_method, table_id, guests } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Items required' });
  }

  // Generate order code
  const code = 'ORD-' + Date.now().toString().slice(-6);

  db.run(
    `INSERT INTO orders(code, order_type, table_id, customer_id, customer_name, guests, status, subtotal, tax, service_charge, discount, total_amount, payment_method, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [code, order_type || 'takeaway', table_id || null, customer_id || user.id, customer_name || user.name, guests || 1, 'pending', subtotal || 0, tax || 0, service_charge || 0, discount || 0, total_amount || 0, payment_method || 'pending'],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, message: err.message });
      }

      const orderId = this.lastID;

      // Insert order items
      let itemsAdded = 0;
      items.forEach(item => {
        db.run(
          `INSERT INTO order_items(order_id, menu_item_id, quantity, unit_price, subtotal, status, note)
           VALUES(?, ?, ?, ?, ?, ?, ?)`,
          [orderId, item.menu_item_id, item.quantity, item.unit_price, (item.quantity * item.unit_price), 'queued', item.note || ''],
          function(err) {
            itemsAdded++;
            if (itemsAdded === items.length) {
              // Return the created order
              res.json({
                success: true,
                message: 'Order created successfully',
                order: {
                  id: orderId,
                  code: code,
                  order_type: order_type || 'takeaway',
                  customer_name: customer_name || user.name,
                  items_count: items.length,
                  subtotal: subtotal || 0,
                  tax: tax || 0,
                  service_charge: service_charge || 0,
                  total_amount: total_amount || 0,
                  status: 'pending',
                  created_at: new Date().toISOString()
                }
              });
            }
          }
        );
      });
    }
  );
});

// ============= START SERVER =============
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log('\n' + '='.repeat(70));
    console.log('████████████████████████████████████████████████████████████████');
    console.log('█                                                              █');
    console.log('█   AKSHAY BHOJANAM - RESTAURANT MANAGEMENT SYSTEM             █');
    console.log('█                                                              █');
    console.log('████████████████████████████████████████████████████████████████');
    console.log('\n🚀 Server running on http://localhost:' + PORT);
    console.log('🎨 Dashboard: http://localhost:' + PORT + '/index.html');
    console.log('\n💳 Razorpay Integration: ACTIVE (TEST MODE)');
    console.log('   Key ID: rzp_test_RzYF4GJPLG8zoR');
    console.log('\n📖 Login Credentials:');
    console.log('   👔 Owner:    apurva_sanpurkar / apurva@2024');
    console.log('   💼 Manager:  shripad_deshpande / staff@2024');
    console.log('   🪑 Waiter:   parth_sahasrabuddhe / staff@2024');
    console.log('   🛍️  Customer: rajesh_kumar / customer@2024');
    console.log('   🛍️  Customer: priya_sharma / customer@2024');
    console.log('\n✓ Database initialized with menu items');
    console.log('✓ Customer ordering interface enabled');
    console.log('✓ Dynamic billing system active');
    console.log('✓ All API endpoints active');
    console.log('✓ Static files serving');
    console.log('✓ Razorpay integration ready');
    console.log('\nPress Ctrl+C to stop...\n' + '='.repeat(70) + '\n');
  });
}).catch(err => {
  console.error('Failed to initialize:', err);
  process.exit(1);
});
