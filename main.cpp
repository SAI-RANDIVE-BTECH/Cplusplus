#include <crow_all.h>
#include <sqlite3.h>
#include <string>
#include <vector>
#include <map>
#include <memory>
#include <chrono>
#include <iomanip>
#include <sstream>
#include <random>
#include <cmath>
#include <iostream>
#include <fstream>
#include <algorithm>

// ============= DATABASE HELPERS =============
class Database {
private:
    sqlite3* db;
public:
    Database() : db(nullptr) {}
    ~Database() { if (db) sqlite3_close(db); }
    bool open(const std::string& path) { return sqlite3_open(path.c_str(), &db) == SQLITE_OK; }
    sqlite3* getDB() { return db; }
    bool executeSQL(const std::string& sql) {
        char* errMsg = nullptr;
        int rc = sqlite3_exec(db, sql.c_str(), nullptr, nullptr, &errMsg);
        if (rc != SQLITE_OK) { std::cerr << "SQL error: " << errMsg << std::endl; sqlite3_free(errMsg); return false; }
        return true;
    }
};

// ============= UTILITIES =============
std::string sha256(const std::string& str) {
    std::hash<std::string> hasher;
    return std::to_string(hasher(str));
}

std::string randomString(int len) {
    const char charset[] = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    std::string result;
    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_int_distribution<> dis(0, sizeof(charset) - 2);
    for (int i = 0; i < len; i++) result += charset[dis(gen)];
    return result;
}

std::string getCurrentTimestamp() {
    auto now = std::chrono::system_clock::now();
    auto time = std::chrono::system_clock::to_time_t(now);
    std::stringstream ss;
    ss << std::put_time(std::localtime(&time), "%Y-%m-%d %H:%M:%S");
    return ss.str();
}

std::string getOrderCode() {
    auto now = std::chrono::system_clock::now();
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch());
    return "ORD-" + std::to_string(ms.count()).substr(std::to_string(ms.count()).length() - 6);
}

std::string getTodayDate() {
    auto now = std::chrono::system_clock::now();
    auto time = std::chrono::system_clock::to_time_t(now);
    std::stringstream ss;
    ss << std::put_time(std::localtime(&time), "%Y-%m-%d");
    return ss.str();
}

// ============= AUTH =============
std::map<std::string, crow::json::wvalue> tokenStore;

struct User { int id; std::string username; std::string name; std::string role; std::string email; int accessLevel; };

User* authenticate(const std::string& token) {
    if (tokenStore.find(token) == tokenStore.end()) return nullptr;
    auto* user = new User();
    auto& d = tokenStore[token];
    user->id = d["id"].i(); user->username = d["username"].s(); user->name = d["name"].s();
    user->role = d["role"].s(); user->email = d["email"].s(); user->accessLevel = d["accessLevel"].i();
    return user;
}

User* requireAuth(const crow::request& req, int minLevel = 20) {
    std::string token;
    auto authHeader = req.get_header_value("Authorization");
    if (authHeader.find("Bearer ") == 0) token = authHeader.substr(7);
    if (token.empty()) return nullptr;
    auto* user = authenticate(token);
    if (!user) return nullptr;
    int level = (user->role == "owner" || user->role == "admin") ? 100 : (user->role == "manager") ? 60 : (user->role == "waiter") ? 40 : 20;
    if (level < minLevel) { delete user; return nullptr; }
    return user;
}

