/**
 * Akshay Bhojanam - Restaurant Management System
 * Complete Multi-User SPA with Role-Based Dashboards
 * Fully Dynamic Database Integration
 */

const App = {
  // State Management
  token: localStorage.getItem("ab_token") || null,
  user: JSON.parse(localStorage.getItem("ab_user") || "null"),
  page: localStorage.getItem("ab_page") || "home",
  data: {},
  cart: JSON.parse(localStorage.getItem("ab_cart") || "[]"),
  currentCustomerOrder: null,
  currentFilter: "all",

  // ============= API LAYER =============
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

  // ============= INITIALIZATION =============
  async boot() {
    if (!this.token || !this.user) {
      this.renderLogin();
      return;
    }
    try {
      await this.refresh();
      this.renderApp();
    } catch (err) {
      console.error("Boot error:", err);
      this.logout(false);
    }
  },

  async refresh() {
    // All users get menu data
    const baseEndpoints = [
      ["/api/menu/items/all", "menu"],
      ["/api/menu/categories", "categories"],
    ];

    // Role-specific data
    let roleEndpoints = [];
    if (this.user.role === "owner" || this.user.role === "admin") {
      roleEndpoints = [
        ["/api/dashboard/stats", "stats"],
        ["/api/orders", "orders"],
        ["/api/staff", "staff"],
        ["/api/sales/summary", "sales"],
      ];
    } else if (this.user.role === "manager") {
      roleEndpoints = [
        ["/api/dashboard/stats", "stats"],
        ["/api/orders", "orders"],
        ["/api/staff", "staff"],
      ];
    } else if (this.user.role === "waiter") {
      roleEndpoints = [
        ["/api/orders", "orders"],
      ];
    }

    const endpoints = [...baseEndpoints, ...roleEndpoints];
    const results = await Promise.all(
      endpoints.map(([path]) => this.api(path).catch(() => []))
    );
    this.data = Object.fromEntries(
      endpoints.map(([_, key], i) => [key, results[i]])
    );
  },

  // ============= AUTHENTICATION =============
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
    this.page = "home";
    await this.boot();
  },

  async register(username, password, full_name, email, phone, role) {
    const result = await this.api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ 
        username, 
        password, 
        full_name, 
        email, 
        phone, 
        role: role || "customer" 
      }),
    });
    if (!result.success) throw new Error(result.message || "Registration failed");
    this.token = result.token;
    this.user = result.user;
    localStorage.setItem("ab_token", this.token);
    localStorage.setItem("ab_user", JSON.stringify(this.user));
    this.page = "home";
    await this.boot();
  },

  async logout() {
    if (this.token) {
      await this.api("/api/auth/logout", { method: "POST" }).catch(() => {});
    }
    localStorage.removeItem("ab_token");
    localStorage.removeItem("ab_user");
    localStorage.removeItem("ab_page");
    localStorage.removeItem("ab_cart");
    this.token = null;
    this.user = null;
    this.cart = [];
    this.page = "home";
    this.currentFilter = "all";
    this.renderLogin();
  },

  // ============= NAVIGATION =============
  navigate(page) {
    this.page = page;
    this.currentFilter = "all";
    localStorage.setItem("ab_page", page);
    this.renderApp();
  },

  setFilter(category) {
    this.currentFilter = category;
    this.renderApp();
  },

  // ============= CART MANAGEMENT =============
  addToCart(item) {
    const existing = this.cart.find(c => c.id === item.id);
    if (existing) {
      existing.quantity += 1;
    } else {
      this.cart.push({ ...item, quantity: 1 });
    }
    this.saveCart();
    this.renderApp();
  },

  removeFromCart(itemId) {
    this.cart = this.cart.filter(c => c.id !== itemId);
    this.saveCart();
    this.renderApp();
  },

  updateCartQuantity(itemId, quantity) {
    const item = this.cart.find(c => c.id === itemId);
    if (item) {
      item.quantity = Math.max(0, quantity);
      if (item.quantity === 0) {
        this.removeFromCart(itemId);
      } else {
        this.saveCart();
        this.renderApp();
      }
    }
  },

  saveCart() {
    localStorage.setItem("ab_cart", JSON.stringify(this.cart));
  },

  calculateBill() {
    const subtotal = this.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const tax = subtotal * 0.05;
    const serviceCharge = subtotal * 0.10;
    const total = subtotal + tax + serviceCharge;
    return {
      subtotal,
      tax,
      serviceCharge,
      total,
      itemCount: this.cart.reduce((sum, item) => sum + item.quantity, 0),
    };
  },

  async placeOrder() {
    if (this.cart.length === 0) {
      alert("Cart is empty!");
      return;
    }

    const bill = this.calculateBill();
    const order = await this.api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        items: this.cart.map(item => ({
          menu_item_id: item.id,
          quantity: item.quantity,
          unit_price: item.price,
        })),
        customer_name: this.user.name,
        customer_id: this.user.id,
        order_type: "takeaway",
        subtotal: bill.subtotal,
        tax: bill.tax,
        service_charge: bill.serviceCharge,
        total_amount: bill.total,
      }),
    });

    if (order.success) {
      this.currentCustomerOrder = order.order;
      this.cart = [];
      this.saveCart();
      alert(`Order placed successfully!\nOrder Code: ${order.order.code}\nTotal: ₹${order.order.total_amount.toFixed(2)}`);
      this.page = "home";
      this.renderApp();
    }
  },

  // ============= RENDERING - MAIN APP =============
  renderApp() {
    if (!this.token || !this.user) {
      this.renderLogin();
      return;
    }

    if (this.user.role === "customer") {
      this.renderCustomerApp();
    } else {
      this.renderStaffApp();
    }
  },

  // ============= CUSTOMER INTERFACE =============
  renderCustomerApp() {
    const container = document.getElementById("app");
    const bill = this.calculateBill();
    const filteredMenu = this.currentFilter === "all" 
      ? this.data.menu || []
      : (this.data.menu || []).filter(item => item.category === this.currentFilter);

    container.innerHTML = `
      <div class="customer-interface">
        <!-- Header -->
        <div class="customer-header">
          <div class="header-left">
            <img src="/assets/अक्षय.svg" alt="Akshay Bhojanam" class="logo-image">
          </div>
          <div class="header-center">
            <h3 style="margin:0; color: #333;">Welcome, ${this.user.name}</h3>
          </div>
          <div class="header-right">
            <button onclick="App.navigate('orders')" class="btn-secondary">📋 My Orders</button>
            <button onclick="App.logout()" class="btn-secondary">🚪 Logout</button>
          </div>
        </div>

        <div class="customer-body">
          <!-- Menu Section -->
          <div class="menu-section">
            <div class="filters">
              <button class="filter-btn ${this.currentFilter === 'all' ? 'active' : ''}" 
                onclick="App.setFilter('all')">All Items</button>
              ${(this.data.categories || []).map(cat => `
                <button class="filter-btn ${this.currentFilter === cat.name ? 'active' : ''}" 
                  onclick="App.setFilter('${cat.name}')">${cat.name}</button>
              `).join('')}
            </div>

            <div class="menu-grid">
              ${filteredMenu.map(item => `
                <div class="menu-card">
                  <div class="menu-card-body">
                    <h4>${item.name}</h4>
                    <p class="description">${item.description || 'Fresh & delicious'}</p>
                    <div class="card-footer">
                      <div class="price-veg">
                        <span class="price">₹${item.price}</span>
                        <span class="veg-badge ${item.is_vegetarian ? 'veg' : 'nonveg'}">
                          ${item.is_vegetarian ? '🟢 Veg' : '🔴 Non-Veg'}
                        </span>
                      </div>
                      <button class="btn-primary" onclick="App.addToCart(${JSON.stringify(item).replace(/"/g, '&quot;')})">
                        Add to Cart
                      </button>
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Bill Panel -->
        <div class="bill-section">
          <h3>🧾 Bill Summary</h3>
          <div class="cart-items">
            ${this.cart.length === 0 ? '<p class="empty-cart">Cart is empty</p>' : this.cart.map(item => `
              <div class="cart-item">
                <div class="item-info">
                  <div class="item-name">${item.name}</div>
                  <div class="item-price">₹${item.price}</div>
                </div>
                <div class="qty-controls">
                  <button class="qty-btn" onclick="App.updateCartQuantity(${item.id}, ${item.quantity - 1})">−</button>
                  <span class="qty-display">${item.quantity}</span>
                  <button class="qty-btn" onclick="App.updateCartQuantity(${item.id}, ${item.quantity + 1})">+</button>
                </div>
                <div class="item-subtotal">₹${(item.price * item.quantity).toFixed(2)}</div>
                <button class="btn-remove" onclick="App.removeFromCart(${item.id})">✕</button>
              </div>
            `).join('')}
          </div>

          ${this.cart.length > 0 ? `
            <div class="bill-breakdown">
              <div class="bill-row">
                <span>Subtotal</span>
                <span>₹${bill.subtotal.toFixed(2)}</span>
              </div>
              <div class="bill-row">
                <span>Tax (5%)</span>
                <span>₹${bill.tax.toFixed(2)}</span>
              </div>
              <div class="bill-row">
                <span>Service (10%)</span>
                <span>₹${bill.serviceCharge.toFixed(2)}</span>
              </div>
              <div class="bill-row total">
                <span>Total</span>
                <span>₹${bill.total.toFixed(2)}</span>
              </div>
              <button class="btn-place-order" onclick="App.placeOrder()">Place Order</button>
              <button class="btn-secondary" onclick="App.cart = []; App.saveCart(); App.renderApp()">Clear Cart</button>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  },

  // ============= STAFF/ADMIN INTERFACES =============
  renderStaffApp() {
    const container = document.getElementById("app");
    const navItems = this.getNavItems();

    container.innerHTML = `
      <div class="staff-interface">
        <!-- Sidebar Navigation -->
        <div class="sidebar">
          <div class="sidebar-header">
            <img src="/assets/अक्षय.svg" alt="Akshay Bhojanam" class="logo-image sidebar-logo">
            <p>${this.user.name}</p>
            <p class="role-badge">${this.user.role.toUpperCase()}</p>
          </div>
          <nav class="sidebar-nav">
            ${navItems.map(item => `
              <button class="nav-item ${this.page === item.id ? 'active' : ''}" 
                onclick="App.navigate('${item.id}')">${item.icon} ${item.label}</button>
            `).join('')}
          </nav>
          <button class="btn-logout" onclick="App.logout()">🚪 Logout</button>
        </div>

        <!-- Main Content -->
        <div class="main-content">
          ${this.renderPageContent()}
        </div>
      </div>
    `;
  },

  getNavItems() {
    const baseItems = [{ id: "home", icon: "📊", label: "Dashboard" }];
    
    if (this.user.role === "owner" || this.user.role === "admin") {
      return [
        ...baseItems,
        { id: "orders", icon: "📋", label: "Orders" },
        { id: "staff", icon: "👥", label: "Staff" },
        { id: "menu", icon: "🍽️", label: "Menu" },
        { id: "sales", icon: "💰", label: "Sales" },
      ];
    } else if (this.user.role === "manager") {
      return [
        ...baseItems,
        { id: "orders", icon: "📋", label: "Orders" },
        { id: "staff", icon: "👥", label: "Staff" },
        { id: "menu", icon: "🍽️", label: "Menu" },
      ];
    } else if (this.user.role === "waiter") {
      return [
        { id: "orders", icon: "📋", label: "Orders" },
        { id: "menu", icon: "🍽️", label: "Menu" },
      ];
    }
    return baseItems;
  },

  renderPageContent() {
    switch (this.page) {
      case "home":
        return this.renderDashboard();
      case "orders":
        return this.renderOrdersPage();
      case "staff":
        return this.renderStaffPage();
      case "menu":
        return this.renderMenuPage();
      case "sales":
        return this.renderSalesPage();
      default:
        return this.renderDashboard();
    }
  },

  renderDashboard() {
    const stats = this.data.stats || {};
    return `
      <div class="page-content">
        <h1>📊 Dashboard</h1>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">₹${(stats.todaysSales || 0).toLocaleString()}</div>
            <div class="stat-label">Today's Sales</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${stats.activeOrders || 0}</div>
            <div class="stat-label">Active Orders</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${stats.activeTables || 0} / ${stats.totalTables || 30}</div>
            <div class="stat-label">Tables Occupied</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${stats.staffOnDuty || 0}</div>
            <div class="stat-label">Staff On Duty</div>
          </div>
        </div>
      </div>
    `;
  },

  renderOrdersPage() {
    const orders = this.data.orders || [];
    return `
      <div class="page-content">
        <h1>📋 Orders</h1>
        <div class="orders-table">
          <table>
            <thead>
              <tr>
                <th>Order Code</th>
                <th>Customer</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              ${orders.slice(0, 20).map(order => `
                <tr>
                  <td>${order.code}</td>
                  <td>${order.customer_name}</td>
                  <td>${order.order_type}</td>
                  <td>₹${order.total_amount.toFixed(2)}</td>
                  <td><span class="status-badge ${order.status}">${order.status}</span></td>
                  <td>${order.created_at}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  renderStaffPage() {
    const staff = this.data.staff || [];
    return `
      <div class="page-content">
        <h1>👥 Staff Directory</h1>
        <div class="staff-grid">
          ${staff.map(person => `
            <div class="staff-card">
              <h3>${person.name}</h3>
              <p><strong>Role:</strong> ${person.role}</p>
              <p><strong>Email:</strong> ${person.email}</p>
              <p><strong>Phone:</strong> ${person.phone}</p>
              <p><strong>Status:</strong> ${person.active ? '✅ Active' : '⛔ Inactive'}</p>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  renderMenuPage() {
    const menu = this.data.menu || [];
    return `
      <div class="page-content">
        <h1>🍽️ Menu Management</h1>
        <div class="menu-table">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th>Price</th>
                <th>Type</th>
                <th>Available</th>
              </tr>
            </thead>
            <tbody>
              ${menu.map(item => `
                <tr>
                  <td>${item.name}</td>
                  <td>${item.category}</td>
                  <td>₹${item.price}</td>
                  <td>${item.is_vegetarian ? '🟢 Veg' : '🔴 Non-Veg'}</td>
                  <td>${item.is_available ? '✅ Yes' : '❌ No'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  renderSalesPage() {
    const sales = this.data.sales || {};
    return `
      <div class="page-content">
        <h1>💰 Sales Report</h1>
        <div class="sales-grid">
          <div class="sales-card">
            <h3>Daily Revenue</h3>
            <p class="amount">₹${(sales.dailyRevenue || 0).toLocaleString()}</p>
          </div>
          <div class="sales-card">
            <h3>Weekly Revenue</h3>
            <p class="amount">₹${(sales.weeklyRevenue || 0).toLocaleString()}</p>
          </div>
          <div class="sales-card">
            <h3>Monthly Revenue</h3>
            <p class="amount">₹${(sales.monthlyRevenue || 0).toLocaleString()}</p>
          </div>
        </div>
        ${sales.paymentBreakdown ? `
          <div style="margin-top: 30px;">
            <h3>Payment Breakdown</h3>
            <table>
              <thead>
                <tr><th>Method</th><th>Amount</th></tr>
              </thead>
              <tbody>
                ${sales.paymentBreakdown.map(pb => `
                  <tr>
                    <td>${pb.method}</td>
                    <td>₹${pb.amount.toLocaleString()}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : ''}
      </div>
    `;
  },

  // ============= LOGIN & REGISTRATION =============
  renderLogin() {
    const container = document.getElementById("app");
    container.innerHTML = `
      <div class="login-container">
        <div class="login-box">
          <img src="/assets/अक्षय.svg" alt="Akshay Bhojanam" class="logo-image login-logo">
          <h2>Restaurant Management System</h2>
          
          <div class="form-tabs">
            <button class="tab-btn active" onclick="App.showLoginForm()">Login</button>
            <button class="tab-btn" onclick="App.showRegisterForm()">Create Account</button>
          </div>

          <div id="login-form" class="form-content">
            <form onsubmit="event.preventDefault(); App.handleLogin()">
              <div class="form-group">
                <label>Username</label>
                <input type="text" id="login-username" placeholder="Enter username" required>
              </div>
              <div class="form-group">
                <label>Password</label>
                <input type="password" id="login-password" placeholder="Enter password" required>
              </div>
              <button type="submit" class="btn-primary btn-large">Login</button>
            </form>
          </div>

          <div id="register-form" class="form-content" style="display: none;">
            <form onsubmit="event.preventDefault(); App.handleRegister()">
              <div class="form-group">
                <label>Full Name</label>
                <input type="text" id="reg-fullname" placeholder="Your full name" required>
              </div>
              <div class="form-group">
                <label>Username</label>
                <input type="text" id="reg-username" placeholder="Choose username" required>
              </div>
              <div class="form-group">
                <label>Email</label>
                <input type="email" id="reg-email" placeholder="Your email" required>
              </div>
              <div class="form-group">
                <label>Phone</label>
                <input type="text" id="reg-phone" placeholder="Your phone (optional)">
              </div>
              <div class="form-group">
                <label>Password</label>
                <input type="password" id="reg-password" placeholder="Strong password" required>
              </div>
              <div class="form-group">
                <label>Account Type</label>
                <select id="reg-role" required>
                  <option value="customer">Customer (Place Orders)</option>
                  <option value="waiter">Waiter (Staff)</option>
                  <option value="manager">Manager (Admin)</option>
                </select>
              </div>
              <button type="submit" class="btn-primary btn-large">Create Account</button>
            </form>
          </div>
        </div>
      </div>
    `;
  },

  showLoginForm() {
    document.getElementById("login-form").style.display = "block";
    document.getElementById("register-form").style.display = "none";
    document.querySelectorAll(".tab-btn")[0].classList.add("active");
    document.querySelectorAll(".tab-btn")[1].classList.remove("active");
  },

  showRegisterForm() {
    document.getElementById("login-form").style.display = "none";
    document.getElementById("register-form").style.display = "block";
    document.querySelectorAll(".tab-btn")[0].classList.remove("active");
    document.querySelectorAll(".tab-btn")[1].classList.add("active");
  },

  async handleLogin() {
    try {
      const username = document.getElementById("login-username").value;
      const password = document.getElementById("login-password").value;
      await this.login(username, password);
    } catch (err) {
      alert("Login failed: " + err.message);
    }
  },

  async handleRegister() {
    try {
      const fullName = document.getElementById("reg-fullname").value;
      const username = document.getElementById("reg-username").value;
      const email = document.getElementById("reg-email").value;
      const phone = document.getElementById("reg-phone").value;
      const password = document.getElementById("reg-password").value;
      const role = document.getElementById("reg-role").value;
      await this.register(username, password, fullName, email, phone, role);
    } catch (err) {
      alert("Registration failed: " + err.message);
    }
  },
};

// ============= INITIALIZATION =============
document.addEventListener("DOMContentLoaded", () => {
  App.boot();
});
