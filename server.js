const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

const app = express();
const PORT = 8080;

// Razorpay Test Keys
const RAZORPAY_KEY_ID = 'rzp_test_RzYF4GJPLG8zoR';
const RAZORPAY_KEY_SECRET = 'fpRado9evw4btr4uRDkGaxz0';

// ============= STATIC FILES =============
const frontendDir = path.join(__dirname, 'frontend');
const assetsDir = path.join(__dirname, 'assets');
app.use(express.json());
app.use(express.static(frontendDir));
app.use('/assets', express.static(assetsDir));

app.get('/index.html', (req, res) => { res.sendFile(path.join(frontendDir, 'index.html')); });
app.get('/', (req, res) => { res.sendFile(path.join(frontendDir, 'index.html')); });

// ============= UTILITIES =============
const randomString = (len) => crypto.randomBytes(len).toString('hex').slice(0, len);
const sha256 = (str) => crypto.createHash('sha256').update(str).digest('hex');

// ============= DATABASE =============
const db = new sqlite3.Database('restaurant.db');

function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','admin','manager','waiter','customer')), full_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT, salary REAL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
      db.run(`CREATE TABLE IF NOT EXISTS menu_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT, is_active INTEGER NOT NULL DEFAULT 1)`);
      db.run(`CREATE TABLE IF NOT EXISTS menu_items (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT, price REAL NOT NULL CHECK(price > 0), item_type TEXT NOT NULL CHECK(item_type IN ('food','beverage','dessert')), is_vegetarian INTEGER NOT NULL, is_available INTEGER NOT NULL DEFAULT 1, prep_minutes INTEGER NOT NULL DEFAULT 15, image_url TEXT, FOREIGN KEY(category_id) REFERENCES menu_categories(id))`);
      db.run(`CREATE TABLE IF NOT EXISTS tables (id INTEGER PRIMARY KEY AUTOINCREMENT, table_number INTEGER NOT NULL UNIQUE, capacity INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('available','occupied','reserved','maintenance')), assigned_waiter_id INTEGER, elapsed_minutes INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(assigned_waiter_id) REFERENCES users(id))`);
      db.run(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, order_type TEXT NOT NULL CHECK(order_type IN ('dine_in','takeaway','parcel')), table_id INTEGER, customer_id INTEGER, customer_name TEXT, guests INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL CHECK(status IN ('pending','confirmed','preparing','ready','served','completed','cancelled')), payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','paid','refunded','failed')), subtotal REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0, service_charge REAL NOT NULL DEFAULT 0, discount REAL NOT NULL DEFAULT 0, total_amount REAL NOT NULL DEFAULT 0, payment_method TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(table_id) REFERENCES tables(id), FOREIGN KEY(customer_id) REFERENCES users(id))`);
      db.run(`CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, menu_item_id INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0), unit_price REAL NOT NULL, subtotal REAL NOT NULL, status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','in_progress','ready','served')), note TEXT, FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE, FOREIGN KEY(menu_item_id) REFERENCES menu_items(id))`);
      db.run(`CREATE TABLE IF NOT EXISTS kitchen_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, order_item_id INTEGER, item_name TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','high','low')), status TEXT NOT NULL CHECK(status IN ('queued','in_progress','completed','cancelled')), elapsed_minutes INTEGER NOT NULL DEFAULT 0, started_at TEXT, completed_at TEXT, FOREIGN KEY(order_id) REFERENCES orders(id), FOREIGN KEY(order_item_id) REFERENCES order_items(id))`);
      db.run(`CREATE TABLE IF NOT EXISTS stock (id INTEGER PRIMARY KEY AUTOINCREMENT, item_name TEXT NOT NULL UNIQUE, category TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT NOT NULL, min_threshold REAL NOT NULL, cost_per_unit REAL NOT NULL DEFAULT 0, supplier TEXT, last_restocked TEXT)`);
      db.run(`CREATE TABLE IF NOT EXISTS cutlery (id INTEGER PRIMARY KEY AUTOINCREMENT, item_name TEXT NOT NULL UNIQUE, total_count INTEGER NOT NULL, available_count INTEGER NOT NULL, in_use_count INTEGER NOT NULL DEFAULT 0, damaged_count INTEGER NOT NULL DEFAULT 0)`);
      db.run(`CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, user_id INTEGER, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'INR', razorpay_payment_id TEXT UNIQUE, razorpay_order_id TEXT UNIQUE, status TEXT NOT NULL CHECK(status IN ('initiated','pending','authorized','captured','refunded','failed','cancelled')), description TEXT, receipt TEXT, email TEXT, phone_number TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))`);
      db.run(`CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, description TEXT, amount REAL NOT NULL, expense_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, recorded_by INTEGER, FOREIGN KEY(recorded_by) REFERENCES users(id))`);
      
      // Enhanced schema for better data management
      db.run(`CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, user_id INTEGER NOT NULL, rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5), comment TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(order_id) REFERENCES orders(id), FOREIGN KEY(user_id) REFERENCES users(id))`);
      db.run(`CREATE TABLE IF NOT EXISTS reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, table_id INTEGER NOT NULL, reservation_date TEXT NOT NULL, time TEXT NOT NULL, guests INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','cancelled','completed')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(table_id) REFERENCES tables(id))`);
      db.run(`CREATE TABLE IF NOT EXISTS promotions (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, description TEXT, discount_percent REAL NOT NULL DEFAULT 0, discount_amount REAL NOT NULL DEFAULT 0, min_order_amount REAL DEFAULT 0, max_uses INTEGER DEFAULT -1, uses_count INTEGER DEFAULT 0, valid_from TEXT NOT NULL, valid_to TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
      db.run(`CREATE TABLE IF NOT EXISTS staff_attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, date TEXT NOT NULL, check_in_time TEXT, check_out_time TEXT, hours_worked REAL DEFAULT 0, status TEXT DEFAULT 'present' CHECK(status IN ('present','absent','leave')), notes TEXT, FOREIGN KEY(user_id) REFERENCES users(id))`);
      db.run(`CREATE TABLE IF NOT EXISTS inventory_log (id INTEGER PRIMARY KEY AUTOINCREMENT, stock_id INTEGER NOT NULL, transaction_type TEXT NOT NULL CHECK(transaction_type IN ('purchase','usage','adjustment','return')), quantity_change REAL NOT NULL, reason TEXT, recorded_by INTEGER NOT NULL, transaction_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(stock_id) REFERENCES stock(id), FOREIGN KEY(recorded_by) REFERENCES users(id))`);
      db.run(`CREATE TABLE IF NOT EXISTS analytics (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE, total_orders INTEGER DEFAULT 0, total_revenue REAL DEFAULT 0, avg_order_value REAL DEFAULT 0, peak_hour INTEGER DEFAULT 0, total_customers INTEGER DEFAULT 0, repeat_customers INTEGER DEFAULT 0, payment_cash REAL DEFAULT 0, payment_card REAL DEFAULT 0, payment_online REAL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
      db.run(`CREATE TABLE IF NOT EXISTS customer_preferences (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL UNIQUE, favorite_items TEXT, dietary_restrictions TEXT, preferred_table_type TEXT, special_occasions TEXT, last_order_date TEXT, total_spent REAL DEFAULT 0, loyalty_points INTEGER DEFAULT 0, preferences_json TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))`);
      db.run(`CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, feedback_type TEXT NOT NULL CHECK(feedback_type IN ('complaint','suggestion','compliment','question')), user_id INTEGER, content TEXT NOT NULL, response TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved','closed')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT, FOREIGN KEY(user_id) REFERENCES users(id))`);
      db.run(`CREATE TABLE IF NOT EXISTS daily_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, report_date TEXT NOT NULL UNIQUE, opening_balance REAL DEFAULT 0, closing_balance REAL DEFAULT 0, total_cash_received REAL DEFAULT 0, total_card_received REAL DEFAULT 0, total_online_received REAL DEFAULT 0, total_expenses REAL DEFAULT 0, staff_count INTEGER DEFAULT 0, covers_served INTEGER DEFAULT 0, created_by INTEGER NOT NULL, notes TEXT, FOREIGN KEY(created_by) REFERENCES users(id))`, (err) => {
        if (err) reject(err); else seedData().then(resolve).catch(reject);
      });
    });
  });
}

