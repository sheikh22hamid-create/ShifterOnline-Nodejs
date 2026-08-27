# 📋 Shifter Online — Complete Admin Panel Sections, Subsections & Modules Master Reference
### Comprehensive Functional Architecture & Blueprint for Claude / Senior Full-Stack Engineer

---

## 📌 1. Executive Summary & Overview

This document provides a **complete, 100% comprehensive inventory** of all **17 Major Functional Sections**, **36 Subsections / Action Pages**, and **24 Database Tables** from the legacy PHP Admin & Super Admin codebase (`/admin/` and `/superadmin/`).

Claude / the Frontend Engineer must use this document to build the **complete sidebar navigation hierarchy, page routing, UI forms, data tables, and operational workflows** in the modern React/Vite dashboard without missing a single legacy capability.

---

## 🗺️ 2. High-Level Master Navigation Structure (Sidebar Tree)

```
SHIFTER ONLINE DASHBOARD
├── 📊 Dashboard
│
├── 📢 BANNER SECTION
│   └── 🖼️ Banner
│       ├── Add Banner
│       └── List Banner
│
├── 💎 PREMIUM PLANS
│   └── 👑 Premium Plans
│       └── Manage Plans (User & Driver)
│
├── 📦 PACKAGE SECTION
│   ├── 💰 Package Cost (Rate Cards: Model 1 to 5)
│   │   ├── Add Package
│   │   └── List Package
│   └── 🏷️ Package Category
│       ├── Add Category
│       └── List Category
│
├── 💳 PAYMENT & REFERRALS
│   ├── 💳 Payment Gateways (List & Config)
│   └── 👥 User Referral
│       ├── Referral Settings
│       └── Referral Network List
│
├── ⚙️ DYNAMIC SECTION
│   └── ❓ Dynamic Questions (Driver Onboarding)
│
├── 🛵 RIDER / DRIVER SECTION
│   ├── 🛵 Delivery Boy List (Fleet Directory & Full KYC Inspection)
│   ├── 💸 Withdraw Requests (Driver Wallet Payouts)
│   └── ⏱️ Rider Activity (Duty Logs & Audit Trail)
│
├── 🏙️ CITY SECTION
│   └── 🏙️ City Management
│       ├── Add City
│       └── List City
│
├── 🚗 VEHICLE SECTION
│   └── 🚗 Vehicle Classification
│       ├── Add Vehicle
│       └── List Vehicle
│
├── 📝 SURVEY SECTION
│   ├── 📋 Surveys (Add / List Survey Topics)
│   └── 🔘 Survey Options (Add / List Choices)
│
├── ❓ FAQ SECTION
│   └── ❓ FAQs (Add / List App Help Q&A)
│
├── 📄 PAGE SECTION (CMS)
│   └── 📄 Static Pages (Privacy, Terms, About, Refund)
│       ├── Add Page
│       └── List Page
│
├── 🎟️ COUPON SECTION
│   └── 🎟️ Promo Coupons (Add / List Discount Codes)
│
├── 👥 CUSTOMER SECTION
│   └── 👥 Customer Directory (Profiles, Wallet, Trips)
│
├── 📈 ORDER REPORTS (ANALYTICS)
│   ├── 📄 Daily Report (Day-wise Bookings & Revenue)
│   └── 📊 Sales Report (Date-Range Filter & GMV Breakdown)
│
├── 📦 PACKAGE ORDERS (DISPATCH ENGINE)
│   ├── ⏳ Pending Orders (Unassigned & Live Dispatch Queue)
│   ├── ✅ Complete Orders (Delivered Trips History)
│   ├── ❌ Cancelled Orders (Cancelled Trips & Reasons)
│   ├── 📅 Assign Orders (Next-Day Scheduled Bookings)
│   └── 🗺️ City Wise Orders (City-by-City Volume Comparison)
│
├── 👤 PROFILE & SYSTEM SETTINGS
│   ├── 👤 Update Profile (Admin Password & Username)
│   ├── 🛑 Cancel Reasons (Customer vs Driver Dropdown Options)
│   └── ⚙️ System Settings (Currency, Google Maps, Firebase, Limits)
│
└── 👑 SUPER ADMIN EXCLUSIVE
    └── 🛡️ Staff Management (Create & Manage City Admins & Executives)
```

