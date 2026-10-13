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
    `3️⃣ Hinglish (हिंग्लिश)\n` +
    `4️⃣ Other Indian Languages (अन्य भारतीय भाषाएं) 🇮🇳\n\n` +
    `👉 कृपया *1, 2, 3 या 4* लिखकर भेजें।\n` +
    `👉 Reply with *1, 2, 3 or 4*.`,

  INVALID_LANGUAGE:
    `⚠️ कृपया केवल *1, 2, 3 या 4* लिखकर भेजें।\n` +
    `⚠️ Please reply with *1, 2, 3 or 4*:\n\n` +
    `1️⃣ हिंदी (Hindi)\n` +
    `2️⃣ English\n` +
    `3️⃣ Hinglish\n` +
    `4️⃣ Other Indian Languages 🇮🇳\n\n` +
    `📞 Helpline: ${HELPLINE_NUMBER}`,

  REGIONAL_LANGUAGE_MENU:
    `🇮🇳 *Select Your Regional Language / अपनी क्षेत्रीय भाषा चुनें*:\n\n` +
    `1️⃣ मराठी (Marathi)\n` +
    `2️⃣ ગુજરાતી (Gujarati)\n` +
    `3️⃣ ਪੰਜਾਬੀ (Punjabi)\n` +
    `4️⃣ বাংলা (Bengali)\n` +
    `5️⃣ తెలుగు (Telugu)\n` +
    `6️⃣ தமிழ் (Tamil)\n` +
    `7️⃣ ಕನ್ನಡ (Kannada)\n` +
    `0️⃣ Back / पिछली भाषा मेन्यू ⬅️\n\n` +
    `👉 कृपया *1 से 7* तक का नंबर लिखकर भेजें (वापस जाने के लिए *0* लिखें)।\n` +
    `👉 Reply with *1 to 7* (or *0* to go back).`,

  INVALID_REGIONAL_LANGUAGE:
    `⚠️ कृपया *1 से 7* तक का कोई नंबर चुनें (वापस जाने के लिए *0* लिखें):\n\n` +
    `1️⃣ मराठी | 2️⃣ ગુજરાતી | 3️⃣ ਪੰਜਾਬੀ | 4️⃣ বাংলা\n` +
    `5️⃣ తెలుగు | 6️⃣ தமிழ் | 7️⃣ ಕನ್ನಡ\n` +
    `0️⃣ Back (मुख्य भाषा मेन्यू)\n\n` +
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
    mr:
      `धन्यवाद! आपण Shifter Online शी कोणत्या भूमिकेत जोडू इच्छिता?\n\n` +
      `1️⃣ Customer (ग्राहक - मालवाहतूक / वाहन बुक करण्यासाठी)\n` +
      `2️⃣ Driver Partner (चालक - वाहन जोडून दररोज कमाई करण्यासाठी)\n` +
      `3️⃣ Job Seeker (नोकरी / करिअर संबंधित माहितीसाठी)\n\n` +
      `👉 कृपया *1*, *2* किंवा *3* लिहून पाठवा.\n` +
      `(0️⃣ भाषा बदलण्यासाठी)`,
    gu:
      `આભાર! તમે Shifter Online સાથે કઈ રીતે જોડાવા માંગો છો?\n\n` +
      `1️⃣ Customer (ગ્રાહક - માલ મોકલવા / વાહન બુક કરવા માટે)\n` +
      `2️⃣ Driver Partner (ડ્રાઇવર - વાહન જોડીને રોજેરોજ કમાણી માટે)\n` +
      `3️⃣ Job Seeker (નોકરી / કારકિર્દી સંબંધી માહિતી માટે)\n\n` +
      `👉 કૃપા કરીને *1*, *2* અથવા *3* લખીને મોકલો.\n` +
      `(0️⃣ ભાષા બદલવા માટે)`,
    pa:
      `ਧੰਨਵਾਦ! ਤੁਸੀਂ Shifter Online ਨਾਲ ਕਿਸ ਰੂਪ ਵਿੱਚ ਜੁੜਨਾ ਚਾਹੁੰਦੇ ਹੋ?\n\n` +
      `1️⃣ Customer (ਗਾਹਕ - ਸਾਮਾਨ ਭੇਜਣ / ਗੱਡੀ ਬੁੱਕ ਕਰਨ ਲਈ)\n` +
      `2️⃣ Driver Partner (ਡਰਾਈਵਰ - ਗੱਡੀ ਜੋੜ ਕੇ ਰੋਜ਼ਾਨਾ ਕਮਾਈ ਲਈ)\n` +
      `3️⃣ Job Seeker (ਨੌਕਰੀ / ਕਰੀਅਰ ਸੰਬੰਧੀ ਜਾਣਕਾਰੀ ਲਈ)\n\n` +
      `👉 ਕਿਰਪਾ ਕਰਕੇ *1*, *2* ਜਾਂ *3* ਲਿਖ ਕੇ ਭੇਜੋ।\n` +
      `(0️⃣ ਭਾਸ਼ਾ ਬਦਲਣ ਲਈ)`,
    bn:
      `ধন্যবাদ! আপনি Shifter Online-এর সাথে কীভাবে যুক্ত হতে চান?\n\n` +
      `1️⃣ Customer (গ্রাহক - পার্সেল পাঠানো / গাড়ি বুক করার জন্য)\n` +
      `2️⃣ Driver Partner (ড্রাইভার - গাড়ি যুক্ত করে দৈনিক উপার্জনের জন্য)\n` +
      `3️⃣ Job Seeker (চাকরি / ক্যারিয়ার সংক্রান্ত তথ্যের জন্য)\n\n` +
      `👉 দয়া করে *1*, *2* অথবা *3* লিখে পাঠান।\n` +
      `(0️⃣ ভাষা পরিবর্তনের জন্য)`,
    te:
      `ధన్యవాదాలు! మీరు Shifter Online తో ఏ విధంగా అనుసంధానం కావాలనుకుంటున్నారు?\n\n` +
      `1️⃣ Customer (కస్టమర్ - వస్తువులు రవాణా / వాహనం బుక్ చేయడానికి)\n` +
      `2️⃣ Driver Partner (డ్రైవర్ - వాహనాన్ని జతచేసి ప్రతిరోజూ సంపాదించడానికి)\n` +
      `3️⃣ Job Seeker (ఉద్యోగం / కెరీర్ సమాచారం కోసం)\n\n` +
      `👉 దయచేసి *1*, *2* లేదా *3* అని రిప్లై ఇవ్వండి.\n` +
      `(0️⃣ భాష మార్చడానికి)`,
    ta:
      `நன்றி! Shifter Online உடன் நீங்கள் எவ்வாறு இணைய விரும்புகிறீர்கள்?\n\n` +
      `1️⃣ Customer (வாடிக்கையாளர் - பார்சல் அனுப்ப / வாகனம் புக் செய்ய)\n` +
      `2️⃣ Driver Partner (ஓட்டுநர் - வாகனம் இணைத்து தினசரி வருமானம் ஈட்ட)\n` +
      `3️⃣ Job Seeker (வேலைவாய்ப்பு / தொழில் சார்ந்த விவரங்கள்)\n\n` +
      `👉 தயவுசெய்து *1*, *2* அல்லது *3* என பதிலளிக்கவும்.\n` +
      `(0️⃣ மொழியை மாற்ற)`,
    kn:
      `ಧನ್ಯವಾದಗಳು! Shifter Online ನೊಂದಿಗೆ ನೀವು ಹೇಗೆ ಸಂಪರ್ಕ ಸಾಧಿಸಲು ಬಯಸುತ್ತೀರಿ?\n\n` +
      `1️⃣ Customer (ಗ್ರಾಹಕ - ಸರಕು ಸಾಗಣೆ / ವಾಹನ ಬುಕ್ ಮಾಡಲು)\n` +
      `2️⃣ Driver Partner (ಚಾಲಕ - ವಾಹನ ಜೋಡಿಸಿ ದೈನಂದಿನ ಗಳಿಕೆ ಮಾಡಲು)\n` +
      `3️⃣ Job Seeker (ಉದ್ಯೋಗ / ವೃತ್ತಿ ಮಾಹಿತಿ ಪಡೆಯಲು)\n\n` +
      `👉 ದಯವಿಟ್ಟು *1*, *2* ಅಥವಾ *3* ಎಂದು ಉತ್ತರಿಸಿ.\n` +
      `(0️⃣ ಭಾಷೆ ಬದಲಾಯಿಸಲು)`,
  },

  INVALID_ROLE: {
    hi: `⚠️ अमान्य विकल्प! कृपया केवल *1, 2 या 3* लिखकर भेजें (0 = मुख्य मेन्यू | हेल्पलाइन: ${HELPLINE_NUMBER})`,
    en: `⚠️ Invalid option! Please reply with *1, 2 or 3* (0 = Main Menu | Helpline: ${HELPLINE_NUMBER})`,
    hinglish: `⚠️ Galat option! Kripya sirf *1, 2 ya 3* likhein (0 = Main Menu | Helpline: ${HELPLINE_NUMBER})`,
    mr: `⚠️ अमान्य पर्याय! कृपया फक्त *1, 2 किंवा 3* लिहून पाठवा (0 = मुख्य मेनू | हेल्पलाइन: ${HELPLINE_NUMBER})`,
    gu: `⚠️ અમાન્ય વિકલ્પ! કૃપા કરીને માત્ર *1, 2 અથવા 3* લખો (0 = મુખ્ય મેનુ | હેલ્પલાઇન: ${HELPLINE_NUMBER})`,
    pa: `⚠️ ਅਵੈਧ ਵਿਕਲਪ! ਕਿਰਪਾ ਕਰਕੇ ਸਿਰਫ਼ *1, 2 ਜਾਂ 3* ਲਿਖੋ (0 = ਮੇਨ ਮੈਨੂ | ਹੈਲਪਲਾਈਨ: ${HELPLINE_NUMBER})`,
    bn: `⚠️ অবৈধ বিকল্প! দয়া করে শুধুমাত্র *1, 2 অথবা 3* লিখুন (0 = প্রধান মেনু | হেল্পলাইন: ${HELPLINE_NUMBER})`,
    te: `⚠️ చెల్లని ఎంపిక! దయచేసి *1, 2 లేదా 3* మాత్రమే ఎంచుకోండి (0 = మెయిన్ మెనూ | హెల్ప్‌లైన్: ${HELPLINE_NUMBER})`,
    ta: `⚠️ தவறான தேர்வு! தயவுசெய்து *1, 2 அல்லது 3* மட்டும் அனுப்பவும் (0 = முதன்மை மெனு | உதவி எண்: ${HELPLINE_NUMBER})`,
    kn: `⚠️ ಅಮಾನ್ಯ ಆಯ್ಕೆ! ದಯವಿಟ್ಟು *1, 2 ಅಥವಾ 3* ಮಾತ್ರ ಟೈಪ್ ಮಾಡಿ (0 = ಮುಖ್ಯ ಮೆನು | ಸಹಾಯವಾಣಿ: ${HELPLINE_NUMBER})`,
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
        `👉 कृपया *1, 2, 3, 4 या 0* लिखकर भेजें।`,
      en:
        `📦 *Shifter Online - Customer Support*\n\n` +
        `Please choose an option by replying with a number:\n\n` +
        `1️⃣ Book a Vehicle (Download Customer App)\n` +
        `2️⃣ Track Active Order (Live Location & Status)\n` +
        `3️⃣ Vehicle Rates & Fare Information\n` +
        `4️⃣ Talk to Customer Care (Helpline: ${HELPLINE_NUMBER})\n` +
        `0️⃣ Back to Main Menu\n\n` +
        `👉 Please reply with *1, 2, 3, 4 or 0*.`,
      hinglish:
        `📦 *Shifter Online - Customer Support*\n\n` +
        `Kripya neeche diye gaye options me se number chunein:\n\n` +
        `1️⃣ Gadi Book Karein (Customer App download link)\n` +
        `2️⃣ Live Order Track Karein (Status & Driver details)\n` +
        `3️⃣ Gadiyon ke Rate aur Kiraya Jankari\n` +
        `4️⃣ Customer Care Support (Helpline: ${HELPLINE_NUMBER})\n` +
        `0️⃣ Main Menu par wapas jayein\n\n` +
        `👉 Kripya *1, 2, 3, 4 ya 0* likhkar bhejein.`,
      mr:
        `📦 *Shifter Online - ग्राहक सेवा (Customer Support)*\n\n` +
        `कृपया खालील पर्यायांमधून नंबर निवडा:\n\n` +
        `1️⃣ वाहन बुक करा (Customer App डाउनलोड लिंक)\n` +
        `2️⃣ चालू ऑर्डर ट्रॅक करा (Live Tracking & Status)\n` +
        `3️⃣ वाहनांचे दर आणि भाडे माहिती (Rates & Pricing)\n` +
        `4️⃣ ग्राहक सेवा प्रतिनिधीशी बोला (Helpline: ${HELPLINE_NUMBER})\n` +
        `0️⃣ मुख्य मेनूवर परत जा (Main Menu)\n\n` +
        `👉 कृपया *1, 2, 3, 4 किंवा 0* लिहून पाठवा.`,
      gu:
        `📦 *Shifter Online - ગ્રાહક સેવા (Customer Support)*\n\n` +
        `કૃપા કરીને નીચેના વિકલ્પોમાંથી નંબર પસંદ કરો:\n\n` +
        `1️⃣ વાહન બુક કરો (Customer App ડાઉનલોડ લિંક)\n` +
        `2️⃣ ચાલુ ઓર્ડર ટ્રેક કરો (Live Tracking & Status)\n` +
        `3️⃣ વાહનોના દર અને ભાડાંની માહિતી\n` +
        `4️⃣ કસ્ટમર કેર સાથે વાત કરો (Helpline: ${HELPLINE_NUMBER})\n` +
        `0️⃣ મુખ્ય મેનુ પર પાછા જાઓ\n\n` +
        `👉 કૃપા કરીને *1, 2, 3, 4 અથવા 0* લખીને મોકલો.`,
      pa:
        `📦 *Shifter Online - ਗਾਹਕ ਸੇਵਾ (Customer Support)*\n\n` +
        `ਕਿਰਪਾ ਕਰਕੇ ਹੇਠਾਂ ਦਿੱਤੇ ਵਿਕਲਪਾਂ ਵਿੱਚੋਂ ਨੰਬਰ ਚੁਣੋ:\n\n` +
        `1️⃣ ਗੱਡੀ ਬੁੱਕ ਕਰੋ (Customer App ਡਾਊਨਲੋਡ ਲਿੰਕ)\n` +
        `2️⃣ ਚਾਲੂ ਆਰਡਰ ਟ੍ਰੈਕ ਕਰੋ (Live Tracking & Status)\n` +
        `3️⃣ ਗੱਡੀਆਂ ਦੇ ਰੇਟ ਅਤੇ ਕਿਰਾਏ ਦੀ ਜਾਣਕਾਰੀ\n` +
        `4️⃣ ਕਸਟਮਰ ਕੇਅਰ ਨਾਲ ਗੱਲ ਕਰੋ (Helpline: ${HELPLINE_NUMBER})\n` +
        `0️⃣ ਮੇਨ ਮੈਨੂ 'ਤੇ ਵਾਪਸ ਜਾਓ\n\n` +
        `👉 ਕਿਰਪਾ ਕਰਕੇ *1, 2, 3, 4 ਜਾਂ 0* ਲਿਖ ਕੇ ਭੇਜੋ।`,
      bn:
        `📦 *Shifter Online - গ্রাহক সেবা (Customer Support)*\n\n` +
        `দয়া করে নিচের বিকল্পগুলি থেকে নম্বর নির্বাচন করুন:\n\n` +
        `1️⃣ গাড়ি বুক করুন (Customer App ডাউনলোড লিংক)\n` +
        `2️⃣ অর্ডার ট্র্যাক করুন (Live Tracking & Status)\n` +
        `3️⃣ গাড়ির ভাড়া ও রেট কার্ড তথ্য\n` +
        `4️⃣ কাস্টমার কেয়ারের সাথে কথা বলুন (Helpline: ${HELPLINE_NUMBER})\n` +
        `0️⃣ প্রধান মেনুতে ফিরে যান\n\n` +
        `👉 দয়া করে *1, 2, 3, 4 অথবা 0* লিখে পাঠান।`,
      te:
        `📦 *Shifter Online - కస్టమర్ సేవలు (Customer Support)*\n\n` +
        `దయచేసి క్రింది ఎంపికల నుండి సంఖ్యను ఎంచుకోండి:\n\n` +
        `1️⃣ వాహనం బుక్ చేయండి (Customer App డౌన్‌లోడ్ లింక్)\n` +
        `2️⃣ ఆర్డర్ లైవ్ ట్రాకింగ్ (Live Location & Status)\n` +
        `3️⃣ వాహన ఛార్జీలు మరియు రేట్ల వివరాలు\n` +
        `4️⃣ కస్టమర్ కేర్ సహాయం (Helpline: ${HELPLINE_NUMBER})\n` +
        `0️⃣ మెయిన్ మెనూకి తిరిగి వెళ్లండి\n\n` +
        `👉 దయచేసి *1, 2, 3, 4 లేదా 0* అని పంపండి.`,
      ta:
        `📦 *Shifter Online - வாடிக்கையாளர் சேவை*\n\n` +
        `தயவுசெய்து கீழேயுள்ள விருப்பங்களில் இருந்து எண்ணைத் தேர்ந்தெடுக்கவும்:\n\n` +
        `1️⃣ வாகனம் புக் செய்யுங்கள் (Customer App பதிவிறக்க இணைப்பு)\n` +
        `2️⃣ நடப்பு ஆர்டரை கண்காணிக்க (Live Tracking)\n` +
        `3️⃣ வாகன கட்டண விவரங்கள் (Rates & Pricing)\n` +
        `4️⃣ வாடிக்கையாளர் சேவை மையம் (Helpline: ${HELPLINE_NUMBER})\n` +
        `0️⃣ முதன்மை மெனுவிற்கு செல்ல\n\n` +
        `👉 தயவுசெய்து *1, 2, 3, 4 அல்லது 0* என பதிலளிக்கவும்.`,
      kn:
        `📦 *Shifter Online - ಗ್ರಾಹಕ ಸೇವೆ (Customer Support)*\n\n` +
        `ದಯವಿಟ್ಟು ಕೆಳಗಿನ ಆಯ್ಕೆಗಳಿಂದ ಸಂಖ್ಯೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ:\n\n` +
        `1️⃣ ವಾಹನ ಬುಕ್ ಮಾಡಿ (Customer App ಡೌನ್‌ಲೋಡ್ ಲಿಂಕ್)\n` +
        `2️⃣ ಚಾಲ್ತಿ ಆರ್ಡರ್ ಟ್ರ್ಯಾಕ್ ಮಾಡಿ (Live Tracking)\n` +
        `3️⃣ ವಾಹನ ದರಗಳು ಮತ್ತು ಬಾಡಿಗೆ ಮಾಹಿತಿ\n` +
        `4️⃣ ಗ್ರಾಹಕ ಸೇವಾ ಸಹಾಯವಾಣಿ (Helpline: ${HELPLINE_NUMBER})\n` +
        `0️⃣ ಮುಖ್ಯ ಮೆನುಗೆ ಹಿಂತಿರುಗಿ\n\n` +
        `👉 ದಯವಿಟ್ಟು *1, 2, 3, 4 ಅಥವಾ 0* ಎಂದು ಉತ್ತರಿಸಿ.`,
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
        `👉 कृपया *1, 2, 3, 4 या 0* लिखकर भेजें।`,
      en:
        `🚚 *Shifter Online - Driver Partner Support*\n\n` +
        `Please choose an option by replying with a number:\n\n` +
        `1️⃣ Attach Vehicle (Download Driver Partner App)\n` +
        `2️⃣ Required Documents for Onboarding\n` +
        `3️⃣ Earnings, Commission & Plans\n` +
        `4️⃣ Driver Helpline & Support\n` +
        `0️⃣ Back to Main Menu\n\n` +
        `👉 Please reply with *1, 2, 3, 4 or 0*.`,
      hinglish:
        `🚚 *Shifter Online - Driver Partner Support*\n\n` +
        `Kripya neeche diye gaye options me se number chunein:\n\n` +
        `1️⃣ Gadi Jodein (Driver Partner App download link)\n` +
        `2️⃣ Jaruri Documents (DL, RC, Aadhaar, PAN)\n` +
        `3️⃣ Kamai, Commission aur Plans ki jankari\n` +
        `4️⃣ Driver Helpline Number\n` +
        `0️⃣ Main Menu par wapas jayein\n\n` +
        `👉 Kripya *1, 2, 3, 4 ya 0* likhkar bhejein.`,
      mr:
        `🚚 *Shifter Online - चालक सेवा (Driver Partner)*\n\n` +
        `कृपया खालील पर्यायांमधून नंबर निवडा:\n\n` +
        `1️⃣ वाहन जोडा (Driver App डाउनलोड लिंक)\n` +
        `2️⃣ आवश्यक कागदपत्रे (Required Documents)\n` +
        `3️⃣ कमाई, कमिशन आणि प्लॅन्स\n` +
        `4️⃣ चालक हेल्पलाइन (Driver Support: ${HELPLINE_NUMBER})\n` +
        `0️⃣ मुख्य मेनूवर परत जा\n\n` +
        `👉 कृपया *1, 2, 3, 4 किंवा 0* लिहून पाठवा.`,
      gu:
        `🚚 *Shifter Online - ડ્રાઇવર પાર્ટનર સેવા*\n\n` +
        `કૃપા કરીને નીચેના વિકલ્પોમાંથી નંબર પસંદ કરો:\n\n` +
        `1️⃣ વાહન જોડો (Driver App ડાઉનલોડ લિંક)\n` +
        `2️⃣ જરૂરી દસ્તાવેજો (Required Documents)\n` +
        `3️⃣ કમાણી, કમિશન અને પ્લાન્સની માહિતી\n` +
        `4️⃣ ડ્રાઇવર હેલ્પલાઇન (Driver Support: ${HELPLINE_NUMBER})\n` +
        `0️⃣ મુખ્ય મેનુ પર પાછા જાઓ\n\n` +
        `👉 કૃપા કરીને *1, 2, 3, 4 અથવા 0* લખીને મોકલો.`,
      pa:
        `🚚 *Shifter Online - ਡਰਾਈਵਰ ਪਾਰਟਨਰ ਸੇਵਾ*\n\n` +
        `ਕਿਰਪਾ ਕਰਕੇ ਹੇਠਾਂ ਦਿੱਤੇ ਵਿਕਲਪਾਂ ਵਿੱਚੋਂ ਨੰਬਰ ਚੁਣੋ:\n\n` +
        `1️⃣ ਗੱਡੀ ਜੋੜੋ (Driver App ਡਾਊਨਲੋਡ ਲਿੰਕ)\n` +
        `2️⃣ ਜ਼ਰੂਰੀ ਦਸਤਾਵੇਜ਼ (Required Documents)\n` +
        `3️⃣ ਕਮਾਈ, ਕਮਿਸ਼ਨ ਅਤੇ ਪਲਾਨਾਂ ਦੀ ਜਾਣਕਾਰੀ\n` +
        `4️⃣ ਡਰਾਈਵਰ ਹੈਲਪਲਾਈਨ (Driver Support: ${HELPLINE_NUMBER})\n` +
        `0️⃣ ਮੇਨ ਮੈਨੂ 'ਤੇ ਵਾਪਸ ਜਾਓ\n\n` +
        `👉 ਕਿਰਪਾ ਕਰਕੇ *1, 2, 3, 4 ਜਾਂ 0* ਲਿਖ ਕੇ ਭੇਜੋ।`,
      bn:
        `🚚 *Shifter Online - ড্রাইভার পার্টনার সেবা*\n\n` +
        `দয়া করে নিচের বিকল্পগুলি থেকে নম্বর নির্বাচন করুন:\n\n` +
        `1️⃣ গাড়ি যুক্ত করুন (Driver App ডাউনলোড লিংক)\n` +
        `2️⃣ প্রয়োজনীয় ডকুমেন্টস (Required Documents)\n` +
        `3️⃣ উপার্জন ও সাবস্ক্রিপশন প্ল্যান\n` +
        `4️⃣ ড্রাইভার হেল্পলাইন (Driver Support: ${HELPLINE_NUMBER})\n` +
        `0️⃣ প্রধান মেনুতে ফিরে যান\n\n` +
        `👉 দয়া করে *1, 2, 3, 4 অথবা 0* লিখে পাঠান।`,
      te:
        `🚚 *Shifter Online - డ్రైవర్ భాగస్వామి సేవలు*\n\n` +
        `దయచేసి క్రింది ఎంపికల నుండి సంఖ్యను ఎంచుకోండి:\n\n` +
        `1️⃣ వాహనం జోడించండి (Driver App డౌన్‌లోడ్ లింక్)\n` +
        `2️⃣ అవసరమైన పత్రాలు (Required Documents)\n` +
        `3️⃣ ఆదాయం మరియు ప్లాన్స్ వివరాలు\n` +
        `4️⃣ డ్రైవర్ హెల్ప్‌లైన్ (Driver Support: ${HELPLINE_NUMBER})\n` +
        `0️⃣ మెయిన్ మెనూకి తిరిగి వెళ్లండి\n\n` +
        `👉 దయచేసి *1, 2, 3, 4 లేదా 0* అని పంపండి.`,
      ta:
        `🚚 *Shifter Online - ஓட்டுநர் சேவை*\n\n` +
        `தயவுசெய்து கீழேயுள்ள விருப்பங்களில் இருந்து எண்ணைத் தேர்ந்தெடுக்கவும்:\n\n` +
        `1️⃣ வாகனம் இணைக்கவும் (Driver App பதிவிறக்க இணைப்பு)\n` +
        `2️⃣ தேவையான ஆவணங்கள் (Required Documents)\n` +
        `3️⃣ வருமானம் மற்றும் திட்டங்கள்\n` +
        `4️⃣ ஓட்டுநர் உதவி எண் (Driver Support: ${HELPLINE_NUMBER})\n` +
        `0️⃣ முதன்மை மெனுவிற்கு செல்ல\n\n` +
        `👉 தயவுசெய்து *1, 2, 3, 4 அல்லது 0* என பதிலளிக்கவும்.`,
      kn:
        `🚚 *Shifter Online - ಚಾಲಕ ಸೇವೆ (Driver Partner)*\n\n` +
        `ದಯವಿಟ್ಟು ಕೆಳಗಿನ ಆಯ್ಕೆಗಳಿಂದ ಸಂಖ್ಯೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ:\n\n` +
        `1️⃣ ವಾಹನ ಜೋಡಿಸಿ (Driver App ಡೌನ್‌ಲೋಡ್ ಲಿಂಕ್)\n` +
        `2️⃣ ಅಗತ್ಯ ದಾಖಲೆಗಳು (Required Documents)\n` +
        `3️⃣ ಗಳಿಕೆ ಮತ್ತು ಯೋಜನೆಗಳ ಮಾಹಿತಿ\n` +
        `4️⃣ ಚಾಲಕ ಸಹಾಯವಾಣಿ (Driver Support: ${HELPLINE_NUMBER})\n` +
        `0️⃣ ಮುಖ್ಯ ಮೆನುಗೆ ಹಿಂತಿರುಗಿ\n\n` +
        `👉 ದಯವಿಟ್ಟು *1, 2, 3, 4 ಅಥವಾ 0* ಎಂದು ಉತ್ತರಿಸಿ.`,
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
        `👉 कृपया *1, 2, 3, 4 या 0* लिखकर भेजें।`,
      en:
        `💼 *Shifter Online - Careers & Job Inquiries*\n\n` +
        `Please choose an option by replying with a number:\n\n` +
        `1️⃣ Current Job Openings & Vacancies\n` +
        `2️⃣ How to Apply (Submit Resume / CV)\n` +
        `3️⃣ Office Address & Interview Timing\n` +
        `4️⃣ HR Department Contact Helpline\n` +
        `0️⃣ Back to Main Menu\n\n` +
        `👉 Please reply with *1, 2, 3, 4 or 0*.`,
      hinglish:
        `💼 *Shifter Online - Careers & Job Inquiries*\n\n` +
        `Kripya neeche diye gaye options me se number chunein:\n\n` +
        `1️⃣ Current Open Jobs & Vacancies\n` +
        `2️⃣ Apply Kaise Karein (Resume / CV send karein)\n` +
        `3️⃣ Office Address aur Interview Timings\n` +
        `4️⃣ HR Contact Details & Helpline\n` +
        `0️⃣ Main Menu par wapas jayein\n\n` +
        `👉 Kripya *1, 2, 3, 4 ya 0* likhkar bhejein.`,
      mr:
        `💼 *Shifter Online - करिअर व नोकरी सहायता*\n\n` +
        `कृपया खालील पर्यायांमधून नंबर निवडा:\n\n` +
        `1️⃣ चालू नोकऱ्या (Current Job Openings)\n` +
        `2️⃣ अर्ज कसा करावा (Resume पाठवा: ${CAREERS_EMAIL})\n` +
        `3️⃣ कार्यालयाचा पत्ता आणि मुलाखतीची वेळ\n` +
        `4️⃣ एचआर संपर्क सूत्र (HR Helpline: ${HELPLINE_NUMBER})\n` +
        `0️⃣ मुख्य मेनूवर परत जा\n\n` +
        `👉 कृपया *1, 2, 3, 4 किंवा 0* लिहून पाठवा.`,
      gu:
        `💼 *Shifter Online - કારકિર્દી અને નોકરી સહાય*\n\n` +
        `કૃપા કરીને નીચેના વિકલ્પોમાંથી નંબર પસંદ કરો:\n\n` +
        `1️⃣ ચાલુ નોકરીઓની માહિતી (Job Openings)\n` +
        `2️⃣ અરજી કેવી રીતે કરવી (Resume મોકલો: ${CAREERS_EMAIL})\n` +
        `3️⃣ ઓફિસનું સરનામું અને સમય\n` +
        `4️⃣ એચઆર હેલ્પલાઇન (HR Helpline: ${HELPLINE_NUMBER})\n` +
        `0️⃣ મુખ્ય મેનુ પર પાછા જાઓ\n\n` +
        `👉 કૃપા કરીને *1, 2, 3, 4 અથવા 0* લખીને મોકલો.`,
      pa:
        `💼 *Shifter Online - ਕਰੀਅਰ ਅਤੇ ਨੌਕਰੀ ਸਹਾਇਤਾ*\n\n` +
        `ਕਿਰਪਾ ਕਰਕੇ ਹੇਠਾਂ ਦਿੱਤੇ ਵਿਕਲਪਾਂ ਵਿੱਚੋਂ ਨੰਬਰ ਚੁਣੋ:\n\n` +
        `1️⃣ ਮੌਜੂਦਾ ਨੌਕਰੀਆਂ (Current Job Openings)\n` +
        `2️⃣ ਅਪਲਾਈ ਕਿਵੇਂ ਕਰੀਏ (Resume ਭੇਜੋ: ${CAREERS_EMAIL})\n` +
        `3️⃣ ਦਫ਼ਤਰ ਦਾ ਪਤਾ ਅਤੇ ਇੰਟਰਵਿਊ ਦਾ ਸਮਾਂ\n` +
        `4️⃣ ਐਚਆਰ ਹੈਲਪਲਾਈਨ (HR Helpline: ${HELPLINE_NUMBER})\n` +
        `0️⃣ ਮੇਨ ਮੈਨੂ 'ਤੇ ਵਾਪਸ ਜਾਓ\n\n` +
        `👉 ਕਿਰਪਾ ਕਰਕੇ *1, 2, 3, 4 ਜਾਂ 0* ਲਿਖ ਕੇ ਭੇਜੋ।`,
      bn:
        `💼 *Shifter Online - ক্যারিয়ার ও চাকরি সহায়তা*\n\n` +
        `দয়া করে নিচের বিকল্পগুলি থেকে নম্বর নির্বাচন করুন:\n\n` +
        `1️⃣ বর্তমান চাকরির সুযোগ (Job Openings)\n` +
        `2️⃣ আবেদন করার নিয়ম (Resume পাঠান: ${CAREERS_EMAIL})\n` +
        `3️⃣ অফিসের ঠিকানা ও সাক্ষাৎকারের সময়সূচি\n` +
        `4️⃣ এইচআর হেল্পলাইন (HR Helpline: ${HELPLINE_NUMBER})\n` +
        `0️⃣ প্রধান মেনুতে ফিরে যান\n\n` +
        `👉 দয়া করে *1, 2, 3, 4 অথবা 0* লিখে পাঠান।`,
      te:
        `💼 *Shifter Online - కెరీర్ & ఉద్యోగ సమాచారం*\n\n` +
        `దయచేసి క్రింది ఎంపికల నుండి సంఖ్యను ఎంచుకోండి:\n\n` +
        `1️⃣ ప్రస్తుత ఉద్యోగావకాశాలు (Job Openings)\n` +
        `2️⃣ దరఖాస్తు ఎలా చేయాలి (Resume పంపండి: ${CAREERS_EMAIL})\n` +
        `3️⃣ ఆఫీస్ చిరునామా మరియు ఇంటర్వ్యూ వేళలు\n` +
        `4️⃣ హెచ్‌ఆర్ హెల్ప్‌లైన్ (HR Helpline: ${HELPLINE_NUMBER})\n` +
        `0️⃣ మెయిన్ మెనూకి తిరిగి వెళ్లండి\n\n` +
        `👉 దయచేసి *1, 2, 3, 4 లేదా 0* అని పంపండి.`,
      ta:
        `💼 *Shifter Online - வேலைவாய்ப்பு விவரங்கள்*\n\n` +
        `தயவுசெய்து கீழேயுள்ள விருப்பங்களில் இருந்து எண்ணைத் தேர்ந்தெடுக்கவும்:\n\n` +
        `1️⃣ நடப்பு காலியிடங்கள் (Job Openings)\n` +
        `2️⃣ விண்ணப்பிக்கும் முறை (Resume அனுப்பவும்: ${CAREERS_EMAIL})\n` +
        `3️⃣ அலுவலக முகவரி மற்றும் நேர்காணல் நேரம்\n` +
        `4️⃣ எச்.ஆர் உதவி எண் (HR Helpline: ${HELPLINE_NUMBER})\n` +
        `0️⃣ முதன்மை மெனுவிற்கு செல்ல\n\n` +
        `👉 தயவுசெய்து *1, 2, 3, 4 அல்லது 0* என பதிலளிக்கவும்.`,
      kn:
        `💼 *Shifter Online - ಉದ್ಯೋಗ ಮಾಹಿತಿ*\n\n` +
        `ದಯವಿಟ್ಟು ಕೆಳಗಿನ ಆಯ್ಕೆಗಳಿಂದ ಸಂಖ್ಯೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ:\n\n` +
        `1️⃣ ಪ್ರಸ್ತುತ ಉದ್ಯೋಗಾವಕಾಶಗಳು (Job Openings)\n` +
        `2️⃣ ಅರ್ಜಿ ಸಲ್ಲಿಸುವುದು ಹೇಗೆ (Resume ಕಳುಹಿಸಿ: ${CAREERS_EMAIL})\n` +
        `3️⃣ ಕಚೇರಿ ವಿಳಾಸ ಮತ್ತು ಸಂದರ್ಶನದ ಸಮಯ\n` +
        `4️⃣ ಹೆಚ್‌ಆರ್ ಸಹಾಯವಾಣಿ (HR Helpline: ${HELPLINE_NUMBER})\n` +
        `0️⃣ ಮುಖ್ಯ ಮೆನುಗೆ ಹಿಂತಿರುಗಿ\n\n` +
        `👉 ದಯವಿಟ್ಟು *1, 2, 3, 4 ಅಥವಾ 0* ಎಂದು ಉತ್ತರಿಸಿ.`,
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
        mr:
          `📦 *वाहन बुक करण्यासाठी Customer App डाउनलोड करा*\n\n` +
          `Shifter Online वर डिलिव्हरी बुकिंग अधिकृत ॲपद्वारे होते, जिथे त्वरित थेट भाडे आणि जवळचा चालक मिळतो.\n\n` +
          `📲 *Customer App डाउनलोड लिंक*:\n👉 ${CUSTOMER_APP_URL}\n\n` +
          `📞 हेल्पलाइन: ${HELPLINE_NUMBER}\n\n` +
          `_(इतर पर्यायांसाठी नंबर निवडा किंवा '0' लिहून मुख्य मेनूवर जा)_`,
        gu:
          `📦 *વાહન બુક કરવા માટે Customer App ડાઉનલોડ કરો*\n\n` +
          `Shifter Online પર બુકિંગ અમારી એપ દ્વારા થાય છે, જ્યાં લાઇવ ભાડું અને નજીકનો ડ્રાઇવર મળે છે.\n\n` +
          `📲 *Customer App ડાઉનલોડ લિંક*:\n👉 ${CUSTOMER_APP_URL}\n\n` +
          `📞 સહાય: ${HELPLINE_NUMBER}\n\n` +
          `_(બીજા વિકલ્પ માટે નંબર લખો અથવા '0' લખીને મુખ્ય મેનુ પર જાઓ)_`,
        pa:
          `📦 *ਗੱਡੀ ਬੁੱਕ ਕਰਨ ਲਈ Customer App ਡਾਊਨਲੋਡ ਕਰੋ*\n\n` +
          `Shifter Online 'ਤੇ ਡਿਲੀਵਰੀ ਬੁਕਿੰਗ ਸਾਡੀ ਆਫੀਸ਼ੀਅਲ ਐਪ ਰਾਹੀਂ ਹੁੰਦੀ ਹੈ ਜਿੱਥੇ ਲਾਈਵ ਕਿਰਾਇਆ ਅਤੇ ਨੇੜਲਾ ਡਰਾਈਵਰ ਮਿਲਦਾ ਹੈ।\n\n` +
          `📲 *Customer App ਡਾਊਨਲੋਡ ਲਿੰਕ*:\n👉 ${CUSTOMER_APP_URL}\n\n` +
          `📞 ਹੈਲਪਲਾਈਨ: ${HELPLINE_NUMBER}\n\n` +
          `_(ਹੋਰ ਵਿਕਲਪ ਲਈ ਨੰਬਰ ਲਿਖੋ ਜਾਂ '0' ਲਿਖ ਕੇ ਮੇਨ ਮੈਨੂ 'ਤੇ ਜਾਓ)_`,
        bn:
          `📦 *গাড়ি বুক করার জন্য Customer App ডাউনলোড করুন*\n\n` +
          `Shifter Online-এ বুকিং অফিসিয়াল অ্যাপের মাধ্যমে হয়, যেখানে সরাসরি লাইভ ভাড়া ও নিকটস্থ ড্রাইভার পাওয়া যায়।\n\n` +
          `📲 *Customer App ডাউনলোড লিংক*:\n👉 ${CUSTOMER_APP_URL}\n\n` +
          `📞 সহায়তা: ${HELPLINE_NUMBER}\n\n` +
          `_(অন্য বিকল্পের জন্য নম্বর লিখুন বা '0' লিখে প্রধান মেনুতে যান)_`,
        te:
          `📦 *వాహనం బుక్ చేయడానికి Customer App డౌన్‌లోడ్ చేయండి*\n\n` +
          `Shifter Online లో బుకింగ్ మా అఫీషియల్ యాప్ ద్వారా జరుగుతుంది, లైవ్ ఛార్జీలు మరియు సమీప డ్రైవర్ తక్షణమే లభిస్తారు.\n\n` +
          `📲 *Customer App డౌన్‌లోడ్ లింక్*:\n👉 ${CUSTOMER_APP_URL}\n\n` +
          `📞 సహాయం: ${HELPLINE_NUMBER}\n\n` +
          `_(ఇతర ఆప్షన్ కోసం నంబర్ ఎంచుకోండి లేదా '0' టైప్ చేసి మెయిన్ మెనూకి వెళ్లండి)_`,
        ta:
          `📦 *வாகனம் புக் செய்ய Customer App பதிவிறக்கவும்*\n\n` +
          `Shifter Online-ல் அனைத்து முன்பதிவுகளும் அதிகாரப்பூர்வ ஆப் வழியாக நடக்கிறது. உடனடி கட்டண விவரங்கள் கிடைக்கும்.\n\n` +
          `📲 *Customer App பதிவிறக்க இணைப்பு*:\n👉 ${CUSTOMER_APP_URL}\n\n` +
          `📞 உதவி எண்: ${HELPLINE_NUMBER}\n\n` +
          `_(வேறு விருப்பத்திற்கு எண் அனுப்பவும் அல்லது '0' அனுப்பி முதன்மை மெனுவுக்கு செல்லவும்)_`,
        kn:
          `📦 *ವಾಹನ ಬುಕ್ ಮಾಡಲು Customer App ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ*\n\n` +
          `Shifter Online ನಲ್ಲಿ ಬುಕಿಂಗ್ ಅಧಿಕೃತ ಆ್ಯಪ್ ಮೂಲಕ ನಡೆಯುತ್ತದೆ. ಲೈವ್ ದರ ಮತ್ತು ಹತ್ತಿರದ ಚಾಲಕ ತಕ್ಷಣ ಸಿಗುತ್ತಾರೆ.\n\n` +
          `📲 *Customer App ಡೌನ್‌ಲೋಡ್ ಲಿಂಕ್*:\n👉 ${CUSTOMER_APP_URL}\n\n` +
          `📞 ಸಹಾಯವಾಣಿ: ${HELPLINE_NUMBER}\n\n` +
          `_(ಇತರ ಆಯ್ಕೆಗಳಿಗೆ ಸಂಖ್ಯೆ ನಮೂದಿಸಿ ಅಥವಾ '0' ಕಳುಹಿಸಿ ಮುಖ್ಯ ಮೆನುಗೆ ಹೋಗಿ)_`,
      },
      "2_PROMPT": {
        hi: `📦 कृपया अपना Order ID नंबर लिखकर भेजें (उदाहरण: *244*):\n\n(वापस जाने के लिए '0' लिखें)`,
        en: `📦 Please reply with your Order ID number (e.g. *244*):\n\n(Reply '0' to go back)`,
        hinglish: `📦 Kripya apna Order ID number likhkar bhejein (jaise: *244*):\n\n(Wapas jane ke liye '0' likhein)`,
        mr: `📦 कृपया आपला Order ID नंबर लिहून पाठवा (उदा: *244*):\n\n(परत जाण्यासाठी '0' लिहा)`,
        gu: `📦 કૃપા કરીને તમારો Order ID નંબર લખીને મોકલો (દા.ત: *244*):\n\n(પાછા જવા માટે '0' લખો)`,
        pa: `📦 ਕਿਰਪਾ ਕਰਕੇ ਆਪਣਾ Order ID ਨੰਬਰ ਲਿਖ ਕੇ ਭੇਜੋ (ਉਦਾਹਰਣ: *244*):\n\n(ਵਾਪਸ ਜਾਣ ਲਈ '0' ਲਿਖੋ)`,
        bn: `📦 দয়া করে আপনার Order ID নম্বর লিখে পাঠান (যেমন: *244*):\n\n(ফিরে যেতে '0' লিখুন)`,
        te: `📦 దయచేసి మీ Order ID సంఖ్యను పంపండి (ఉదాహరణ: *244*):\n\n(వెనక్కి వెళ్ళడానికి '0' రాయండి)`,
        ta: `📦 தயவுசெய்து உங்கள் Order ID எண்ணை அனுப்பவும் (எ.கா: *244*):\n\n(திரும்ப செல்ல '0' என அனுப்பவும்)`,
        kn: `📦 ದಯವಿಟ್ಟು ನಿಮ್ಮ Order ID ಸಂಖ್ಯೆಯನ್ನು ಕಳುಹಿಸಿ (ಉದಾ: *244*):\n\n(ಹಿಂದೆ ಹೋಗಲು '0' ಕಳುಹಿಸಿ)`,
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
        mr:
          `🚚 *Shifter Online - वाहने व भाडे दर*\n\n` +
          `सर्व प्रकारच्या मालासाठी वाहने उपलब्ध आहेत:\n` +
          `🛵 *2-Wheeler (Bike)*: छोटी पार्सल्स आणि कागदपत्रे\n` +
          `🛺 *3-Wheeler / E-Loader*: मध्यम माल आणि खोके (किफायतशीर)\n` +
          `🚛 *Tata Ace (छोटा हत्ती)*: जड माल व व्यावसायिक वाहतूक\n` +
          `🚚 *Pickup 8ft / Bolero*: फर्निचर आणि मोठी शिफ्टिंग\n\n` +
          `💡 अचूक भाडे पाहण्यासाठी Customer App डाउनलोड करा:\n👉 ${CUSTOMER_APP_URL}\n\n` +
          `📞 मदत: ${HELPLINE_NUMBER}`,
        gu:
          `🚚 *Shifter Online - વાહનો અને ભાડાના દર*\n\n` +
          `દરેક પ્રકારના સામાન માટે વાહનો ઉપલબ્ધ છે:\n` +
          `🛵 *2-Wheeler (Bike)*: નાના પાર્સલ અને દસ્તાવેજો માટે\n` +
          `🛺 *3-Wheeler / E-Loader*: મધ્યમ સામાન અને બોક્સ માટે\n` +
          `🚛 *Tata Ace (છોટા હાથી)*: ભારે સામાન અને શિફ્ટિંગ માટે\n` +
          `🚚 *Pickup 8ft / Bolero*: મોટા ફર્નિચર અને લોડિંગ માટે\n\n` +
          `💡 સચોટ ભાડું જોવા માટે Customer App ડાઉનલોડ કરો:\n👉 ${CUSTOMER_APP_URL}\n\n` +
          `📞 હેલ્પલાઇન: ${HELPLINE_NUMBER}`,
        pa:
          `🚚 *Shifter Online - ਵਾਹਨ ਅਤੇ ਕਿਰਾਏ ਦੇ ਰੇਟ*\n\n` +
          `ਹਰ ਤਰ੍ਹਾਂ ਦੇ ਸਮਾਨ ਲਈ ਵਾਹਨ ਉਪਲਬਧ ਹਨ:\n` +
          `🛵 *2-Wheeler (Bike)*: ਛੋਟੇ ਪਾਰਸਲ ਅਤੇ ਕਾਗਜ਼ਾਤ\n` +
          `🛺 *3-Wheeler / E-Loader*: ਦਰਮਿਆਨਾ ਸਮਾਨ ਅਤੇ ਡੱਬੇ\n` +
          `🚛 *Tata Ace (ਛੋਟਾ ਹਾਥੀ)*: ਭਾਰੀ ਸਮਾਨ ਅਤੇ ਕਮਰਸ਼ੀਅਲ ਲੋਡਿੰਗ\n` +
          `🚚 *Pickup 8ft / Bolero*: ਫਰਨੀਚਰ ਅਤੇ ਵੱਡੀ ਸ਼ਿਫਟਿੰਗ\n\n` +
          `💡 ਸਹੀ ਰੇਟ ਦੇਖਣ ਲਈ App ਡਾਊਨਲੋਡ ਕਰੋ:\n👉 ${CUSTOMER_APP_URL}\n\n` +
          `📞 ਹੈਲਪਲਾਈਨ: ${HELPLINE_NUMBER}`,
        bn:
          `🚚 *Shifter Online - গাড়ির তালিকা ও ভাড়া*\n\n` +
          `সব ধরনের মালামালের জন্য গাড়ি উপলব্ধ:\n` +
          `🛵 *2-Wheeler (Bike)*: ছোট পার্সেল ও নথিপত্র\n` +
          `🛺 *3-Wheeler / E-Loader*: মাঝারি সাইজের পার্সেল\n` +
          `🚛 *Tata Ace (ছোট হাতি)*: ভারী মালামাল ও পণ্য\n` +
          `🚚 *Pickup 8ft / Bolero*: ফার্নিচার ও বড় শিফটিং\n\n` +
          `💡 সঠিক ভাড়া দেখতে Customer App ডাউনলোড করুন:\n👉 ${CUSTOMER_APP_URL}\n\n` +
          `📞 সহায়তা: ${HELPLINE_NUMBER}`,
        te:
          `🚚 *Shifter Online - వాహన శ్రేణి & ఛార్జీలు*\n\n` +
          `అన్ని రకాల వస్తువుల రవాణాకు వాహనాలు సిద్ధంగా ఉన్నాయి:\n` +
          `🛵 *2-Wheeler (Bike)*: చిన్న పార్సిల్స్ మరియు డాక్యుమెంట్స్\n` +
          `🛺 *3-Wheeler / E-Loader*: మధ్య తరహా సరుకులు\n` +
          `🚛 *Tata Ace (ఛోటా హాథీ)*: భారీ వస్తువులు & లోడింగ్\n` +
          `🚚 *Pickup 8ft / Bolero*: ఫర్నిచర్ & పెద్ద షిఫ్టింగ్\n\n` +
          `💡 లైవ్ రేట్లు తెలుసుకోవడానికి Customer App డౌన్‌లోడ్ చేయండి:\n👉 ${CUSTOMER_APP_URL}\n\n` +
          `📞 హెల్ప్‌లైన్: ${HELPLINE_NUMBER}`,
        ta:
          `🚚 *Shifter Online - வாகன வகைகள் & கட்டணங்கள்*\n\n` +
          `அனைத்து டெலிವರಿ தேவைகளுக்கும் வாகனங்கள்:\n` +
          `🛵 *2-Wheeler (Bike)*: சிறிய பார்சல்கள் மற்றும் ஆவணங்கள்\n` +
          `🛺 *3-Wheeler / E-Loader*: நடுத்தர அளவிலான பொருட்கள்\n` +
          `🚛 *Tata Ace (சோட்டா ஹாதி)*: அதிக எடையுள்ள சரக்குகள்\n` +
          `🚚 *Pickup 8ft / Bolero*: தளவாடங்கள் மற்றும் பெரிய ஷிஃப்டிங்\n\n` +
          `💡 உடனடி கட்டணம் பார்க்க Customer App பதிவிறக்கவும்:\n👉 ${CUSTOMER_APP_URL}\n\n` +
          `📞 உதவி எண்: ${HELPLINE_NUMBER}`,
        kn:
          `🚚 *Shifter Online - ವಾಹನಗಳು ಮತ್ತು ಬಾಡಿಗೆ ದರಗಳು*\n\n` +
          `ಎಲ್ಲಾ ರೀತಿಯ ಸರಕುಗಳಿಗೆ ವಾಹನಗಳು ಲಭ್ಯವಿದೆ:\n` +
          `🛵 *2-Wheeler (Bike)*: ಸಣ್ಣ ಪಾರ್ಸಲ್‌ಗಳು ಮತ್ತು ದಾಖಲೆಗಳು\n` +
          `🛺 *3-Wheeler / E-Loader*: ಮಧ್ಯಮ ಗಾತ್ರದ ಸರಕುಗಳು\n` +
          `🚛 *Tata Ace (ಛೋಟಾ ಹಾಥಿ)*: ಭಾರವಾದ ಸಾಮಾನುಗಳು ಮತ್ತು ಲೋಡಿಂಗ್\n` +
          `🚚 *Pickup 8ft / Bolero*: ಪೀಠೋಪಕರಣಗಳು ಮತ್ತು ದೊಡ್ಡ ಶಿಫ್ಟಿಂಗ್\n\n` +
          `💡 ನಿಖರ ದರ ತಿಳಿಯಲು App ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ:\n👉 ${CUSTOMER_APP_URL}\n\n` +
          `📞 ಸಹಾಯವಾಣಿ: ${HELPLINE_NUMBER}`,
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
        mr:
          `📞 *Shifter Online - ग्राहक सेवा मदत*\n\n` +
          `आमच्या सपोर्ट टीमशी थेट संपर्क साधा:\n` +
          `📱 *हेल्पलाइन*: ${HELPLINE_NUMBER}\n` +
          `📧 *ईमेल*: ${SUPPORT_EMAIL}\n` +
          `🌐 *वेबसाइट*: https://shifteronline.com\n` +
          `🏢 *कंपनी*: Movigo Logistic Aggregator Private Limited`,
        gu:
          `📞 *Shifter Online - કસ્ટમર કેર સપોર્ટ*\n\n` +
          `અમારી ટીમ સાથે સીધો સંપર્ક કરો:\n` +
          `📱 *હેલ્પલાઇન*: ${HELPLINE_NUMBER}\n` +
          `📧 *ઈમેલ*: ${SUPPORT_EMAIL}\n` +
          `🌐 *વેબસાઇટ*: https://shifteronline.com\n` +
          `🏢 *કંપની*: Movigo Logistic Aggregator Private Limited`,
        pa:
          `📞 *Shifter Online - ਗਾਹਕ ਸੇਵਾ ਹੈਲਪਲਾਈਨ*\n\n` +
          `ਸਾਡੀ ਸਹਾਇਤਾ ਟੀਮ ਨਾਲ ਸਿੱਧਾ ਸੰਪਰਕ ਕਰੋ:\n` +
          `📱 *ਫੋਨ*: ${HELPLINE_NUMBER}\n` +
          `📧 *ਈਮੇਲ*: ${SUPPORT_EMAIL}\n` +
          `🌐 *ਵੈੱਬਸਾਈਟ*: https://shifteronline.com\n` +
          `🏢 *ਕੰਪਨੀ*: Movigo Logistic Aggregator Private Limited`,
        bn:
          `📞 *Shifter Online - কাস্টমার কেয়ার হেল্পলাইন*\n\n` +
          `আমাদের সাপোর্ট টিমের সাথে সরাসরি যোগাযোগ করুন:\n` +
          `📱 *ফোন*: ${HELPLINE_NUMBER}\n` +
          `📧 *ইমেল*: ${SUPPORT_EMAIL}\n` +
          `🌐 *ওয়েবসাইট*: https://shifteronline.com\n` +
          `🏢 *কোম্পানি*: Movigo Logistic Aggregator Private Limited`,
        te:
          `📞 *Shifter Online - కస్టమర్ కేర్ హెల్ప్‌లైన్*\n\n` +
          `మా సపోర్ట్ టీమ్‌తో నేరుగా మాట్లాడండి:\n` +
          `📱 *ఫోన్*: ${HELPLINE_NUMBER}\n` +
          `📧 *ఈమెయిల్*: ${SUPPORT_EMAIL}\n` +
          `🌐 *వెబ్‌సైట్*: https://shifteronline.com\n` +
          `🏢 *సంస్థ*: Movigo Logistic Aggregator Private Limited`,
        ta:
          `📞 *Shifter Online - வாடிக்கையாளர் சேவை உதவி எண்*\n\n` +
          `எங்கள் உதவி மையத்தை நேரடியாக தொடர்பு கொள்ளவும்:\n` +
          `📱 *தொலைபேசி*: ${HELPLINE_NUMBER}\n` +
          `📧 *மின்னஞ்சல்*: ${SUPPORT_EMAIL}\n` +
          `🌐 *இணையதளம்*: https://shifteronline.com\n` +
          `🏢 *நிறுவனம்*: Movigo Logistic Aggregator Private Limited`,
        kn:
          `📞 *Shifter Online - ಗ್ರಾಹಕ ಸೇವಾ ಸಹಾಯವಾಣಿ*\n\n` +
          `ನಮ್ಮ ತಂಡದೊಂದಿಗೆ ನೇರವಾಗಿ ಸಂಪರ್ಕದಲ್ಲಿರಿ:\n` +
          `📱 *ದೂರವಾಣಿ*: ${HELPLINE_NUMBER}\n` +
          `📧 *ಇಮೇಲ್*: ${SUPPORT_EMAIL}\n` +
          `🌐 *ವೆಬ್‌ಸೈಟ್*: https://shifteronline.com\n` +
          `🏢 *ಕಂಪನಿ*: Movigo Logistic Aggregator Private Limited`,
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
        mr:
          `🚚 *Shifter Online मध्ये वाहन जोडा आणि दररोज कमवा*\n\n` +
          `आपले वाहन (Bike, 3-Wheeler, Tata Ace, Pickup) जोडून आजच कमाई सुरू करा.\n\n` +
          `📲 *Driver Partner App डाउनलोड लिंक*:\n👉 ${DRIVER_APP_URL}\n\n` +
          `✅ ५ मिनिटांत सोपी नोंदणी\n` +
          `✅ थेट बँक / UPI मध्ये दररोज पेमेंट\n\n` +
          `📞 चालक मदत: ${HELPLINE_NUMBER}`,
        gu:
          `🚚 *Shifter Online માં વાહન જોડો અને રોજેરોજ કમાઓ*\n\n` +
          `તમારું વાહન જોડીને આજે જ ઓર્ડર મેળવવાનું શરૂ કરો.\n\n` +
          `📲 *Driver Partner App ડાઉનલોડ લિંક*:\n👉 ${DRIVER_APP_URL}\n\n` +
          `✅ 5 મિનિટમાં સરળ રજીસ્ટ્રેશન\n` +
          `✅ રોજ સીધું બેંક/UPI પેમેન્ટ\n\n` +
          `📞 ડ્રાઇવર સહાય: ${HELPLINE_NUMBER}`,
        pa:
          `🚚 *Shifter Online ਵਿੱਚ ਗੱਡੀ ਜੋੜੋ ਅਤੇ ਰੋਜ਼ਾਨਾ ਕਮਾਓ*\n\n` +
          `ਆਪਣੀ ਗੱਡੀ ਜੋੜ ਕੇ ਅੱਜ ਹੀ ਆਰਡਰ ਪ੍ਰਾਪਤ ਕਰਨਾ ਸ਼ੁਰੂ ਕਰੋ।\n\n` +
          `📲 *Driver Partner App ਡਾਊਨਲੋਡ ਲਿੰਕ*:\n👉 ${DRIVER_APP_URL}\n\n` +
          `✅ 5 ਮਿੰਟ ਵਿੱਚ ਆਸਾਨ ਰਜਿਸਟ੍ਰੇਸ਼ਨ\n` +
          `✅ ਰੋਜ਼ਾਨਾ ਸਿੱਧਾ ਬੈਂਕ/UPI ਪੇਮੈਂਟ\n\n` +
          `📞 ਡਰਾਈਵਰ ਹੈਲਪਲਾਈਨ: ${HELPLINE_NUMBER}`,
        bn:
          `🚚 *Shifter Online-এ গাড়ি যুক্ত করুন এবং প্রতিদিন উপার্জন করুন*\n\n` +
          `আপনার গাড়ি যুক্ত করে আজই ট্রিপ শুরু করুন।\n\n` +
          `📲 *Driver Partner App ডাউনলোড লিংক*:\n👉 ${DRIVER_APP_URL}\n\n` +
          `✅ ৫ মিনিটে সহজ রেজিস্ট্রেশন\n` +
          `✅ প্রতিদিন সরাসরি ব্যাংক/UPI পেমেন্ট\n\n` +
          `📞 ড্রাইভার সহায়তা: ${HELPLINE_NUMBER}`,
        te:
          `🚚 *Shifter Online లో మీ వాహనాన్ని జతచేసి రోజూ సంపాదించండి*\n\n` +
          `మీ వాహనాన్ని జోడించి ఈరోజే ట్రిప్పులు ప్రారంభించండి.\n\n` +
          `📲 *Driver Partner App డౌన్‌లోడ్ లింక్*:\n👉 ${DRIVER_APP_URL}\n\n` +
          `✅ 5 నిమిషాల్లో సులభమైన రిజిస్ట్రేషన్\n` +
          `✅ రోజూ నేరుగా బ్యాంక్/UPI చెల్లింపులు\n\n` +
          `📞 డ్రైవర్ హెల్ప్‌లైన్: ${HELPLINE_NUMBER}`,
        ta:
          `🚚 *Shifter Online-ல் வாகனம் இணைத்து தினசரி சம்பாதியுங்கள்*\n\n` +
          `உங்கள் வாகனத்தை இணைத்து இன்றே ஆர்டர்களை பெறத் தொடங்குங்கள்.\n\n` +
          `📲 *Driver Partner App பதிவிறக்க இணைப்பு*:\n👉 ${DRIVER_APP_URL}\n\n` +
          `✅ 5 நிமிடங்களில் எளிய பதிவு\n` +
          `✅ தினசரி நேரடி வங்கி/UPI வருமானம்\n\n` +
          `📞 ஓட்டுநர் உதவி எண்: ${HELPLINE_NUMBER}`,
        kn:
          `🚚 *Shifter Online ನಲ್ಲಿ ವಾಹನ ಜೋಡಿಸಿ ದೈನಂದಿನ ಗಳಿಕೆ ಮಾಡಿ*\n\n` +
          `ನಿಮ್ಮ ವಾಹನವನ್ನು ಜೋಡಿಸಿ ಇಂದೇ ಆರ್ಡರ್ ಸ್ವೀಕರಿಸಲು ಪ್ರಾರಂಭಿಸಿ.\n\n` +
          `📲 *Driver Partner App ಡೌನ್‌ಲೋಡ್ ಲಿಂಕ್*:\n👉 ${DRIVER_APP_URL}\n\n` +
          `✅ 5 ನಿಮಿಷಗಳಲ್ಲಿ ಸುಲಭ ನೋಂದಣಿ\n` +
          `✅ ದೈನಂದಿನ ನೇರ ಬ್ಯಾಂಕ್/UPI ಪಾವತಿ\n\n` +
          `📞 ಚಾಲಕ ಸಹಾಯವಾಣಿ: ${HELPLINE_NUMBER}`,
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
        mr:
          `📋 *चालक ऑनबोर्डिंगसाठी आवश्यक कागदपत्रे*\n\n` +
          `1️⃣ ड्रायव्हिंग लायસन्स (DL)\n` +
          `2️⃣ वाहन आरसी (RC Book)\n` +
          `3️⃣ आधार कार्ड (Aadhaar Card)\n` +
          `4️⃣ पॅन कार्ड (PAN Card)\n` +
          `5️⃣ बँक खाते किंवा UPI तपशील\n` +
          `6️⃣ सेल्फी फोटो\n\n` +
          `📲 ॲपद्वारे कागदपत्रे अपलोड करा:\n👉 ${DRIVER_APP_URL}\n\n` +
          `📞 मदत: ${HELPLINE_NUMBER}`,
        gu:
          `📋 *ડ્રાઇવર ઓનબોર્ડિંગ માટે જરૂરી દસ્તાવેજો*\n\n` +
          `1️⃣ ડ્રાઇવિંગ લાઇસન્સ (DL)\n` +
          `2️⃣ વાહન આરસી બુક (RC Book)\n` +
          `3️⃣ આધાર કાર્ડ (Aadhaar Card)\n` +
          `4️⃣ પાન કાર્ડ (PAN Card)\n` +
          `5️⃣ બેંક ખાતું અથવા UPI વિગત\n` +
          `6️⃣ સેલ્ફી ફોટો\n\n` +
          `📲 એપ પર ડોક્યુમેન્ટ અપલોડ કરો:\n👉 ${DRIVER_APP_URL}\n\n` +
          `📞 સહાય: ${HELPLINE_NUMBER}`,
        pa:
          `📋 *ਡਰਾਈਵਰ ਔਨਬੋਰਡਿੰਗ ਲਈ ਜ਼ਰੂਰੀ ਦਸਤਾਵੇਜ਼*\n\n` +
          `1️⃣ ਡਰਾਈਵਿੰਗ ਲਾਇਸੈਂਸ (DL)\n` +
          `2️⃣ ਗੱਡੀ ਦੀ ਆਰਸੀ (RC Book)\n` +
          `3️⃣ ਆਧਾਰ ਕਾਰਡ\n` +
          `4️⃣ ਪੈਨ ਕਾਰਡ\n` +
          `5️⃣ ਬੈਂਕ ਖਾਤਾ ਜਾਂ UPI\n` +
          `6️⃣ ਸੈਲਫੀ ਫੋਟੋ\n\n` +
          `📲 ਐਪ ਰਾਹੀਂ ਦਸਤਾਵੇਜ਼ ਅੱਪਲੋਡ ਕਰੋ:\n👉 ${DRIVER_APP_URL}\n\n` +
          `📞 ਹੈਲਪਲਾਈਨ: ${HELPLINE_NUMBER}`,
        bn:
          `📋 *ড্রাইভার অনবোর্ডিংয়ের জন্য প্রয়োজনীয় ডকুমেন্টস*\n\n` +
          `1️⃣ ড্রাইভিং লাইসেন্স (DL)\n` +
          `2️⃣ গাড়ির আরসি (RC Book)\n` +
          `3️⃣ আধার কার্ড\n` +
          `4️⃣ প্যান কার্ড\n` +
          `5️⃣ ব্যাংক একাউন্ট বা UPI\n` +
          `6️⃣ সেলফি ফটো\n\n` +
          `📲 ডকুমেন্টস আপলোড করতে অ্যাপ ডাউনলোড করুন:\n👉 ${DRIVER_APP_URL}\n\n` +
          `📞 সহায়তা: ${HELPLINE_NUMBER}`,
        te:
          `📋 *డ్రైవర్ ఆన్‌బోర్డింగ్ కోసం అవసరమైన పత్రాలు*\n\n` +
          `1️⃣ డ్రైవింగ్ లైసెన్స్ (DL)\n` +
          `2️⃣ వెహికల్ ఆర్సీ (RC Book)\n` +
          `3️⃣ ఆధార్ కార్డు\n` +
          `4️⃣ పాన్ కార్డు\n` +
          `5️⃣ బ్యాంక్ ఖాతా లేదా UPI\n` +
          `6️⃣ డ్రైవర్ సెల్ఫీ ఫోటో\n\n` +
          `📲 డాక్యుమెంట్లు అప్‌లోడ్ చేయడానికి Driver App చూడండి:\n👉 ${DRIVER_APP_URL}\n\n` +
          `📞 హెల్ప్‌లైన్: ${HELPLINE_NUMBER}`,
        ta:
          `📋 *ஓட்டுநர் இணைப்பிற்கு தேவையான ஆவணங்கள்*\n\n` +
          `1️⃣ ஓட்டுநர் உரிமம் (DL)\n` +
          `2️⃣ வாகன ஆர்.சி புத்தகம் (RC Book)\n` +
          `3️⃣ ஆதார் அட்டை\n` +
          `4️⃣ பான் கார்டு\n` +
          `5️⃣ வங்கி கணக்கு அல்லது UPI\n` +
          `6️⃣ நேரடி செல்ஃபி புகைப்படம்\n\n` +
          `📲 ஆவணங்களை பதிவேற்ற Driver App பதிவிறக்கவும்:\n👉 ${DRIVER_APP_URL}\n\n` +
          `📞 உதவி எண்: ${HELPLINE_NUMBER}`,
        kn:
          `📋 *ಚಾಲಕರ ನೋಂದಣಿಗೆ ಅಗತ್ಯವಿರುವ ದಾಖಲೆಗಳು*\n\n` +
          `1️⃣ ಚಾಲನಾ ಪರವಾನಗಿ (DL)\n` +
          `2️⃣ ವಾಹನ ಆರ್‌ಸಿ (RC Book)\n` +
          `3️⃣ ಆಧಾರ್ ಕಾರ್ಡ್\n` +
          `4️⃣ ಪ್ಯಾನ್ ಕಾರ್ಡ್\n` +
          `5️⃣ ಬ್ಯಾಂಕ್ ಖಾತೆ ಅಥವಾ UPI ವಿವರ\n` +
          `6️⃣ ಲೈವ್ ಸೆಲ್ಫಿ ಫೋಟೋ\n\n` +
          `📲 ದಾಖಲೆಗಳನ್ನು ಅಪ್‌ಲೋಡ್ ಮಾಡಲು App ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ:\n👉 ${DRIVER_APP_URL}\n\n` +
          `📞 ಸಹಾಯವಾಣಿ: ${HELPLINE_NUMBER}`,
      },
      "3": {
        hi:
          `💰 *कमाई, कमीशन व सब्सक्रिप्शन प्लान्स*\n\n` +
          `Shifter Online ड्राइवर्स को अधिकतम कमाई का अवसर देता है:\n` +
          `⭐ *ज़ीरो कमीशन मॉडल*: अपने मेहनत की पूरी कमाई अपनी जेब में रखें\n` +
          `⭐ *डेली ड्राइवर प्लान्स*: हर दिन गारंटीड ऑर्डर्स और बोनस\n` +
          `⭐ *त्वरित विड्रॉल*: अपनी कमाई जब चाहें तुरंत UPI / बैंक खाते में ट्रांसफर करें\n\n` +
          `📲 प्लान्स की विस्तृत जानकारी Driver App में उपलब्ध है:\n👉 ${DRIVER_APP_URL}\n\n` +
          `📞 ड्राइवर हेल्पलाइन: ${HELPLINE_NUMBER}`,
        en:
          `💰 *Earnings, Commission & Subscription Plans*\n\n` +
          `Maximize your daily earnings with Shifter Online:\n` +
          `⭐ *Zero Commission Model*: Keep 100% of your trip fare\n` +
          `⭐ *Daily Driver Plans*: Dedicated local orders & daily bonuses\n` +
          `⭐ *Instant Payouts*: Withdraw your earnings to bank/UPI anytime\n\n` +
          `📲 View active plans in the Driver App:\n👉 ${DRIVER_APP_URL}\n\n` +
          `📞 Helpline: ${HELPLINE_NUMBER}`,
        hinglish:
          `💰 *Kamai, Commission aur Plans ki Jankari*\n\n` +
          `Shifter Online drivers ke liye best earning model laya hai:\n` +
          `⭐ *Zero Commission*: Har trip ki poori kamai aapki\n` +
          `⭐ *Daily Driver Plans*: Local regular orders aur performance bonus\n` +
          `⭐ *Instant Payout*: Jab chahein apni kamai UPI/Bank me nikaalein\n\n` +
          `📲 Poori details Driver App me dekhein:\n👉 ${DRIVER_APP_URL}\n\n` +
          `📞 Driver Helpline: ${HELPLINE_NUMBER}`,
        mr:
          `💰 *कमाई, कमिशन आणि प्लॅन्सची माहिती*\n\n` +
          `⭐ *शून्य कमिशन मॉडेल*: १००% कमाई थेट आपल्या खिशात\n` +
          `⭐ *डेली ड्रायव्हर प्लॅन्स*: दररोज नियमित ऑर्डर्स व बोनस\n` +
          `⭐ *त्वरित विड्रॉल*: कधीही UPI/बँकेत पैसे ट्रान्सफर करा\n\n` +
          `📲 Driver App मध्ये सविस्तर माहिती पहा:\n👉 ${DRIVER_APP_URL}\n\n` +
          `📞 मदत: ${HELPLINE_NUMBER}`,
        gu:
          `💰 *કમાણી, કમિશન અને પ્લાન્સ*\n\n` +
          `⭐ *ઝીરો કમિશન મોડલ*: તમારી મહેનતની પૂરી કમાણી તમારી પાસે\n` +
          `⭐ *ડેઇલી ડ્રાઇવર પ્લાન્સ*: દરરોજ ઓર્ડર્સ અને બોનસ\n` +
          `⭐ *ઇન્સ્ટન્ટ વિથડ્રોલ*: ગમે ત્યારે UPI/બેંકમાં નાણાં મેળવો\n\n` +
          `📲 Driver App માં વધુ જુઓ:\n👉 ${DRIVER_APP_URL}\n\n` +
          `📞 હેલ્પલાઇન: ${HELPLINE_NUMBER}`,
        pa:
          `💰 *ਕਮਾਈ, ਕਮਿਸ਼ਨ ਅਤੇ ਪਲਾਨਾਂ ਦੀ ਜਾਣਕਾਰੀ*\n\n` +
          `⭐ *ਜ਼ੀਰੋ ਕਮਿਸ਼ਨ ਮਾਡਲ*: ਪੂਰੀ ਕਮਾਈ ਤੁਹਾਡੀ ਜੇਬ ਵਿੱਚ\n` +
          `⭐ *ਡੇਲੀ ਡਰਾਈਵਰ ਪਲਾਨ*: ਰੋਜ਼ਾਨਾ ਰੈਗੂਲਰ ਆਰਡਰ ਅਤੇ ਬੋਨਸ\n` +
          `⭐ *ਤੁਰੰਤ ਪੇਮੈਂਟ*: ਕਿਸੇ ਵੀ ਵੇਲੇ UPI/ਬੈਂਕ ਵਿੱਚ ਟਰਾਂਸਫਰ ਕਰੋ\n\n` +
          `📲 Driver App ਵਿੱਚ ਪੂਰੀ ਜਾਣਕਾਰੀ ਦੇਖੋ:\n👉 ${DRIVER_APP_URL}\n\n` +
          `📞 ਹੈਲਪਲਾਈਨ: ${HELPLINE_NUMBER}`,
        bn:
          `💰 *উপার্জন ও সাবস্ক্রিপশন প্ল্যান*\n\n` +
          `⭐ *জিরো কমিশন মডেল*: আপনার উপার্জনের ১০০% আপনার কাছে\n` +
          `⭐ *দৈনিক ড্রাইভার প্ল্যান*: নিয়মিত ট্রিপ ও বোনাস\n` +
          `⭐ *ইনস্ট্যান্ট পে-আউট*: যেকোনো সময় ব্যাংক/UPI-তে টাকা তুলুন\n\n` +
          `📲 Driver App-এ বিস্তারিত দেখুন:\n👉 ${DRIVER_APP_URL}\n\n` +
          `📞 সহায়তা: ${HELPLINE_NUMBER}`,
        te:
          `💰 *ఆదాయం, కమీషన్ మరియు ప్లాన్స్*\n\n` +
          `⭐ *జీరో కమీషన్ మోడల్*: మీ కష్టార్జితం 100% మీకే\n` +
          `⭐ *డైలీ డ్రైవర్ ప్లాన్స్*: గ్యారెంటీడ్ ఆర్డర్లు మరియు బోనస్‌లు\n` +
          `⭐ *ఇన్‌స్టంట్ పేఅవుట్*: ఎప్పుడైనా UPI/బ్యాంకుకి విత్‌డ్రా చేసుకోండి\n\n` +
          `📲 పూర్తి వివరాలు Driver App లో చూడండి:\n👉 ${DRIVER_APP_URL}\n\n` +
          `📞 హెల్ప్‌లైన్: ${HELPLINE_NUMBER}`,
        ta:
          `💰 *வருமானம் மற்றும் திட்டங்களின் விவரங்கள்*\n\n` +
          `⭐ *பூஜ்ஜிய கமிஷன் முறை*: உங்கள் முழு வருமானமும் உங்களுக்கே\n` +
          `⭐ *தினசரி ஓட்டுநர் திட்டங்கள்*: வழக்கமான ஆர்டர்கள் மற்றும் போனஸ்\n` +
          `⭐ *உடனடி பணம் எடுக்கும் வசதி*: எப்போது வேண்டுமானாலும் வங்கிக்கு மாற்றலாம்\n\n` +
          `📲 மேலும் அறிய Driver App பார்க்கவும்:\n👉 ${DRIVER_APP_URL}\n\n` +
          `📞 உதவி எண்: ${HELPLINE_NUMBER}`,
        kn:
          `💰 *ಗಳಿಕೆ, ಕಮಿಷನ್ ಮತ್ತು ಚಂದಾದಾರಿಕೆ ಯೋಜನೆಗಳು*\n\n` +
          `⭐ *ಶೂನ್ಯ ಕಮಿಷನ್ ಮಾದರಿ*: ನಿಮ್ಮ ಶ್ರಮದ ಸಂಪೂರ್ಣ ಗಳಿಕೆ ನಿಮ್ಮದೇ\n` +
          `⭐ *ದೈನಂದಿನ ಚಾಲಕ ಯೋಜನೆಗಳು*: ಖಚಿತ ಆರ್ಡರ್‌ಗಳು ಮತ್ತು ಬೋನಸ್\n` +
          `⭐ *ತಕ್ಷಣದ ವಿತ್‌ಡ್ರಾ*: ಯಾವಾಗ ಬೇಕಾದರೂ UPI/ಬ್ಯಾಂಕ್‌ಗೆ ಹಣ ವರ್ಗಾವಣೆ\n\n` +
          `📲 Driver App ನಲ್ಲಿ ವಿವರಗಳನ್ನು ನೋಡಿ:\n👉 ${DRIVER_APP_URL}\n\n` +
          `📞 ಸಹಾಯವಾಣಿ: ${HELPLINE_NUMBER}`,
      },
      "4": {
        hi:
          `📞 *Shifter Online ड्राइवर हेल्पलाइन*\n\n` +
          `ड्राइवर पार्टनर्स किसी भी समस्या या पूछताछ के लिए सीधे कॉल कर सकते हैं:\n` +
          `📱 *ड्राइवर हेल्पलाइन*: ${HELPLINE_NUMBER}\n` +
          `📧 *ईमेल*: ${SUPPORT_EMAIL}\n` +
          `📲 *Driver App*: ${DRIVER_APP_URL}`,
        en:
          `📞 *Shifter Online Driver Support Helpline*\n\n` +
          `For onboarding, account, or ride issues:\n` +
          `📱 *Driver Support*: ${HELPLINE_NUMBER}\n` +
          `📧 *Email*: ${SUPPORT_EMAIL}\n` +
          `📲 *Driver App*: ${DRIVER_APP_URL}`,
        hinglish:
          `📞 *Shifter Online Driver Support Helpline*\n\n` +
          `Onboarding, account ya ride se judi sahayata ke liye:\n` +
          `📱 *Driver Support Phone*: ${HELPLINE_NUMBER}\n` +
          `📧 *Email*: ${SUPPORT_EMAIL}\n` +
          `📲 *Driver App*: ${DRIVER_APP_URL}`,
        mr: `📞 *चालक हेल्पलाइन*: ${HELPLINE_NUMBER} | 📧 ${SUPPORT_EMAIL}\n📲 ${DRIVER_APP_URL}`,
        gu: `📞 *ડ્રાઇવર હેલ્પલાઇન*: ${HELPLINE_NUMBER} | 📧 ${SUPPORT_EMAIL}\n📲 ${DRIVER_APP_URL}`,
        pa: `📞 *ਡਰਾਈਵਰ ਹੈਲਪਲਾਈਨ*: ${HELPLINE_NUMBER} | 📧 ${SUPPORT_EMAIL}\n📲 ${DRIVER_APP_URL}`,
        bn: `📞 *ড্রাইভার হেল্পলাইন*: ${HELPLINE_NUMBER} | 📧 ${SUPPORT_EMAIL}\n📲 ${DRIVER_APP_URL}`,
        te: `📞 *డ్రైవర్ హెల్ప్‌లైన్*: ${HELPLINE_NUMBER} | 📧 ${SUPPORT_EMAIL}\n📲 ${DRIVER_APP_URL}`,
        ta: `📞 *ஓட்டுநர் உதவி எண்*: ${HELPLINE_NUMBER} | 📧 ${SUPPORT_EMAIL}\n📲 ${DRIVER_APP_URL}`,
        kn: `📞 *ಚಾಲಕ ಸಹಾಯವಾಣಿ*: ${HELPLINE_NUMBER} | 📧 ${SUPPORT_EMAIL}\n📲 ${DRIVER_APP_URL}`,
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
          `📞 एचआर हेल्पलाइन: ${HELPLINE_NUMBER}`,
        en:
          `💼 *Current Job Openings & Vacancies*\n\n` +
          `Shifter Online is actively hiring for the following positions:\n` +
          `1️⃣ Customer Support & Telecalling Executive\n` +
          `2️⃣ Driver Onboarding & Field Operations\n` +
          `3️⃣ Logistics Dispatch Coordinator\n` +
          `4️⃣ Area Business Development Executive\n\n` +
          `📧 Send your Resume to: *${CAREERS_EMAIL}*\n` +
          `📞 HR Helpline: ${HELPLINE_NUMBER}`,
        hinglish:
          `💼 *Current Open Jobs & Vacancies*\n\n` +
          `Shifter Online mein in positions par active hiring chal rahi hai:\n` +
          `1️⃣ Customer Support & Telecaller Executive\n` +
          `2️⃣ Driver Onboarding & Field Operations\n` +
          `3️⃣ Logistics Dispatch Coordinator\n` +
          `4️⃣ Sales & Business Development\n\n` +
          `📧 Apply karne ke liye resume bhejein: *${CAREERS_EMAIL}*\n` +
          `📞 HR Helpline: ${HELPLINE_NUMBER}`,
        mr:
          `💼 *चालू नोकऱ्या (Job Openings)*\n\n` +
          `1️⃣ Customer Support Executive\n` +
          `2️⃣ Field Operations & Driver Onboarding\n` +
          `3️⃣ Logistics Dispatch Coordinator\n\n` +
          `📧 Resume पाठवा: *${CAREERS_EMAIL}*\n📞 HR: ${HELPLINE_NUMBER}`,
        gu:
          `💼 *ચાલુ નોકરીઓની વિગતો (Job Openings)*\n\n` +
          `1️⃣ Customer Support Executive\n` +
          `2️⃣ Field Operations & Driver Onboarding\n` +
          `3️⃣ Logistics Dispatch Coordinator\n\n` +
          `📧 Resume મોકલો: *${CAREERS_EMAIL}*\n📞 HR: ${HELPLINE_NUMBER}`,
        pa:
          `💼 *ਮੌਜੂਦਾ ਨੌਕਰੀਆਂ (Job Openings)*\n\n` +
          `1️⃣ Customer Support Executive\n` +
          `2️⃣ Field Operations & Driver Onboarding\n` +
          `3️⃣ Logistics Dispatch Coordinator\n\n` +
          `📧 Resume ਭੇਜੋ: *${CAREERS_EMAIL}*\n📞 HR: ${HELPLINE_NUMBER}`,
        bn:
          `💼 *বর্তমান চাকরির সুযোগ (Job Openings)*\n\n` +
          `1️⃣ Customer Support Executive\n` +
          `2️⃣ Field Operations & Driver Onboarding\n` +
          `3️⃣ Logistics Dispatch Coordinator\n\n` +
          `📧 Resume পাঠান: *${CAREERS_EMAIL}*\n📞 HR: ${HELPLINE_NUMBER}`,
        te:
          `💼 *ప్రస్తుత ఉద్యోగావకాశాలు (Job Openings)*\n\n` +
          `1️⃣ Customer Support Executive\n` +
          `2️⃣ Field Operations & Driver Onboarding\n` +
          `3️⃣ Logistics Dispatch Coordinator\n\n` +
          `📧 Resume పంపండి: *${CAREERS_EMAIL}*\n📞 HR: ${HELPLINE_NUMBER}`,
        ta:
          `💼 *நடப்பு காலியிடங்கள் (Job Openings)*\n\n` +
          `1️⃣ Customer Support Executive\n` +
          `2️⃣ Field Operations & Driver Onboarding\n` +
          `3️⃣ Logistics Dispatch Coordinator\n\n` +
          `📧 Resume அனுப்பவும்: *${CAREERS_EMAIL}*\n📞 HR: ${HELPLINE_NUMBER}`,
        kn:
          `💼 *ಪ್ರಸ್ತುತ ಉದ್ಯೋಗಾವಕಾಶಗಳು (Job Openings)*\n\n` +
          `1️⃣ Customer Support Executive\n` +
          `2️⃣ Field Operations & Driver Onboarding\n` +
          `3️⃣ Logistics Dispatch Coordinator\n\n` +
          `📧 Resume ಕಳುಹಿಸಿ: *${CAREERS_EMAIL}*\n📞 HR: ${HELPLINE_NUMBER}`,
      },
      "2": {
        hi:
          `📝 *नौकरी के लिए आवेदन कैसे करें*\n\n` +
          `कृपया अपना नवीनतम रिज्यूमे (CV) हमारे आधिकारिक ईमेल पर भेजें:\n` +
          `📧 *ईमेल*: ${CAREERS_EMAIL}\n` +
          `📌 *Subject*: जिस पद के लिए आवेदन कर रहे हैं (उदा. Application for Customer Support)\n\n` +
          `हमारी HR टीम आपके रिज्यूमे की समीक्षा करके 24-48 घंटों के भीतर संपर्क करेगी।\n\n` +
          `📞 एचआर हेल्पलाइन: ${HELPLINE_NUMBER}`,
        en:
          `📝 *How to Apply for Open Roles*\n\n` +
          `Please email your updated Resume (CV) to our HR department:\n` +
          `📧 *Email*: ${CAREERS_EMAIL}\n` +
          `📌 *Subject*: Position Name (e.g., Application for Customer Support)\n\n` +
          `Our recruitment team will review your profile and reach out within 24-48 hours.\n\n` +
          `📞 HR Helpline: ${HELPLINE_NUMBER}`,
        hinglish:
          `📝 *Job ke liye Apply Kaise Karein*\n\n` +
          `Kripya apna updated resume (CV) hamari official careers email par bhejein:\n` +
          `📧 *Email*: ${CAREERS_EMAIL}\n` +
          `📌 *Subject*: Job Role (jaise: Application for Customer Support)\n\n` +
          `Hamari HR team aapka resume check karke 24-48 hours me call karegi.\n\n` +
          `📞 HR Helpline: ${HELPLINE_NUMBER}`,
        mr: `📝 आपला Resume ईमेलवर पाठवा: *${CAREERS_EMAIL}*\n📞 HR हेल्पलाइन: ${HELPLINE_NUMBER}`,
        gu: `📝 તમારો Resume ઈમેલ પર મોકલો: *${CAREERS_EMAIL}*\n📞 HR હેલ્પલાઇન: ${HELPLINE_NUMBER}`,
        pa: `📝 ਆਪਣਾ Resume ਈਮੇਲ ਕਰੋ: *${CAREERS_EMAIL}*\n📞 HR ਹੈਲਪਲਾਈਨ: ${HELPLINE_NUMBER}`,
        bn: `📝 আপনার Resume ইমেল করুন: *${CAREERS_EMAIL}*\n📞 HR হেল্পলাইন: ${HELPLINE_NUMBER}`,
        te: `📝 మీ Resume ను ఈమెయిల్ చేయండి: *${CAREERS_EMAIL}*\n📞 HR హెల్ప్‌లైన్: ${HELPLINE_NUMBER}`,
        ta: `📝 உங்கள் Resume-ஐ மின்னஞ்சல் செய்யவும்: *${CAREERS_EMAIL}*\n📞 HR உதவி எண்: ${HELPLINE_NUMBER}`,
        kn: `📝 ನಿಮ್ಮ Resume ಇಮೇಲ್ ಮಾಡಿ: *${CAREERS_EMAIL}*\n📞 HR ಸಹಾಯವಾಣಿ: ${HELPLINE_NUMBER}`,
      },
      "3": {
        hi:
          `🏢 *ऑफिस का पता और इंटरव्यू समय*\n\n` +
          `🏢 *कंपनी*: Movigo Logistic Aggregator Private Limited (Shifter Online)\n` +
          `⏰ *कार्य दिवस*: सोमवार से शनिवार (Monday to Saturday)\n` +
          `⏰ *समय*: सुबह 10:00 AM से शाम 6:00 PM\n` +
          `📞 *हेल्पलाइन*: ${HELPLINE_NUMBER}\n` +
          `📧 *ईमेल*: ${CAREERS_EMAIL}`,
        en:
          `🏢 *Office Address & Interview Timing*\n\n` +
          `🏢 *Company*: Movigo Logistic Aggregator Private Limited (Shifter Online)\n` +
          `⏰ *Working Days*: Monday to Saturday\n` +
          `⏰ *Working Hours*: 10:00 AM to 6:00 PM\n` +
          `📞 *Helpline*: ${HELPLINE_NUMBER}\n` +
          `📧 *Email*: ${CAREERS_EMAIL}`,
        hinglish:
          `🏢 *Office Address aur Interview Timings*\n\n` +
          `🏢 *Company*: Movigo Logistic Aggregator Private Limited (Shifter Online)\n` +
          `⏰ *Days*: Monday to Saturday\n` +
          `⏰ *Timings*: Subah 10:00 AM se Shaam 6:00 PM\n` +
          `📞 *Helpline*: ${HELPLINE_NUMBER}\n` +
          `📧 *Email*: ${CAREERS_EMAIL}`,
        mr: `🏢 Movigo Logistic Aggregator Pvt Ltd | सोम-शनि, 10 AM - 6 PM | 📞 ${HELPLINE_NUMBER}`,
        gu: `🏢 Movigo Logistic Aggregator Pvt Ltd | સોમ-શનિ, 10 AM - 6 PM | 📞 ${HELPLINE_NUMBER}`,
        pa: `🏢 Movigo Logistic Aggregator Pvt Ltd | ਸੋਮ-ਸ਼ਨੀ, 10 AM - 6 PM | 📞 ${HELPLINE_NUMBER}`,
        bn: `🏢 Movigo Logistic Aggregator Pvt Ltd | সোম-শনি, 10 AM - 6 PM | 📞 ${HELPLINE_NUMBER}`,
        te: `🏢 Movigo Logistic Aggregator Pvt Ltd | సోమ-శని, 10 AM - 6 PM | 📞 ${HELPLINE_NUMBER}`,
        ta: `🏢 Movigo Logistic Aggregator Pvt Ltd | திங்கள்-சனி, 10 AM - 6 PM | 📞 ${HELPLINE_NUMBER}`,
        kn: `🏢 Movigo Logistic Aggregator Pvt Ltd | ಸೋಮ-ಶನಿ, 10 AM - 6 PM | 📞 ${HELPLINE_NUMBER}`,
      },
      "4": {
        hi:
          `📞 *HR व भर्ती संपर्क सूत्र*\n\n` +
          `नौकरी संबंधी पूछताछ के लिए:\n` +
          `📱 *एचआर हेल्पलाइन*: ${HELPLINE_NUMBER}\n` +
          `📧 *करियर ईमेल*: ${CAREERS_EMAIL}\n` +
          `🏢 *कंपनी*: Movigo Logistic Aggregator Private Limited`,
        en:
          `📞 *HR & Recruitment Helpline*\n\n` +
          `For job and career inquiries:\n` +
          `📱 *HR Helpline*: ${HELPLINE_NUMBER}\n` +
          `📧 *Careers Email*: ${CAREERS_EMAIL}\n` +
          `🏢 *Company*: Movigo Logistic Aggregator Private Limited`,
        hinglish:
          `📞 *HR & Careers Helpline*\n\n` +
          `Job inquiry ya interview updates ke liye:\n` +
          `📱 *HR Helpline*: ${HELPLINE_NUMBER}\n` +
          `📧 *Careers Email*: ${CAREERS_EMAIL}\n` +
          `🏢 *Company*: Movigo Logistic Aggregator Private Limited`,
        mr: `📱 HR हेल्पलाइन: ${HELPLINE_NUMBER} | 📧 ${CAREERS_EMAIL}`,
        gu: `📱 HR હેલ્પલાઇન: ${HELPLINE_NUMBER} | 📧 ${CAREERS_EMAIL}`,
        pa: `📱 HR ਹੈਲਪਲਾਈਨ: ${HELPLINE_NUMBER} | 📧 ${CAREERS_EMAIL}`,
        bn: `📱 HR হেল্পলাইন: ${HELPLINE_NUMBER} | 📧 ${CAREERS_EMAIL}`,
        te: `📱 HR హెల్ప్‌లైన్: ${HELPLINE_NUMBER} | 📧 ${CAREERS_EMAIL}`,
        ta: `📱 HR உதவி எண்: ${HELPLINE_NUMBER} | 📧 ${CAREERS_EMAIL}`,
        kn: `📱 HR ಸಹಾಯವಾಣಿ: ${HELPLINE_NUMBER} | 📧 ${CAREERS_EMAIL}`,
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
    mr:
      `⚠️ माफ करा, मला आपला संदेश समजला नाही.\n\n` +
      `मी एक स्वयंचलित मेनू बॉट आहे. कृपया दिलेल्या पर्यायांपैकी फक्त नंबर (*1, 2, 3...*) पाठवा.\n\n` +
      `थेट संपर्कासाठी ग्राहक सेवा केंद्राशी बोला:\n` +
      `📞 *मदत*: ${HELPLINE_NUMBER}\n` +
      `📧 *ईमेल*: ${SUPPORT_EMAIL}\n\n` +
      `_(मुख्य मेनूसाठी '0' पाठवा)_`,
    gu:
      `⚠️ માફ કરશો, હું તમારો સંદેશ સમજી શક્યો નથી.\n\n` +
      `હું એક ઓટોમેટેડ મેનુ બોટ છું. કૃપા કરીને આપેલા વિકલ્પોમાંથી માત્ર નંબર (*1, 2, 3...*) મોકલો.\n\n` +
      `વધુ સહાય માટે કસ્ટમર કેરનો સંપર્ક કરો:\n` +
      `📞 *હેલ્પલાઇન*: ${HELPLINE_NUMBER}\n` +
      `📧 *ઈમેલ*: ${SUPPORT_EMAIL}\n\n` +
      `_(મુખ્ય મેનુ માટે '0' લખો)_`,
    pa:
      `⚠️ ਮਾਫ਼ ਕਰਨਾ, ਮੈਨੂੰ ਤੁਹਾਡਾ ਸੁਨੇਹਾ ਸਮਝ ਨਹੀਂ ਆਇਆ।\n\n` +
      `ਮੈਂ ਇੱਕ ਆਟੋਮੇਟਿਡ ਮੈਨੂ ਬੋਟ ਹਾਂ। ਕਿਰਪਾ ਕਰਕੇ ਦਿੱਤੇ ਗਏ ਵਿਕਲਪਾਂ ਵਿੱਚੋਂ ਸਿਰਫ਼ ਨੰਬਰ (*1, 2, 3...*) ਲਿਖੋ।\n\n` +
      `ਸਹਾਇਤਾ ਲਈ ਸਾਡੀ ਟੀਮ ਨਾਲ ਸੰਪਰਕ ਕਰੋ:\n` +
      `📞 *ਹੈਲਪਲਾਈਨ*: ${HELPLINE_NUMBER}\n` +
      `📧 *ਈਮੇਲ*: ${SUPPORT_EMAIL}\n\n` +
      `_(ਮੇਨ ਮੈਨੂ ਲਈ '0' ਲਿਖੋ)_`,
    bn:
      `⚠️ দুঃখিত, আমি আপনার বার্তাটি বুঝতে পারিনি।\n\n` +
      `আমি একটি অটোমেটেড মেনু বট। দয়া করে প্রদত্ত বিকল্পগুলি থেকে শুধুমাত্র নম্বর (*1, 2, 3...*) পাঠান।\n\n` +
      `সহায়তার জন্য আমাদের সাথে যোগাযোগ করুন:\n` +
      `📞 *হেল্পলাইন*: ${HELPLINE_NUMBER}\n` +
      `📧 *ইমেল*: ${SUPPORT_EMAIL}\n\n` +
      `_(প্রধান মেনুর জন্য '0' লিখুন)_`,
    te:
      `⚠️ క్షమించండి, మీ సందేశం నాకు అర్థం కాలేదు.\n\n` +
      `నేను ఆటోమేటెడ్ మెనూ బాట్‌ను. దయచేసి ఇచ్చిన ఎంపికలలోని సంఖ్యలను (*1, 2, 3...*) మాత్రమే టైప్ చేయండి.\n\n` +
      `నేరుగా సహాయం కోసం సంప్రదించండి:\n` +
      `📞 *హెల్ప్‌లైన్*: ${HELPLINE_NUMBER}\n` +
      `📧 *ఈమెయిల్*: ${SUPPORT_EMAIL}\n\n` +
      `_(మెయిన్ మెనూ కోసం '0' అని పంపండి)_`,
    ta:
      `⚠️ மன்னிக்கவும், உங்கள் செய்தி எனக்கு புரியவில்லை.\n\n` +
      `நான் ஒரு தானியங்கி மெனு பாட். தயவுசெய்து எண்களை (*1, 2, 3...*) மட்டுமே உள்ளிடவும்.\n\n` +
      `நேரடி உதவிக்கு தொடர்பு கொள்ளவும்:\n` +
      `📞 *உதவி எண்*: ${HELPLINE_NUMBER}\n` +
      `📧 *மின்னஞ்சல்*: ${SUPPORT_EMAIL}\n\n` +
      `_(முதன்மை மெனுவுக்கு '0' என அனுப்பவும்)_`,
    kn:
      `⚠️ ಕ್ಷಮಿಸಿ, ನಿಮ್ಮ ಸಂದೇಶ ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ.\n\n` +
      `ನಾನು ಸ್ವಯಂಚಾಲಿತ ಮೆನು ಬಾಟ್. ದಯವಿಟ್ಟು ನೀಡಲಾದ ಆಯ್ಕೆಗಳ ಸಂಖ್ಯೆಯನ್ನು (*1, 2, 3...*) ಮಾತ್ರ ನಮೂದಿಸಿ.\n\n` +
      `ನೇರ ಸಹಾಯಕ್ಕಾಗಿ ಸಂಪರ್ಕಿಸಿ:\n` +
      `📞 *ಸಹಾಯವಾಣಿ*: ${HELPLINE_NUMBER}\n` +
      `📧 *ಇಮೇಲ್*: ${SUPPORT_EMAIL}\n\n` +
      `_(ಮುಖ್ಯ ಮೆನುಗಾಗಿ '0' ಎಂದು ಕಳುಹಿಸಿ)_`,
  },

  CUSTOMER_CARE_HANDOFF: {
    hi:
      `⚠️ *कस्टमर केयर सहायता (Direct Customer Support)*\n\n` +
      `लगता है आपको किसी विशेष विषय पर सहायता चाहिए। कृपया हमारे कस्टमर केयर एग्जीक्यूटिव से सीधे संपर्क करें:\n\n` +
      `📞 *कॉल / हेल्पलाइन*: ${HELPLINE_NUMBER}\n` +
      `📧 *ईमेल*: ${SUPPORT_EMAIL}\n` +
      `⏰ *समय*: सुबह 10:00 AM से शाम 6:00 PM (सोमवार - शनिवार)\n` +
      `🏢 *कंपनी*: Movigo Logistic Aggregator Private Limited\n\n` +
      `_(बॉट मेन्यू पुनः शुरू करने के लिए *0* या *START* लिखकर भेजें)_`,
    en:
      `⚠️ *Direct Customer Care Support*\n\n` +
      `It looks like you need personalized assistance. Please connect directly with our customer support executive:\n\n` +
      `📞 *Phone / Helpline*: ${HELPLINE_NUMBER}\n` +
      `📧 *Email*: ${SUPPORT_EMAIL}\n` +
      `⏰ *Working Hours*: 10:00 AM to 6:00 PM (Monday - Saturday)\n` +
      `🏢 *Company*: Movigo Logistic Aggregator Private Limited\n\n` +
      `_(Reply with *0* or *START* to restart the menu)_`,
    hinglish:
      `⚠️ *Customer Care Direct Support*\n\n` +
      `Lagta hai aapko kisi specific vishay par help chahiye. Kripya hamari Customer Care team se direct sampark karein:\n\n` +
      `📞 *Call / Helpline*: ${HELPLINE_NUMBER}\n` +
      `📧 *Email*: ${SUPPORT_EMAIL}\n` +
      `⏰ *Timing*: Subah 10:00 AM se Shaam 6:00 PM (Mon - Sat)\n` +
      `🏢 *Company*: Movigo Logistic Aggregator Private Limited\n\n` +
      `_(Bot dobara shuru karne ke liye *0* ya *START* likhkar bhejein)_`,
    mr:
      `⚠️ *ग्राहक सेवा केंद्राशी थेट संपर्क साधा*\n\n` +
      `आपल्या थेट व त्वरित मदतीसाठी कृपया आमच्या ग्राहक सेवा प्रतिनिधीशी संपर्क साधा:\n\n` +
      `📞 *हेल्पलाइन*: ${HELPLINE_NUMBER}\n` +
      `📧 *ईमेल*: ${SUPPORT_EMAIL}\n` +
      `⏰ *वेळ*: सकाळी 10:00 AM ते संध्याकाळी 6:00 PM (सोम - शनि)\n\n` +
      `_(मेनू पुन्हा सुरू करण्यासाठी *0* किंवा *START* पाठवा)_`,
    gu:
      `⚠️ *કસ્ટમર કેર સાથે સીધો સંપર્ક કરો*\n\n` +
      `તમારી તાત્કાલિક સહાયતા માટે કૃપા કરીને અમારી કસ્ટમર કેર ટીમનો સંપર્ક કરો:\n\n` +
      `📞 *હેલ્પલાઇન*: ${HELPLINE_NUMBER}\n` +
      `📧 *ઈમેલ*: ${SUPPORT_EMAIL}\n` +
      `⏰ *સમય*: સવારે 10:00 AM થી સાંજે 6:00 PM (સોમ - શનિ)\n\n` +
      `_(મેનુ ફરી શરૂ કરવા માટે *0* અથવા *START* લખો)_`,
    pa:
      `⚠️ *ਕਸਟਮਰ ਕੇਅਰ ਨਾਲ ਸਿੱਧਾ ਸੰਪਰਕ ਕਰੋ*\n\n` +
      `ਸਿੱਧੀ ਸਹਾਇਤਾ ਲਈ ਕਿਰਪਾ ਕਰਕੇ ਸਾਡੀ ਕਸਟਮਰ ਕੇਅਰ ਟੀਮ ਨਾਲ ਸੰਪਰਕ ਕਰੋ:\n\n` +
      `📞 *ਹੈਲਪਲਾਈਨ*: ${HELPLINE_NUMBER}\n` +
      `📧 *ਈਮੇਲ*: ${SUPPORT_EMAIL}\n` +
      `⏰ *ਸਮਾਂ*: ਸਵੇਰੇ 10:00 AM ਤੋਂ ਸ਼ਾਮ 6:00 PM\n\n` +
      `_(ਮੈਨੂ ਮੁੜ ਸ਼ੁਰੂ ਕਰਨ ਲਈ *0* ਜਾਂ *START* ਲਿਖੋ)_`,
    bn:
      `⚠️ *কাস্টমার কেয়ারের সাথে সরাসরি যোগাযোগ করুন*\n\n` +
      `আপনার সহায়তার জন্য দয়া করে আমাদের কাস্টমার কেয়ার টিমের সাথে সরাসরি যোগাযোগ করুন:\n\n` +
      `📞 *হেল্পলাইন*: ${HELPLINE_NUMBER}\n` +
      `📧 *ইমেল*: ${SUPPORT_EMAIL}\n` +
      `⏰ *সময়*: সকাল 10:00 AM থেকে সন্ধ্যা 6:00 PM\n\n` +
      `_(মেনু পুনরায় শুরু করতে *0* অথবা *START* লিখুন)_`,
    te:
      `⚠️ *కస్టమర్ కేర్‌తో నేరుగా మాట్లాడండి*\n\n` +
      `తక్షణ సహాయం కోసం దయచేసి మా కస్టమర్ కేర్ టీమ్‌ను నేరుగా సంప్రదించండి:\n\n` +
      `📞 *హెల్ప్‌లైన్*: ${HELPLINE_NUMBER}\n` +
      `📧 *ఈమెయిల్*: ${SUPPORT_EMAIL}\n` +
      `⏰ *సమయం*: ఉదయం 10:00 AM నుండి సాయంత్రం 6:00 PM\n\n` +
      `_(మెనూ మళ్లీ ప్రారంభించడానికి *0* లేదా *START* అని పంపండి)_`,
    ta:
      `⚠️ *வாடிக்கையாளர் சேவை மையத்தை தொடர்பு கொள்ளவும்*\n\n` +
      `நேரடி உதவிக்கு எங்கள் வாடிக்கையாளர் சேவை மையத்தை உடனடியாக தொடர்பு கொள்ளவும்:\n\n` +
      `📞 *உதவி எண்*: ${HELPLINE_NUMBER}\n` +
      `📧 *மின்னஞ்சல்*: ${SUPPORT_EMAIL}\n` +
      `⏰ *நேரம்*: காலை 10:00 AM முதல் மாலை 6:00 PM வரை\n\n` +
      `_(மெனுவை மீண்டும் தொடங்க *0* அல்லது *START* என அனுப்பவும்)_`,
    kn:
      `⚠️ *ಗ್ರಾಹಕ ಸೇವಾ ಕೇಂದ್ರವನ್ನು ನೇರವಾಗಿ ಸಂಪರ್ಕಿಸಿ*\n\n` +
      `ತ್ವರಿತ ಸಹಾಯಕ್ಕಾಗಿ ದಯವಿಟ್ಟು ನಮ್ಮ ಗ್ರಾಹಕ ಸೇವಾ ತಂಡವನ್ನು ನೇರವಾಗಿ ಸಂಪರ್ಕಿಸಿ:\n\n` +
      `📞 *ಸಹಾಯವಾಣಿ*: ${HELPLINE_NUMBER}\n` +
      `📧 *ಇಮೇಲ್*: ${SUPPORT_EMAIL}\n` +
      `⏰ *ಸಮಯ*: ಬೆಳಗ್ಗೆ 10:00 AM ರಿಂದ ಸಂಜೆ 6:00 PM\n\n` +
      `_(ಮೆನು ಮರುಪ್ರಾರಂಭಿಸಲು *0* ಅಥವಾ *START* ಎಂದು ಕಳುಹಿಸಿ)_`,
  },
};