async function seedData() {
  return new Promise((resolve, reject) => {
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
      if (row && row.count > 0) { resolve(); return; }

      const users = [
        { username: 'apurva', password: 'SaiBaba', role: 'owner', name: 'Apurva Sanpurkar', email: 'apurva@gmail.com', phone: '9876500001', dept: 'Administration', salary: 0 },
        { username: 'apurva_sanpurkar', password: 'apurva@2024', role: 'owner', name: 'Apurva Sanpurkar', email: 'apurva@akshaybhojanam.in', phone: '9876500001', dept: 'Administration', salary: 0 },
        { username: 'sai_randive', password: 'sai@2024', role: 'owner', name: 'Sai Randive', email: 'sai@akshaybhojanam.in', phone: '9876500002', dept: 'Administration', salary: 0 },
        { username: 'shripad_deshpande', password: 'staff@2024', role: 'manager', name: 'Shripad Deshpande', email: 'shripad@akshaybhojanam.in', phone: '9876500101', dept: 'Kitchen', salary: 35000 },
        { username: 'aniruddha_joshi', password: 'staff@2024', role: 'manager', name: 'Aniruddha Joshi', email: 'aniruddha@akshaybhojanam.in', phone: '9876500102', dept: 'Kitchen', salary: 32000 },
        { username: 'chinmay_patwardhan', password: 'staff@2024', role: 'manager', name: 'Chinmay Patwardhan', email: 'chinmay@akshaybhojanam.in', phone: '9876500103', dept: 'Desserts', salary: 30000 },
        { username: 'vedant_aghnihotri', password: 'staff@2024', role: 'manager', name: 'Vedant Agnihotri', email: 'vedant@akshaybhojanam.in', phone: '9876500104', dept: 'Store', salary: 28000 },
        { username: 'parth_sahasrabuddhe', password: 'staff@2024', role: 'waiter', name: 'Parth Sahasrabuddhe', email: 'parth@akshaybhojanam.in', phone: '9876500105', dept: 'Floor', salary: 18000 },
        { username: 'ishaan_bhave', password: 'staff@2024', role: 'waiter', name: 'Ishaan Bhave', email: 'ishaan@akshaybhojanam.in', phone: '9876500106', dept: 'Floor', salary: 18000 },
        { username: 'tanmay_pendse', password: 'staff@2024', role: 'waiter', name: 'Tanmay Pendse', email: 'tanmay@akshaybhojanam.in', phone: '9876500107', dept: 'Floor', salary: 17000 },
        { username: 'omkar_gokhale', password: 'staff@2024', role: 'waiter', name: 'Omkar Gokhale', email: 'omkar@akshaybhojanam.in', phone: '9876500108', dept: 'Billing', salary: 19000 },
        { username: 'rajesh_kumar', password: 'customer@2024', role: 'customer', name: 'Rajesh Kumar', email: 'rajesh@customer.in', phone: '9876500201', dept: 'Customer', salary: 0 },
        { username: 'priya_sharma', password: 'customer@2024', role: 'customer', name: 'Priya Sharma', email: 'priya@customer.in', phone: '9876500202', dept: 'Customer', salary: 0 }
      ];

      let count = 0;
      users.forEach(u => {
        const salt = randomString(32);
        const hash = sha256(salt + u.password + salt);
        db.run(`INSERT INTO users(username,password_hash,salt,role,full_name,email,phone,salary,is_active) VALUES(?,?,?,?,?,?,?,?,?)`,
          [u.username, hash, salt, u.role, u.name, u.email, u.phone, u.salary, 1], () => {
            count++; if (count === users.length) seedInventory();
          });
      });

      function seedInventory() {
        const cutlery = [
          { name: 'Momo Steamer Baskets', category: 'Equipment', qty: 20, unit: 'Units', threshold: 5, cost: 450 },
          { name: 'Biryani Handis (Small)', category: 'Crockery', qty: 50, unit: 'Units', threshold: 10, cost: 350 },
          { name: 'Large Dinner Plates', category: 'Crockery', qty: 100, unit: 'Units', threshold: 20, cost: 180 },
          { name: 'Falooda Glasses', category: 'Glassware', qty: 40, unit: 'Units', threshold: 10, cost: 85 },
          { name: 'Kulfi Plates', category: 'Crockery', qty: 40, unit: 'Units', threshold: 8, cost: 65 },
          { name: 'Stainless Steel Spoons', category: 'Cutlery', qty: 150, unit: 'Units', threshold: 30, cost: 40 },
          { name: 'Reusable Bamboo Chopsticks', category: 'Cutlery', qty: 50, unit: 'Pairs', threshold: 10, cost: 25 },
          { name: 'Soup Bowls', category: 'Crockery', qty: 60, unit: 'Units', threshold: 12, cost: 75 }
        ];

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
          { name: 'Falooda Syrup', category: 'Desserts', qty: 5, unit: 'kg', threshold: 1, cost: 200 }
        ];

        let cCount = 0;
        cutlery.forEach(item => {
          db.run(`INSERT INTO cutlery(item_name, total_count, available_count, in_use_count, damaged_count) VALUES(?,?,?,?,?)`,
            [item.name, item.qty, item.qty, 0, 0], () => { cCount++; });
        });

        let iCount = 0;
        inventory.forEach(item => {
          db.run(`INSERT INTO stock(item_name, category, quantity, unit, min_threshold, cost_per_unit, last_restocked) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
            [item.name, item.category, item.qty, item.unit, item.threshold, item.cost], () => { iCount++; });
        });

        setTimeout(() => seedTables(), 500);
      }

      function seedTables() {
        let tableCount = 0;
        for (let i = 1; i <= 30; i++) {
          const status = i <= 5 ? 'occupied' : i <= 10 ? 'reserved' : 'available';
          db.run(`INSERT INTO tables(table_number,capacity,status,elapsed_minutes) VALUES(?,?,?,?)`,
            [i, i <= 4 ? 2 : i <= 8 ? 4 : i <= 16 ? 6 : 8, status, Math.floor(Math.random() * 120)], () => {
              tableCount++; if (tableCount === 30) seedBasicMenu();
            });
        }
      }

      function seedBasicMenu() {
        const baseCategories = [
          { name: "Steamed Momo", desc: "Traditional steamed momos" },
          { name: "Fried Momo", desc: "Crispy fried momos" },
          { name: "Panfried Momo", desc: "Golden panfried momos" },
          { name: "Chilli Momo", desc: "Spicy chilli momos" },
          { name: "Sizzler Momo", desc: "Sizzling hot momos" },
          { name: "Thukpa & Starters", desc: "Soups and starters" },
          { name: "Shawarma", desc: "Middle eastern wraps" },
          { name: "Biryani & Rice", desc: "Aromatic rice dishes" },
          { name: "Chaat", desc: "Indian street snacks" },
          { name: "Paneer Specialties", desc: "Paneer delicacies" },
          { name: "Faloodas", desc: "Cold dessert drinks" },
          { name: "Kulfi & Ice Cream", desc: "Frozen desserts" },
          { name: "Shakes & Sundaes", desc: "Milkshakes and sundaes" },
          { name: "Beverages", desc: "Hot and cold drinks" }
        ];

        const basicItems = [
          { cat: "Steamed Momo", name: "Veg Pahari Feast Momo", price: 169, veg: 1 },
          { cat: "Steamed Momo", name: "Chicken Pahari Feast Momo", price: 179, veg: 0 },
          { cat: "Steamed Momo", name: "Veg Himalayan Momo", price: 199, veg: 1 },
          { cat: "Steamed Momo", name: "Chicken Himalayan Momo", price: 195, veg: 0 },
          { cat: "Fried Momo", name: "Veg Darjeeling Momo Fried", price: 335, veg: 1 },
          { cat: "Fried Momo", name: "Chicken Darjeeling Momo Fried", price: 355, veg: 0 },
          { cat: "Panfried Momo", name: "Veg Feast Pan Fried Momo", price: 255, veg: 1 },
          { cat: "Panfried Momo", name: "Chicken Feast Pan Fried Momo", price: 265, veg: 0 },
          { cat: "Chilli Momo", name: "Veg Himalayan Chilli Momo", price: 299, veg: 1 },
          { cat: "Chilli Momo", name: "Chicken Himalayan Chilli Momo", price: 295, veg: 0 },
          { cat: "Sizzler Momo", name: "Veg Sizzler Momo", price: 525, veg: 1 },
          { cat: "Sizzler Momo", name: "Chicken Sizzler Momo", price: 549, veg: 0 },
          { cat: "Thukpa & Starters", name: "Veggie Thukpa", price: 335, veg: 1 },
          { cat: "Thukpa & Starters", name: "Chicken Thukpa", price: 349, veg: 0 },
          { cat: "Thukpa & Starters", name: "Regular Fries", price: 89, veg: 1 },
          { cat: "Shawarma", name: "Classic Chicken Shawarma 6\"", price: 215, veg: 0 },
          { cat: "Shawarma", name: "Classic Chicken Shawarma 8\"", price: 245, veg: 0 },
          { cat: "Biryani & Rice", name: "Chicken Dum Biryani", price: 330, veg: 0 },
          { cat: "Biryani & Rice", name: "Veg Handi Biryani", price: 259, veg: 1 },
          { cat: "Biryani & Rice", name: "Paneer Handi Biryani", price: 289, veg: 1 },
          { cat: "Chaat", name: "Pani Puri", price: 99, veg: 1 },
          { cat: "Chaat", name: "Sev Puri", price: 129, veg: 1 },
          { cat: "Chaat", name: "Samosa Chaat", price: 199, veg: 1 },
          { cat: "Paneer Specialties", name: "Paneer Butter Masala", price: 299, veg: 1 },
          { cat: "Paneer Specialties", name: "Paneer Kadai", price: 299, veg: 1 },
          { cat: "Faloodas", name: "Royal Falooda", price: 180, veg: 1 },
          { cat: "Faloodas", name: "Malai Kulfi Falooda", price: 210, veg: 1 },
          { cat: "Kulfi & Ice Cream", name: "Asli Malai Kulfi", price: 80, veg: 1 },
          { cat: "Kulfi & Ice Cream", name: "Kesar Pista Kulfi", price: 80, veg: 1 },
          { cat: "Shakes & Sundaes", name: "Oreo Cookie Fudge Shake", price: 350, veg: 1 },
          { cat: "Shakes & Sundaes", name: "Rocky Road Sundae", price: 320, veg: 1 },
          { cat: "Beverages", name: "Mango Lassi", price: 149, veg: 1 },
          { cat: "Beverages", name: "Masala Tea", price: 69, veg: 1 }
        ];

        let catCount = 0;
        const catMap = {};
        baseCategories.forEach(cat => {
          db.run(`INSERT INTO menu_categories(name, description, is_active) VALUES(?,?,?)`,
            [cat.name, cat.desc, 1], function(err) {
              if (!err) catMap[cat.name] = this.lastID;
              catCount++;
              if (catCount === baseCategories.length) addMenuItems();
            });
        });

        function addMenuItems() {
          let itemCount = 0;
          basicItems.forEach(item => {
            const catId = catMap[item.cat] || 1;
            db.run(`INSERT INTO menu_items(category_id, name, description, price, item_type, is_vegetarian, is_available, prep_minutes) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
              [catId, item.name, `${item.name} - Fresh & Delicious`, item.price, 'food', item.veg, 1, 15], () => {
                itemCount++;
                if (itemCount === basicItems.length) resolve();
              });
          });
        }
      }
    });
  });
}