---

## 🔍 3. Exhaustive Section & Subsection Specifications

---

### 1. 📊 Dashboard
* **Legacy PHP File**: `dashboard.php`
* **Target Tables**: `pkg_order`, `tbl_rider`, `tbl_user`, `driver_withdraw_requests`
* **Purpose & Functional Workflow**:
  * High-level executive command center showing animated KPI counter ribbons:
    1. **Today's Revenue** (Total GMV completed today in ₹).
    2. **Total Revenue** (All-time platform GMV in ₹).
    3. **Active Trips** (Orders currently in `Processing`, `Pickup`, or `On Route`).
    4. **Total Orders** (All-time package bookings count).
    5. **Online Drivers** (Drivers with `a_status = 1` and `status = 1`).
    6. **Total Drivers** (Registered driver fleet count).
    7. **Pending KYC** (Drivers with unverified documents).
* **Modern React Mapping**: `pages/Dashboard.jsx` (Metric cards ribbon + 2-column layout with Live Fleet Map and Recent Orders ticker).
* **Access**: Super Admin (Global pan-India), City Admin & Executive (City scoped).

---

### 2. 📢 Banner Section
* **Legacy PHP Files**: `add_banner.php`, `list_banner.php`
* **Target Table**: `tbl_banner` (`id`, `img`, `status`, `city_id`)
* **Subsections**:
  #### 2.1 Add Banner (`add_banner.php`)
  * **What it does**: Allows admin to upload a marketing banner for the customer mobile app home slider.
  * **Inputs**: Banner image (`jpg`/`png`), Target City (`tbl_city` dropdown or All Cities), Status (`Active`/`Inactive`).
  #### 2.2 List Banner (`list_banner.php`)
  * **What it does**: Displays an image grid/table of all banners. Admin can preview the banner, toggle active/inactive status with 1 click, or delete the banner.
* **Modern React Mapping**: `pages/marketing/Banners.jsx` (Data table with image thumbnail preview, quick toggle switch, and modal upload form).

---

### 3. 💎 Premium Plans (Subscriptions)
* **Legacy PHP Files**: `admin_premium_plans.php`, `add_premium_plan.php`, `admin_add_premium_plan.php`
* **Target Table**: `tbl_premium_plan` (`id`, `plan_name`, `price`, `validity_days`, `plan_for`, `description`, `is_popular`, `status`)
* **Subsections**:
  #### 3.1 Manage Premium Plans (`admin_premium_plans.php`)
  * **What it does**: Manages recurring membership/subscription packages for both **Customers** (`plan_for = 'user'`) and **Drivers** (`plan_for = 'driver'`).
  * **Inputs & Fields**:
    * Plan Name (e.g. "Shifter Pro Driver Plan", "Gold Saver Customer").
    * Target Audience: `user` (gives delivery discounts) or `driver` (gives lower platform commission).
    * Price (₹) & Validity (e.g., 30 Days, 90 Days, 365 Days).
    * Benefits & Feature description points.
    * "Popular" badge toggle.
* **Modern React Mapping**: `pages/marketing/PremiumPlans.jsx` (Card grid view showing plan cards with price tags and edit/delete actions).

---