// ============= INIT DB =============
void initializeDatabase(Database& db) {
    db.executeSQL(R"(CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','admin','manager','waiter','customer')), full_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT, salary REAL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP))");
    db.executeSQL(R"(CREATE TABLE IF NOT EXISTS menu_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT, is_active INTEGER NOT NULL DEFAULT 1))");
    db.executeSQL(R"(CREATE TABLE IF NOT EXISTS menu_items (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT, price REAL NOT NULL CHECK(price > 0), item_type TEXT NOT NULL CHECK(item_type IN ('food','beverage','dessert')), is_vegetarian INTEGER NOT NULL, is_available INTEGER NOT NULL DEFAULT 1, prep_minutes INTEGER NOT NULL DEFAULT 15, image_url TEXT, FOREIGN KEY(category_id) REFERENCES menu_categories(id)))");
    db.executeSQL(R"(CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, order_type TEXT NOT NULL CHECK(order_type IN ('dine_in','takeaway','parcel')), table_id INTEGER, customer_id INTEGER, customer_name TEXT, guests INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL CHECK(status IN ('pending','confirmed','preparing','ready','served','completed','cancelled')), payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','paid','refunded','failed')), subtotal REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0, service_charge REAL NOT NULL DEFAULT 0, discount REAL NOT NULL DEFAULT 0, total_amount REAL NOT NULL DEFAULT 0, payment_method TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(table_id) REFERENCES tables(id), FOREIGN KEY(customer_id) REFERENCES users(id)))");
    db.executeSQL(R"(CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, menu_item_id INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0), unit_price REAL NOT NULL, subtotal REAL NOT NULL, status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','in_progress','ready','served')), note TEXT, FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE, FOREIGN KEY(menu_item_id) REFERENCES menu_items(id)))");
    db.executeSQL(R"(CREATE TABLE IF NOT EXISTS tables (id INTEGER PRIMARY KEY AUTOINCREMENT, table_number INTEGER NOT NULL UNIQUE, capacity INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('available','occupied','reserved','maintenance')), assigned_waiter_id INTEGER, elapsed_minutes INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(assigned_waiter_id) REFERENCES users(id)))");
    db.executeSQL(R"(CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, user_id INTEGER, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'INR', razorpay_payment_id TEXT UNIQUE, razorpay_order_id TEXT UNIQUE, status TEXT NOT NULL CHECK(status IN ('initiated','pending','authorized','captured','refunded','failed','cancelled')), description TEXT, receipt TEXT, email TEXT, phone_number TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id)))");
    db.executeSQL(R"(CREATE TABLE IF NOT EXISTS stock (id INTEGER PRIMARY KEY AUTOINCREMENT, item_name TEXT NOT NULL UNIQUE, category TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT NOT NULL, min_threshold REAL NOT NULL, cost_per_unit REAL NOT NULL DEFAULT 0, supplier TEXT, last_restocked TEXT))");
    db.executeSQL(R"(CREATE TABLE IF NOT EXISTS cutlery (id INTEGER PRIMARY KEY AUTOINCREMENT, item_name TEXT NOT NULL UNIQUE, total_count INTEGER NOT NULL, available_count INTEGER NOT NULL, in_use_count INTEGER NOT NULL DEFAULT 0, damaged_count INTEGER NOT NULL DEFAULT 0))");
    db.executeSQL(R"(CREATE TABLE IF NOT EXISTS kitchen_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, order_item_id INTEGER, item_name TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','high','low')), status TEXT NOT NULL CHECK(status IN ('queued','in_progress','completed','cancelled')), elapsed_minutes INTEGER NOT NULL DEFAULT 0, started_at TEXT, completed_at TEXT, FOREIGN KEY(order_id) REFERENCES orders(id), FOREIGN KEY(order_item_id) REFERENCES order_items(id)))");
    db.executeSQL(R"(CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, description TEXT, amount REAL NOT NULL, expense_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, recorded_by INTEGER, FOREIGN KEY(recorded_by) REFERENCES users(id)))");
}