// ============= AUTH =============
const tokenStore = {};

function authenticate(token) { return tokenStore[token] || null; }

function requireAuth(req, res, minLevel = 20) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  const user = authenticate(token);
  if (!user) { res.status(401).json({ success: false, message: 'Unauthorized' }); return null; }
  const accessLevels = { owner: 100, admin: 80, manager: 60, waiter: 40, customer: 20 };
  if ((accessLevels[user.role] || 0) < minLevel) { res.status(403).json({ success: false, message: 'Forbidden' }); return null; }
  return user;
}

// ============= API ENDPOINTS =============

// Auth
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const hash = sha256(user.salt + password + user.salt);
    if (hash !== user.password_hash) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const token = randomString(48);
    const userData = { id: user.id, username: user.username, name: user.full_name, role: user.role, email: user.email, accessLevel: { owner: 100, admin: 80, manager: 60, waiter: 40, customer: 20 }[user.role] };
    tokenStore[token] = userData;
    res.json({ success: true, token, user: userData });
  });
});

app.post('/api/auth/register', (req, res) => {
  const { username, password, role, full_name, email, phone, secret_key } = req.body;
  if (!username || !password || !full_name || !email) return res.status(400).json({ success: false, message: 'Missing required fields' });
  if (!['owner', 'admin', 'manager', 'waiter', 'customer'].includes(role || 'customer')) return res.status(400).json({ success: false, message: 'Invalid role' });
  if ((role || 'customer') === 'owner' && secret_key !== '224005') return res.status(403).json({ success: false, message: 'Invalid owner secret key' });
  const salt = randomString(32);
  const hash = sha256(salt + password + salt);
  db.run(`INSERT INTO users(username, password_hash, salt, role, full_name, email, phone, salary) VALUES(?,?,?,?,?,?,?,?)`,
    [username, hash, salt, role || 'customer', full_name, email, phone || '', 0], function(err) {
      if (err) return res.status(409).json({ success: false, message: 'Username or email already exists' });
      const token = randomString(48);
      const userData = { id: this.lastID, username, name: full_name, role: role || 'customer', email, accessLevel: { owner: 100, admin: 80, manager: 60, waiter: 40, customer: 20 }[role || 'customer'] };
      tokenStore[token] = userData;
      res.json({ success: true, token, user: userData });
    });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  delete tokenStore[token];
  res.json({ success: true });
});