### 4. 📦 Package Section (Rate Cards & Categories)
* **Legacy PHP Files**: `add_package.php`, `list_package.php`, `pkg_category.php`, `pkglist_category.php`
* **Target Tables**: `tbl_package`, `pkg_category`
* **Subsections**:
  #### 4.1 Package Cost ➔ Add / List Package (`tbl_package`)
  * **What it does**: Configures the **core pricing engine rate cards** for Model 1 through Model 5 tiers.
  * **Inputs & Calculation Rules**:
    * Category mapping (`cat_id` -> Bike, 3 wheeler, etc.).
    * Tier Title (Model 1, Model 2, Model 3, Model 4, Model 5).
    * Minimum Base Fare (`min_charge`, e.g., ₹25.00).
    * Per Kilometer Charge (`per_km_charge`, e.g., ₹7.00/km).
    * Driver Earning Share (`driver_per_percent` e.g., 80% or `driver_per_trip` fixed ₹).
    * Service Charge % & Night Surge % (applicable between 10 PM and 6 AM).
    * Free Waiting Time (e.g. 5 mins) and Chargeable Waiting Fee (e.g. ₹2.00/min).
    * Customer & Driver Cancellation Penalty Fees.
  #### 4.2 Package Category ➔ Add / List Category (`pkg_category`)
  * **What it does**: Customer app vehicle category master (Bike, 3 Wheeler, 4 Wheeler, E-Loader).
  * **Inputs**: Category name, Category SVG/PNG icon, Status.
* **Modern React Mapping**: `pages/pricing/RateCards.jsx` and `pages/pricing/Categories.jsx`.

---

### 5. 💳 Payment Gateway & User Referrals
* **Legacy PHP Files**: `list_payment_list.php`, `list_user_referal_manage.php`, `list_user_referral.php`, `add_user_referral.php`
* **Target Tables**: `tbl_payment_list`, `tbl_referral`, `tbl_referral_setting`, `tbl_user_referrals`, `tbl_referral_point_log`
* **Subsections**:
  #### 5.1 List Payment Gateway (`list_payment_list.php`)
  * **What it does**: Admin configures online payment credentials (Razorpay Key ID/Secret, Stripe Public/Secret, Paytm Merchant ID/Key, Cashfree, PayPal) and switches between Live/Sandbox mode.
  #### 5.2 Referral Settings (`list_user_referal_manage.php`)
  * **What it does**: Sets viral growth reward rules:
    * Points awarded to Referrer upon successful referee registration.
    * Points awarded to Referee as welcome bonus.
    * Minimum completed delivery trips required by referee before points can be redeemed to wallet.
    * 1 Point = ₹ value conversion rate.
  #### 5.3 Referral List (`list_user_referral.php`)
  * **What it does**: Visualizes the user referral network tree. Displays who referred whom, referee registration date, bonus awarded, and includes an administrative **Manual Point Adjustment** button (`adjust_referral_points`).
* **Modern React Mapping**: `pages/settings/PaymentGateways.jsx` and `pages/marketing/Referrals.jsx`.

---

### 6. ⚙️ Dynamic Section
* **Legacy PHP File**: `dynamic_question.php`
* **Target Table**: `tbl_question` (`id`, `question`, `type`, `status`)
* **What it does**:
  * Configures custom dynamic onboarding questions for drivers during mobile app sign-up.
  * Examples: *"Do you own a commercial GPS smartphone?"*, *"Are you available for night shifts?"*.
  * Admin can add, edit, toggle active status, or delete questions.
* **Modern React Mapping**: `pages/settings/DynamicQuestions.jsx`.

---

