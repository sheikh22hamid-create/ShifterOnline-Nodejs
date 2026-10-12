const customerHandler = require("./handlers/customerHandler");
const sessionManager = require("./sessionManager");
const logger = require("../utils/logger");

const HELPLINE_NUMBER = "9109114515";
const SUPPORT_EMAIL = "support@shifteronline.com";
const CAREERS_EMAIL = "careers@shifteronline.com";
const CUSTOMER_APP_URL = "https://play.google.com/store/apps/details?id=com.shifter.online";
const DRIVER_APP_URL = "https://play.google.com/store/apps/details?id=com.shifter.driver";

// ==========================================
// 1. MENU TEMPLATES & STRINGS (MULTI-LINGUAL)
// ==========================================

const TEXTS = {
  LANGUAGE_MENU:
    `🚚 *Welcome to Shifter Online!* / *Shifter Online में आपका स्वागत है!*\n\n` +
    `कृपया अपनी पसंदीदा भाषा चुनें / Please select your preferred language:\n\n` +
    `1️⃣ हिंदी (Hindi)\n` +
    `2️⃣ English\n` +
    `3️⃣ Hinglish (हिंग्लिश)\n\n` +
    `👉 कृपया *1*, *2* या *3* लिखकर भेजें।\n` +
    `👉 Reply with *1*, *2* or *3*.`,

  INVALID_LANGUAGE:
    `⚠️ कृपया केवल *1*, *2* या *3* लिखकर भेजें।\n` +
    `⚠️ Please reply with *1*, *2* or *3*:\n\n` +
    `1️⃣ हिंदी (Hindi)\n` +
    `2️⃣ English\n` +
    `3️⃣ Hinglish\n\n` +
    `📞 Helpline: ${HELPLINE_NUMBER}`,

  ROLE_MENU: {
    hi:
      `धन्यवाद! आप Shifter Online से किस रूप में जुड़ना चाहते हैं?\n\n` +
      `1️⃣ Customer (ग्राहक - सामान भेजने / गाड़ी बुक करने के लिए)\n` +
      `2️⃣ Driver Partner (ड्राइवर - गाड़ी जोड़कर रोज़ाना कमाई के लिए)\n` +
      `3️⃣ Job Seeker (जॉब सीकर - ऑफिस नौकरी / करियर संबंधी जानकारी)\n\n` +
      `👉 कृपया *1*, *2* या *3* लिखकर भेजें।\n` +
      `(0️⃣ भाषा बदलने के लिए)`,
    en:
      `Thank you! How would you like to connect with Shifter Online?\n\n` +
      `1️⃣ Customer (Goods delivery / Book a vehicle)\n` +
      `2️⃣ Driver Partner (Attach vehicle & daily earnings)\n` +
      `3️⃣ Job Seeker (Office jobs & Career inquiry)\n\n` +
      `👉 Please reply with *1*, *2* or *3*.\n` +
      `(0️⃣ to change language)`,
    hinglish:
      `Shukriya! Aap Shifter Online ke sath kis roop me judna chahte hain?\n\n` +
      `1️⃣ Customer (Goods parcel bhejna / Gadi book karna)\n` +
      `2️⃣ Driver Partner (Gadi attach karke daily kamai)\n` +
      `3️⃣ Job Seeker (Office job / Career inquiry)\n\n` +
      `👉 Kripya *1*, *2* ya *3* likhkar bhejein.\n` +
      `(0️⃣ Language change karne ke liye)`,
  },

  INVALID_ROLE: {
    hi:
      `⚠️ अमान्य विकल्प! कृपया केवल *1*, *2* या *3* लिखकर भेजें:\n` +
      `1 = Customer, 2 = Driver Partner, 3 = Job Seeker.\n` +
      `(0 = मुख्य मेन्यू | हेल्पलाइन: ${HELPLINE_NUMBER})`,
    en:
      `⚠️ Invalid option! Please reply with *1*, *2* or *3*:\n` +
      `1 = Customer, 2 = Driver Partner, 3 = Job Seeker.\n` +
      `(0 = Main Menu | Helpline: ${HELPLINE_NUMBER})`,
    hinglish:
      `⚠️ Galat option! Kripya sirf *1*, *2* ya *3* likhein:\n` +
      `1 = Customer, 2 = Driver Partner, 3 = Job Seeker.\n` +
      `(0 = Main Menu | Helpline: ${HELPLINE_NUMBER})`,
  },

  // Role Sub-Menus
  CATEGORY_MENU: {
    CUSTOMER: {
      hi:
        `📦 *Shifter Online - ग्राहक सेवा (Customer Support)*\n\n` +
        `कृपया नीचे दिए गए विकल्पों में से नंबर चुनें:\n\n` +
        `1️⃣ गाड़ी बुक करें (Customer App डाउनलोड लिंक)\n` +
        `2️⃣ चालू ऑर्डर ट्रैक करें (Live Tracking & Status)\n` +
        `3️⃣ गाड़ियों के रेट और किराया जानकारी (Fare & Pricing)\n` +
        `4️⃣ कस्टमर केयर से बात करें (Helpline: ${HELPLINE_NUMBER})\n` +
        `0️⃣ मुख्य मेन्यू पर वापस जाएं (Main Menu)\n\n` +
        `👉 कृपया *1*, *2*, *3*, *4* या *0* लिखकर भेजें।`,
      en:
        `📦 *Shifter Online - Customer Support*\n\n` +
        `Please choose an option by replying with a number:\n\n` +
        `1️⃣ Book a Vehicle (Download Customer App)\n` +
        `2️⃣ Track Active Order (Live Location & Status)\n` +
        `3️⃣ Vehicle Rates & Fare Information\n` +
        `4️⃣ Talk to Customer Care (Helpline: ${HELPLINE_NUMBER})\n` +
        `0️⃣ Back to Main Menu\n\n` +
        `👉 Please reply with *1*, *2*, *3*, *4* or *0*.`,
      hinglish:
        `📦 *Shifter Online - Customer Support*\n\n` +
        `Kripya neeche diye gaye options me se number chunein:\n\n` +
        `1️⃣ Gadi Book Karein (Customer App download link)\n` +
        `2️⃣ Live Order Track Karein (Status & Driver details)\n` +
        `3️⃣ Gadiyon ke Rate aur Kiraya Jankari\n` +
        `4️⃣ Customer Care Support (Helpline: ${HELPLINE_NUMBER})\n` +
        `0️⃣ Main Menu par wapas jayein\n\n` +
        `👉 Kripya *1*, *2*, *3*, *4* ya *0* likhkar bhejein.`,
    },

    DRIVER: {
      hi:
        `🚚 *Shifter Online - ड्राइवर पार्टनर सेवा*\n\n` +
        `कृपया नीचे दिए गए विकल्पों में से नंबर चुनें:\n\n` +
        `1️⃣ गाड़ी जोड़ें (Driver Partner App डाउनलोड लिंक)\n` +
        `2️⃣ जरूरी कागजात (Required Documents)\n` +
        `3️⃣ कमाई, कमीशन और सब्सक्रिप्शन प्लान्स\n` +
        `4️⃣ ड्राइवर हेल्पलाइन नंबर (Driver Support)\n` +
        `0️⃣ मुख्य मेन्यू पर वापस जाएं (Main Menu)\n\n` +
        `👉 कृपया *1*, *2*, *3*, *4* या *0* लिखकर भेजें।`,
      en:
        `🚚 *Shifter Online - Driver Partner Support*\n\n` +
        `Please choose an option by replying with a number:\n\n` +
        `1️⃣ Attach Vehicle (Download Driver Partner App)\n` +
        `2️⃣ Required Documents for Onboarding\n` +
        `3️⃣ Earnings, Commission & Plans\n` +
        `4️⃣ Driver Helpline & Support\n` +
        `0️⃣ Back to Main Menu\n\n` +
        `👉 Please reply with *1*, *2*, *3*, *4* or *0*.`,
      hinglish:
        `🚚 *Shifter Online - Driver Partner Support*\n\n` +
        `Kripya neeche diye gaye options me se number chunein:\n\n` +
        `1️⃣ Gadi Jodein (Driver Partner App download link)\n` +
        `2️⃣ Jaruri Documents (DL, RC, Aadhaar, PAN)\n` +
        `3️⃣ Kamai, Commission aur Plans ki jankari\n` +
        `4️⃣ Driver Helpline Number\n` +
        `0️⃣ Main Menu par wapas jayein\n\n` +
        `👉 Kripya *1*, *2*, *3*, *4* ya *0* likhkar bhejein.`,
    },

    JOB_SEEKER: {
      hi:
        `💼 *Shifter Online - करियर व नौकरी सहायता*\n\n` +
        `कृपया नीचे दिए गए विकल्पों में से नंबर चुनें:\n\n` +
        `1️⃣ वर्तमान रिक्तियां (Current Job Openings)\n` +
        `2️⃣ आवेदन कैसे करें (Resume / CV कैसे भेजें)\n` +
        `3️⃣ ऑफिस का पता और इंटरव्यू का समय\n` +
        `4️⃣ HR विभाग संपर्क सूत्र (HR Helpline)\n` +
        `0️⃣ मुख्य मेन्यू पर वापस जाएं (Main Menu)\n\n` +
        `👉 कृपया *1*, *2*, *3*, *4* या *0* लिखकर भेजें।`,
      en:
        `💼 *Shifter Online - Careers & Job Inquiries*\n\n` +
        `Please choose an option by replying with a number:\n\n` +
        `1️⃣ Current Job Openings & Vacancies\n` +
        `2️⃣ How to Apply (Submit Resume / CV)\n` +
        `3️⃣ Office Address & Interview Timing\n` +
        `4️⃣ HR Department Contact Helpline\n` +
        `0️⃣ Back to Main Menu\n\n` +
        `👉 Please reply with *1*, *2*, *3*, *4* or *0*.`,
      hinglish:
        `💼 *Shifter Online - Careers & Job Inquiries*\n\n` +
        `Kripya neeche diye gaye options me se number chunein:\n\n` +
        `1️⃣ Current Open Jobs & Vacancies\n` +
        `2️⃣ Apply Kaise Karein (Resume / CV send karein)\n` +
        `3️⃣ Office Address aur Interview Timings\n` +
        `4️⃣ HR Contact Details & Helpline\n` +
        `0️⃣ Main Menu par wapas jayein\n\n` +
        `👉 Kripya *1*, *2*, *3*, *4* ya *0* likhkar bhejein.`,
    },
  },

  // Sub-Menu Answers
  RESPONSES: {
    CUSTOMER: {
      "1": {
        hi:
          `📦 *गाड़ी बुक करने के लिए Customer App डाउनलोड करें*\n\n` +
          `Shifter Online पर डिलीवरी बुकिंग हमारी आधिकारिक ऐप से होती है, जहाँ आपको तुरंत पारदर्शी किराया और नज़दीकी ड्राइवर मिलता है।\n\n` +
          `📲 *Customer App डाउनलोड लिंक*:\n👉 ${CUSTOMER_APP_URL}\n\n` +
          `📞 सहायता: ${HELPLINE_NUMBER}\n\n` +
          `_(अन्य विकल्प के लिए नंबर चुनें या '0' लिखकर मुख्य मेन्यू पर जाएं)_`,
        en:
          `📦 *Download Shifter Customer App to Book*\n\n` +
          `All logistics and vehicle bookings are handled through our official Customer App with instant upfront fares and live tracking.\n\n` +
          `📲 *Download Customer App*:\n👉 ${CUSTOMER_APP_URL}\n\n` +
          `📞 Support: ${HELPLINE_NUMBER}\n\n` +
          `_(Reply with another number or '0' for Main Menu)_`,
        hinglish:
          `📦 *Gadi Book Karne ke liye App Download Karein*\n\n` +
          `Shifter Online par goods delivery booking hamari official Customer App se hoti hai, jahan aap live fare dekhkar turant driver book kar sakte hain.\n\n` +
          `📲 *Download Customer App*:\n👉 ${CUSTOMER_APP_URL}\n\n` +
          `📞 Helpline: ${HELPLINE_NUMBER}\n\n` +
          `_(Doosre option ke liye number chunein ya '0' likhkar Main Menu par jayein)_`,
      },
      "2_PROMPT": {
        hi: `📦 कृपया अपना Order ID नंबर लिखकर भेजें (उदाहरण: *244*):\n\n(वापस जाने के लिए '0' लिखें)`,
        en: `📦 Please reply with your Order ID number (e.g. *244*):\n\n(Reply '0' to go back)`,
        hinglish: `📦 Kripya apna Order ID number likhkar bhejein (jaise: *244*):\n\n(Wapas jane ke liye '0' likhein)`,
      },
      "3": {
        hi:
          `🚚 *Shifter Online - वाहन व किराया दरें*\n\n` +
          `हमारे पास हर तरह के सामान के लिए गाड़ियाँ उपलब्ध हैं:\n` +
          `🛵 *2-Wheeler (Bike)*: छोटे पार्सल और दस्तावेज़ के लिए\n` +
          `🛺 *3-Wheeler / E-Loader*: मध्यम सामान और कार्टन (किफायती दर)\n` +
          `🚛 *Tata Ace (छोटा हाथी)*: भारी सामान व कमर्शियल लोडिंग\n` +
          `🚚 *Pickup 8ft / Bolero*: बड़े फर्नीचर व भारी शिफ्टिंग\n\n` +
          `💡 सटीक दूरी और लोकेशन के अनुसार तुरंत किराया देखने के लिए Customer App डाउनलोड करें:\n` +
          `👉 ${CUSTOMER_APP_URL}\n\n` +
          `📞 सहायता: ${HELPLINE_NUMBER}\n\n` +
          `_(अन्य विकल्प के लिए नंबर चुनें या '0' लिखकर मुख्य मेन्यू पर जाएं)_`,
        en:
          `🚚 *Shifter Online - Vehicle Categories & Fares*\n\n` +
          `Vehicles available for all delivery needs:\n` +
          `🛵 *2-Wheeler (Bike)*: Parcels, food & urgent documents\n` +
          `🛺 *3-Wheeler / E-Loader*: Medium cargo & cartons (Economical)\n` +
          `🚛 *Tata Ace (Chhota Hathi)*: Heavy goods & commercial cargo\n` +
          `🚚 *Pickup 8ft / Bolero*: Furniture & bulk relocation\n\n` +
          `💡 Calculate instant transparent fares on our Customer App:\n` +
          `👉 ${CUSTOMER_APP_URL}\n\n` +
          `📞 Helpline: ${HELPLINE_NUMBER}\n\n` +
          `_(Reply with another number or '0' for Main Menu)_`,
        hinglish:
          `🚚 *Shifter Online - Gadiyon ke Rate aur Kiraya*\n\n` +
          `Har tarah ke saman ke liye gadiyan uplabdh hain:\n` +
          `🛵 *2-Wheeler (Bike)*: Chhote parcel aur documents\n` +
          `🛺 *3-Wheeler / E-Loader*: Medium cargo aur boxes\n` +
          `🚛 *Tata Ace (Chhota Hathi)*: Heavy goods aur commercial saman\n` +
          `🚚 *Pickup 8ft / Bolero*: Furniture aur bulk loading\n\n` +
          `💡 Exact distance ke hisab se live rate dekhne ke liye App download karein:\n` +
          `👉 ${CUSTOMER_APP_URL}\n\n` +
          `📞 Helpline: ${HELPLINE_NUMBER}\n\n` +
          `_(Doosre option ke liye number chunein ya '0' likhkar Main Menu par jayein)_`,
      },
      "4": {
        hi:
          `📞 *Shifter Online - कस्टमर केयर सहायता*\n\n` +
          `आप हमारी सपोर्ट टीम से सीधे संपर्क कर सकते हैं:\n` +
          `📱 *कॉल / व्हाट्सएप*: ${HELPLINE_NUMBER}\n` +
          `📧 *ईमेल*: ${SUPPORT_EMAIL}\n` +
          `🌐 *वेबसाइट*: https://shifteronline.com\n` +
          `🏢 *कंपनी*: Movigo Logistic Aggregator Private Limited\n\n` +
          `_(अन्य विकल्प के लिए नंबर चुनें या '0' लिखकर मुख्य मेन्यू पर जाएं)_`,
        en:
          `📞 *Shifter Online - Customer Care Support*\n\n` +
          `Get in touch directly with our support team:\n` +
          `📱 *Phone / Helpline*: ${HELPLINE_NUMBER}\n` +
          `📧 *Email*: ${SUPPORT_EMAIL}\n` +
          `🌐 *Website*: https://shifteronline.com\n` +
          `🏢 *Company*: Movigo Logistic Aggregator Private Limited\n\n` +
          `_(Reply with another number or '0' for Main Menu)_`,
        hinglish:
          `📞 *Shifter Online - Customer Care Helpline*\n\n` +
          `Hamari support team se direct sampark karein:\n` +
          `📱 *Call / Helpline*: ${HELPLINE_NUMBER}\n` +
          `📧 *Email*: ${SUPPORT_EMAIL}\n` +
          `🌐 *Website*: https://shifteronline.com\n` +
          `🏢 *Company*: Movigo Logistic Aggregator Private Limited\n\n` +
          `_(Doosre option ke liye number chunein ya '0' likhkar Main Menu par jayein)_`,
      },
    },

    DRIVER: {
      "1": {
        hi:
          `🚚 *Shifter Online में गाड़ी जोड़ें और रोज़ाना कमाएं*\n\n` +
          `अपनी गाड़ी (Bike, 3-Wheeler, Tata Ace, Pickup) जोड़कर आज ही ट्रिप शुरू करें।\n\n` +
          `📲 *Driver Partner App डाउनलोड लिंक*:\n👉 ${DRIVER_APP_URL}\n\n` +
          `✅ 5 मिनट में आसान रजिस्ट्रेशन\n` +
          `✅ तुरंत आईडी वेरिफिकेशन\n` +
          `✅ रोज़ाना बैंक / UPI में सीधा पेमेंट\n\n` +
          `📞 ड्राइवर सपोर्ट: ${HELPLINE_NUMBER}\n\n` +
          `_(अन्य विकल्प के लिए नंबर चुनें या '0' लिखकर मुख्य मेन्यू पर जाएं)_`,
        en:
          `🚚 *Attach Your Vehicle & Earn Daily with Shifter*\n\n` +
          `Attach your Bike, 3-Wheeler, Tata Ace, or Pickup truck and start receiving orders today.\n\n` +
          `📲 *Download Driver Partner App*:\n👉 ${DRIVER_APP_URL}\n\n` +
          `✅ Quick 5-minute onboarding\n` +
          `✅ Fast document verification\n` +
          `✅ Daily direct bank/UPI payouts\n\n` +
          `📞 Driver Support: ${HELPLINE_NUMBER}\n\n` +
          `_(Reply with another number or '0' for Main Menu)_`,
        hinglish:
          `🚚 *Shifter me Gadi Jodein aur Daily Kamayein*\n\n` +
          `Apni gadi (Bike, Auto, Tata Ace, Pickup) attach karke aaj hi kamai shuru karein.\n\n` +
          `📲 *Driver Partner App Download Link*:\n👉 ${DRIVER_APP_URL}\n\n` +
          `✅ 5 minute me aasan registration\n` +
          `✅ Instant document verification\n` +
          `✅ Daily direct UPI / Bank payout\n\n` +
          `📞 Driver Helpline: ${HELPLINE_NUMBER}\n\n` +
          `_(Doosre option ke liye number chunein ya '0' likhkar Main Menu par jayein)_`,
      },
      "2": {
        hi:
          `📋 *ड्राइवर ऑनबोर्डिंग के लिए जरूरी कागजात*\n\n` +
          `1️⃣ ड्राइविंग लाइसेंस (Driving License - DL)\n` +
          `2️⃣ वाहन आरसी (Vehicle RC Book)\n` +
          `3️⃣ आधार कार्ड (Aadhaar Card)\n` +
          `4️⃣ पैन कार्ड (PAN Card)\n` +
          `5️⃣ बैंक खाता या UPI विवरण (Bank Account / UPI)\n` +
          `6️⃣ ड्राइवर की लाइव सेल्फी फोटो\n\n` +
          `📲 कागजात अपलोड करने के लिए Shifter Driver App डाउनलोड करें:\n` +
          `👉 ${DRIVER_APP_URL}\n\n` +
          `📞 सहायता: ${HELPLINE_NUMBER}\n\n` +
          `_(अन्य विकल्प के लिए नंबर चुनें या '0' लिखकर मुख्य मेन्यू पर जाएं)_`,
        en:
          `📋 *Required Documents for Driver Onboarding*\n\n` +
          `1️⃣ Driving License (DL)\n` +
          `2️⃣ Vehicle RC Book\n` +
          `3️⃣ Aadhaar Card / Govt ID\n` +
          `4️⃣ PAN Card\n` +
          `5️⃣ Bank Account or UPI Details\n` +
          `6️⃣ Driver Selfie Photo\n\n` +
          `📲 Upload documents via Shifter Driver App:\n` +
          `👉 ${DRIVER_APP_URL}\n\n` +
          `📞 Support: ${HELPLINE_NUMBER}\n\n` +
          `_(Reply with another number or '0' for Main Menu)_`,
        hinglish:
          `📋 *Driver Onboarding ke liye Jaruri Documents*\n\n` +
          `1️⃣ Driving License (DL)\n` +
          `2️⃣ Vehicle RC Book\n` +
          `3️⃣ Aadhaar Card\n` +
          `4️⃣ PAN Card\n` +
          `5️⃣ Bank Account ya UPI ID\n` +
          `6️⃣ Driver ki photo\n\n` +
          `📲 Documents upload karne ke liye Driver App download karein:\n` +
          `👉 ${DRIVER_APP_URL}\n\n` +
          `📞 Helpline: ${HELPLINE_NUMBER}\n\n` +
          `_(Doosre option ke liye number chunein ya '0' likhkar Main Menu par jayein)_`,
      },
      "3": {
        hi:
          `💰 *कमाई, कमीशन व सब्सक्रिप्शन प्लान्स*\n\n` +
          `Shifter Online ड्राइवर्स को अधिकतम कमाई का अवसर देता है:\n` +
          `⭐ *ज़ीरो कमीशन मॉडल*: अपने मेहनत की पूरी कमाई अपनी जेब में रखें\n` +
          `⭐ *डेली ड्राइवर प्लान्स*: हर दिन गारंटीड ऑर्डर्स और बोनस\n` +
          `⭐ *त्वरित विड्रॉल*: अपनी कमाई जब चाहें तुरंत UPI / बैंक खाते में ट्रांसफर करें\n\n` +
          `📲 प्लान्स की विस्तृत जानकारी Driver App में उपलब्ध है:\n` +
          `👉 ${DRIVER_APP_URL}\n\n` +
          `📞 ड्राइवर हेल्पलाइन: ${HELPLINE_NUMBER}\n\n` +
          `_(अन्य विकल्प के लिए नंबर चुनें या '0' लिखकर मुख्य मेन्यू पर जाएं)_`,
        en:
          `💰 *Earnings, Commission & Subscription Plans*\n\n` +
          `Maximize your daily earnings with Shifter Online:\n` +
          `⭐ *Zero Commission Model*: Keep 100% of your trip fare\n` +
          `⭐ *Daily Driver Plans*: Dedicated local orders & daily bonuses\n` +
          `⭐ *Instant Payouts*: Withdraw your earnings to bank/UPI anytime\n\n` +
          `📲 View active plans in the Driver App:\n` +
          `👉 ${DRIVER_APP_URL}\n\n` +
          `📞 Helpline: ${HELPLINE_NUMBER}\n\n` +
          `_(Reply with another number or '0' for Main Menu)_`,
        hinglish:
          `💰 *Kamai, Commission aur Plans ki Jankari*\n\n` +
          `Shifter Online drivers ke liye best earning model laya hai:\n` +
          `⭐ *Zero Commission*: Har trip ki poori kamai aapki\n` +
          `⭐ *Daily Driver Plans*: Local regular orders aur performance bonus\n` +
          `⭐ *Instant Payout*: Jab chahein apni kamai UPI/Bank me nikaalein\n\n` +
          `📲 Poori details Driver App me dekhein:\n` +
          `👉 ${DRIVER_APP_URL}\n\n` +
          `📞 Driver Helpline: ${HELPLINE_NUMBER}\n\n` +
          `_(Doosre option ke liye number chunein ya '0' likhkar Main Menu par jayein)_`,
      },
      "4": {
        hi:
          `📞 *Shifter Online ड्राइवर हेल्पलाइन*\n\n` +
          `ड्राइवर पार्टनर्स किसी भी समस्या या पूछताछ के लिए सीधे कॉल कर सकते हैं:\n` +
          `📱 *ड्राइवर हेल्पलाइन*: ${HELPLINE_NUMBER}\n` +
          `📧 *ईमेल*: ${SUPPORT_EMAIL}\n` +
          `📲 *Driver App*: ${DRIVER_APP_URL}\n\n` +
          `_(अन्य विकल्प के लिए नंबर चुनें या '0' लिखकर मुख्य मेन्यू पर जाएं)_`,
        en:
          `📞 *Shifter Online Driver Support Helpline*\n\n` +
          `For onboarding, account, or ride issues:\n` +
          `📱 *Driver Support*: ${HELPLINE_NUMBER}\n` +
          `📧 *Email*: ${SUPPORT_EMAIL}\n` +
          `📲 *Driver App*: ${DRIVER_APP_URL}\n\n` +
          `_(Reply with another number or '0' for Main Menu)_`,
        hinglish:
          `📞 *Shifter Online Driver Support Helpline*\n\n` +
          `Onboarding, account ya ride se judi sahayata ke liye:\n` +
          `📱 *Driver Support Phone*: ${HELPLINE_NUMBER}\n` +
          `📧 *Email*: ${SUPPORT_EMAIL}\n` +
          `📲 *Driver App*: ${DRIVER_APP_URL}\n\n` +
          `_(Doosre option ke liye number chunein ya '0' likhkar Main Menu par jayein)_`,
      },
    },

    JOB_SEEKER: {
      "1": {
        hi:
          `💼 *वर्तमान रिक्तियां (Current Job Openings)*\n\n` +
          `Shifter Online में निम्नलिखित पदों पर सक्रिय भर्तियां चल रही हैं:\n` +
          `1️⃣ Customer Support & Telecalling Executive\n` +
          `2️⃣ Driver Onboarding & Field Operations\n` +
          `3️⃣ Logistics Dispatch Coordinator\n` +
          `4️⃣ Area Business Development Executive\n\n` +
          `📧 आवेदन के लिए अपना रिज्यूमे भेजें: *${CAREERS_EMAIL}*\n` +
          `📞 एचआर हेल्पलाइन: ${HELPLINE_NUMBER}\n\n` +
          `_(अन्य विकल्प के लिए नंबर चुनें या '0' लिखकर मुख्य मेन्यू पर जाएं)_`,
        en:
          `💼 *Current Job Openings & Vacancies*\n\n` +
          `Shifter Online is actively hiring for the following positions:\n` +
          `1️⃣ Customer Support & Telecalling Executive\n` +
          `2️⃣ Driver Onboarding & Field Operations\n` +
          `3️⃣ Logistics Dispatch Coordinator\n` +
          `4️⃣ Area Business Development Executive\n\n` +
          `📧 Send your Resume to: *${CAREERS_EMAIL}*\n` +
          `📞 HR Helpline: ${HELPLINE_NUMBER}\n\n` +
          `_(Reply with another number or '0' for Main Menu)_`,
        hinglish:
          `💼 *Current Open Jobs & Vacancies*\n\n` +
          `Shifter Online mein in positions par active hiring chal rahi hai:\n` +
          `1️⃣ Customer Support & Telecaller Executive\n` +
          `2️⃣ Driver Onboarding & Field Operations\n` +
          `3️⃣ Logistics Dispatch Coordinator\n` +
          `4️⃣ Sales & Business Development\n\n` +
          `📧 Apply karne ke liye resume bhejein: *${CAREERS_EMAIL}*\n` +
          `📞 HR Helpline: ${HELPLINE_NUMBER}\n\n` +
          `_(Doosre option ke liye number chunein ya '0' likhkar Main Menu par jayein)_`,
      },
      "2": {
        hi:
          `📝 *नौकरी के लिए आवेदन कैसे करें*\n\n` +
          `कृपया अपना नवीनतम रिज्यूमे (CV) हमारे आधिकारिक ईमेल पर भेजें:\n` +
          `📧 *ईमेल*: ${CAREERS_EMAIL}\n` +
          `📌 *Subject*: जिस पद के लिए आवेदन कर रहे हैं (उदा. Application for Customer Support)\n\n` +
          `हमारी HR टीम आपके रिज्यूमे की समीक्षा करके 24-48 घंटों के भीतर साक्षात्कार के लिए संपर्क करेगी।\n\n` +
          `📞 एचआर हेल्पलाइन: ${HELPLINE_NUMBER}\n\n` +
          `_(अन्य विकल्प के लिए नंबर चुनें या '0' लिखकर मुख्य मेन्यू पर जाएं)_`,
        en:
          `📝 *How to Apply for Open Roles*\n\n` +
          `Please email your updated Resume (CV) to our HR department:\n` +
          `📧 *Email*: ${CAREERS_EMAIL}\n` +
          `📌 *Subject*: Position Name (e.g., Application for Customer Support)\n\n` +
          `Our recruitment team will review your profile and reach out within 24-48 hours.\n\n` +
          `📞 HR Helpline: ${HELPLINE_NUMBER}\n\n` +
          `_(Reply with another number or '0' for Main Menu)_`,
        hinglish:
          `📝 *Job ke liye Apply Kaise Karein*\n\n` +
          `Kripya apna updated resume (CV) hamari official careers email par bhejein:\n` +
          `📧 *Email*: ${CAREERS_EMAIL}\n` +
          `📌 *Subject*: Job Role (jaise: Application for Customer Support)\n\n` +
          `Hamari HR team aapka resume check karke 24-48 hours me call karegi.\n\n` +
          `📞 HR Helpline: ${HELPLINE_NUMBER}\n\n` +
          `_(Doosre option ke liye number chunein ya '0' likhkar Main Menu par jayein)_`,
      },
      "3": {
        hi:
          `🏢 *ऑफिस का पता और इंटरव्यू समय*\n\n` +
          `🏢 *कंपनी*: Movigo Logistic Aggregator Private Limited (Shifter Online)\n` +
          `⏰ *कार्य दिवस*: सोमवार से शनिवार (Monday to Saturday)\n` +
          `⏰ *समय*: सुबह 10:00 AM से शाम 6:00 PM\n` +
          `📞 *हेल्पलाइन*: ${HELPLINE_NUMBER}\n` +
          `📧 *ईमेल*: ${CAREERS_EMAIL}\n\n` +
          `_(अन्य विकल्प के लिए नंबर चुनें या '0' लिखकर मुख्य मेन्यू पर जाएं)_`,
        en:
          `🏢 *Office Address & Interview Timing*\n\n` +
          `🏢 *Company*: Movigo Logistic Aggregator Private Limited (Shifter Online)\n` +
          `⏰ *Working Days*: Monday to Saturday\n` +
          `⏰ *Working Hours*: 10:00 AM to 6:00 PM\n` +
          `📞 *Helpline*: ${HELPLINE_NUMBER}\n` +
          `📧 *Email*: ${CAREERS_EMAIL}\n\n` +
          `_(Reply with another number or '0' for Main Menu)_`,
        hinglish:
          `🏢 *Office Address aur Interview Timings*\n\n` +
          `🏢 *Company*: Movigo Logistic Aggregator Private Limited (Shifter Online)\n` +
          `⏰ *Days*: Monday to Saturday\n` +
          `⏰ *Timings*: Subah 10:00 AM se Shaam 6:00 PM\n` +
          `📞 *Helpline*: ${HELPLINE_NUMBER}\n` +
          `📧 *Email*: ${CAREERS_EMAIL}\n\n` +
          `_(Doosre option ke liye number chunein ya '0' likhkar Main Menu par jayein)_`,
      },
      "4": {
        hi:
          `📞 *HR व भर्ती संपर्क सूत्र*\n\n` +
          `नौकरी संबंधी पूछताछ के लिए:\n` +
          `📱 *एचआर हेल्पलाइन*: ${HELPLINE_NUMBER}\n` +
          `📧 *करियर ईमेल*: ${CAREERS_EMAIL}\n` +
          `🏢 *कंपनी*: Movigo Logistic Aggregator Private Limited\n\n` +
          `_(अन्य विकल्प के लिए नंबर चुनें या '0' लिखकर मुख्य मेन्यू पर जाएं)_`,
        en:
          `📞 *HR & Recruitment Helpline*\n\n` +
          `For job and career inquiries:\n` +
          `📱 *HR Helpline*: ${HELPLINE_NUMBER}\n` +
          `📧 *Careers Email*: ${CAREERS_EMAIL}\n` +
          `🏢 *Company*: Movigo Logistic Aggregator Private Limited\n\n` +
          `_(Reply with another number or '0' for Main Menu)_`,
        hinglish:
          `📞 *HR & Careers Helpline*\n\n` +
          `Job inquiry ya interview updates ke liye:\n` +
          `📱 *HR Helpline*: ${HELPLINE_NUMBER}\n` +
          `📧 *Careers Email*: ${CAREERS_EMAIL}\n` +
          `🏢 *Company*: Movigo Logistic Aggregator Private Limited\n\n` +
          `_(Doosre option ke liye number chunein ya '0' likhkar Main Menu par jayein)_`,
      },
    },
  },

  // Guardrail: Fallback when user enters free-form random messages
  GUARDRAIL_FALLBACK: {
    hi:
      `⚠️ क्षमा करें, मैं आपका संदेश समझ नहीं पाया।\n\n` +
      `मैं एक स्वचालित मेनू बॉट हूँ। कृपया दिए गए विकल्पों में से केवल नंबर (*1, 2, 3...*) लिखकर भेजें।\n\n` +
      `यदि आपको किसी विशेष विषय पर सीधे बात करनी है, तो कृपया हमारे कस्टमर केयर से संपर्क करें:\n` +
      `📞 *कस्टमर केयर*: ${HELPLINE_NUMBER}\n` +
      `📧 *ईमेल*: ${SUPPORT_EMAIL}\n\n` +
      `_(मुख्य मेन्यू देखने के लिए '0' लिखकर भेजें)_`,
    en:
      `⚠️ Sorry, I could not understand your message.\n\n` +
      `I am an automated menu bot. Please reply only with the option numbers (*1, 2, 3...*).\n\n` +
      `For direct assistance or specific questions, please contact our support team:\n` +
      `📞 *Customer Care*: ${HELPLINE_NUMBER}\n` +
      `📧 *Email*: ${SUPPORT_EMAIL}\n\n` +
      `_(Reply with '0' to return to Main Menu)_`,
    hinglish:
      `⚠️ Maaf kijiye, main aapka message samajh nahi paya.\n\n` +
      `Main ek automated menu bot hoon. Kripya diye gaye option numbers (*1, 2, 3...*) me se hi chunein.\n\n` +
      `Direct sahayata ya kisi anya jankari ke liye hamari team se sampark karein:\n` +
      `📞 *Customer Care*: ${HELPLINE_NUMBER}\n` +
      `📧 *Email*: ${SUPPORT_EMAIL}\n\n` +
      `_(Main Menu dekhne ke liye '0' likhkar bhejein)_`,
  },
};