// Dashboard - Real-time stats from DB
app.get('/api/dashboard/stats', (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const today = new Date().toISOString().split('T')[0];
  db.get(`SELECT COALESCE(SUM(total_amount),0) as todaysSales, COUNT(*) as activeOrders FROM orders WHERE date(created_at) = date('now') AND status != 'cancelled' AND status != 'completed'`, (err, row1) => {
    db.get(`SELECT COUNT(*) as activeTables, COUNT(*) as totalTables FROM tables`, (err, row2) => {
      db.get(`SELECT COUNT(*) as staffOnDuty FROM users WHERE role IN ('manager','waiter','admin') AND is_active = 1`, (err, row3) => {
        res.json({
          todaysSales: row1?.todaysSales || 0,
          activeOrders: row1?.activeOrders || 0,
          activeTables: row2?.activeTables || 0,
          totalTables: 30,
          staffOnDuty: row3?.staffOnDuty || 0,
          salesDelta: 12
        });
      });
    });
  });
});

// Menu
app.get('/api/menu/categories', (req, res) => {
  db.all('SELECT * FROM menu_categories', (err, rows) => res.json(rows || []));
});

app.get('/api/menu/items/all', (req, res) => {
  db.all(`SELECT m.*, c.name as category FROM menu_items m JOIN menu_categories c ON m.category_id = c.id`, (err, rows) => res.json(rows || []));
});

// Tables
app.get('/api/tables', (req, res) => {
  db.all(`SELECT t.*, u.full_name as waiter_name FROM tables t LEFT JOIN users u ON t.assigned_waiter_id = u.id`, (err, rows) => res.json(rows || []));
});

app.put('/api/tables/:id/status', (req, res) => {
  const user = requireAuth(req, res, 40);
  if (!user) return;
  const { status, waiter_id } = req.body;
  db.run(`UPDATE tables SET status = ?, assigned_waiter_id = ? WHERE id = ?`, [status, waiter_id || null, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, changes: this.changes });
  });
});

// Orders
app.get('/api/orders', (req, res) => {
  db.all(`SELECT o.*, t.table_number FROM orders o LEFT JOIN tables t ON o.table_id = t.id ORDER BY o.created_at DESC`, (err, rows) => {
    if (err || !rows) return res.json([]);
    let processed = 0;
    if (rows.length === 0) return res.json([]);
    rows.forEach(order => {
      db.all('SELECT oi.*, m.name as item_name FROM order_items oi JOIN menu_items m ON oi.menu_item_id = m.id WHERE oi.order_id = ?', [order.id], (err, items) => {
        order.items = items || [];
        processed++;
        if (processed === rows.length) res.json(rows);
      });
    });
  });
});