### 7. 🛵 Rider / Driver Section (Fleet Operations)
* **Legacy PHP Files**: `list_deliveryboy.php`, `withdraw_requests.php`, `list_driver_activity.php`, `decision.php`
* **Target Tables**: `tbl_rider`, `tbl_personal_doc`, `tbl_vehicle_details`, `tbl_bank_account`, `tbl_kit`, `tbl_eme_contact`, `driver_withdraw_requests`, `driver_activity`
* **Subsections**:
  #### 7.1 Delivery Boy List (`list_deliveryboy.php`)
  * **What it does**: The central driver operations hub.
  * **Features**:
    * Filter drivers by city, vehicle type, online/offline duty (`a_status`), and approval status.
    * Stat chips: Total online drivers, offline drivers, busy drivers.
    * **Full KYC Dossier Inspection**: Clicking a driver opens their verification dossier:
      1. Personal Documents (`tbl_personal_doc`): Aadhaar / Address front & back, Residence proof.
      2. Vehicle Documents (`tbl_vehicle_details`): RC number, RC photo, Vehicle front photo, Vehicle back photo with number plate.
      3. Bank Details (`tbl_bank_account`): Account holder name, Account number, IFSC code.
      4. Emergency Contact (`tbl_eme_contact`): Relative name, relationship, mobile.
      5. Kit Compliance (`tbl_kit`): Uniform T-Shirt and Delivery Bag verification.
    * One-click Approve / Reject with rejection reason per document type.
  #### 7.2 Withdraw Requests (`withdraw_requests.php`)
  * **What it does**: Manages driver wallet cash-out requests.
  * **Workflow**: Shows driver name, requested amount, current wallet balance, and verified bank IFSC/Account. Admin enters the Bank UTR / Transaction Reference number and uploads payment proof to mark `Approved`, or enters a rejection reason to refund balance to driver wallet.
  #### 7.3 Rider Activity (`list_driver_activity.php`)
  * **What it does**: Audit trail log of driver duty shifts: Login timestamp, Logout timestamp, Total online hours, and GPS location tracking stream.
* **Modern React Mapping**:
  * `pages/drivers/DriverList.jsx`
  * `pages/drivers/KycApprovalDock.jsx` (Smart side-by-side inspector)
  * `pages/payouts/WithdrawalRequests.jsx`
  * `pages/drivers/DriverActivity.jsx`

---

### 8. 🏙️ City Section
* **Legacy PHP Files**: `add_city.php`, `list_city.php`
* **Target Table**: `tbl_city` (`id`, `title`, `c_status`)
* **Subsections**:
  #### 8.1 Add / List City
  * **What it does**: Defines operational cities (e.g. New Delhi, Bhopal, Indore, Mumbai, Bengaluru).
  * **Scoping Impact**: City Admins and Executives are strictly bounded to their assigned `city_id`.
* **Modern React Mapping**: `pages/master/Cities.jsx`.

---

### 9. 🚗 Vehicle Section
* **Legacy PHP Files**: `add_vehicle.php`, `list_vehicle.php`
* **Target Table**: `tbl_vechicle` (`id`, `title`, `img`, `status`)
* **Subsections**:
  #### 9.1 Add / List Vehicle
  * **What it does**: Master classification of transport vehicles (e.g., Bike, 3 Wheeler Auto, Tata Ace 7ft, Pickup Truck 8ft) with vehicle silhouette image and specifications.
* **Modern React Mapping**: `pages/master/Vehicles.jsx`.

---

### 10. 📝 Survey Section
* **Legacy PHP Files**: `add_survey.php`, `list_survey.php`, `add_survey_option.php`, `list_survey_option.php`
* **Target Tables**: `tbl_survey`, `tbl_option`, `tbl_survery_answer`
* **Subsections**:
  #### 10.1 Survey (Add / List)
  * **What it does**: Creates survey topics for customer satisfaction or driver feedback (e.g. "Monthly Driver Experience Survey").
  #### 10.2 Survey Options (Add / List)
  * **What it does**: Adds multiple-choice response options for survey questions. Displays submitted survey analytics.
* **Modern React Mapping**: `pages/content/Surveys.jsx`.

---

### 11. ❓ FAQ Section
* **Legacy PHP Files**: `add_faq.php`, `list_faq.php`
* **Target Table**: `tbl_faq` (`id`, `question`, `answer`, `status`)
* **Subsections**:
  #### 11.1 Add / List FAQ
  * **What it does**: Customer and driver in-app Help & Support Q&A management.
* **Modern React Mapping**: `pages/content/Faqs.jsx`.

---