// ============= SEED =============
void seedData(Database& db) {
    sqlite3_stmt* stmt;
    sqlite3_prepare_v2(db.getDB(), "SELECT COUNT(*) as count FROM users", -1, &stmt, nullptr);
    sqlite3_step(stmt);
    int count = sqlite3_column_int(stmt, 0);
    sqlite3_finalize(stmt);
    if (count > 0) { std::cout << "Database already seeded" << std::endl; return; }

    std::vector<std::tuple<std::string, std::string, std::string, std::string, std::string, double>> users = {
        {"apurva", "SaiBaba", "owner", "Apurva Sanpurkar", "apurva@gmail.com", 0},
        {"apurva_sanpurkar", "apurva@2024", "owner", "Apurva Sanpurkar", "apurva@akshaybhojanam.in", 0},
        {"sai_randive", "sai@2024", "owner", "Sai Randive", "sai@akshaybhojanam.in", 0},
        {"shripad_deshpande", "staff@2024", "manager", "Shripad Deshpande", "shripad@akshaybhojanam.in", 35000},
        {"aniruddha_joshi", "staff@2024", "manager", "Aniruddha Joshi", "aniruddha@akshaybhojanam.in", 32000},
        {"parth_sahasrabuddhe", "staff@2024", "waiter", "Parth Sahasrabuddhe", "parth@akshaybhojanam.in", 18000},
        {"rajesh_kumar", "customer@2024", "customer", "Rajesh Kumar", "rajesh@customer.in", 0},
        {"priya_sharma", "customer@2024", "customer", "Priya Sharma", "priya@customer.in", 0}
    };

    for (auto& u : users) {
        std::string salt = randomString(32);
        std::string hash = sha256(salt + std::get<1>(u) + salt);
        std::string sql = "INSERT INTO users(username,password_hash,salt,role,full_name,email,phone,salary,is_active) VALUES(?,?,?,?,?,?,?,?,?)";
        sqlite3_stmt* s; sqlite3_prepare_v2(db.getDB(), sql.c_str(), -1, &s, nullptr);
        sqlite3_bind_text(s, 1, std::get<0>(u).c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_text(s, 2, hash.c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_text(s, 3, salt.c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_text(s, 4, std::get<2>(u).c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_text(s, 5, std::get<3>(u).c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_text(s, 6, std::get<4>(u).c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_text(s, 7, "9876500000", -1, SQLITE_STATIC);
        sqlite3_bind_double(s, 8, std::get<5>(u));
        sqlite3_bind_int(s, 9, 1);
        sqlite3_step(s); sqlite3_finalize(s);
    }

    for (int i = 1; i <= 30; i++) {
        std::string status = (i <= 5) ? "occupied" : (i <= 10) ? "reserved" : "available";
        int capacity = (i <= 4) ? 2 : (i <= 8) ? 4 : (i <= 16) ? 6 : 8;
        std::string sql = "INSERT INTO tables(table_number, capacity, status, elapsed_minutes) VALUES(?, ?, ?, ?)";
        sqlite3_stmt* s; sqlite3_prepare_v2(db.getDB(), sql.c_str(), -1, &s, nullptr);
        sqlite3_bind_int(s, 1, i); sqlite3_bind_int(s, 2, capacity);
        sqlite3_bind_text(s, 3, status.c_str(), -1, SQLITE_STATIC); sqlite3_bind_int(s, 4, rand() % 120);
        sqlite3_step(s); sqlite3_finalize(s);
    }

    std::vector<std::tuple<std::string, std::string, double, std::string, double, double>> stockItems = {
        {"Basmati Rice (Premium)", "Grains", 250, "kg", 50, 110}, {"Maida (Fine)", "Flours", 80, "kg", 15, 45},
        {"Full Cream Milk", "Dairy", 450, "Liters", 100, 66}, {"Paneer (Fresh)", "Dairy", 60, "kg", 10, 420},
        {"Chicken (Boneless)", "Non-Veg", 120, "kg", 20, 280}, {"Onion", "Vegetables", 70, "kg", 15, 50},
        {"Refined Sunflower Oil", "Oils", 100, "Liters", 20, 145}, {"Biryani Masala", "Spices", 5, "kg", 1, 600},
        {"Ginger", "Vegetables", 65, "kg", 10, 50}, {"Garlic", "Vegetables", 65, "kg", 10, 50}
    };
    for (auto& item : stockItems) {
        std::string sql = "INSERT INTO stock(item_name, category, quantity, unit, min_threshold, cost_per_unit, last_restocked) VALUES(?,?,?,?,?,?,?)";
        sqlite3_stmt* s; sqlite3_prepare_v2(db.getDB(), sql.c_str(), -1, &s, nullptr);
        sqlite3_bind_text(s, 1, std::get<0>(item).c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_text(s, 2, std::get<1>(item).c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_double(s, 3, std::get<2>(item));
        sqlite3_bind_text(s, 4, std::get<3>(item).c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_double(s, 5, std::get<4>(item));
        sqlite3_bind_double(s, 6, std::get<5>(item));
        sqlite3_bind_text(s, 7, getCurrentTimestamp().c_str(), -1, SQLITE_STATIC);
        sqlite3_step(s); sqlite3_finalize(s);
    }

    std::vector<std::tuple<std::string, int, int, int, int>> cutleryItems = {
        {"Momo Steamer Baskets", 20, 20, 0, 0}, {"Biryani Handis (Small)", 50, 50, 0, 0},
        {"Large Dinner Plates", 100, 100, 0, 0}, {"Stainless Steel Spoons", 150, 150, 0, 0},
        {"Falooda Glasses", 40, 40, 0, 0}, {"Kulfi Plates", 40, 40, 0, 0},
        {"Reusable Bamboo Chopsticks", 50, 50, 0, 0}
    };
    for (auto& c : cutleryItems) {
        std::string sql = "INSERT INTO cutlery(item_name, total_count, available_count, in_use_count, damaged_count) VALUES(?,?,?,?,?)";
        sqlite3_stmt* s; sqlite3_prepare_v2(db.getDB(), sql.c_str(), -1, &s, nullptr);
        sqlite3_bind_text(s, 1, std::get<0>(c).c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_int(s, 2, std::get<1>(c)); sqlite3_bind_int(s, 3, std::get<2>(c));
        sqlite3_bind_int(s, 4, std::get<3>(c)); sqlite3_bind_int(s, 5, std::get<4>(c));
        sqlite3_step(s); sqlite3_finalize(s);
    }
    std::cout << "Users, tables, stock and cutlery seeded successfully" << std::endl;
}

void seedMenuData(Database& db) {
    sqlite3_stmt* stmt;
    sqlite3_prepare_v2(db.getDB(), "SELECT COUNT(*) as count FROM menu_items", -1, &stmt, nullptr);
    sqlite3_step(stmt);
    int itemCount = sqlite3_column_int(stmt, 0);
    sqlite3_finalize(stmt);
    if (itemCount > 0) { std::cout << "Menu already seeded" << std::endl; return; }

    std::map<std::string, std::vector<std::pair<std::string, std::pair<double, int>>>> menuData = {
        {"Steamed Momo", {{"Veg Pahari Feast Momo",{169,1}},{"Veg Pahari Fresh Momo",{129,1}},{"Veg Himalayan Momo",{199,1}},{"Veg Hot Garlic Momo",{245,1}},{"Veg Darjeeling Momo",{275,1}},{"Chatpata Paneer Momo",{325,1}},{"Corn Cheese Momo",{345,1}},{"Chicken Pahari Feast Momo",{179,0}},{"Chicken Pahari Fresh Momo",{139,0}},{"Chicken Himalayan Momo",{195,0}},{"Chicken Delight Momo",{245,0}},{"Chicken Darjeeling Momo",{295,0}},{"Chicken Masala Momo",{345,0}},{"Chicken Cheese Momo",{365,0}}}},
        {"Fried Momo", {{"Veg Darjeeling Momo Fried",{335,1}},{"Corn Cheese Momo Fried",{405,1}},{"Chicken Darjeeling Momo Fried",{355,0}},{"Chicken Cheese Momo Fried",{425,0}}}},
        {"Panfried Momo", {{"Veg Feast Pan Fried Momo",{255,1}},{"Veg Fresh Pan Fried Momo",{215,1}},{"Veg Himalayan Pan Fried Momo",{285,1}},{"Veg Hot Garlic Pan Fried Momo",{329,1}},{"Veg Darjeeling Pan Fried Momo",{359,1}},{"Chicken Feast Pan Fried Momo",{265,0}},{"Chicken Fresh Pan Fried Momo",{225,0}},{"Chicken Himalayan Pan Fried Momo",{279,0}},{"Chicken Darjeeling Pan Fried Momo",{379,0}}}},
        {"Chilli Momo", {{"Veg Himalayan Chilli Momo",{299,1}},{"Veg Darjeeling Chilli Momo",{375,1}},{"Veg Corn Cheese Chilli Momo",{445,1}},{"Chicken Himalayan Chilli Momo",{295,0}},{"Chicken Darjeeling Chilli Momo",{395,0}},{"Chicken Cheese Chilli Momo",{465,0}}}},
        {"Sizzler Momo", {{"Veg Sizzler Momo",{525,1}},{"Chatpata Paneer Sizzler Momo",{539,1}},{"Corn Cheese Sizzler Momo",{549,1}},{"Chicken Sizzler Momo",{549,0}},{"Chicken Cheese Sizzler Momo",{579,0}}}},
        {"Thukpa & Starters", {{"Veggie Thukpa",{335,1}},{"Chicken Thukpa",{349,0}},{"Regular Fries",{89,1}},{"Peri Peri Fries",{114,1}},{"Regular Fries with Dip",{119,1}}}},
        {"Shawarma", {{"Classic Chicken Shawarma 6\"",{215,0}},{"Classic Chicken Shawarma 8\"",{245,0}},{"Chicken Seekh Shawarma 6\"",{225,0}},{"Chicken Seekh Shawarma 8\"",{255,0}},{"Spl. Chicken Shawarma 6\"",{250,0}},{"Spl. Chicken Shawarma 8\"",{280,0}}}},
        {"Biryani & Rice", {{"Egg Dum Biryani",{300,1}},{"Chicken Dum Biryani",{330,0}},{"Chicken Boneless Biryani",{345,0}},{"Chicken Tikka Biryani",{355,0}},{"Mutton Biryani",{390,0}},{"Veg Handi Biryani",{259,1}},{"Paneer Handi Biryani",{289,1}}}},
        {"Chaat", {{"Pani Puri",{99,1}},{"Sev Puri",{129,1}},{"Bambaiya Dahi Puri",{159,1}},{"Bombay Bhel Puri",{119,1}},{"Dahi Papdi Chaat",{159,1}},{"KP Special Mix Chaat",{199,1}},{"Aloo Tikki Chaat",{199,1}},{"Dahi Wada",{199,1}},{"Samosa Chaat",{199,1}}}},
        {"Paneer Specialties", {{"Paneer Khurchan",{299,1}},{"Paneer Kadai",{299,1}},{"Paneer Butter Masala",{299,1}},{"Paneer Lababdar",{299,1}},{"Paneer Bhurjee",{299,1}}}},
        {"Faloodas", {{"Royal Falooda",{180,1}},{"Malai Kulfi Falooda",{210,1}},{"Kesar Kulfi Falooda",{220,1}},{"Paan Falooda",{230,1}},{"Dry Fruit Falooda",{240,1}}}},
        {"Kulfi & Ice Cream", {{"Asli Malai Kulfi",{80,1}},{"Kesar Pista Kulfi",{80,1}},{"Mango Kulfi",{80,1}},{"3 in 1 Kulfi",{160,1}},{"Family Pack Kulfi",{540,1}}}},
        {"Shakes & Sundaes", {{"Oreo Cookie Fudge Shake",{350,1}},{"Brownie Bliss Shake",{350,1}},{"Nutella Cheesecake Shake",{350,1}},{"Rocky Road Sundae",{320,1}},{"Chocolate Overdose Sundae",{320,1}}}},
        {"Beverages", {{"Mango Lassi",{149,1}},{"Sweet Lassi",{129,1}},{"Masala Tea",{69,1}},{"Nescafe",{79,1}},{"Tea",{59,1}}}}
    };

    for (auto& cat : menuData) {
        std::string catSql = "INSERT INTO menu_categories(name, description, is_active) VALUES(?, ?, ?)";
        sqlite3_stmt* catStmt;
        sqlite3_prepare_v2(db.getDB(), catSql.c_str(), -1, &catStmt, nullptr);
        sqlite3_bind_text(catStmt, 1, cat.first.c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_text(catStmt, 2, (cat.first + " - Special selection").c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_int(catStmt, 3, 1);
        sqlite3_step(catStmt);
        int catId = sqlite3_last_insert_rowid(db.getDB());
        sqlite3_finalize(catStmt);

        for (auto& item : cat.second) {
            std::string itemSql = "INSERT INTO menu_items(category_id, name, description, price, item_type, is_vegetarian, is_available, prep_minutes) VALUES(?, ?, ?, ?, ?, ?, ?, ?)";
            sqlite3_stmt* itemStmt;
            sqlite3_prepare_v2(db.getDB(), itemSql.c_str(), -1, &itemStmt, nullptr);
            sqlite3_bind_int(itemStmt, 1, catId);
            sqlite3_bind_text(itemStmt, 2, item.first.c_str(), -1, SQLITE_STATIC);
            sqlite3_bind_text(itemStmt, 3, (item.first + " - Freshly made").c_str(), -1, SQLITE_STATIC);
            sqlite3_bind_double(itemStmt, 4, item.second.first);
            sqlite3_bind_text(itemStmt, 5, "food", -1, SQLITE_STATIC);
            sqlite3_bind_int(itemStmt, 6, item.second.second);
            sqlite3_bind_int(itemStmt, 7, 1);
            sqlite3_bind_int(itemStmt, 8, 15);
            sqlite3_step(itemStmt);
            sqlite3_finalize(itemStmt);
        }
    }
    std::cout << "Menu seeded successfully with comprehensive data" << std::endl;
}

// ============= MAIN SERVER =============
int main() {
    crow::SimpleApp app;
    Database db;
    if (!db.open("restaurant.db")) { std::cerr << "Failed to open database" << std::endl; return 1; }
    initializeDatabase(db);
    seedData(db);
    seedMenuData(db);
    std::cout << "Database initialized and seeded" << std::endl;

    // Auth - Login
    CROW_ROUTE(app, "/api/auth/login").methods("POST"_method)([&db](const crow::request& req) {
        auto data = crow::json::load(req.body);
        if (!data || !data.has("username") || !data.has("password")) {
            return crow::response(400, crow::json::wvalue{{"success",false},{"message","Missing credentials"}});
        }
        std::string username = data["username"].s();
        std::string password = data["password"].s();
        std::string query = "SELECT id, full_name, role, email, password_hash, salt FROM users WHERE username = ?";
        sqlite3_stmt* stmt;
        sqlite3_prepare_v2(db.getDB(), query.c_str(), -1, &stmt, nullptr);
        sqlite3_bind_text(stmt, 1, username.c_str(), -1, SQLITE_STATIC);
        if (sqlite3_step(stmt) == SQLITE_ROW) {
            int id = sqlite3_column_int(stmt, 0);
            std::string name = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1));
            std::string role = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 2));
            std::string email = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 3));
            std::string hash = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 4));
            std::string salt = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 5));
            if (sha256(salt + password + salt) == hash) {
                std::string token = randomString(48);
                crow::json::wvalue user;
                user["id"] = id; user["username"] = username; user["name"] = name; user["role"] = role; user["email"] = email;
                user["accessLevel"] = (role == "owner" || role == "admin") ? 100 : (role == "manager") ? 60 : (role == "waiter") ? 40 : 20;
                tokenStore[token] = user;
                sqlite3_finalize(stmt);
                crow::json::wvalue response;
                response["success"] = true; response["token"] = token; response["user"] = user;
                return crow::response(200, response);
            }
        }
        sqlite3_finalize(stmt);
        return crow::response(401, crow::json::wvalue{{"success",false},{"message","Invalid credentials"}});
    });

    // Auth - Register
    CROW_ROUTE(app, "/api/auth/register").methods("POST"_method)([&db](const crow::request& req) {
        auto data = crow::json::load(req.body);
        if (!data || !data.has("username") || !data.has("password") || !data.has("full_name") || !data.has("email")) {
            return crow::response(400, crow::json::wvalue{{"success",false},{"message","Missing required fields"}});
        }
        std::string username = data["username"].s();
        std::string password = data["password"].s();
        std::string full_name = data["full_name"].s();
        std::string email = data["email"].s();
        std::string role = data.has("role") ? data["role"].s() : "customer";
        std::string phone = data.has("phone") ? data["phone"].s() : "";
        if (role == "owner" && (!data.has("secret_key") || data["secret_key"].s() != "224005")) {
            return crow::response(403, crow::json::wvalue{{"success",false},{"message","Invalid owner secret key"}});
        }
        std::string salt = randomString(32);
        std::string hash = sha256(salt + password + salt);
        std::string sql = "INSERT INTO users(username,password_hash,salt,role,full_name,email,phone,is_active) VALUES(?,?,?,?,?,?,?,?)";
        sqlite3_stmt* stmt;
        if (sqlite3_prepare_v2(db.getDB(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
            return crow::response(500, crow::json::wvalue{{"success",false},{"message","Database error"}});
        }
        sqlite3_bind_text(stmt, 1, username.c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_text(stmt, 2, hash.c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_text(stmt, 3, salt.c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_text(stmt, 4, role.c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_text(stmt, 5, full_name.c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_text(stmt, 6, email.c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_text(stmt, 7, phone.c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_int(stmt, 8, 1);
        if (sqlite3_step(stmt) != SQLITE_DONE) { sqlite3_finalize(stmt); return crow::response(409, crow::json::wvalue{{"success",false},{"message","User already exists"}}); }
        int userId = sqlite3_last_insert_rowid(db.getDB());
        sqlite3_finalize(stmt);
        std::string token = randomString(48);
        crow::json::wvalue user;
        user["id"] = userId; user["username"] = username; user["name"] = full_name; user["role"] = role; user["email"] = email;
        user["accessLevel"] = (role == "customer") ? 20 : 60;
        tokenStore[token] = user;
        crow::json::wvalue response;
        response["success"] = true; response["token"] = token; response["user"] = user;
        return crow::response(200, response);
    });

    // Auth - Logout
    CROW_ROUTE(app, "/api/auth/logout").methods("POST"_method)([](const crow::request& req) {
        auto authHeader = req.get_header_value("Authorization");
        if (authHeader.find("Bearer ") == 0) { std::string token = authHeader.substr(7); tokenStore.erase(token); }
        return crow::response(200, crow::json::wvalue{{"success",true}});
    });

    // Menu - Categories
    CROW_ROUTE(app, "/api/menu/categories").methods("GET"_method)([&db]() {
        crow::json::wvalue response = crow::json::wvalue::list();
        sqlite3_stmt* stmt;
        sqlite3_prepare_v2(db.getDB(), "SELECT id, name, description, is_active FROM menu_categories", -1, &stmt, nullptr);
        int index = 0;
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            crow::json::wvalue item;
            item["id"] = sqlite3_column_int(stmt, 0);
            item["name"] = std::string(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1)));
            item["description"] = std::string(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 2)));
            item["is_active"] = sqlite3_column_int(stmt, 3);
            response[index++] = item;
        }
        sqlite3_finalize(stmt);
        return crow::response(200, response);
    });

    // Menu - Items
    CROW_ROUTE(app, "/api/menu/items/all").methods("GET"_method)([&db]() {
        crow::json::wvalue response = crow::json::wvalue::list();
        std::string query = "SELECT m.id, m.name, m.description, m.price, m.item_type, m.is_vegetarian, m.is_available, m.prep_minutes, m.category_id, c.name as category FROM menu_items m JOIN menu_categories c ON m.category_id = c.id WHERE m.is_available = 1";
        sqlite3_stmt* stmt;
        sqlite3_prepare_v2(db.getDB(), query.c_str(), -1, &stmt, nullptr);
        int index = 0;
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            crow::json::wvalue item;
            item["id"] = sqlite3_column_int(stmt, 0);
            item["name"] = std::string(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1)));
            item["description"] = std::string(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 2)));
            item["price"] = sqlite3_column_double(stmt, 3);
            item["item_type"] = std::string(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 4)));
            item["is_vegetarian"] = sqlite3_column_int(stmt, 5);
            item["is_available"] = sqlite3_column_int(stmt, 6);
            item["prep_minutes"] = sqlite3_column_int(stmt, 7);
            item["category_id"] = sqlite3_column_int(stmt, 8);
            item["category"] = std::string(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 9)));
            response[index++] = item;
        }
        sqlite3_finalize(stmt);
        return crow::response(200, response);
    });

    // Orders - Create
    CROW_ROUTE(app, "/api/orders").methods("POST"_method)([&db](const crow::request& req) {
        auto data = crow::json::load(req.body);
        if (!data || !data.has("items")) return crow::response(400, crow::json::wvalue{{"success",false},{"message","Items required"}});
        std::string code = getOrderCode();
        std::string orderType = data.has("order_type") ? data["order_type"].s() : "takeaway";
        std::string customerName = data.has("customer_name") ? data["customer_name"].s() : "Guest";
        int customerId = data.has("customer_id") ? data["customer_id"].i() : 0;
        double subtotal = data.has("subtotal") ? data["subtotal"].d() : 0;
        double tax = data.has("tax") ? data["tax"].d() : 0;
        double serviceCharge = data.has("service_charge") ? data["service_charge"].d() : 0;
        double totalAmount = data.has("total_amount") ? data["total_amount"].d() : 0;
        std::string orderSql = "INSERT INTO orders(code, order_type, customer_id, customer_name, status, subtotal, tax, service_charge, total_amount, payment_method, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        sqlite3_stmt* orderStmt;
        if (sqlite3_prepare_v2(db.getDB(), orderSql.c_str(), -1, &orderStmt, nullptr) != SQLITE_OK) return crow::response(500, crow::json::wvalue{{"success",false}});
        sqlite3_bind_text(orderStmt, 1, code.c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_text(orderStmt, 2, orderType.c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_int(orderStmt, 3, customerId);