// ==========================================
// 2. STATE MACHINE CORE ENGINE
// ==========================================

const STEPS = {
  IDLE: "IDLE",
  AWAITING_LANGUAGE: "AWAITING_LANGUAGE",
  AWAITING_REGIONAL_LANGUAGE: "AWAITING_REGIONAL_LANGUAGE",
  AWAITING_ROLE: "AWAITING_ROLE",
  IN_MENU: "IN_MENU",
  AWAITING_ORDER_ID: "AWAITING_ORDER_ID",
};

const PRIMARY_LANG_MAP = {
  "1": "hi",
  "2": "en",
  "3": "hinglish",
};

const REGIONAL_LANG_MAP = {
  "1": "mr", // Marathi
  "2": "gu", // Gujarati
  "3": "pa", // Punjabi
  "4": "bn", // Bengali
  "5": "te", // Telugu
  "6": "ta", // Tamil
  "7": "kn", // Kannada
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
    t === "reset" ||
    t === "restart" ||
    t === "home" ||
    t === "main menu" ||
    t === "main"
  );
}

/**
 * Checks if input is a 1-step back navigation trigger
 */
function isBackTrigger(text) {
  const t = String(text || "").toLowerCase().trim();
  return (
    t === "0" ||
    t === "back" ||
    t === "b" ||
    t === "wapas" ||
    t === "vaapas" ||
    t === "piche" ||
    t === "peeche" ||
    t === "prev" ||
    t === "previous" ||
    t === "return" ||
    /^(back|wapas|vaapas|piche|peeche|parat|mage|pacha)\s*(jao|karo|plz|please)?$/i.test(t)
  );
}