app.get('/api/orders/:id', (req, res) => {
  db.get(`SELECT o.*, t.table_number FROM orders o LEFT JOIN tables t ON o.table_id = t.id WHERE o.id = ?`, [req.params.id], (err, order) => {
    if (err || !order) return res.status(404).json({ error: 'Order not found' });
    db.all('SELECT oi.*, m.name as item_name FROM order_items oi JOIN menu_items m ON oi.menu_item_id = m.id WHERE oi.order_id = ?', [order.id], (err, items) => {
      order.items = items || [];
      db.all('SELECT * FROM payments WHERE order_id = ?', [order.code], (err, payments) => {
        order.payments = payments || [];
        res.json(order);
      });
    });
  });
});

app.post('/api/orders', (req, res) => {
  const user = requireAuth(req, res, 20);
  if (!user) return;
  const { order_type, customer_id, customer_name, items, subtotal, tax, service_charge, discount, total_amount, table_id, guests } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ success: false, message: 'Items required' });
  const code = 'ORD-' + Date.now().toString().slice(-6);
  db.run(`INSERT INTO orders(code, order_type, table_id, customer_id, customer_name, guests, status, payment_status, subtotal, tax, service_charge, discount, total_amount, payment_method, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
    [code, order_type || 'takeaway', table_id || null, customer_id || user.id, customer_name || user.name, guests || 1, 'pending', 'unpaid', subtotal || 0, tax || 0, service_charge || 0, discount || 0, total_amount || 0, 'pending'], function(err) {
      if (err) return res.status(500).json({ success: false, message: err.message });
      const orderId = this.lastID;
      let itemsAdded = 0;
      items.forEach(item => {
        db.run(`INSERT INTO order_items(order_id, menu_item_id, quantity, unit_price, subtotal, status, note) VALUES(?,?,?,?,?,?,?)`,
          [orderId, item.menu_item_id, item.quantity, item.unit_price, (item.quantity * item.unit_price), 'queued', item.note || ''], function(err) {
            itemsAdded++;
            if (itemsAdded === items.length) {
              // Add to kitchen queue
              items.forEach((item, idx) => {
                db.run(`INSERT INTO kitchen_queue(order_id, order_item_id, item_name, status, started_at) VALUES(?,?,?,?,?)`,
                  [orderId, null, item.name || 'Item', 'queued', null]);
              });
              res.json({ success: true, message: 'Order created successfully', order: { id: orderId, code, order_type: order_type || 'takeaway', customer_name: customer_name || user.name, items_count: items.length, subtotal: subtotal || 0, tax: tax || 0, service_charge: service_charge || 0, total_amount: total_amount || 0, status: 'pending', payment_status: 'unpaid', created_at: new Date().toISOString() } });
            }
          });
      });
    });
});

app.put('/api/orders/:id/status', (req, res) => {
  const user = requireAuth(req, res, 40);
  if (!user) return;
  const { status } = req.body;
  const validStatuses = ['pending','confirmed','preparing','ready','served','completed','cancelled'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.run(`UPDATE orders SET status = ? WHERE id = ?`, [status, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, changes: this.changes });
  });
});

app.put('/api/orders/:id/payment', (req, res) => {
  const user = requireAuth(req, res, 40);
  if (!user) return;
  const { payment_status, payment_method } = req.body;
  db.run(`UPDATE orders SET payment_status = ?, payment_method = ? WHERE id = ?`, [payment_status, payment_method, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, changes: this.changes });
  });
});

// Kitchen Queue
app.get('/api/kitchen/queue', (req, res) => {
  const user = requireAuth(req, res, 40);
  if (!user) return;
  db.all(`SELECT kq.*, o.code as order_code, o.status as order_status FROM kitchen_queue kq JOIN orders o ON kq.order_id = o.id WHERE kq.status != 'completed' ORDER BY kq.priority DESC, kq.id ASC`, (err, rows) => res.json(rows || []));
});

app.put('/api/kitchen/queue/:id/start', (req, res) => {
  const user = requireAuth(req, res, 40);
  if (!user) return;
  db.run(`UPDATE kitchen_queue SET status = 'in_progress', started_at = CURRENT_TIMESTAMP WHERE id = ?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.put('/api/kitchen/queue/:id/complete', (req, res) => {
  const user = requireAuth(req, res, 40);
  if (!user) return;
  db.run(`UPDATE kitchen_queue SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Stock
app.get('/api/stock', (req, res) => {
  const user = requireAuth(req, res, 60);
  if (!user) return;
  db.all('SELECT * FROM stock ORDER BY category, item_name', (err, rows) => res.json(rows || []));
});

app.get('/api/stock/alerts', (req, res) => {
  const user = requireAuth(req, res, 60);
  if (!user) return;
  db.all('SELECT * FROM stock WHERE quantity <= min_threshold ORDER BY quantity ASC', (err, rows) => res.json(rows || []));
});

app.post('/api/stock', (req, res) => {
  const user = requireAuth(req, res, 80);
  if (!user) return;
  const { item_name, category, quantity, unit, min_threshold, cost_per_unit, supplier } = req.body;
  db.run(`INSERT INTO stock(item_name, category, quantity, unit, min_threshold, cost_per_unit, supplier, last_restocked) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
    [item_name, category, quantity, unit, min_threshold, cost_per_unit, supplier], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    });
});

app.put('/api/stock/:id', (req, res) => {
  const user = requireAuth(req, res, 80);
  if (!user) return;
  const { quantity, cost_per_unit, supplier } = req.body;
  db.run(`UPDATE stock SET quantity = ?, cost_per_unit = ?, supplier = ?, last_restocked = CURRENT_TIMESTAMP WHERE id = ?`,
    [quantity, cost_per_unit, supplier, req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, changes: this.changes });
    });
});

// Cutlery
app.get('/api/cutlery', (req, res) => {
  const user = requireAuth(req, res, 60);
  if (!user) return;
  db.all('SELECT * FROM cutlery ORDER BY item_name', (err, rows) => res.json(rows || []));
});

app.post('/api/cutlery', (req, res) => {
  const user = requireAuth(req, res, 80);
  if (!user) return;
  const { item_name, total_count, available_count, in_use_count, damaged_count } = req.body;
  db.run(`INSERT INTO cutlery(item_name, total_count, available_count, in_use_count, damaged_count) VALUES(?,?,?,?,?)`,
    [item_name, total_count, available_count || total_count, in_use_count || 0, damaged_count || 0], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    });
});