// ==========================================
// 2. STATE MACHINE CORE ENGINE
// ==========================================

const STEPS = {
  IDLE: "IDLE",
  AWAITING_LANGUAGE: "AWAITING_LANGUAGE",
  AWAITING_ROLE: "AWAITING_ROLE",
  IN_MENU: "IN_MENU",
  AWAITING_ORDER_ID: "AWAITING_ORDER_ID",
};

const LANG_MAP = {
  "1": "hi",
  "2": "en",
  "3": "hinglish",
};

const ROLE_MAP = {
  "1": "CUSTOMER",
  "2": "DRIVER",
  "3": "JOB_SEEKER",
};

/**
 * Checks if input is a global reset / main menu trigger
 */
function isResetTrigger(text) {
  const t = String(text || "").toLowerCase().trim();
  return (
    t === "0" ||
    t === "menu" ||
    t === "main menu" ||
    t === "reset" ||
    t === "restart" ||
    t === "home" ||
    t === "start" ||
    t === "/start"
  );
}

/**
 * Checks if input is an initial greeting
 */
function isGreeting(text) {
  const t = String(text || "").toLowerCase().trim();
  return /^(hi|hello|hey|namaste|pranam|hola|good\s*(morning|afternoon|evening)|start|\/start)$/i.test(t);
}