/**
 * Handles 1-step backward navigation across the menu state machine
 */
function handleBackNavigation(session, senderPhone) {
  const lang = session.data?.lang || "hinglish";
  const role = session.data?.role || null;
  const subOption = session.data?.subOption || null;

  // 1. If currently waiting for Order ID (was inside Customer option 2) -> Step back to Customer Menu
  if (session.step === STEPS.AWAITING_ORDER_ID) {
    sessionManager.updateSession(senderPhone, STEPS.IN_MENU, {
      subOption: null,
      invalidAttempts: 0,
    });
    const categoryMenuObj = TEXTS.CATEGORY_MENU.CUSTOMER;
    return categoryMenuObj[lang] || categoryMenuObj.hinglish || categoryMenuObj.en;
  }

  // 2. If inside a category menu or viewing a detail sub-option
  if (session.step === STEPS.IN_MENU && role) {
    // If viewing a detail sub-option (e.g. rates, app link, docs) -> Step back to the category menu
    if (subOption) {
      sessionManager.updateSession(senderPhone, STEPS.IN_MENU, {
        subOption: null,
        invalidAttempts: 0,
      });
      const categoryMenuObj = TEXTS.CATEGORY_MENU[role];
      return categoryMenuObj[lang] || categoryMenuObj.hinglish || categoryMenuObj.en;
    }

    // If already at the category menu -> Step back to Role selection
    sessionManager.updateSession(senderPhone, STEPS.AWAITING_ROLE, {
      role: null,
      subOption: null,
      invalidAttempts: 0,
    });
    return TEXTS.ROLE_MENU[lang] || TEXTS.ROLE_MENU.hinglish;
  }

  // 3. If in Role Selection (AWAITING_ROLE) -> Step back to Language selection
  if (session.step === STEPS.AWAITING_ROLE) {
    const isRegional = Object.values(REGIONAL_LANG_MAP).includes(lang);
    if (isRegional) {
      sessionManager.updateSession(senderPhone, STEPS.AWAITING_REGIONAL_LANGUAGE, {
        lang: null,
        role: null,
        subOption: null,
        invalidAttempts: 0,
      });
      return TEXTS.REGIONAL_LANGUAGE_MENU;
    }

    sessionManager.updateSession(senderPhone, STEPS.AWAITING_LANGUAGE, {
      lang: null,
      role: null,
      subOption: null,
      invalidAttempts: 0,
    });
    return TEXTS.LANGUAGE_MENU;
  }

  // 4. If in Regional Language Selection (AWAITING_REGIONAL_LANGUAGE) -> Step back to Primary Language Menu
  if (session.step === STEPS.AWAITING_REGIONAL_LANGUAGE) {
    sessionManager.updateSession(senderPhone, STEPS.AWAITING_LANGUAGE, {
      lang: null,
      role: null,
      subOption: null,
      invalidAttempts: 0,
    });
    return TEXTS.LANGUAGE_MENU;
  }

  // 5. If already in AWAITING_LANGUAGE or IDLE -> Already at root
  sessionManager.updateSession(senderPhone, STEPS.AWAITING_LANGUAGE, {
    lang: null,
    role: null,
    subOption: null,
    invalidAttempts: 0,
  });
  return TEXTS.LANGUAGE_MENU;
}

