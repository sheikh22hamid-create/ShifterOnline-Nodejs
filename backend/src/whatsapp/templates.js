/**
 * Standard WhatsApp Outreach & Marketing Message Templates
 * Shifter Online Admin & Sales Automation
 */

const CUSTOMER_APP_URL = "https://play.google.com/store/apps/details?id=com.shifter.online";
const DRIVER_APP_URL = "https://play.google.com/store/apps/details?id=com.shifter.driver";
const HELPLINE_NUMBER = "+91 9109114515";

const WHATSAPP_TEMPLATES = [
  {
    id: "customer_promo_benefits",
    name: "customer_promo_benefits",
    metaTemplateName: "customer_promo_benefits",
    isMetaApproved: true,
    title: "🎥 Customer Promo & 5 Benefits (Video + Buttons)",
    category: "customer",
    categoryLabel: "Marketing & Offers",
    description: "Official Meta template with promotional video header, 5 core customer benefits, and Download App + Chat buttons.",
    message:
      "🚚 *SHIFTER ONLINE – Kam Kiraya, Bharosemand Service & Extra Savings!*\n\nCommercial & household customers ke liye market se saste rates par tempo/mini truck booking + 5 Zabardast Benefits! 🎉\n\n🌟 *5 SPECIAL BENEFITS:*\n💸 *1. Market Se Kam Rates* — Har booking par guaranteed bachat\n🎁 *2. Free Booking Chance* — Free Driver milne par 100% fare wallet me refund\n🛡️ *3. Booking Guarantee* — Driver na milne par compensation guarantee\n🚛 *4. Cancellation Compensation* — Driver cancel kare to instant compensation\n💰 *5. Receiver Commission* — Apne customer ki booking par commission kamane ka moka\n\n👇 Neeche *Download App* button par click karein aur abhi booking shuru karein!\n\nKisi bhi sahayata ke liye *Chat With Us* button dabayein — hamari team turant reply karegi.\n\n— *Team Shifter Online*",
  },
  {
    id: "shifter_driver_unavailable",
    name: "shifter_driver_unavailable",
    metaTemplateName: "shifter_driver_unavailable",
    isMetaApproved: true,
    title: "⚠️ Driver Unavailable Apology (Order Not Assigned)",
    category: "customer",
    categoryLabel: "Customer Care",
    description: "Official Meta-approved apology message sent when no driver partner could be assigned for an order.",
    message:
      "Namaste {{1}} ji,\n\nHumein behad khed hai ki aapke Order #{{2}} ke samay aapke pickup location par koi driver partner available nahi ho saka, jis karan aapki booking arrange nahi ho paayi.\n\n\"We sincerely apologize that we were unable to arrange a driver partner for your booking at that time.\"\n\nAapki suvidha hamare liye sarvopari hai. Hamari team lagatar aapke area me naye driver partners jod rahi hai taaki aage aapko aisi pareshani ka samna na karna pade.\n\nAgar aapko abhi bhi gaadi ki aavashyakta hai to aap dubara book kar sakte hain ya kisi bhi sahayata ke liye hamare support se sampark karein.\n\nShifter Online par vishwas jatane ke liye dhanyawad.\n\n— Team Shifter Online",
  },
  {
    id: "shifter_customer_welcome",
    name: "shifter_customer_welcome",
    metaTemplateName: "shifter_customer_welcome",
    isMetaApproved: true,
    title: "📲 Customer App Download & Welcome (Meta Approved)",
    category: "customer",
    categoryLabel: "Customer App",
    description: "Official Meta-approved welcome message with customer app download link.",
    message:
      "Namaste! Welcome to Shifter Online. Book mini trucks and tempos (Tata Ace, Pickup, 3-Wheeler) at affordable fares with verified drivers. Download the Shifter App now or reply to this message to book. Team Shifter Online.",
  },
  {
    id: "shifter_driver_partner_app",
    name: "shifter_driver_partner_app",
    metaTemplateName: "shifter_driver_partner_app",
    isMetaApproved: true,
    title: "🚚 Driver Partner App (Play Store Image & Link)",
    category: "driver",
    categoryLabel: "Driver Onboarding",
    description: "Official Meta invite with app icon image, Play Store link in text & button, and Chat With Us button.",
    message:
      "🚚 *Shifter Online Partner App*\nDriver App download karein: https://play.google.com/store/apps/details?id=com.shifter.driver\n\nNamaste {{1}} ji! 🙏\n\n*Shifter Online* ek online, on-demand logistics platform hai. Yahan customers apna saaman — parcel, goods aur house shifting — book karte hain, aur booking seedha partner drivers ko milti hai.\n\nAap bhi Partner App se judkar apne area me booking le sakte hain — mini truck, pickup, loading gaadi, sab ke liye kaam milega.\n\n👇 Neeche *Download App* button se app install karke apna registration pura karein.\n\nKoi sawal ho to *Chat With Us* button dabayein — hamari team aapse yahin chat karegi. 💬\n\n— *Team Shifter Online*",
  },
  {
    id: "shifter_driver_incomplete_reg",
    name: "shifter_driver_incomplete_reg",
    metaTemplateName: "shifter_driver_incomplete_reg",
    isMetaApproved: true,
    title: "⚠️ Driver Incomplete Registration (Image Banner & Buttons)",
    category: "driver",
    categoryLabel: "Driver Reminder",
    description: "Nudge drivers with incomplete registration using high-converting Tata Ace image banner and direct action buttons.",
    message:
      "Aapka *Shifter Online Driver* registration adhoora hai. Bas 2 minute me apni details aur RC/DL submit karke account activate karein aur daily orders lena shuru karein! 🚚💨\n\n📲 *Driver App* khol kar registration poora karein:\n👉 https://play.google.com/store/apps/details?id=com.shifter.driver\n\nKoi pareshani aaye to call karein: +91 9109114515\n— *Team Shifter Online*",
  },
  {
    id: "shifter_partner_app_invite",
    name: "shifter_partner_app_invite",
    metaTemplateName: "shifter_partner_app_invite",
    isMetaApproved: true,
    title: "🚚 Shifter Partner App Invite (Image + Buttons)",
    category: "driver",
    categoryLabel: "Driver Onboarding",
    description: "Official Meta template with app banner image, personalized name, driver benefits, and Download App button.",
    message:
      "🚚 *Shifter Online Partner App*\n\nNamaste {{1}} ji! 🙏\n\n*Shifter Online* ek online, on-demand logistics platform hai. Yahan customers apna saaman — parcel, goods aur house shifting book karte hain, aur booking seedha partner drivers ko milti hai.\n\n*Shifter Partner Banney Ke Fayde:*\n✅ Kam commission & daily guaranteed bookings\n✅ Apni marzi ka kiraya aur favorite route select karein\n✅ Mini truck, pickup, loading gaadi sab ke liye kaam\n✅ Rozana direct bank payout & dedicated driver helpline\n\n👇 Neeche *Download App* button se app install karke apna registration poora karein.\n\nKoi sawal ho to *Chat With Us* button dabayein — hamari team aapse yahin chat karegi. 💬\n\n— *Team Shifter Online*",
  },
  {
    id: "shifter_driver_onboard",
    name: "shifter_driver_onboard",
    metaTemplateName: "shifter_driver_onboard",
    isMetaApproved: true,
    title: "🚚 Driver Partner App & Onboarding (Meta Approved)",
    category: "driver",
    categoryLabel: "Driver Onboarding",
    description: "Official Meta-approved driver onboarding and registration invite.",
    message:
      "Namaste Driver Partner! Attach your vehicle (Tata Ace, Pickup, 3-Wheeler) with Shifter Online and earn daily guaranteed income. Download the Shifter Driver App now to register or reply to this message for support. Team Shifter Online.",
  },
  {
    id: "shifter_booking_followup",
    name: "shifter_booking_followup",
    metaTemplateName: "shifter_booking_followup",
    isMetaApproved: true,
    title: "💼 Booking Enquiry Follow-up (Meta Approved)",
    category: "sales",
    categoryLabel: "Sales Follow-up",
    description: "Official Meta-approved sales follow-up message for goods transport leads.",
    message:
      "Namaste! Thank you for contacting Shifter Online for goods transport. Our team is ready to help you with vehicle booking and best quotes. Reply to this message or call our helpline to book your tempo. Team Shifter Online.",
  },
  {
    id: "hello_world",
    name: "hello_world",
    metaTemplateName: "hello_world",
    isMetaApproved: true,
    title: "👋 Hello World (Meta Default Sample)",
    category: "utility",
    categoryLabel: "Meta Sample",
    description: "Official Meta Cloud API test template.",
    message:
      "Welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API, hosted by Meta. Thank you for taking the time to test with us.",
  },
  {
    id: "customer_app_download",
    name: "customer_app_download",
    metaTemplateName: "shifter_customer_welcome",
    isMetaApproved: false,
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
    name: "driver_app_download",
    metaTemplateName: "shifter_driver_onboard",
    isMetaApproved: false,
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
    name: "sales_booking_followup",
    metaTemplateName: "shifter_booking_followup",
    isMetaApproved: false,
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
    name: "incomplete_driver_registration",
    metaTemplateName: "shifter_driver_incomplete_reg",
    isMetaApproved: true,
    title: "⚠️ Driver Incomplete Registration Reminder",
    category: "driver",
    categoryLabel: "Driver Reminder",
    description: "Nudge drivers who entered OTP but haven't completed their registration.",
    message:
      "Aapka *Shifter Online Driver* registration adhoora hai. Bas 2 minute me apni details aur RC/DL submit karke account activate karein aur daily orders lena shuru karein! 🚚💨\n\n📲 *Driver App* khol kar registration poora karein:\n👉 https://play.google.com/store/apps/details?id=com.shifter.driver\n\nKoi pareshani aaye to call karein: +91 9109114515\n— *Team Shifter Online*",
  },
  {
    id: "customer_discount_offer",
    name: "customer_discount_offer",
    metaTemplateName: "shifter_customer_welcome",
    isMetaApproved: false,
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
    name: "payment_reminder",
    metaTemplateName: "shifter_booking_followup",
    isMetaApproved: false,
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