### 12. 📄 Page Section (CMS Legal Content)
* **Legacy PHP Files**: `add_page.php`, `list_page.php`
* **Target Table**: `tbl_page` (`id`, `title`, `description`, `slug`, `status`)
* **Subsections**:
  #### 12.1 Add / List Page
  * **What it does**: Rich-text HTML content management for legal pages: Privacy Policy, Terms of Service, About Us, Refund & Cancellation Policy.
* **Modern React Mapping**: `pages/content/Pages.jsx`.

---

### 13. 🎟️ Coupon Section (Promotions)
* **Legacy PHP Files**: `add_coupon.php`, `list_coupon.php`
* **Target Table**: `tbl_coupon` (`id`, `c_title`, `c_code`, `c_value`, `c_type`, `min_amt`, `c_desc`, `start_date`, `end_date`, `status`)
* **Subsections**:
  #### 13.1 Add / List Coupon
  * **What it does**: Creates promotional promo codes.
  * **Options**: Flat ₹ off or Percentage (%) off, Minimum order amount requirement, Expiry date, and Usage limits.
* **Modern React Mapping**: `pages/marketing/Coupons.jsx`.

---

### 14. 👥 Customer Section
* **Legacy PHP File**: `customer.php`, `delete_customer.php`
* **Target Table**: `tbl_user` (`id`, `fname`, `lname`, `mobile`, `email`, `city_id`, `wallet`, `status`)
* **What it does**:
  * Complete customer directory filtered by city.
  * Shows customer name, phone, email, registered date, total orders completed, wallet balance.
  * Actions: Block/Unblock suspicious users, Manual Wallet adjustment (credit/debit), and Transactional Account Deletion.
* **Modern React Mapping**: `pages/customers/CustomerList.jsx` and `pages/customers/CustomerDetailModal.jsx`.

---

### 15. 📈 Package Order Reports (Analytics)
* **Legacy PHP Files**: `pdaily.php`, `pack_sales.php`, `sales_month_compare.php`, `city_wise_order.php`
* **Target Table**: `pkg_order`
* **Subsections**:
  #### 15.1 Daily Report (`pdaily.php`)
  * **What it does**: Summary of bookings for any selected date: Total orders received, Completed orders, Cancelled orders, Total cash collected vs online paid.
  #### 15.2 Sales Report (`pack_sales.php`)
  * **What it does**: Date-range financial reporting (Start Date to End Date). Generates total GMV, driver payouts, net platform commission earnings, and exportable sales data.
* **Modern React Mapping**: `pages/reports/DailyReport.jsx` and `pages/reports/SalesReport.jsx`.

---

### 16. 📦 Package Orders (Real-Time Dispatch Engine)
* **Legacy PHP Files**: `pkg_pending.php`, `pkg_complete.php`, `pkg_cancle_order_list.php`, `next_day_booking.php`, `assign_next_day_driver.php`, `edit_order.php`
* **Target Tables**: `pkg_order`, `pkg_order_wait_timer`, `tbl_order_requests`
* **Subsections**:
  #### 16.1 Pending Orders (`pkg_pending.php`)
  * **What it does**: Real-time dispatch queue showing active orders waiting for driver acceptance.
  * **Features**: Live countdown timer, auto-refresh via WebSockets, and **Manual Driver Assignment Fallback Modal** (shows nearest online eligible drivers with distance in km).
  #### 16.2 Complete Orders (`pkg_complete.php`)
  * **What it does**: Archive of delivered orders with pickup/drop timestamps, customer OTP verification, total fare, waiting charges, and driver payout cut.
  #### 16.3 Cancelled Orders (`pkg_cancle_order_list.php`)
  * **What it does**: Log of all cancelled bookings, who cancelled (Customer vs Driver vs Server Timeout), cancellation reason, and applied cancellation penalties.
  #### 16.4 Assign Orders / Next-Day Scheduled (`next_day_booking.php`)
  * **What it does**: Pre-scheduled future bookings (`booking_scudle = 1`). Allows dispatchers to pre-assign drivers in advance and triggers scheduled wake-up alerts 30 mins prior to pickup.
  #### 16.5 City Wise Orders (`city_wise_order.php`)
  * **What it does**: Comparative order distribution across different operational hubs.
  #### 16.6 Edit Order Logistics (`edit_order.php`)
  * **What it does**: Direct administrative correction of pickup/drop addresses, recipient phone numbers, item descriptions, and fare adjustments.