/**
 * Main function: Processes any incoming WhatsApp message strictly within the Bounded State Machine.
 */
async function processMenuMessage(senderPhone, textMessage) {
  const session = sessionManager.getSession(senderPhone);
  const clean = String(textMessage || "").trim();
  const lang = session.data?.lang || "hinglish";
  const role = session.data?.role || null;

  logger.info(`🤖 [MenuBot] Phone: ${senderPhone} | Step: ${session.step} | Lang: ${lang} | Input: "${clean}"`);

  // 1. Check for Reset / Restart Trigger (0, menu, reset)
  if (isResetTrigger(clean)) {
    sessionManager.updateSession(senderPhone, STEPS.AWAITING_LANGUAGE, {
      lang: null,
      role: null,
    });
    return TEXTS.LANGUAGE_MENU;
  }

  // 2. Brand new user, IDLE, or Greeting -> Present Language Menu
  if (session.step === STEPS.IDLE || isGreeting(clean)) {
    sessionManager.updateSession(senderPhone, STEPS.AWAITING_LANGUAGE, {});
    return TEXTS.LANGUAGE_MENU;
  }

  // 3. Step: Awaiting Language Selection (1, 2, or 3)
  if (session.step === STEPS.AWAITING_LANGUAGE) {
    const selectedLang = LANG_MAP[clean];
    if (selectedLang) {
      sessionManager.updateSession(senderPhone, STEPS.AWAITING_ROLE, {
        lang: selectedLang,
      });
      return TEXTS.ROLE_MENU[selectedLang];
    }

    // Invalid choice during language selection: Re-send language prompt
    return TEXTS.INVALID_LANGUAGE;
  }

  // 4. Step: Awaiting Role / Category Selection (1, 2, or 3)
  if (session.step === STEPS.AWAITING_ROLE) {
    const selectedRole = ROLE_MAP[clean];
    if (selectedRole) {
      sessionManager.updateSession(senderPhone, STEPS.IN_MENU, {
        role: selectedRole,
      });
      return TEXTS.CATEGORY_MENU[selectedRole][lang];
    }

    // Invalid choice during role selection: Re-send role prompt with warning
    return TEXTS.INVALID_ROLE[lang] || TEXTS.INVALID_ROLE.hinglish;
  }

  // 5. Step: Waiting for Order ID to track
  if (session.step === STEPS.AWAITING_ORDER_ID) {
    const orderIdMatch = clean.match(/\d+/);
    if (orderIdMatch) {
      const orderId = orderIdMatch[0];
      const trackingResult = await customerHandler.handleTrackingQuery(orderId, senderPhone);
      sessionManager.updateSession(senderPhone, STEPS.IN_MENU, {});
      return (
        `${trackingResult}\n\n` +
        `_(अन्य सहायता के लिए नंबर चुनें या '0' लिखकर मुख्य मेन्यू पर जाएं)_`
      );
    }

    // Non-digit input while expecting Order ID: Send guardrail fallback and restore IN_MENU
    sessionManager.updateSession(senderPhone, STEPS.IN_MENU, {});
    return (
      (TEXTS.GUARDRAIL_FALLBACK[lang] || TEXTS.GUARDRAIL_FALLBACK.hinglish) +
      `\n\n` +
      TEXTS.CATEGORY_MENU.CUSTOMER[lang]
    );
  }

  // 6. Step: In Active Category Menu (IN_MENU)
  if (session.step === STEPS.IN_MENU && role) {
    // If Customer chose Option 2 (Track Running Order), prompt for Order ID
    if (role === "CUSTOMER" && clean === "2") {
      sessionManager.updateSession(senderPhone, STEPS.AWAITING_ORDER_ID, {});
      return (
        TEXTS.RESPONSES.CUSTOMER["2_PROMPT"][lang] ||
        TEXTS.RESPONSES.CUSTOMER["2_PROMPT"].hinglish
      );
    }

    // Check if user selected a valid sub-option (1, 2, 3, 4)
    const categoryResponses = TEXTS.RESPONSES[role];
    if (categoryResponses && categoryResponses[clean]) {
      return (
        categoryResponses[clean][lang] ||
        categoryResponses[clean].hinglish
      );
    }

    // STRICT GUARDRAIL:
    // If user enters free-form text, random conversation, or an invalid number:
    // The bot says it could not understand, provides helpline 9109114515, and shows the category menu again!
    const fallbackText = TEXTS.GUARDRAIL_FALLBACK[lang] || TEXTS.GUARDRAIL_FALLBACK.hinglish;
    const categoryMenu = TEXTS.CATEGORY_MENU[role][lang] || TEXTS.CATEGORY_MENU[role].hinglish;
    return `${fallbackText}\n\n${categoryMenu}`;
  }

  // Default fallback if session in unknown state
  sessionManager.updateSession(senderPhone, STEPS.AWAITING_LANGUAGE, {});
  return TEXTS.LANGUAGE_MENU;
}

module.exports = {
  STEPS,
  TEXTS,
  processMenuMessage,
  isResetTrigger,
  isGreeting,
  HELPLINE_NUMBER,
};
