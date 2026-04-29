# Akshay Bhojanam - Enhancement TODO

## Phase 1: Backend (main.cpp)
- [ ] 1.1 Add owner seed with email=apurva@gmail.com, password=SaiBaba
- [ ] 1.2 Add Razorpay payment endpoints (create-order, capture, verify, refund)
- [ ] 1.3 Add order detail endpoint GET /api/orders/:id
- [ ] 1.4 Add order status update PUT /api/orders/:id/status
- [ ] 1.5 Add kitchen queue endpoints (GET, start, complete)
- [ ] 1.6 Add table management endpoints (GET, assign, status)
- [ ] 1.7 Add stock CRUD endpoints
- [ ] 1.8 Add cutlery/utensil endpoints
- [ ] 1.9 Add staff salary endpoints
- [ ] 1.10 Make dashboard/sales stats query from database
- [ ] 1.11 Add parcel order_type support

## Phase 2: Frontend (app.js)
- [ ] 2.1 Add owner registration with secret key 224005
- [ ] 2.2 Add customer dine-in/parcel selector + Razorpay checkout
- [ ] 2.3 Add clickable order modals for waiter/manager/owner
- [ ] 2.4 Add order status action buttons
- [ ] 2.5 Add kitchen queue view for staff
- [ ] 2.6 Add table management view
- [ ] 2.7 Add stock management dashboard
- [ ] 2.8 Add cutlery/utensil management dashboard
- [ ] 2.9 Add staff salary/earnings dashboard
- [ ] 2.10 Add owner comprehensive dashboard
- [ ] 2.11 Add real-time polling for orders

## Phase 3: Frontend (styles.css + index.html)
- [ ] 3.1 Add Razorpay script to index.html
- [ ] 3.2 Add modal styles for order details
- [ ] 3.3 Add payment widget styles
- [ ] 3.4 Add status badge styles (preparing, ready, cancelled, paid, unpaid)
- [ ] 3.5 Add dashboard card enhancements

## Phase 4: Build & Test
- [ ] 4.1 Build with CMake
- [ ] 4.2 Run server and verify all endpoints
- [ ] 4.3 Test all user flows (customer, waiter, manager, owner)