* **Modern React Mapping**:
  * `pages/orders/OrdersList.jsx` (Tabbed Kanban: `Pending`, `On Route`, `Completed`, `Cancelled`)
  * `pages/orders/ScheduledOrders.jsx`
  * `pages/orders/AssignDriverModal.jsx`
  * `pages/orders/OrderDossierDrawer.jsx`

---

### 17. 👤 Profile & System Settings
* **Legacy PHP Files**: `profile.php`, `cancel_reason_manage.php`, `add_cancel_reason.php`, `setting.php`
* **Target Tables**: `admin`, `tbl_cancel_reason`, `setting`
* **Subsections**:
  #### 17.1 Update Profile (`profile.php`)
  * **What it does**: Change current admin username and password.
  #### 17.2 Cancle Reason (`cancel_reason_manage.php`)
  * **What it does**: Manages standard dropdown options shown when an order is cancelled. Configured separately for **Customers** (e.g. "Booked by mistake", "Driver asked to cancel") and **Drivers** (e.g. "Vehicle breakdown", "Customer unreachable").
  #### 17.3 Settings (`setting.php`)
  * **What it does**: Master system configuration:
    * Currency Symbol (`₹`).
    * Google Maps API Key (`AIzaSy...`).
    * Firebase Service Account / OneSignal push notification server keys.
    * Maximum driver cash collection threshold before wallet lock.
    * Base tax % and platform commission %.
* **Modern React Mapping**: `pages/settings/Profile.jsx`, `pages/settings/CancelReasons.jsx`, `pages/settings/PlatformSettings.jsx`.

---

### 18. 🛡️ Super Admin Staff Management
* **Legacy PHP Files**: `super_admin.php`, `delete_admin.php`
* **Target Table**: `admin`
* **What it does**:
  * Super Admin only view to create, update, deactivate, and delete **City Admins** and **Executives**.
  * Assigns each staff account to their designated city (`city_id`).
* **Modern React Mapping**: `pages/staff/StaffManagement.jsx`.

---

## 🎯 4. Direct Action Checklist for Claude / Frontend Engineer

Claude must organize the frontend sidebar into these **grouped collapsible categories** so that 100% of these screens are rendered:

```
[Group 1: OPERATIONS]
├── 📊 Dashboard (Live KPIs + Fleet Map + Orders Stream)
├── 📦 Live Orders (Tabbed: Pending, Active, Completed, Cancelled)
├── 📅 Scheduled Orders (Next-Day Bookings)
├── 🛵 Drivers Fleet (Directory & Status)
├── 🛡️ KYC Approval Dock (Smart Side-by-Side Inspector)
└── 👥 Customers Directory

[Group 2: FLEET & PRICING]
├── 💰 Rate Cards (Model 1 to Model 5 Pricing Engine)
├── 🏷️ Categories & Vehicle Types
└── 🏙️ Operational Cities

[Group 3: FINANCIALS & GROWTH]
├── 💸 Withdrawal Requests (Driver Payouts)
├── 💎 Premium Plans (User & Driver Subscriptions)
├── 🎟️ Promo Coupons
├── 📢 App Banners
└── 👥 Referral Network & Points

[Group 4: CMS & SYSTEM SETTINGS]
├── 📈 Reports & Sales Analytics
├── ❓ FAQs & Support
├── 📄 Legal Pages (CMS)
├── 🛑 Cancellation Reasons
├── ⚙️ Dynamic Questions
├── 💳 Payment Gateways
├── 👥 Staff Management (Super Admin only)
└── 🔧 Platform Master Settings
```

---

*This document serves as the single source of truth for the complete functional scope of the Shifter Online Administrative Suite.*