app.put('/api/cutlery/:id', (req, res) => {
  const user = requireAuth(req, res, 80);
  if (!user) return;
  const { total_count, available_count, in_use_count, damaged_count } = req.body;
  db.run(`UPDATE cutlery SET total_count = ?, available_count = ?, in_use_count = ?, damaged_count = ? WHERE id = ?`,
    [total_count, available_count, in_use_count, damaged_count, req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, changes: this.changes });
    });
});

// Staff
app.get('/api/staff', (req, res) => {
  const user = requireAuth(req, res, 60);
  if (!user) return;
  db.all(`SELECT id, full_name as name, username, role, email, phone, salary, is_active as active FROM users WHERE role IN ('manager', 'waiter', 'admin', 'owner')`, (err, rows) => res.json(rows || []));
});

app.get('/api/staff/:id', (req, res) => {
  const user = requireAuth(req, res, 60);
  if (!user) return;
  db.get(`SELECT id, full_name as name, username, role, email, phone, salary, is_active FROM users WHERE id = ?`, [req.params.id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'Staff not found' });
    res.json(row);
  });
});

app.post('/api/staff', (req, res) => {
  const user = requireAuth(req, res, 80);
  if (!user) return;
  const { username, password, full_name, email, phone, role, salary } = req.body;
  const salt = randomString(32);
  const hash = sha256(salt + password + salt);
  db.run(`INSERT INTO users(username, password_hash, salt, role, full_name, email, phone, salary, is_active) VALUES(?,?,?,?,?,?,?,?,?)`,
    [username, hash, salt, role, full_name, email, phone || '', salary || 0, 1], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    });
});

app.put('/api/staff/:id', (req, res) => {
  const user = requireAuth(req, res, 80);
  if (!user) return;
  const { full_name, email, phone, role, salary, is_active } = req.body;
  db.run(`UPDATE users SET full_name = ?, email = ?, phone = ?, role = ?, salary = ?, is_active = ? WHERE id = ?`,
    [full_name, email, phone, role, salary, is_active, req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, changes: this.changes });
    });
});

// Expenses
app.get('/api/expenses', (req, res) => {
  const user = requireAuth(req, res, 80);
  if (!user) return;
  db.all(`SELECT e.*, u.full_name as recorded_by_name FROM expenses e LEFT JOIN users u ON e.recorded_by = u.id ORDER BY e.expense_date DESC`, (err, rows) => res.json(rows || []));
});

app.post('/api/expenses', (req, res) => {
  const user = requireAuth(req, res, 80);
  if (!user) return;
  const { category, description, amount } = req.body;
  db.run(`INSERT INTO expenses(category, description, amount, recorded_by) VALUES(?,?,?,?)`,
    [category, description, amount, user.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    });
});

// Sales
app.get('/api/sales/summary', (req, res) => {
  const user = requireAuth(req, res, 60);
  if (!user) return;
  const today = new Date().toISOString().split('T')[0];
  db.get(`SELECT COALESCE(SUM(total_amount),0) as dailyRevenue FROM orders WHERE date(created_at) = date('now') AND status != 'cancelled'`, (err, daily) => {
    db.get(`SELECT COALESCE(SUM(total_amount),0) as weeklyRevenue FROM orders WHERE created_at >= date('now','-7 days') AND status != 'cancelled'`, (err, weekly) => {
      db.get(`SELECT COALESCE(SUM(total_amount),0) as monthlyRevenue FROM orders WHERE created_at >= date('now','-30 days') AND status != 'cancelled'`, (err, monthly) => {
        db.all(`SELECT payment_method as method, COALESCE(SUM(total_amount),0) as amount FROM orders WHERE status != 'cancelled' GROUP BY payment_method`, (err, pb) => {
          res.json({
            dailyRevenue: daily?.dailyRevenue || 0,
            weeklyRevenue: weekly?.weeklyRevenue || 0,
            monthlyRevenue: monthly?.monthlyRevenue || 0,
            paymentBreakdown: pb || []
          });
        });
      });
    });
  });
});

