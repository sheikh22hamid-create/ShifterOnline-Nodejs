/**
 * Standard WhatsApp Outreach & Marketing Message Templates
 * Shifter Online Admin & Sales Automation
 */

const CUSTOMER_APP_URL = "https://play.google.com/store/apps/details?id=com.shifter.online";
const DRIVER_APP_URL = "https://play.google.com/store/apps/details?id=com.shifter.driver";
const HELPLINE_NUMBER = "+91 9109114515";

const WHATSAPP_TEMPLATES = [
  {
    id: "customer_app_download",
    title: "📲 Customer App Download & Welcome",
    category: "customer",
    categoryLabel: "Customer App",
    description: "Invite customers to download the Shifter Online app with features and links.",
    message:
      `Namaste ji! 🙏\n\n` +
      `Ab kisi bhi saman ko shift karna ya mini truck/tempo book karna hua behad aasan aur kifayati! 🚚📦\n\n` +
      `*Shifter Online* ke sath payein:\n` +
      `✅ Sabse sasta aur transparent fare\n` +
      `✅ Real-time live vehicle tracking\n` +
      `✅ Tata Ace, Pickup, Bolero & 3-Wheeler instant availability\n` +
      `✅ Verified and professional driver partners\n\n` +
      `📲 *Shifter Customer App* abhi download karein:\n` +
      `👉 ${CUSTOMER_APP_URL}\n\n` +
      `Kisi bhi sahayata ke liye call karein: ${HELPLINE_NUMBER}\n` +
      `— *Team Shifter Online*`,
  },
  {
    id: "driver_app_download",
    title: "🚚 Driver Partner App Download & Earnings",
    category: "driver",
    categoryLabel: "Driver Onboarding",
    description: "Recruit drivers to join Shifter fleet and download the driver app.",
    message:
      `Namaste Driver Partner! 🙏\n\n` +
      `Apni gadi (Tata Ace, Pickup, Bolero, Champion, 3-Wheeler) ko *Shifter Online* ke sath jodein aur har mahine ₹25,000 se ₹50,000 tak kamayein! 💰🚚\n\n` +
      `*Shifter Driver Partner ke fayde:*\n` +
      `🌟 Rozana daily orders aur guaranteed kamai\n` +
      `🌟 Turant daily wallet payout / bank transfer\n` +
      `🌟 Zero tension aur transparent bidding/booking system\n` +
      `🌟 24x7 Dedicated driver support helpline\n\n` +
      `📲 *Shifter Driver App* abhi download karein aur register karein:\n` +
      `👉 ${DRIVER_APP_URL}\n\n` +
      `Helpline: ${HELPLINE_NUMBER}\n` +
      `— *Team Shifter Online*`,
  },
  {
    id: "sales_booking_followup",
    title: "💼 Sales Team Booking Follow-up",
    category: "sales",
    categoryLabel: "Sales Follow-up",
    description: "Follow up with leads who enquired about booking a truck or shifting goods.",
    message:
      `Namaste! 🙏\n\n` +
      `Aapne *Shifter Online* par goods transport / house shifting ke liye enquiry ki thi. 🚚📦\n\n` +
      `Hamari sales team aapki shifting ko aasan aur affordable banane ke liye taiyar hai. Agar aapko vehicle chahiye ya fare quote janna hai, to aap:\n\n` +
      `1️⃣ Is WhatsApp par *"BOOK"* likh kar reply karein\n` +
      `2️⃣ Ya direct call karein: ${HELPLINE_NUMBER}\n\n` +
      `📲 Ya hamari app se instant online booking karein:\n` +
      `👉 ${CUSTOMER_APP_URL}\n\n` +
      `— *Sales Team, Shifter Online*`,
  },
  {
    id: "incomplete_driver_registration",
    title: "⚠️ Driver Incomplete Registration Reminder",
    category: "driver",
    categoryLabel: "Driver Reminder",
    description: "Nudge drivers who entered OTP but haven't completed their registration.",
    message:
      `Namaste Driver Partner! 🙏\n\n` +
      `Aapka *Shifter Online Driver* registration adhoora hai. Bas 2 minute me apni details aur RC/DL submit karke account activate karein aur daily orders lena shuru karein! 🚚💨\n\n` +
      `📲 *Driver App* khol kar registration poora karein:\n` +
      `👉 ${DRIVER_APP_URL}\n\n` +
      `Koi pareshani aaye to call karein: ${HELPLINE_NUMBER}\n` +
      `— *Team Shifter Online*`,
  },
  {
    id: "customer_discount_offer",
    title: "🏷️ Customer Flat Discount Promo",
    category: "customer",
    categoryLabel: "Offers & Promos",
    description: "Send discount coupon and offer alert to existing or prospective customers.",
    message:
      `Khushkhabri! 🎉 Shifter Online par shifting hui aur bhi sasti! 🚚\n\n` +
      `Apni agli tempo ya truck booking par payein *Flat ₹100 Instant Discount*! 💰\n\n` +
      `Promo Code: *SHIFTER100*\n\n` +
      `📲 Offer ka fayda uthane ke liye abhi Shifter App kholein:\n` +
      `👉 ${CUSTOMER_APP_URL}\n\n` +
      `Hurry! Offer limited time ke liye valid hai.\n` +
      `— *Team Shifter Online*`,
  },
  {
    id: "payment_reminder",
    title: "💳 Payment / Invoice Reminder",
    category: "sales",
    categoryLabel: "Payment Reminder",
    description: "Polite reminder to clear outstanding trip invoice or dues.",
    message:
      `Namaste! 🙏\n\n` +
      `Ye reminder aapke *Shifter Online* trip ke outstanding balance ke sambandh me hai. 🚚\n\n` +
      `Kripya apna pending bill online UPI ya app ke madhyam se clear karein taaki aapki aane wali bookings bina kisi rukawat ke continue rahein.\n\n` +
      `Kisi bhi query ya bill breakdown ke liye call karein: ${HELPLINE_NUMBER}\n` +
      `— *Accounts Team, Shifter Online*`,
  },
];

module.exports = {
  WHATSAPP_TEMPLATES,
  CUSTOMER_APP_URL,
  DRIVER_APP_URL,
  HELPLINE_NUMBER,
};
