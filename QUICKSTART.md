# Quick Start Guide - Akshay Bhojanam C++ Backend

## ⚡ 5-Minute Setup

### Step 1: Download Crow Header
```bash
# Create include directory (if not exists)
mkdir include

# Download crow_all.h from:
# https://github.com/CrowCpp/Crow/releases/download/v0.7%2B5/crow_all.h
# And save to: d:\Cpp Project\include\crow_all.h
```

### Step 2: Install SQLite3 (Choose One)

**Option A: Using vcpkg (Recommended)**
```bash
# Clone vcpkg
git clone https://github.com/Microsoft/vcpkg.git
cd vcpkg
.\bootstrap-vcpkg.bat

# Install SQLite3
.\vcpkg install sqlite3:x64-windows

# Later use CMake with toolchain:
# cmake -DCMAKE_TOOLCHAIN_FILE=<vcpkg-path>\scripts\buildsystems\vcpkg.cmake ..
```

**Option B: Using Chocolatey**
```bash
choco install sqlite
```

### Step 3: Build the Project
```bash
cd "d:\Cpp Project"
mkdir build
cd build

# Using vcpkg toolchain:
cmake -DCMAKE_TOOLCHAIN_FILE=C:\path\to\vcpkg\scripts\buildsystems\vcpkg.cmake -DCMAKE_BUILD_TYPE=Release ..

# Or without vcpkg:
cmake -DCMAKE_BUILD_TYPE=Release ..

# Build
cmake --build . --config Release
```

### Step 4: Run the Server
```bash
# From d:\Cpp Project\build directory
Release\server.exe

# Or from build directory
.\Release\server.exe
```

### Step 5: Access the Application
Open browser to: **http://localhost:8080**

---

## 🔑 Test Credentials

### Customer Login (Order Food)
```
Username: rajesh_kumar
Password: customer@2024
```

**What you'll see:**
- Menu items with prices
- Add to cart functionality
- Dynamic bill calculation (5% tax + 10% service charge)
- Place order button

### Manager Login (View Dashboard)
```
Username: shripad_deshpande
Password: staff@2024
```

**What you'll see:**
- Dashboard with sales metrics
- Order management
- Staff directory
- Menu management

---

## 📝 What's Included

✅ **Database**: Automatically created on first run  
✅ **Menu**: 100+ items across 14 categories  
✅ **Users**: 7 pre-configured test users  
✅ **API**: 25+ REST endpoints  
✅ **Frontend**: Responsive HTML5/CSS3/JavaScript  

---

## 🔧 Troubleshooting

### "crow_all.h: No such file or directory"
→ Download crow_all.h and place in `include/` folder

### "sqlite3 not found"
→ Install SQLite3 development libraries via vcpkg

### "Port 8080 already in use"
→ Edit `main.cpp` line: `app.port(8080)` to use different port

### CMake configuration fails
→ Make sure you're in the `build` directory: `cd build` first

---

## 📚 Menu Categories

- **Momo** (Steamed, Fried, Pan-fried, Chilli, Sizzler)
- **Shawarma** (Classic, Seekh, Special)
- **Biryani** (Egg, Chicken, Mutton, Veg)
- **Chaat** (Pani Puri, Sev Puri, Dahi Puri)
- **Paneer Specialties**
- **Faloodas & Kulfis**
- **Ice Cream & Shakes**
- **Beverages**

---

## 🎯 Next Steps

1. **Customize Database**: Edit `seedMenuData()` in `main.cpp`
2. **Modify Pricing**: Update prices in menu data structure
3. **Add API Endpoints**: Use `CROW_ROUTE` macro
4. **Style Customization**: Edit `frontend/styles.css`

---

**For full documentation, see README.md**