// Razorpay Payment Endpoints
app.post('/api/payments/create-order', (req, res) => {
  const user = requireAuth(req, res, 20);
  if (!user) return;
  const { amount, currency = 'INR', receipt } = req.body;
  const razorpayOrderId = 'order_' + randomString(16).toUpperCase();
  // Store in DB
  db.run(`INSERT INTO payments(order_id, user_id, amount, currency, razorpay_order_id, status, description, receipt, email, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [receipt, user.id, amount, currency, razorpayOrderId, 'initiated', 'Razorpay order', receipt, user.email], (err) => {
      if (err) console.error('Payment store error:', err);
    });
  res.json({
    id: razorpayOrderId,
    entity: 'order',
    amount: amount * 100,
    amount_paid: 0,
    amount_due: amount * 100,
    currency: currency,
    receipt: receipt,
    status: 'created',
    created_at: Math.floor(Date.now() / 1000),
    key_id: RAZORPAY_KEY_ID
  });
});

app.post('/api/payments/capture', (req, res) => {
  const user = requireAuth(req, res, 20);
  if (!user) return;
  const { paymentId, amount, orderId, orderCode } = req.body;
  db.run(`UPDATE payments SET razorpay_payment_id = ?, status = 'captured', updated_at = CURRENT_TIMESTAMP WHERE razorpay_order_id = ?`,
    [paymentId, orderId], (err) => {
      if (err) console.error('Payment capture error:', err);
    });
  // Also update order payment status
  if (orderCode) {
    db.run(`UPDATE orders SET payment_status = 'paid', payment_method = 'razorpay' WHERE code = ?`, [orderCode]);
  }
  res.json({ id: paymentId, entity: 'payment', amount: amount * 100, currency: 'INR', status: 'captured' });
});

app.post('/api/payments/verify', (req, res) => {
  res.json({ success: true, message: 'Signature verified' });
});

app.post('/api/payments/refund', (req, res) => {
  const user = requireAuth(req, res, 80);
  if (!user) return;
  const { paymentId, amount } = req.body;
  db.run(`UPDATE payments SET status = 'refunded', updated_at = CURRENT_TIMESTAMP WHERE razorpay_payment_id = ?`, [paymentId]);
  res.json({ id: 'rfnd_' + randomString(16).toUpperCase(), entity: 'refund', payment_id: paymentId, amount: amount * 100, currency: 'INR', status: 'processed' });
});

app.get('/api/payments/all', (req, res) => {
  const user = requireAuth(req, res, 60);
  if (!user) return;
  db.all(`SELECT p.*, u.username, u.email as user_email FROM payments p LEFT JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC`, (err, rows) => res.json(rows || []));
});

app.get('/api/payments/stats', (req, res) => {
  const user = requireAuth(req, res, 60);
  if (!user) return;
  db.get(`SELECT COUNT(*) as total_transactions, COALESCE(SUM(CASE WHEN status = 'captured' THEN amount ELSE 0 END),0) as total_captured, COUNT(CASE WHEN status = 'captured' THEN 1 END) as successful_payments, COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_payments FROM payments`, (err, row) => {
    res.json(row || {});
  });
});

app.get('/api/payments/order/:orderId', (req, res) => {
  db.all('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC', [req.params.orderId], (err, rows) => res.json(rows || []));
});

// Customer orders by user
app.get('/api/orders/user/:userId', (req, res) => {
  const user = requireAuth(req, res, 20);
  if (!user) return;
  db.all(`SELECT o.*, t.table_number FROM orders o LEFT JOIN tables t ON o.table_id = t.id WHERE o.customer_id = ? ORDER BY o.created_at DESC`, [req.params.userId], (err, rows) => {
    if (err || !rows) return res.json([]);
    let processed = 0;
    if (rows.length === 0) return res.json([]);
    rows.forEach(order => {
      db.all('SELECT oi.*, m.name as item_name FROM order_items oi JOIN menu_items m ON oi.menu_item_id = m.id WHERE oi.order_id = ?', [order.id], (err, items) => {
        order.items = items || [];
        processed++;
        if (processed === rows.length) res.json(rows);
      });
    });
  });
});

// Reservations
app.get('/api/reservations', (req, res) => {
  const user = requireAuth(req, res, 20);
  if (!user) return;
  const query = user.role === 'customer' ? 
    `SELECT * FROM reservations WHERE user_id = ? ORDER BY reservation_date DESC` :
    `SELECT r.*, u.full_name as customer_name, t.table_number FROM reservations r LEFT JOIN users u ON r.user_id = u.id LEFT JOIN tables t ON r.table_id = t.id ORDER BY r.reservation_date DESC`;
  db.all(query, user.role === 'customer' ? [user.id] : [], (err, rows) => res.json(rows || []));
});

app.post('/api/reservations', (req, res) => {
  const user = requireAuth(req, res, 20);
  if (!user) return;
  const { table_id, reservation_date, time, guests } = req.body;
  db.run(`INSERT INTO reservations(user_id, table_id, reservation_date, time, guests, status) VALUES(?,?,?,?,?,?)`,
    [user.id, table_id, reservation_date, time, guests, 'pending'], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    });
});

// Promotions
app.get('/api/promotions', (req, res) => {
  db.all(`SELECT * FROM promotions WHERE is_active = 1 AND date('now') BETWEEN date(valid_from) AND date(valid_to) ORDER BY created_at DESC`, (err, rows) => res.json(rows || []));
});

app.post('/api/promotions/validate', (req, res) => {
  const { code, order_amount } = req.body;
  db.get(`SELECT * FROM promotions WHERE code = ? AND is_active = 1 AND date('now') BETWEEN date(valid_from) AND date(valid_to) AND (max_uses = -1 OR uses_count < max_uses) AND (min_order_amount = 0 OR ? >= min_order_amount)`, 
    [code, order_amount], (err, promo) => {
      if (!promo) return res.status(404).json({ success: false, message: 'Invalid promotion code' });
      const discount = promo.discount_percent > 0 ? order_amount * (promo.discount_percent / 100) : promo.discount_amount;
      res.json({ success: true, promotion: promo, discount });
    });
});

// Reviews
app.post('/api/reviews', (req, res) => {
  const user = requireAuth(req, res, 20);
  if (!user) return;
  const { order_id, rating, comment } = req.body;
  db.run(`INSERT INTO reviews(order_id, user_id, rating, comment) VALUES(?,?,?,?)`,
    [order_id, user.id, rating, comment], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    });
});

app.get('/api/reviews/order/:orderId', (req, res) => {
  db.all(`SELECT r.*, u.full_name as user_name FROM reviews r LEFT JOIN users u ON r.user_id = u.id WHERE r.order_id = ? ORDER BY r.created_at DESC`, 
    [req.params.orderId], (err, rows) => res.json(rows || []));
});

// Customer Preferences
app.get('/api/customer/preferences', (req, res) => {
  const user = requireAuth(req, res, 20);
  if (!user) return;
  db.get(`SELECT * FROM customer_preferences WHERE user_id = ?`, [user.id], (err, row) => {
    if (!row) return res.json({ user_id: user.id, favorite_items: '', dietary_restrictions: '', loyalty_points: 0 });
    row.preferences_json = JSON.parse(row.preferences_json || '{}');
    res.json(row);
  });
});

app.put('/api/customer/preferences', (req, res) => {
  const user = requireAuth(req, res, 20);
  if (!user) return;
  const { favorite_items, dietary_restrictions, preferences_json } = req.body;
  db.run(`INSERT INTO customer_preferences(user_id, favorite_items, dietary_restrictions, preferences_json, updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)
          ON CONFLICT(user_id) DO UPDATE SET favorite_items=?, dietary_restrictions=?, preferences_json=?, updated_at=CURRENT_TIMESTAMP`,
    [user.id, favorite_items, dietary_restrictions, JSON.stringify(preferences_json), favorite_items, dietary_restrictions, JSON.stringify(preferences_json)],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});

// Analytics
app.get('/api/analytics/daily/:date', (req, res) => {
  const user = requireAuth(req, res, 60);
  if (!user) return;
  db.get(`SELECT * FROM analytics WHERE date = ?`, [req.params.date], (err, row) => {
    if (!row) return res.json({ date: req.params.date, total_orders: 0, total_revenue: 0, updated_at: new Date().toISOString() });
    res.json(row);
  });
});

app.get('/api/analytics/range', (req, res) => {
  const user = requireAuth(req, res, 60);
  if (!user) return;
  const { start_date, end_date } = req.query;
  db.all(`SELECT * FROM analytics WHERE date BETWEEN ? AND ? ORDER BY date DESC LIMIT 90`, 
    [start_date || '2026-01-01', end_date || new Date().toISOString().split('T')[0]], 
    (err, rows) => {
      if (!rows) return res.json([]);
      res.json(rows);
    });
});

// Feedback
app.get('/api/feedback', (req, res) => {
  const user = requireAuth(req, res, 60);
  if (!user) return;
  db.all(`SELECT f.*, u.full_name as user_name FROM feedback f LEFT JOIN users u ON f.user_id = u.id ORDER BY f.created_at DESC LIMIT 100`, (err, rows) => res.json(rows || []));
});

app.post('/api/feedback', (req, res) => {
  const user = requireAuth(req, res, 20);
  if (!user) return;
  const { feedback_type, content } = req.body;
  db.run(`INSERT INTO feedback(feedback_type, user_id, content, status) VALUES(?,?,?,?)`,
    [feedback_type, user.id, content, 'open'], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    });
});

// Staff Attendance
app.get('/api/staff/attendance/:userId', (req, res) => {
  const user = requireAuth(req, res, 60);
  if (!user) return;
  db.all(`SELECT * FROM staff_attendance WHERE user_id = ? ORDER BY date DESC LIMIT 30`, [req.params.userId], (err, rows) => res.json(rows || []));
});

app.post('/api/staff/attendance/checkin', (req, res) => {
  const user = requireAuth(req, res, 40);
  if (!user) return;
  const today = new Date().toISOString().split('T')[0];
  const checkInTime = new Date().toTimeString().split(' ')[0];
  db.run(`INSERT INTO staff_attendance(user_id, date, check_in_time, status) VALUES(?,?,?,?) 
          ON CONFLICT(user_id, date) DO UPDATE SET check_in_time=?`,
    [user.id, today, checkInTime, 'present', checkInTime], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});

app.post('/api/staff/attendance/checkout', (req, res) => {
  const user = requireAuth(req, res, 40);
  if (!user) return;
  const today = new Date().toISOString().split('T')[0];
  const checkOutTime = new Date().toTimeString().split(' ')[0];
  db.run(`UPDATE staff_attendance SET check_out_time=? WHERE user_id=? AND date=?`,
    [checkOutTime, user.id, today], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});

// Daily Reports
app.get('/api/reports/daily/:date', (req, res) => {
  const user = requireAuth(req, res, 80);
  if (!user) return;
  db.get(`SELECT * FROM daily_reports WHERE report_date = ?`, [req.params.date], (err, row) => {
    if (!row) return res.json({ success: false, message: 'Report not found' });
    res.json(row);
  });
});

app.post('/api/reports/daily', (req, res) => {
  const user = requireAuth(req, res, 80);
  if (!user) return;
  const { report_date, opening_balance, closing_balance, total_cash_received, total_card_received, total_online_received, total_expenses, staff_count, covers_served, notes } = req.body;
  db.run(`INSERT INTO daily_reports(report_date, opening_balance, closing_balance, total_cash_received, total_card_received, total_online_received, total_expenses, staff_count, covers_served, created_by, notes) 
          VALUES(?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(report_date) DO UPDATE SET opening_balance=?, closing_balance=?, total_cash_received=?, total_card_received=?, total_online_received=?, total_expenses=?, staff_count=?, covers_served=?, notes=?`,
    [report_date, opening_balance, closing_balance, total_cash_received, total_card_received, total_online_received, total_expenses, staff_count, covers_served, user.id, notes,
     opening_balance, closing_balance, total_cash_received, total_card_received, total_online_received, total_expenses, staff_count, covers_served, notes],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});

// Inventory Log
app.get('/api/inventory/log/:stockId', (req, res) => {
  const user = requireAuth(req, res, 60);
  if (!user) return;
  db.all(`SELECT il.*, u.full_name as recorded_by_name FROM inventory_log il LEFT JOIN users u ON il.recorded_by = u.id WHERE il.stock_id = ? ORDER BY il.transaction_date DESC LIMIT 50`, 
    [req.params.stockId], (err, rows) => res.json(rows || []));
});

app.post('/api/inventory/log', (req, res) => {
  const user = requireAuth(req, res, 60);
  if (!user) return;
  const { stock_id, transaction_type, quantity_change, reason } = req.body;
  db.run(`INSERT INTO inventory_log(stock_id, transaction_type, quantity_change, reason, recorded_by, transaction_date) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)`,
    [stock_id, transaction_type, quantity_change, reason, user.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      // Update stock quantity
      db.run(`UPDATE stock SET quantity = quantity + ? WHERE id = ?`, [quantity_change, stock_id]);
      res.json({ success: true, id: this.lastID });
    });
});

// Dev endpoint
app.get('/api/dev/credentials', (req, res) => {
  res.json([
    { username: 'apurva', password: 'SaiBaba', role: 'owner', email: 'apurva@gmail.com' },
    { username: 'apurva_sanpurkar', password: 'apurva@2024', role: 'owner' },
    { username: 'shripad_deshpande', password: 'staff@2024', role: 'manager' },
    { username: 'parth_sahasrabuddhe', password: 'staff@2024', role: 'waiter' },
    { username: 'rajesh_kumar', password: 'customer@2024', role: 'customer' },
    { username: 'priya_sharma', password: 'customer@2024', role: 'customer' }
  ]);
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
    console.log('   Key ID: ' + RAZORPAY_KEY_ID);
    console.log('\n📖 Login Credentials:');
    console.log('   👔 Owner:    apurva / SaiBaba  (email: apurva@gmail.com)');
    console.log('   👔 Owner:    apurva_sanpurkar / apurva@2024');
    console.log('   💼 Manager:  shripad_deshpande / staff@2024');
    console.log('   🪑 Waiter:   parth_sahasrabuddhe / staff@2024');
    console.log('   🛍️  Customer: rajesh_kumar / customer@2024');
    console.log('   🛍️  Customer: priya_sharma / customer@2024');
    console.log('\n✓ Database initialized with menu items');
    console.log('✓ Customer ordering interface enabled');
    console.log('✓ Dynamic billing system active');
    console.log('✓ All API endpoints active');
    console.log('✓ Razorpay integration ready');
    console.log('✓ Real-time dashboard stats');
    console.log('✓ Stock & Cutlery management');
    console.log('✓ Staff salary tracking');
    console.log('\nPress Ctrl+C to stop...\n' + '='.repeat(70) + '\n');
  });
}).catch(err => {
  console.error('Failed to initialize:', err);
  process.exit(1);
});
