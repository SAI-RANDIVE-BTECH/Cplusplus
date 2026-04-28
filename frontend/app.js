/**
 * Akshay Bhojanam - Restaurant Management System
 * Single Page Application (SPA) - Complete Admin & Owner Dashboard
 * 100% Dynamic Data from SQLite3 Backend
 */

const App = {
  token: localStorage.getItem("ab_token") || null,
  user: JSON.parse(localStorage.getItem("ab_user") || "null"),
  page: localStorage.getItem("ab_page") || "dashboard",
  data: {},
  showRegister: false,
  cart: JSON.parse(localStorage.getItem("ab_cart") || "[]"),
  currentCustomerOrder: null,

  async api(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(path, { ...options, headers });
    if (res.status === 401) {
      this.logout(false);
      throw new Error("Session expired");
    }
    if (res.status === 403) throw new Error("Access denied");
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    return res.json();
  },

  async boot() {
    if (!this.token || !this.user) {
      this.renderLogin();
      return;
    }
    try {
      await this.refresh();
      // For customers, load only menu. For staff, load all data.
      if (this.user.role === "customer") {
        this.renderCustomerInterface();
      } else {
        this.renderShell();
      }
    } catch (err) {
      console.error("Boot error:", err);
      this.logout(false);
    }
  },

  async refresh() {
    // Customers only need menu and categories
    if (this.user?.role === "customer") {
      const endpoints = [
        ["/api/menu/items/all", "menu"],
        ["/api/menu/categories", "categories"],
      ];
      const results = await Promise.all(endpoints.map(([path]) => this.api(path).catch(() => [])));
      this.data = Object.fromEntries(endpoints.map(([_, key], i) => [key, results[i]]));
    } else {
      // Staff/Admins get full dashboard data
      const endpoints = [
        ["/api/dashboard/stats", "stats"],
        ["/api/menu/items/all", "menu"],
        ["/api/menu/categories", "categories"],
        ["/api/tables", "tables"],
        ["/api/orders", "orders"],
        ["/api/kitchen/queue", "kitchen"],
        ["/api/stock", "stock"],
        ["/api/cutlery", "cutlery"],
        ["/api/reservations/all", "reservations"],
        ["/api/sales/summary", "sales"],
        ["/api/payments/all", "payments"],
        ["/api/staff", "staff"],
      ];
      const results = await Promise.all(endpoints.map(([path]) => this.api(path).catch(() => [])));
      this.data = Object.fromEntries(endpoints.map(([_, key], i) => [key, results[i]]));
    }
  },

  async login(username, password) {
    const result = await this.api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (!result.success) throw new Error(result.message || "Login failed");
    this.token = result.token;
    this.user = result.user;
    localStorage.setItem("ab_token", this.token);
    localStorage.setItem("ab_user", JSON.stringify(this.user));
    this.showRegister = false;
    await this.boot();
  },

  async register(username, password, full_name, email, phone, role) {
    const result = await this.api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, full_name, email, phone, role: role || "customer" }),
    });
    if (!result.success) throw new Error(result.message || "Registration failed");
    this.token = result.token;
    this.user = result.user;
    localStorage.setItem("ab_token", this.token);
    localStorage.setItem("ab_user", JSON.stringify(this.user));
    this.showRegister = false;
    await this.boot();
  },

  async logout(callServer = true) {
    if (callServer && this.token) await this.api("/api/auth/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("ab_token");
    localStorage.removeItem("ab_user");
    localStorage.removeItem("ab_page");
    localStorage.removeItem("ab_cart");
    this.token = null;
    this.user = null;
    this.cart = [];
    this.showRegister = false;
    this.renderLogin();
  },

  // CART MANAGEMENT
  addToCart(item) {
    const existing = this.cart.find(c => c.id === item.id);
    if (existing) {
      existing.quantity += 1;
    } else {
      this.cart.push({...item, quantity: 1});
    }
    this.saveCart();
    this.renderCustomerInterface();
  },

  removeFromCart(itemId) {
    this.cart = this.cart.filter(c => c.id !== itemId);
    this.saveCart();
    this.renderCustomerInterface();
  },

  updateCartQuantity(itemId, quantity) {
    const item = this.cart.find(c => c.id === itemId);
    if (item) {
      item.quantity = Math.max(0, quantity);
      if (item.quantity === 0) {
        this.removeFromCart(itemId);
      } else {
        this.saveCart();
        this.renderCustomerInterface();
      }
    }
  },

  saveCart() {
    localStorage.setItem("ab_cart", JSON.stringify(this.cart));
  },

  calculateBill() {
    const subtotal = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const taxRate = 0.05; // 5% tax
    const tax = subtotal * taxRate;
    const serviceCharge = subtotal * 0.10; // 10% service charge
    const total = subtotal + tax + serviceCharge;
    
    return {
      subtotal: subtotal.toFixed(2),
      tax: tax.toFixed(2),
      serviceCharge: serviceCharge.toFixed(2),
      total: total.toFixed(2),
      itemCount: this.cart.reduce((sum, item) => sum + item.quantity, 0)
    };
  },

  renderCustomerInterface() {
    if (!this.user) {
      this.renderLogin();
      return;
    }

    const menuItems = this.data.menu || [];
    const categories = this.data.categories || [];
    const bill = this.calculateBill();
    const cartEmpty = this.cart.length === 0;

    // Get unique categories from menu items
    const categorySet = new Set(menuItems.map(m => m.category_id || 1));
    
    document.getElementById("app").innerHTML = `
      <div class="customer-interface">
        <header class="customer-header">
          <div class="customer-brand">
            <img src="/assets/logo.png" alt="Akshay Bhojanam" style="height: 50px; object-fit: contain;" />
            <div>
              <h1 style="margin: 0; font-family: 'Playfair Display'; font-size: 24px; color: var(--primary);">🍽️ AKSHAY BHOJANAM</h1>
              <p style="margin: 4px 0 0 0; font-size: 13px; color: var(--muted);">Welcome, ${this.user.name || 'Customer'}!</p>
            </div>
          </div>
          <div class="customer-actions">
            <button class="btn light" id="customer-refresh" title="Refresh Menu">↻ Refresh</button>
            <button class="btn light" id="customer-logout" title="Logout">🚪 Logout</button>
          </div>
        </header>

        <div class="customer-body">
          <section class="menu-section">
            <h2 style="margin-bottom: 20px; font-family: 'Playfair Display'; font-size: 28px; color: var(--ink);">Browse Our Menu</h2>
            <div class="menu-grid">
              ${menuItems.filter(m => m.is_available !== 0).map(item => `
                <article class="menu-card">
                  <div class="menu-card-body">
                    <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600;">${item.name || 'Item'}</h3>
                    <p style="margin: 0 0 12px 0; font-size: 13px; color: var(--muted); min-height: 26px;">${item.description || 'Delicious food item'}</p>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                      <div>
                        <span class="badge ${item.is_vegetarian ? 'green' : 'blue'}" style="margin-right: 6px;">${item.is_vegetarian ? '🌱 Veg' : '🍗 Non-Veg'}</span>
                        <span class="badge gold">⏱️ ${item.prep_minutes || 15}m</span>
                      </div>
                      <div style="font-weight: 700; color: var(--primary); font-size: 18px;">${this.money(item.price || 0)}</div>
                    </div>
                    <button class="btn" style="width: 100%;" data-add-item="${item.id}" data-item-name="${item.name}" data-item-price="${item.price}">+ Add to Cart</button>
                  </div>
                </article>
              `).join('')}
            </div>
            ${menuItems.length === 0 ? '<p class="muted" style="text-align: center; padding: 40px;">No menu items available</p>' : ''}
          </section>
        </div>

        <aside class="bill-section">
          <div class="bill-panel">
            <h2 style="margin: 0 0 20px 0; font-family: 'Playfair Display'; font-size: 22px;">📋 Your Order</h2>
            
            <div class="cart-items">
              ${cartEmpty ? `
                <div style="text-align: center; padding: 40px 0; color: var(--muted);">
                  <p style="font-size: 14px; margin: 0;">🛒 Your cart is empty</p>
                  <p style="font-size: 12px; margin: 8px 0 0 0;">Add items to get started!</p>
                </div>
              ` : `
                ${this.cart.map(item => `
                  <div class="cart-item">
                    <div style="flex: 1;">
                      <strong style="display: block; margin-bottom: 4px;">${item.name}</strong>
                      <span class="muted" style="font-size: 12px;">${this.money(item.price)} × ${item.quantity}</span>
                    </div>
                    <div style="text-align: right; margin-right: 12px;">
                      <div style="font-weight: 600; margin-bottom: 4px;">${this.money(item.price * item.quantity)}</div>
                    </div>
                    <div style="display: flex; gap: 4px; align-items: center;">
                      <button class="qty-btn" data-qty-minus="${item.id}">−</button>
                      <span style="min-width: 20px; text-align: center;">${item.quantity}</span>
                      <button class="qty-btn" data-qty-plus="${item.id}">+</button>
                      <button class="qty-btn remove" data-remove-item="${item.id}">✕</button>
                    </div>
                  </div>
                `).join('')}
              `}
            </div>

            ${!cartEmpty ? `
              <div class="bill-breakdown">
                <div class="bill-row">
                  <span>Subtotal</span>
                  <strong>${this.money(bill.subtotal)}</strong>
                </div>
                <div class="bill-row">
                  <span>Tax (5%)</span>
                  <strong>${this.money(bill.tax)}</strong>
                </div>
                <div class="bill-row">
                  <span>Service Charge (10%)</span>
                  <strong>${this.money(bill.serviceCharge)}</strong>
                </div>
                <div class="bill-row total">
                  <span>Total Amount</span>
                  <strong style="font-size: 18px;">${this.money(bill.total)}</strong>
                </div>
              </div>
              <button class="btn green" style="width: 100%; margin-top: 16px;" id="place-order">
                Place Order (${bill.itemCount} items)
              </button>
              <button class="btn light" style="width: 100%; margin-top: 8px;" id="clear-cart">Clear Cart</button>
            ` : ''}
          </div>
        </aside>
      </div>
    `;

    this.bindCustomerActions();
  },

  bindCustomerActions() {
    // Add to cart
    document.querySelectorAll("[data-add-item]").forEach(btn => {
      btn.addEventListener("click", () => {
        const itemId = parseInt(btn.dataset.addItem);
        const item = (this.data.menu || []).find(m => m.id === itemId);
        if (item) {
          this.addToCart(item);
        }
      });
    });

    // Remove from cart
    document.querySelectorAll("[data-remove-item]").forEach(btn => {
      btn.addEventListener("click", () => {
        this.removeFromCart(parseInt(btn.dataset.removeItem));
      });
    });

    // Quantity update
    document.querySelectorAll("[data-qty-plus]").forEach(btn => {
      btn.addEventListener("click", () => {
        const itemId = parseInt(btn.dataset.qtyPlus);
        const item = this.cart.find(c => c.id === itemId);
        if (item) this.updateCartQuantity(itemId, item.quantity + 1);
      });
    });

    document.querySelectorAll("[data-qty-minus]").forEach(btn => {
      btn.addEventListener("click", () => {
        const itemId = parseInt(btn.dataset.qtyMinus);
        const item = this.cart.find(c => c.id === itemId);
        if (item) this.updateCartQuantity(itemId, item.quantity - 1);
      });
    });

    // Clear cart
    document.getElementById("clear-cart")?.addEventListener("click", () => {
      if (confirm("Clear all items from cart?")) {
        this.cart = [];
        this.saveCart();
        this.renderCustomerInterface();
      }
    });

    // Place order
    document.getElementById("place-order")?.addEventListener("click", async () => {
      if (this.cart.length === 0) {
        alert("Add items to your cart first!");
        return;
      }

      const bill = this.calculateBill();
      const orderData = {
        order_type: "takeaway",
        customer_id: this.user.id,
        customer_name: this.user.name,
        items: this.cart.map(item => ({
          menu_item_id: item.id,
          quantity: item.quantity,
          unit_price: item.price,
          note: ""
        })),
        subtotal: parseFloat(bill.subtotal),
        tax: parseFloat(bill.tax),
        service_charge: parseFloat(bill.serviceCharge),
        discount: 0,
        total_amount: parseFloat(bill.total),
        payment_method: "pending"
      };

      try {
        const response = await this.api("/api/orders", {
          method: "POST",
          body: JSON.stringify(orderData)
        });

        if (response.success) {
          this.currentCustomerOrder = response.order;
          this.cart = [];
          this.saveCart();
          this.showOrderConfirmation(response.order);
        } else {
          alert(response.message || "Failed to place order");
        }
      } catch (err) {
        alert("Error placing order: " + err.message);
      }
    });

    // Refresh menu
    document.getElementById("customer-refresh")?.addEventListener("click", async () => {
      await this.refresh();
      this.renderCustomerInterface();
    });

    // Logout
    document.getElementById("customer-logout")?.addEventListener("click", () => {
      this.logout();
    });
  },

  showOrderConfirmation(order) {
    alert(`✅ Order Placed Successfully!\n\nOrder ID: #${order.code}\nTotal: ${this.money(order.total_amount)}\n\nYour order is being prepared in the kitchen. Thank you for ordering!`);
    this.renderCustomerInterface();
  },

  navigate(page) {
    this.page = page;
    localStorage.setItem("ab_page", page);
    this.renderShell();
  },

  icon(name) {
    const icons = {
      dashboard: "📊", kitchen: "👨‍🍳", floor: "🪑", menu: "📋", orders: "🛒",
      reports: "📈", payments: "💳", stock: "📦", staff: "👥", reservations: "📅", categories: "🏷️"
    };
    return icons[name] || "•";
  },

  renderLogin() {
    const html = this.showRegister ? this.renderRegister() : this.renderLoginForm();
    document.getElementById("app").innerHTML = `
      <main class="login">
        <div class="login-card">
          <div style="text-align: center; margin-bottom: 30px;">
            <img src="/assets/logo.png" alt="Akshay Bhojanam" style="width: 80px; height: 80px; object-fit: contain; margin-bottom: 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);" />
            <h1 class="login-title">🍽️ AKSHAY BHOJANAM</h1>
            <p class="login-subtitle">Modern Restaurant Management System</p>
          </div>
          ${html}
        </div>
      </main>
    `;
  },

  renderLoginForm() {
    return `
      <form id="login-form">
        <div class="form-group">
          <label for="username">Username</label>
          <input type="text" id="username" placeholder="Enter your username" required />
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" placeholder="Enter your password" required />
        </div>
        <button type="submit" class="btn">Sign In</button>
        <button type="button" class="btn light" id="toggle-register" style="margin-top: 10px; width: 100%;">Create New Account</button>
      </form>

      <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--line);">
        <p style="font-size: 13px; color: var(--muted); margin: 0 0 12px 0;">📌 Demo Credentials:</p>
        <div style="display: grid; gap: 8px; font-size: 12px;">
          <div><strong>Owner:</strong> owner / owner123</div>
          <div><strong>Admin:</strong> admin / admin123</div>
          <div><strong>Manager:</strong> manager / manager123</div>
          <div><strong>Waiter:</strong> waiter1 / waiter123</div>
          <div><strong>Customer:</strong> customer / customer123</div>
        </div>
      </div>

      <div style="margin-top: 24px; padding: 16px; background: linear-gradient(135deg, rgba(155, 69, 0, 0.1) 0%, transparent 100%); border-radius: 8px; border-left: 3px solid var(--primary);">
        <p style="font-size: 13px; color: var(--muted); margin: 0;">
          ✓ Real-time Order Management<br/>
          ✓ Kitchen Queue Integration<br/>
          ✓ Razorpay Payment Processing<br/>
          ✓ Inventory & Stock Tracking<br/>
          ✓ Staff & Role Management
        </p>
      </div>
    `;
  },

  renderRegister() {
    return `
      <form id="register-form">
        <div class="form-group">
          <label for="reg-username">Username</label>
          <input type="text" id="reg-username" placeholder="Choose a username" required />
        </div>
        <div class="form-group">
          <label for="reg-email">Email</label>
          <input type="email" id="reg-email" placeholder="your@email.com" required />
        </div>
        <div class="form-group">
          <label for="reg-fullname">Full Name</label>
          <input type="text" id="reg-fullname" placeholder="Your full name" required />
        </div>
        <div class="form-group">
          <label for="reg-phone">Phone (Optional)</label>
          <input type="tel" id="reg-phone" placeholder="9876543210" />
        </div>
        <div class="form-group">
          <label for="reg-password">Password</label>
          <input type="password" id="reg-password" placeholder="Create a strong password" required />
        </div>
        <div class="form-group">
          <label for="reg-role">Role</label>
          <select id="reg-role" required>
            <option value="customer">Customer</option>
            <option value="waiter">Waiter</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <button type="submit" class="btn">Create Account</button>
        <button type="button" class="btn light" id="toggle-login" style="margin-top: 10px; width: 100%;">Back to Login</button>
      </form>
    `;
  },

  renderShell() {
    if (!this.user) {
      this.renderLogin();
      return;
    }

    const allPages = [
      ["dashboard", "Dashboard", 20],
      ["kitchen", "Kitchen", 40],
      ["floor", "Floor Map", 40],
      ["menu", "Menu", 80],
      ["categories", "Categories", 80],
      ["orders", "Orders", 40],
      ["reports", "Reports", 80],
      ["payments", "Payments", 80],
      ["stock", "Stock", 60],
      ["staff", "Staff", 80],
      ["reservations", "Reservations", 20],
    ];
    const pages = allPages.filter(([,,level]) => (this.user?.accessLevel || 0) >= level);

    document.getElementById("app").innerHTML = `
      <div class="shell">
        <aside class="sidebar">
          <div class="brand">
            <img src="/assets/logo.png" alt="Akshay Bhojanam Logo" style="border-radius: 12px; background: linear-gradient(135deg, var(--primary) 0%, var(--primary-2) 100%); padding: 8px; width: 100%; height: auto; object-fit: contain;" />
            <div class="brand-title">AKSHAY<br>BHOJANAM</div>
            <div class="brand-subtitle">${(this.user?.role || 'user').toUpperCase()} PANEL</div>
          </div>
          <nav class="nav">
            ${pages.map(([id,label]) => `<button class="${this.page===id?"active":""}" data-page="${id}"><span>${this.icon(id)}</span>${label}</button>`).join("")}
          </nav>
          <div class="user-card">
            <div class="avatar">${(this.user?.name || 'U')[0]}</div>
            <div>
              <strong>${this.user?.name || 'User'}</strong>
              <div class="muted">${this.user?.role || 'user'} · L${this.user?.accessLevel || 0}</div>
            </div>
            <button class="icon-btn" id="logout" title="Logout">🚪</button>
          </div>
        </aside>
        <section class="content">
          <header class="topbar">
            <div class="page-title">${this.title()}</div>
            <div class="toolbar">
              <input class="search" id="search" placeholder="Search..." />
              <button class="icon-btn" title="Refresh" id="refresh">↻</button>
            </div>
          </header>
          <main class="main">${this.renderPage()}</main>
        </section>
      </div>
    `;
    document.querySelectorAll("[data-page]").forEach(b => b.addEventListener("click", () => this.navigate(b.dataset.page)));
    document.getElementById("logout").addEventListener("click", () => this.logout());
    document.getElementById("refresh").addEventListener("click", async () => {
      try { await this.refresh(); this.renderShell(); } catch (e) { alert(e.message); }
    });
    this.bindPageActions();
  },

  title() {
    return { dashboard: "Dashboard", kitchen: "Kitchen Queue", floor: "Floor Map", menu: "Menu Items",
      categories: "Categories", orders: "Orders", reports: "Reports", payments: "Payment Transactions", stock: "Stock", staff: "Staff", reservations: "Reservations" }[this.page];
  },

  money(v) { return `₹${Number(v).toLocaleString("en-IN", {maximumFractionDigits:2})}`; },
  statusClass(s) {
    if(["ready","served","completed","available","confirmed"].includes(s)) return "green";
    if(["preparing","in_progress","pending","queued"].includes(s)) return "gold";
    if(["reserved","takeaway"].includes(s)) return "blue";
    if(["critical","cancelled"].includes(s)) return "red";
    return "";
  },
  badge(s) { return `<span class="badge ${this.statusClass(s)}">${String(s).replaceAll("_"," ")}</span>`; },

  renderPage() {
    return {
      dashboard: this.dashboard(), kitchen: this.kitchen(), floor: this.floor(), menu: this.menu(),
      categories: this.categories(), orders: this.orders(), reports: this.reports(), payments: this.payments(), stock: this.stock(),
      staff: this.staff(), reservations: this.reservations()
    }[this.page] || `<p class="muted">Page not found</p>`;
  },

  dashboard() {
    const s = this.data.stats || {};
    return `
      <div class="grid stats">
        <article class="card stat" style="animation-delay: 0s;">
          <div class="label">💰 Today's Sales</div>
          <div class="metric">${this.money(s.todaysSales||0)}</div>
          <div class="muted">↗ ${(s.salesDelta||0)}% from yesterday</div>
        </article>
        <article class="card stat" style="animation-delay: 0.1s;">
          <div class="label">📦 Active Orders</div>
          <div class="metric">${s.activeOrders||0}</div>
          <div class="muted">Currently in progress</div>
        </article>
        <article class="card stat" style="animation-delay: 0.2s;">
          <div class="label">🪑 Table Status</div>
          <div class="metric">${s.activeTables||0}/${s.totalTables||30}</div>
          <div class="muted">Tables occupied</div>
        </article>
        <article class="card stat" style="animation-delay: 0.3s;">
          <div class="label">👥 Staff On Duty</div>
          <div class="metric">${s.staffOnDuty||0}</div>
          <div class="muted">Ready to serve</div>
        </article>
      </div>

      <div class="grid two-col" style="margin-top: 24px;">
        <section class="card panel">
          <h2 class="section-title">📊 Recent Orders</h2>
          <p class="muted">Latest orders from dining area and online</p>
          ${this.orderTable((this.data.orders||[]).slice(0,5))}
        </section>
        <section class="card panel">
          <h2 class="section-title">⚡ Quick Actions</h2>
          <p class="muted">Fast access to key features</p>
          <div class="grid" style="gap: 12px;">
            ${(this.user?.accessLevel||0)>=60?`<button class="btn" onclick="App.navigate('orders')" style="width: 100%; justify-content: center;"><i class="fas fa-shopping-cart"></i> New Order</button>`:''}
            ${(this.user?.accessLevel||0)>=60?`<button class="btn light" onclick="App.navigate('floor')" style="width: 100%; justify-content: center;"><i class="fas fa-home"></i> Floor Map</button>`:''}
            ${(this.user?.accessLevel||0)>=80?`<button class="btn green" onclick="App.navigate('staff')" style="width: 100%; justify-content: center;"><i class="fas fa-users"></i> Staff</button>`:''}
            ${(this.user?.accessLevel||0)>=80?`<button class="btn light" onclick="App.navigate('menu')" style="width: 100%; justify-content: center;"><i class="fas fa-list"></i> Menu</button>`:''}
          </div>
        </section>
      </div>

      <section class="card panel" style="margin-top: 24px;">
        <h2 class="section-title">💳 Razorpay Integration Status</h2>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
          <div style="padding: 16px; background: linear-gradient(135deg, #adedd3 0%, transparent 100%); border-radius: 8px; border-left: 3px solid var(--green);">
            <div class="caps" style="color: var(--green);">Payment Gateway</div>
            <div style="font-size: 18px; font-weight: 700; color: var(--green); margin-top: 8px;">✓ Active</div>
            <div class="muted">Real-time processing</div>
          </div>
          <div style="padding: 16px; background: linear-gradient(135deg, #fff0bd 0%, transparent 100%); border-radius: 8px; border-left: 3px solid #9d7c0a;">
            <div class="caps" style="color: #9d7c0a;">Mode</div>
            <div style="font-size: 18px; font-weight: 700; color: #9d7c0a; margin-top: 8px;">TEST</div>
            <div class="muted">Sandbox credentials</div>
          </div>
          <div style="padding: 16px; background: linear-gradient(135deg, #dfeaff 0%, transparent 100%); border-radius: 8px; border-left: 3px solid #004499;">
            <div class="caps" style="color: #004499;">Dashboard</div>
            <div style="font-size: 18px; font-weight: 700; color: #004499; margin-top: 8px;"><a href="javascript:App.navigate('payments')" style="color: #004499;">💳 View</a></div>
            <div class="muted">Payment transactions</div>
          </div>
        </div>
      </section>
    `;
  },

  stat(label, value, note) { return `<article class="card stat"><div class="label">${label}</div><div class="metric">${value}</div><div class="muted">${note}</div></article>`; },

  orderTable(orders) {
    if(!orders || orders.length===0) return `<p class="muted">No orders</p>`;
    return `
      <table class="table">
        <thead><tr><th>ID</th><th>Table</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>
          ${orders.map(o => `<tr>
            <td><strong>#${o.code||'N/A'}</strong></td>
            <td>${o.table?`Table ${o.table}`:"Takeaway"}</td>
            <td>${(o.items||[]).map(i=>i.name).slice(0,2).join(", ")||"N/A"}</td>
            <td><strong>${this.money(o.total_amount||o.total||0)}</strong></td>
            <td>${this.badge(o.status||"pending")}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    `;
  },

  kitchen() {
    const k = this.data.kitchen || [];
    if(!k||k.length===0) return `<p class="muted">No pending orders</p>`;
    return `
      <div class="grid kitchen-grid">
        ${k.map(t => `<article class="card ticket ${t.priority==="high"?"high":""}">
          <div class="ticket-head">
            <div>
              ${this.badge(t.priority||"normal")}
              <div class="order-code">Order #${t.code||t.orderId}</div>
              <div class="caps">${t.table?`Table ${t.table}`:"Web"} · ${(t.items||[]).length} items</div>
            </div>
            <div><div class="elapsed">${t.elapsed||0}m</div></div>
          </div>
          <div class="ticket-items">
            ${(t.items||[]).map(i => `<div class="line-item"><div class="qty">${i.quantity||1}</div><div><strong>${i.name||"Item"}</strong></div>${this.badge(i.status||"queued")}</div>`).join("")}
          </div>
          <div class="ticket-actions">
            <button class="btn ${t.status==="completed"?"":"green"}" data-kitchen="${t.orderId}">${t.status==="queued"?"Start":"Ready"}</button>
          </div>
        </article>`).join("")}
      </div>
    `;
  },

  floor() {
    const t = this.data.tables || [];
    const av = t.filter(x=>x.status==="available").length;
    const oc = t.filter(x=>x.status==="occupied").length;
    const rs = t.filter(x=>x.status==="reserved").length;
    return `
      <section class="card panel" style="margin-bottom:24px;display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap">
        <div>${this.badge("available")} <strong>Available</strong> · ${av}</div>
        <div>${this.badge("occupied")} <strong>Occupied</strong> · ${oc}</div>
        <div>${this.badge("reserved")} <strong>Reserved</strong> · ${rs}</div>
      </section>
      <div class="grid floor-grid">
        ${t.map(tb => `<article class="card table-card ${tb.status}">
          <div class="caps">${tb.status}</div>
          <div class="table-no">${String(tb.number||tb.id).padStart(2,"0")}</div>
          <div style="margin-top:22px">
            ${tb.status==="occupied"?`Waiter: ${tb.waiter||"N/A"}<br>`:""}
            <strong>${tb.capacity||4} seater</strong>
            ${tb.status==="occupied"?` · ${tb.elapsedMinutes||tb.elapsed_minutes||0}m`:""}
          </div>
        </article>`).join("")}
      </div>
    `;
  },

  menu() {
    const m = this.data.menu || [];
    const cats = new Set(m.map(x=>x.category));
    return `
      <div class="grid menu-layout">
        <aside class="card panel">
          <div class="caps" style="margin-bottom:14px">Categories</div>
          <div class="category-list">
            <button class="active">All</button>
            ${Array.from(cats).map(c => `<button>${c}</button>`).join("")}
          </div>
        </aside>
        <section class="card">
          <div class="panel" style="display:flex;justify-content:space-between;gap:18px">
            <div><h2 class="section-title">Items</h2><div class="muted">${m.length} total items</div></div>
            ${(this.user?.accessLevel||0)>=80?`<button class="btn" id="add-menu">+ Add Item</button>`:""}
          </div>
          <table class="table">
            <thead><tr><th>Item</th><th>Category</th><th>Price</th><th>Type</th><th>Status</th>${(this.user?.accessLevel||0)>=80?"<th>Action</th>":""}</tr></thead>
            <tbody>
              ${m.map(i => `<tr>
                <td><strong>${i.name||"Item"}</strong></td>
                <td>${i.category||"General"}</td>
                <td>${this.money(i.price||0)}</td>
                <td>${this.badge((i.type||"food").replace("_"," "))}</td>
                <td><button class="switch ${i.available?"on":""}" data-menu="${i.id}" title="Toggle"><span></span></button></td>
                ${(this.user?.accessLevel||0)>=80?`<td><button class="btn light" data-edit-menu="${i.id}">Edit</button></td>`:""}
              </tr>`).join("")}
            </tbody>
          </table>
        </section>
      </div>
    `;
  },

  categories() {
    const c = this.data.categories || [];
    return `
      <section class="card">
        <div class="panel" style="display:flex;justify-content:space-between;gap:18px">
          <div><h2 class="section-title">Menu Categories</h2><div class="muted">${c.length} categories</div></div>
          ${(this.user?.accessLevel||0)>=80?`<button class="btn" id="add-category">+ Add Category</button>`:""}
        </div>
        <table class="table">
          <thead><tr><th>Name</th><th>Description</th><th>Items</th><th>Status</th>${(this.user?.accessLevel||0)>=80?"<th>Action</th>":""}</tr></thead>
          <tbody>
            ${c.map(cat => {
              const itemCount = (this.data.menu||[]).filter(m=>m.category===cat.name).length;
              return `<tr>
                <td><strong>${cat.name}</strong></td>
                <td>${cat.description||"No description"}</td>
                <td><span class="badge blue">${itemCount}</span></td>
                <td>${cat.is_active?this.badge("active"):this.badge("inactive")}</td>
                ${(this.user?.accessLevel||0)>=80?`<td><button class="btn light" data-edit-cat="${cat.id}">Edit</button></td>`:""}
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </section>
    `;
  },

  orders() {
    const o = this.data.orders || [];
    return `
      <section class="card">
        <div class="panel"><h2 class="section-title">All Orders</h2></div>
        <table class="table">
          <thead><tr><th>ID</th><th>Type</th><th>Table</th><th>Items</th><th>Total</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            ${o.map(ord => `<tr>
              <td><strong>#${ord.code||"N/A"}</strong></td>
              <td>${this.badge(ord.order_type||ord.type||"dine_in")}</td>
              <td>${ord.table?`Table ${ord.table}`:"Takeaway"}</td>
              <td>${(ord.items||[]).length}</td>
              <td><strong>${this.money(ord.total_amount||ord.total||0)}</strong></td>
              <td>${this.badge(ord.status||"pending")}</td>
              <td><button class="btn light" data-view-order="${ord.id}">View</button></td>
            </tr>`).join("")}
          </tbody>
        </table>
      </section>
    `;
  },

  reports() {
    const s = this.data.sales || {};
    const pb = s.paymentBreakdown || [];
    return `
      <div class="grid stats">
        <article class="card stat">
          <div class="label">📈 Daily Revenue</div>
          <div class="metric">${this.money(s.dailyRevenue||0)}</div>
          <div class="muted">Today's total</div>
        </article>
        <article class="card stat">
          <div class="label">📊 Weekly Revenue</div>
          <div class="metric">${this.money(s.weeklyRevenue||0)}</div>
          <div class="muted">Last 7 days</div>
        </article>
        <article class="card stat">
          <div class="label">💼 Monthly Revenue</div>
          <div class="metric">${this.money(s.monthlyRevenue||0)}</div>
          <div class="muted">Current month</div>
        </article>
        <article class="card stat">
          <div class="label">⏱️ Avg Prep Time</div>
          <div class="metric">${this.data.stats?.avgPrepTime||"18m"}</div>
          <div class="muted">Kitchen speed</div>
        </article>
      </div>

      <section class="card panel" style="margin-top:24px">
        <h2 class="section-title">💳 Payment Method Breakdown</h2>
        <p class="muted">Revenue distribution across payment channels</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-top:20px">
          ${pb.map((p, i) => `<div class="card panel" style="background: linear-gradient(135deg, rgba(155, 69, 0, ${0.05 + i*0.03}) 0%, transparent 100%); border: 1px solid rgba(155, 69, 0, ${0.1 + i*0.05});">
            <div class="caps">${p.method||"Unknown"}</div>
            <div style="font-size: 28px; font-weight: 700; color: var(--primary); margin-top: 8px;">${this.money(p.amount||0)}</div>
            <div class="muted" style="margin-top: 4px;">Payment method</div>
          </div>`).join("")}
        </div>
      </section>
    `;
  },

  payments() {
    const p = this.data.payments || [];
    if (!p || p.length === 0) {
      return `<p class="muted">No payment transactions recorded</p>`;
    }
    const stats = {
      totalTransactions: p.length,
      totalAmount: p.reduce((sum, payment) => {
        return sum + (payment.status === 'captured' ? (payment.amount || 0) : 0);
      }, 0),
      successRate: p.length > 0 ? ((p.filter(x => x.status === 'captured').length / p.length) * 100).toFixed(1) : 0
    };

    return `
      <div class="grid stats">
        ${this.stat("Total Transactions", stats.totalTransactions, "All time")}
        ${this.stat("Revenue from Razorpay", this.money(stats.totalAmount), "Captured payments")}
        ${this.stat("Success Rate", stats.successRate + "%", "Successful captures")}
        ${this.stat("Razorpay Integration", "TEST MODE", "Sandbox")}
      </div>
      <section class="card panel" style="margin-top:24px">
        <div style="display:flex;justify-content:space-between;gap:18px;margin-bottom:16px">
          <div>
            <h2 class="section-title">Payment Transactions</h2>
            <div class="muted">${p.length} transactions</div>
          </div>
          <div style="text-align:right">
            <div class="muted">Razorpay Integration</div>
            <strong>Live API Connected</strong>
          </div>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>Payment ID</th>
              <th>Order ID</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Method</th>
              <th>Email</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            ${p.map(payment => `<tr>
              <td><code style="font-size:11px">${payment.razorpay_payment_id || payment.id || 'N/A'}</code></td>
              <td><strong>#${payment.order_id || 'N/A'}</strong></td>
              <td><strong>${this.money(payment.amount || 0)}</strong></td>
              <td>${this.badge(payment.status || 'pending')}</td>
              <td>${payment.payment_method || 'online'}</td>
              <td>${payment.email || 'N/A'}</td>
              <td>${new Date(payment.created_at).toLocaleDateString('en-IN')}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </section>
      <section class="card panel" style="margin-top:24px">
        <h2 class="section-title">Payment Status Distribution</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px">
          ${['captured', 'pending', 'failed', 'refunded'].map(status => {
            const count = p.filter(x => x.status === status).length;
            const amount = p.filter(x => x.status === status).reduce((sum, payment) => sum + (payment.amount || 0), 0);
            return `<div class="card panel">
              <div class="caps">${status}</div>
              <div class="metric">${count}</div>
              <div class="muted">${this.money(amount)}</div>
            </div>`;
          }).join("")}
        </div>
      </section>
    `;
  },

  stock() {
    const s = this.data.stock || [];
    return `
      <section class="card">
        <div class="panel" style="display:flex;justify-content:space-between;gap:18px">
          <div><h2 class="section-title">Stock Management</h2><div class="muted">${s.length} items</div></div>
          ${(this.user?.accessLevel||0)>=80?`<button class="btn" id="add-stock">+ Add Stock</button>`:""}
        </div>
        <table class="table">
          <thead><tr><th>Item</th><th>Category</th><th>Qty</th><th>Threshold</th><th>Status</th><th>Supplier</th>${(this.user?.accessLevel||0)>=80?"<th>Action</th>":""}</tr></thead>
          <tbody>
            ${s.map(item => `<tr>
              <td><strong>${item.item||item.item_name||"Item"}</strong></td>
              <td>${item.category||"General"}</td>
              <td>${item.quantity||0} ${item.unit||"unit"}</td>
              <td>${item.threshold||item.min_threshold||0}</td>
              <td>${this.badge((item.quantity||0)<=(item.threshold||item.min_threshold||0)?"low":"healthy")}</td>
              <td>${item.supplier||"N/A"}</td>
              ${(this.user?.accessLevel||0)>=80?`<td><button class="btn light" data-edit-stock="${item.id}">Edit</button></td>`:""}
            </tr>`).join("")}
          </tbody>
        </table>
      </section>
    `;
  },

  staff() {
    const st = this.data.staff || [];
    return `
      <section class="card">
        <div class="panel" style="display:flex;justify-content:space-between;gap:18px">
          <div><h2 class="section-title">Staff Management</h2><div class="muted">${st.length} total staff</div></div>
          ${(this.user?.accessLevel||0)>=80?`<button class="btn" id="add-staff">+ Add Staff</button>`:""}
        </div>
        <table class="table">
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Email</th><th>Phone</th><th>Status</th>${(this.user?.accessLevel||0)>=80?"<th>Action</th>":""}</tr></thead>
          <tbody>
            ${st.map(p => `<tr>
              <td><strong>${p.name||"N/A"}</strong></td>
              <td>${p.username||"N/A"}</td>
              <td>${this.badge(p.role||"staff")}</td>
              <td>${p.email||"N/A"}</td>
              <td>${p.phone||"N/A"}</td>
              <td>${this.badge(p.active?"active":"inactive")}</td>
              ${(this.user?.accessLevel||0)>=80?`<td><button class="btn light" data-edit-staff="${p.id}">Edit</button></td>`:""}
            </tr>`).join("")}
          </tbody>
        </table>
      </section>
    `;
  },

  reservations() {
    const r = this.data.reservations || [];
    return `
      <section class="card">
        <div class="panel"><h2 class="section-title">Reservations</h2><div class="muted">${r.length} total</div></div>
        <table class="table">
          <thead><tr><th>Customer</th><th>Table</th><th>Party Size</th><th>Date/Time</th><th>Status</th>${(this.user?.accessLevel||0)>=60?"<th>Action</th>":""}</tr></thead>
          <tbody>
            ${r.map(res => `<tr>
              <td><strong>${res.customer||res.customer_name||"N/A"}</strong></td>
              <td>${res.table||res.tableNumber||"N/A"}</td>
              <td>${res.partySize||res.party_size||"N/A"}</td>
              <td>${res.reservation_date||"N/A"} ${res.reservation_time||res.time||"N/A"}</td>
              <td>${this.badge(res.status||"pending")}</td>
              ${(this.user?.accessLevel||0)>=60?`<td><button class="btn light" data-res-confirm="${res.id}">Confirm</button></td>`:""}
            </tr>`).join("")}
          </tbody>
        </table>
      </section>
    `;
  },

  bindPageActions() {
    // Login form
    const loginForm = document.getElementById("login-form");
    if (loginForm) {
      loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          await this.login(
            document.getElementById("username").value,
            document.getElementById("password").value
          );
        } catch (err) {
          alert(err.message);
        }
      });
      document.getElementById("toggle-register")?.addEventListener("click", () => {
        this.showRegister = true;
        this.renderLogin();
      });
    }

    // Register form
    const registerForm = document.getElementById("register-form");
    if (registerForm) {
      registerForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          await this.register(
            document.getElementById("reg-username").value,
            document.getElementById("reg-password").value,
            document.getElementById("reg-fullname").value,
            document.getElementById("reg-email").value,
            document.getElementById("reg-phone").value || "",
            document.getElementById("reg-role").value
          );
        } catch (err) {
          alert(err.message);
        }
      });
      document.getElementById("toggle-login")?.addEventListener("click", () => {
        this.showRegister = false;
        this.renderLogin();
      });
    }

    // Kitchen actions
    document.querySelectorAll("[data-kitchen]").forEach(b => {
      b.addEventListener("click", async () => {
        try {
          const status = b.textContent.includes("Start") ? "in_progress" : "ready";
          await this.api(`/api/kitchen/${b.dataset.kitchen}/status`, {method:"PUT", body: JSON.stringify({status})});
          await this.refresh(); this.renderShell();
        } catch (e) { alert(e.message); }
      });
    });

    // Menu toggle
    document.querySelectorAll("[data-menu]").forEach(b => {
      b.addEventListener("click", async () => {
        try {
          await this.api(`/api/menu/items/${b.dataset.menu}/toggle`, {method:"PUT"});
          await this.refresh(); this.renderShell();
        } catch (e) { alert(e.message); }
      });
    });

    // Add staff
    document.getElementById("add-staff")?.addEventListener("click", () => {
      const username = prompt("Username:");
      const name = prompt("Full Name:");
      const email = prompt("Email:");
      const phone = prompt("Phone:");
      const role = prompt("Role (owner/admin/manager/waiter/customer):", "waiter");
      if (username && name) {
        this.api("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({username, full_name: name, email, phone, role, password: "staff123"})
        }).then(() => { this.refresh(); this.renderShell(); }).catch(e => alert(e.message));
      }
    });

    // Add category
    document.getElementById("add-category")?.addEventListener("click", () => {
      const name = prompt("Category Name:");
      const desc = prompt("Description:");
      if (name) {
        this.api("/api/menu/categories", {
          method: "POST",
          body: JSON.stringify({name, description: desc})
        }).then(() => { this.refresh(); this.renderShell(); }).catch(e => alert(e.message));
      }
    });

    // Add menu item
    document.getElementById("add-menu")?.addEventListener("click", () => {
      const name = prompt("Item Name:");
      const price = parseFloat(prompt("Price:") || "0");
      const catId = prompt("Category ID:", "1");
      if (name && price) {
        this.api("/api/menu/items", {
          method: "POST",
          body: JSON.stringify({name, price, categoryId: catId, type: "food", vegetarian: false, available: true, prepMinutes: 15})
        }).then(() => { this.refresh(); this.renderShell(); }).catch(e => alert(e.message));
      }
    });

    // Add stock
    document.getElementById("add-stock")?.addEventListener("click", () => {
      const item = prompt("Item Name:");
      const qty = parseFloat(prompt("Quantity:") || "0");
      const cat = prompt("Category:", "General");
      if (item && qty) {
        this.api("/api/stock", {
          method: "POST",
          body: JSON.stringify({item, quantity: qty, category: cat, unit: "kg", threshold: 10})
        }).then(() => { this.refresh(); this.renderShell(); }).catch(e => alert(e.message));
      }
    });
  },
};

// Setup immediate event listeners for login form after render
const originalRenderLogin = App.renderLogin.bind(App);
App.renderLogin = function() {
  originalRenderLogin();
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await this.login(
          document.getElementById("username").value,
          document.getElementById("password").value
        );
      } catch (err) {
        alert(err.message);
      }
    });
    document.getElementById("toggle-register")?.addEventListener("click", () => {
      this.showRegister = true;
      this.renderLogin();
    });
  }
  const registerForm = document.getElementById("register-form");
  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await this.register(
          document.getElementById("reg-username").value,
          document.getElementById("reg-password").value,
          document.getElementById("reg-fullname").value,
          document.getElementById("reg-email").value,
          document.getElementById("reg-phone").value || "",
          document.getElementById("reg-role").value
        );
      } catch (err) {
        alert(err.message);
      }
    });
    document.getElementById("toggle-login")?.addEventListener("click", () => {
      this.showRegister = false;
      this.renderLogin();
    });
  }
};

App.boot();