/**
 * Checks if input is an initial greeting
 */
function isGreeting(text) {
  const t = String(text || "").toLowerCase().trim();
  return /^(hi|hello|hey|namaste|pranam|hola|good\s*(morning|afternoon|evening)|start|\/start)$/i.test(t);
}

const MAX_INVALID_ATTEMPTS = 3;

/**
 * Tracks invalid consecutive attempts and escalates directly to Customer Care on 3rd attempt
 */
function handleInvalidAttempt(session, senderPhone, lang, standardPrompt) {
  const currentAttempts = (session.data?.invalidAttempts || 0) + 1;
  sessionManager.updateSession(senderPhone, session.step, {
    invalidAttempts: currentAttempts,
  });

  if (currentAttempts >= MAX_INVALID_ATTEMPTS) {
    sessionManager.updateSession(senderPhone, session.step, {
      invalidAttempts: 0,
    });
    return (
      TEXTS.CUSTOMER_CARE_HANDOFF[lang] ||
      TEXTS.CUSTOMER_CARE_HANDOFF.hinglish ||
      TEXTS.CUSTOMER_CARE_HANDOFF.hi
    );
  }

  return standardPrompt;
}

/**
 * Internal processor: Evaluates message against state machine
 */
async function internalProcessMenuMessage(senderPhone, textMessage) {
  const session = sessionManager.getSession(senderPhone);
  const clean = String(textMessage || "").trim();
  const lang = session.data?.lang || "hinglish";
  const role = session.data?.role || null;

  logger.info(`🤖 [MenuBot] Phone: ${senderPhone} | Step: ${session.step} | Lang: ${lang} | Input: "${clean}"`);

  // 1. Full Reset / Restart Trigger (reset, restart, home, main menu)
  if (isResetTrigger(clean)) {
    sessionManager.updateSession(senderPhone, STEPS.AWAITING_LANGUAGE, {
      lang: null,
      role: null,
      subOption: null,
      invalidAttempts: 0,
    });
    return TEXTS.LANGUAGE_MENU;
  }

  // 2. Step-Back Trigger (0, back, wapas, piche, prev)
  if (isBackTrigger(clean)) {
    return handleBackNavigation(session, senderPhone);
  }

  // 3. Brand new user, IDLE, or Greeting -> Present Language Menu
  if (session.step === STEPS.IDLE || isGreeting(clean)) {
    sessionManager.updateSession(senderPhone, STEPS.AWAITING_LANGUAGE, {
      invalidAttempts: 0,
      subOption: null,
    });
    return TEXTS.LANGUAGE_MENU;
  }

  // 4. Step: Awaiting Primary Language Selection (1: Hindi, 2: English, 3: Hinglish, 4: Other Indian Languages)
  if (session.step === STEPS.AWAITING_LANGUAGE) {
    if (clean === "4") {
      sessionManager.updateSession(senderPhone, STEPS.AWAITING_REGIONAL_LANGUAGE, {
        invalidAttempts: 0,
        subOption: null,
      });
      return TEXTS.REGIONAL_LANGUAGE_MENU;
    }

    const selectedLang = PRIMARY_LANG_MAP[clean];
    if (selectedLang) {
      sessionManager.updateSession(senderPhone, STEPS.AWAITING_ROLE, {
        lang: selectedLang,
        subOption: null,
        invalidAttempts: 0,
      });
      return TEXTS.ROLE_MENU[selectedLang] || TEXTS.ROLE_MENU.hinglish;
    }

    // Invalid choice during language selection
    return handleInvalidAttempt(session, senderPhone, "hinglish", TEXTS.INVALID_LANGUAGE);
  }

  // 5. Step: Awaiting Regional Language Selection (1: Marathi, 2: Gujarati, 3: Punjabi, 4: Bengali, 5: Telugu, 6: Tamil, 7: Kannada)
  if (session.step === STEPS.AWAITING_REGIONAL_LANGUAGE) {
    const selectedRegionalLang = REGIONAL_LANG_MAP[clean];
    if (selectedRegionalLang) {
      sessionManager.updateSession(senderPhone, STEPS.AWAITING_ROLE, {
        lang: selectedRegionalLang,
        subOption: null,
        invalidAttempts: 0,
      });
      return TEXTS.ROLE_MENU[selectedRegionalLang] || TEXTS.ROLE_MENU.en;
    }

    return handleInvalidAttempt(session, senderPhone, "hinglish", TEXTS.INVALID_REGIONAL_LANGUAGE);
  }

  // 6. Step: Awaiting Role / Category Selection (1: Customer, 2: Driver, 3: Job Seeker)
  if (session.step === STEPS.AWAITING_ROLE) {
    const selectedRole = ROLE_MAP[clean];
    if (selectedRole) {
      sessionManager.updateSession(senderPhone, STEPS.IN_MENU, {
        role: selectedRole,
        subOption: null,
        invalidAttempts: 0,
      });
      const categoryMenuObj = TEXTS.CATEGORY_MENU[selectedRole];
      return categoryMenuObj[lang] || categoryMenuObj.hinglish || categoryMenuObj.en;
    }

    // Invalid choice during role selection: Re-send role prompt with warning
    return handleInvalidAttempt(
      session,
      senderPhone,
      lang,
      TEXTS.INVALID_ROLE[lang] || TEXTS.INVALID_ROLE.hinglish || TEXTS.INVALID_ROLE.en
    );
  }

  // 7. Step: Waiting for Order ID to track
  if (session.step === STEPS.AWAITING_ORDER_ID) {
    const orderIdMatch = clean.match(/\d+/);
    if (orderIdMatch) {
      const orderId = orderIdMatch[0];
      const trackingResult = await customerHandler.handleTrackingQuery(orderId, senderPhone);
      sessionManager.updateSession(senderPhone, STEPS.IN_MENU, {
        subOption: "2",
        invalidAttempts: 0,
      });
      return (
        `${trackingResult}\n\n` +
        `_(Reply with another number or '0' to go back)_`
      );
    }

    // Non-digit input while expecting Order ID: Send guardrail fallback and restore IN_MENU
    sessionManager.updateSession(senderPhone, STEPS.IN_MENU, {
      subOption: null,
    });
    const fallbackText = TEXTS.GUARDRAIL_FALLBACK[lang] || TEXTS.GUARDRAIL_FALLBACK.hinglish;
    const catMenu = TEXTS.CATEGORY_MENU.CUSTOMER[lang] || TEXTS.CATEGORY_MENU.CUSTOMER.hinglish;
    return handleInvalidAttempt(session, senderPhone, lang, `${fallbackText}\n\n${catMenu}`);
  }

  // 8. Step: In Active Category Menu (IN_MENU)
  if (session.step === STEPS.IN_MENU && role) {
    // If Customer chose Option 2 (Track Running Order), prompt for Order ID
    if (role === "CUSTOMER" && clean === "2") {
      sessionManager.updateSession(senderPhone, STEPS.AWAITING_ORDER_ID, {
        subOption: "2",
        invalidAttempts: 0,
      });
      const promptObj = TEXTS.RESPONSES.CUSTOMER["2_PROMPT"];
      return promptObj[lang] || promptObj.hinglish || promptObj.en;
    }

    // Check if user selected a valid sub-option (1, 2, 3, 4)
    const categoryResponses = TEXTS.RESPONSES[role];
    if (categoryResponses && categoryResponses[clean]) {
      sessionManager.updateSession(senderPhone, STEPS.IN_MENU, {
        subOption: clean,
        invalidAttempts: 0,
      });
      const respObj = categoryResponses[clean];
      return respObj[lang] || respObj.hinglish || respObj.en;
    }

    // STRICT GUARDRAIL:
    // If user enters free-form text, random conversation, or an invalid number:
    // The bot tracks invalid attempts. On 3rd attempt, escalates to Customer Care!
    const fallbackText = TEXTS.GUARDRAIL_FALLBACK[lang] || TEXTS.GUARDRAIL_FALLBACK.hinglish;
    const categoryMenuObj = TEXTS.CATEGORY_MENU[role];
    const categoryMenu = categoryMenuObj[lang] || categoryMenuObj.hinglish || categoryMenuObj.en;
    return handleInvalidAttempt(session, senderPhone, lang, `${fallbackText}\n\n${categoryMenu}`);
  }

  // Default fallback if session in unknown state
  sessionManager.updateSession(senderPhone, STEPS.AWAITING_LANGUAGE, {
    invalidAttempts: 0,
    subOption: null,
  });
  return TEXTS.LANGUAGE_MENU;
}

const NAV_FOOTER =
  `\n\n─────────────────────\n` +
  `🔙 _पीछे जाने के लिए *BACK* या *0* लिखें | Type *BACK* to go back_\n` +
  `⏸️ _बॉट रोकने के लिए *STOP* लिखें | Type *STOP* to pause_`;

const STOP_FOOTER = NAV_FOOTER;

/**
 * Main function: Processes any incoming WhatsApp message strictly within the Bounded State Machine,
 * and appends the standard Back & STOP hint to every message.
 */
async function processMenuMessage(senderPhone, textMessage) {
  const result = await internalProcessMenuMessage(senderPhone, textMessage);
  if (result && typeof result === "string" && !result.includes("बॉट रोकने के लिए *STOP* लिखें")) {
    return `${result}${NAV_FOOTER}`;
  }
  return result;
}

module.exports = {
  STEPS,
  TEXTS,
  NAV_FOOTER,
  STOP_FOOTER,
  processMenuMessage,
  isResetTrigger,
  isBackTrigger,
  isGreeting,
  HELPLINE_NUMBER,
};
