/*
 * Inline form help for people who are new to Zakat.
 *
 * Every string is written in plain, non-scholarly language and is available
 * in English plus the languages spoken where each supported currency is used.
 * English is always the default; the translation toggle only appears when the
 * selected currency maps to extra languages (e.g. INR -> Urdu/Hindi).
 *
 * Usage from ui.js:
 *   ZKHelp.bind(node, key)   — set node text to t(key) and keep it updatable
 *   ZKHelp.refresh()         — re-translate every bound node after setLang()
 *   ZKHelp.availableLangs()  — languages for the current currency
 */
(function (global) {
  "use strict";

  const LANG_LABELS = {
    en: "English",
    ur: "اردو",            // اردو
    hi: "हिन्दी", // हिन्दी
    ar: "العربية", // العربية
    bn: "বাংলা",       // বাংলা
  };

  const RTL_LANGS = new Set(["ur", "ar"]);

  // Which extra help languages make sense for each currency. English is
  // always offered first; currencies not listed here stay English-only.
  const CURRENCY_LANGS = {
    INR: ["ur", "hi"],
    PKR: ["ur"],
    BDT: ["bn"],
    AED: ["ar"], SAR: ["ar"], QAR: ["ar"], KWD: ["ar"], BHD: ["ar"],
    OMR: ["ar"], JOD: ["ar"], EGP: ["ar"], MAD: ["ar"], DZD: ["ar"], TND: ["ar"],
  };

  const LS_KEY = "zk_help_lang";

  const S = {
    // ---- Shared form intro ----
    intro_zakat: {
      en: "New to Zakat? It is a yearly charity duty: 2.5% of wealth (cash, gold, savings) kept for one lunar year, once it crosses a minimum called nisab. Add each thing this person owns — the app does the maths.",
      ur: "زکوٰۃ ہر سال ادا کی جانے والی فرض خیرات ہے: جو مال (نقدی، سونا، بچت) ایک قمری سال تک آپ کے پاس رہے اور نصاب سے زیادہ ہو، اس کا 2.5%۔ اس شخص کی ہر چیز یہاں درج کریں — حساب ایپ خود کرے گی۔",
      hi: "ज़कात हर साल दी जाने वाली फ़र्ज़ खैरात है: जो माल (नक़दी, सोना, बचत) एक चाँद-साल आपके पास रहे और निसाब से ज़्यादा हो, उसका 2.5%। इस व्यक्ति की हर चीज़ यहाँ जोड़ें — हिसाब ऐप खुद करेगी।",
      ar: "الزكاة صدقة واجبة كل عام: 2.5% من المال (نقود، ذهب، مدّخرات) الذي بقي عندك سنة قمرية وتجاوز النصاب. أضف كل ما يملكه هذا الشخص — والتطبيق يحسب عنك.",
      bn: "যাকাত প্রতি বছর দেওয়া ফরজ দান: যে সম্পদ (নগদ, সোনা, সঞ্চয়) এক চান্দ্র বছর আপনার কাছে থাকে এবং নিসাবের বেশি হয়, তার ২.৫%। এই ব্যক্তির প্রতিটি সম্পদ এখানে যোগ করুন — হিসাব অ্যাপ করবে।",
    },

    // ---- Member form ----
    member_intro: {
      en: "Zakat is counted per person. Add each family member first, then add what they own.",
      ur: "زکوٰۃ ہر فرد کے حساب سے بنتی ہے۔ پہلے گھر کا ہر فرد شامل کریں، پھر اس کا مال درج کریں۔",
      hi: "ज़कात हर व्यक्ति के हिसाब से बनती है। पहले घर का हर सदस्य जोड़ें, फिर उसका माल दर्ज करें।",
      ar: "تُحسب الزكاة لكل شخص على حدة. أضف أفراد العائلة أولاً، ثم أضف ما يملكون.",
      bn: "যাকাত প্রত্যেক ব্যক্তির জন্য আলাদা হিসাব হয়। আগে পরিবারের সদস্য যোগ করুন, তারপর তার সম্পদ।",
    },
    member_name: {
      en: "Who owns the wealth you are about to add — yourself, your spouse, a parent or a child.",
      ur: "جس کا مال آپ درج کرنے والے ہیں — آپ خود، شریکِ حیات، والدین یا بچے۔",
      hi: "जिसका माल आप जोड़ने जा रहे हैं — आप खुद, जीवनसाथी, माता-पिता या बच्चे।",
      ar: "من يملك هذا المال — أنت، زوجك، أحد الوالدين أو طفل.",
      bn: "যার সম্পদ আপনি যোগ করছেন — আপনি নিজে, স্ত্রী/স্বামী, বাবা-মা বা সন্তান।",
    },
    member_rel: {
      en: "How this person is related to the head of the family — Self, Spouse, Son, Daughter, Mother…",
      ur: "گھر کے سربراہ سے رشتہ — خود، شریکِ حیات، بیٹا، بیٹی، والدہ…",
      hi: "घर के मुखिया से रिश्ता — खुद, जीवनसाथी, बेटा, बेटी, माँ…",
      ar: "صلة هذا الشخص برب الأسرة — أنا، زوج، ابن، ابنة، أم…",
      bn: "পরিবারের প্রধানের সাথে সম্পর্ক — নিজে, স্ত্রী/স্বামী, ছেলে, মেয়ে, মা…",
    },

    // ---- Asset form: fields ----
    asset_category: {
      en: "What kind of wealth is this? Pick the closest match — the form shows only the boxes you need.",
      ur: "یہ کس قسم کا مال ہے؟ قریب ترین قسم چنیں — فارم صرف ضروری خانے دکھائے گا۔",
      hi: "यह किस तरह का माल है? सबसे मिलती-जुलती किस्म चुनें — फ़ॉर्म सिर्फ़ ज़रूरी खाने दिखाएगा।",
      ar: "ما نوع هذا المال؟ اختر الأقرب — وستظهر الحقول اللازمة فقط.",
      bn: "এটি কোন ধরনের সম্পদ? সবচেয়ে কাছাকাছিটি বেছে নিন — ফর্মে শুধু প্রয়োজনীয় ঘরগুলো দেখাবে।",
    },
    asset_desc: {
      en: "A short name so you can recognise it later — e.g. “HDFC savings” or “Wedding gold chain”.",
      ur: "مختصر نام تاکہ بعد میں پہچان سکیں — جیسے “بینک بچت” یا “شادی کی سونے کی چین”۔",
      hi: "छोटा सा नाम ताकि बाद में पहचान सकें — जैसे “बैंक बचत” या “शादी की सोने की चेन”।",
      ar: "اسم قصير لتعرفه لاحقاً — مثل “حساب التوفير” أو “سلسلة ذهب الزواج”.",
      bn: "ছোট নাম যাতে পরে চিনতে পারেন — যেমন “ব্যাংক সঞ্চয়” বা “বিয়ের সোনার চেন”।",
    },
    asset_value: {
      en: "Today's selling value — what you would get if you sold it now, not what you paid for it.",
      ur: "آج کی قیمت — ابھی بیچیں تو جو ملے، وہ لکھیں، خرید قیمت نہیں۔",
      hi: "आज की कीमत — अभी बेचें तो जो मिले, वह लिखें, खरीद कीमत नहीं।",
      ar: "قيمة البيع اليوم — ما تحصل عليه لو بعته الآن، لا ثمن الشراء.",
      bn: "আজকের বিক্রয় মূল্য — এখন বিক্রি করলে যা পাবেন তা লিখুন, কেনার দাম নয়।",
    },
    asset_weight: {
      en: "Total weight in grams, from the bill or a jeweller's scale. If you know tola: 1 tola ≈ 11.66 g.",
      ur: "کل وزن گرام میں — بل یا سنار کے تول سے۔ تولہ معلوم ہو تو: 1 تولہ ≈ 11.66 گرام۔",
      hi: "कुल वज़न ग्राम में — बिल या सुनार के तोल से। तोला पता हो तो: 1 तोला ≈ 11.66 ग्राम।",
      ar: "الوزن الكلي بالجرام من الفاتورة أو ميزان الصائغ.",
      bn: "মোট ওজন গ্রামে — রসিদ বা স্বর্ণকারের পাল্লা থেকে। ভরি জানা থাকলে: ১ ভরি ≈ ১১.৬৬ গ্রাম।",
    },
    asset_purity: {
      en: "The purity stamped on the piece or printed on the bill — most Indian gold jewellery is 22K.",
      ur: "زیور پر مہر یا بل پر لکھی خالصیت — زیادہ تر زیورات 22 کیرٹ کے ہوتے ہیں۔",
      hi: "गहने पर मुहर या बिल पर छपी शुद्धता — ज़्यादातर गहने 22 कैरेट के होते हैं।",
      ar: "العيار المختوم على القطعة أو المطبوع في الفاتورة — عيار 21 أو 22 شائع.",
      bn: "গহনায় ছাপ বা রসিদে লেখা বিশুদ্ধতা — বেশিরভাগ গহনা ২২ ক্যারেট।",
    },
    asset_purity_custom: {
      en: "Enter karat, fineness, % or decimal fraction.",
      ur: "کیرٹ، فائننیس، فیصد یا اعشاریہ لکھیں۔",
      hi: "कैरेट, फ़ाइननेस, % या दशमलव लिखें।",
      ar: "أدخل العيار أو النقاوة أو النسبة المئوية.",
      bn: "ক্যারেট, ফাইননেস, % বা দশমিক লিখুন।",
    },
    asset_carats: {
      en: "Diamond weight in carats (from the certificate or bill). Leave the value box empty to price automatically.",
      ur: "ہیرے کا وزن کیرٹ میں (سرٹیفکیٹ یا بل سے)۔ قیمت خالی چھوڑیں تو خود حساب ہوگا۔",
      hi: "हीरे का वज़न कैरेट में (सर्टिफ़िकेट या बिल से)। कीमत खाली छोड़ें तो खुद हिसाब होगा।",
      ar: "وزن الماس بالقيراط (من الشهادة أو الفاتورة). اترك القيمة فارغة لحسابها تلقائياً.",
      bn: "হীরার ওজন ক্যারেটে (সার্টিফিকেট বা রসিদ থেকে)। মূল্য খালি রাখলে নিজে হিসাব হবে।",
    },
    asset_quantity: {
      en: "How many animals you own in total.",
      ur: "کل کتنے جانور ہیں۔",
      hi: "कुल कितने जानवर हैं।",
      ar: "كم عدد الحيوانات التي تملكها.",
      bn: "মোট কতগুলো পশু আছে।",
    },
    asset_hawl: {
      en: "Since when have you owned this? Zakat is due only after one lunar year (≈354 days) of owning it. Leave empty if unsure — it will still be counted.",
      ur: "یہ کب سے آپ کے پاس ہے؟ زکوٰۃ ایک قمری سال (تقریباً 354 دن) گزرنے پر فرض ہوتی ہے۔ یقین نہ ہو تو خالی چھوڑیں — پھر بھی شمار ہوگا۔",
      hi: "यह कब से आपके पास है? ज़कात एक चाँद-साल (लगभग 354 दिन) बीतने पर फ़र्ज़ होती है। पक्का पता न हो तो खाली छोड़ें — फिर भी गिना जाएगा।",
      ar: "منذ متى تملك هذا؟ تجب الزكاة بعد سنة قمرية (نحو 354 يوماً) من الملك. اتركه فارغاً إن لم تتأكد — وسيُحسب مع ذلك.",
      bn: "এটি কবে থেকে আপনার কাছে? এক চান্দ্র বছর (প্রায় ৩৫৪ দিন) পর যাকাত ফরজ হয়। নিশ্চিত না হলে খালি রাখুন — তবুও গণনা হবে।",
    },
    asset_acquired: {
      en: "The year you first got this — used only for history charts. Optional.",
      ur: "جس سال یہ ملا — صرف چارٹس کے لیے۔ اختیاری۔",
      hi: "जिस साल यह मिला — सिर्फ़ चार्ट के लिए। ऐच्छिक।",
      ar: "سنة حصولك عليه — للرسوم البيانية فقط. اختياري.",
      bn: "যে বছর এটি পেয়েছেন — শুধু চার্টের জন্য। ঐচ্ছিক।",
    },
    asset_jewelry: {
      en: "Tick if it is jewellery worn regularly. Shafi'i, Maliki and Hanbali schools exempt worn jewellery; Hanafi counts it.",
      ur: "اگر یہ روزانہ پہننے کا زیور ہے تو نشان لگائیں۔ شافعی، مالکی اور حنبلی میں معاف، حنفی میں شامل۔",
      hi: "अगर यह रोज़ पहनने का गहना है तो टिक करें। शाफ़ेई, मालिकी, हंबली में माफ़़, हनफ़ी में शामिल।",
      ar: "ضع علامة إن كان حلياً يُلبس عادة. الشافعية والمالكية والحنابلة يعفونه، والحنفية يحسبونه.",
      bn: "নিয়মিত পরা গহনা হলে টিক দিন। শাফেয়ী, মালেকী, হাম্বলীতে মাফ; হানাফীতে গণনা হয়।",
    },
    asset_pf_balance: {
      en: "Copy the balance from your latest PF/EPF statement or passbook.",
      ur: "اپنے تازہ PF/EPF اسٹیٹمنٹ یا پاس بک سے بیلنس لکھیں۔",
      hi: "अपने ताज़ा PF/EPF स्टेटमेंट या पासबुक से बैलेंस लिखें।",
      ar: "انقل الرصيد من أحدث كشف لصندوق الادخار.",
      bn: "সর্বশেষ PF/EPF স্টেটমেন্ট থেকে ব্যালেন্স লিখুন।",
    },
    asset_pf_asof: {
      en: "The date printed on that statement — the app projects today's balance from it.",
      ur: "اس اسٹیٹمنٹ پر لکھی تاریخ — ایپ اس سے آج کا بیلنس نکالتی ہے۔",
      hi: "उस स्टेटमेंट पर छपी तारीख — ऐप इससे आज का बैलेंस निकालती है।",
      ar: "التاريخ المطبوع في الكشف — يقدّر التطبيق رصيد اليوم منه.",
      bn: "স্টেটমেন্টের তারিখ — এর থেকে অ্যাপ আজকের ব্যালেন্স বের করে।",
    },
    asset_pf_monthly: {
      en: "The amount added every month — see your salary slip.",
      ur: "ہر ماہ جمع ہونے والی رقم — تنخواہ سلپ دیکھیں۔",
      hi: "हर महीने जमा होने वाली राशि — सैलरी स्लिप देखें।",
      ar: "المبلغ المضاف كل شهر — انظر قسيمة الراتب.",
      bn: "প্রতি মাসে জমা হওয়া টাকা — স্যালারি স্লিপ দেখুন।",
    },
    asset_pf_rate: {
      en: "Yearly interest rate of the fund — EPF India is about 8.25%.",
      ur: "فنڈ کی سالانہ شرح — EPF انڈیا تقریباً 8.25% ہے۔",
      hi: "फ़ंड की सालाना दर — EPF इंडिया लगभग 8.25% है।",
      ar: "معدل الفائدة السنوي للصندوق.",
      bn: "ফান্ডের বার্ষিক হার — EPF ইন্ডিয়া প্রায় ৮.২৫%।",
    },
    asset_photo: {
      en: "Optional photo of the item. Stored only in your browser and included in Excel backups.",
      ur: "چیز کی تصویر (اختیاری)۔ صرف آپ کے براؤزر میں محفوظ اور ایکسل بیک اپ میں شامل۔",
      hi: "चीज़ की फ़ोटो (ऐच्छिक)। सिर्फ़ आपके ब्राउज़र में सुरक्षित, एक्सेल बैकअप में शामिल।",
      ar: "صورة اختيارية. تُحفظ في متصفحك فقط وتُضمّن في النسخ الاحتياطية.",
      bn: "জিনিসের ছবি (ঐচ্ছিক)। শুধু আপনার ব্রাউজারে থাকে, এক্সেল ব্যাকআপে যুক্ত হয়।",
    },
    asset_subtype_property: {
      en: "Personal residence = the house you live in (no zakat). Rental = you collect rent (building exempt; add saved rent under Cash). Trade = bought to sell (full value counts).",
      ur: "ذاتی رہائش = جس گھر میں رہتے ہیں (زکوٰۃ نہیں)۔ کرایہ = عمارت معاف، بچا ہوا کرایہ نقدی میں لکھیں۔ تجارت = بیچنے کے لیے خریدی — پوری قیمت شمار ہوگی۔",
      hi: "निजी आवास = जिस घर में रहते हैं (ज़कात नहीं)। किराया = इमारत माफ़, बचा किराया नक़दी में जोड़ें। व्यापार = बेचने के लिए खरीदी — पूरी कीमत गिनी जाएगी।",
      ar: "سكن شخصي = البيت الذي تسكنه (لا زكاة). إيجار = المبنى معفى، وأضف الإيجار المدّخر في النقد. تجارة = اشتُري للبيع — تُحسب القيمة كاملة.",
      bn: "নিজ বাসস্থান = যে বাড়িতে থাকেন (যাকাত নেই)। ভাড়া = ভবন মাফ, জমানো ভাড়া নগদে যোগ করুন। ব্যবসা = বিক্রির জন্য কেনা — পুরো মূল্য গণনা হয়।",
    },
    asset_subtype_agri: {
      en: "How the land was watered: rain-fed pays 10%, irrigated 5%, mixed 7.5%.",
      ur: "زمین کو پانی کیسے ملا: بارش سے 10%، آب پاشی سے 5%، ملا جلا 7.5%۔",
      hi: "ज़मीन को पानी कैसे मिला: बारिश से 10%, सिंचाई से 5%, मिला-जुला 7.5%।",
      ar: "طريقة السقي: بالمطر 10%، بالري 5%، مختلط 7.5%.",
      bn: "জমিতে পানি কীভাবে এল: বৃষ্টিতে ১০%, সেচে ৫%, মিশ্র ৭.৫%।",
    },
    asset_subtype_livestock: {
      en: "Which animal — the Sunnah sets different zakat counts for sheep/goats, cattle and camels.",
      ur: "کون سا جانور — بھیڑ بکری، گائے اور اونٹ کے لیے سنت میں الگ الگ حساب ہے۔",
      hi: "कौन सा जानवर — भेड़-बकरी, गाय और ऊँट के लिए सुन्नत में अलग-अलग हिसाब है।",
      ar: "أي حيوان — فللغنم والبقر والإبل أنصبة مختلفة في السنة.",
      bn: "কোন পশু — ভেড়া-ছাগল, গরু ও উটের জন্য সুন্নাহতে আলাদা হিসাব।",
    },

    // ---- Payment form ----
    pay_intro: {
      en: "Already gave zakat this year? Record it here — it is subtracted from the amount due.",
      ur: "اس سال زکوٰۃ دے چکے ہیں؟ یہاں لکھیں — وہ واجب رقم سے کم ہو جائے گی۔",
      hi: "इस साल ज़कात दे चुके हैं? यहाँ लिखें — वह देय राशि से घट जाएगी।",
      ar: "هل دفعت زكاة هذا العام؟ سجّلها هنا — وتُخصم من المبلغ المستحق.",
      bn: "এ বছর যাকাত দিয়েছেন? এখানে লিখুন — দেয় অর্থ থেকে বাদ যাবে।",
    },
    pay_given: {
      en: "Who received it — a person in need, masjid, madrasa or charity.",
      ur: "کس کو دی — ضرورت مند شخص، مسجد، مدرسہ یا خیراتی ادارہ۔",
      hi: "किसे दी — ज़रूरतमंद व्यक्ति, मस्जिद, मदरसा या संस्था।",
      ar: "من استلمها — محتاج، مسجد، مدرسة أو جمعية خيرية.",
      bn: "কাকে দিয়েছেন — অভাবী ব্যক্তি, মসজিদ, মাদ্রাসা বা সংস্থা।",
    },
    pay_amount: {
      en: "How much you gave.",
      ur: "کتنی رقم دی۔",
      hi: "कितनी राशि दी।",
      ar: "كم دفعت.",
      bn: "কত টাকা দিয়েছেন।",
    },

    // ---- Category explainers ----
    cat_Gold: {
      en: "Gold you own — jewellery, coins, bars. Enter the weight in grams and the karat; the app prices it at today's gold rate.",
      ur: "آپ کا سونا — زیورات، سکے، بسکٹ۔ وزن گرام میں اور کیرٹ لکھیں — آج کے ریٹ سے قیمت خود بنے گی۔",
      hi: "आपका सोना — गहने, सिक्के, बिस्कुट। वज़न ग्राम में और कैरेट लिखें — आज के रेट से कीमत खुद बनेगी।",
      ar: "الذهب الذي تملكه — حلي، عملات، سبائك. أدخل الوزن بالجرام والعيار — ويُقيّم بسعر اليوم.",
      bn: "আপনার সোনা — গহনা, মুদ্রা, বার। ওজন গ্রামে ও ক্যারেট লিখুন — আজকের দরে দাম হবে।",
    },
    cat_Silver: {
      en: "Silver items — jewellery, coins, utensils. Enter weight and purity; today's silver rate is applied automatically.",
      ur: "چاندی — زیور، سکے، برتن۔ وزن اور خالصیت لکھیں — آج کا ریٹ خود لگے گا۔",
      hi: "चाँदी — गहने, सिक्के, बर्तन। वज़न और शुद्धता लिखें — आज का रेट खुद लगेगा।",
      ar: "الفضة — حلي، عملات، أوانٍ. أدخل الوزن والنقاوة — ويُطبّق سعر اليوم.",
      bn: "রূপা — গহনা, মুদ্রা, বাসন। ওজন ও বিশুদ্ধতা লিখুন — আজকের দর লাগবে।",
    },
    cat_Platinum: {
      en: "Platinum items. Enter weight and purity; valued at today's rate.",
      ur: "پلاٹینم — وزن اور خالصیت لکھیں، آج کے ریٹ سے قیمت بنے گی۔",
      hi: "प्लेटिनम — वज़न और शुद्धता लिखें, आज के रेट से कीमत बनेगी।",
      ar: "البلاتين — أدخل الوزن والنقاوة، ويُقيّم بسعر اليوم.",
      bn: "প্লাটিনাম — ওজন ও বিশুদ্ধতা লিখুন, আজকের দরে দাম হবে।",
    },
    cat_Diamond: {
      en: "Diamond jewellery or stones. Enter carats to price automatically, or type today's resale value.",
      ur: "ہیرے کا زیور یا نگ۔ کیرٹ لکھیں تو قیمت خود بنے گی، یا آج کی قیمت خود لکھیں۔",
      hi: "हीरे का गहना या नग। कैरेट लिखें तो कीमत खुद बनेगी, या आज की कीमत खुद लिखें।",
      ar: "حلي أو أحجار الماس. أدخل القيراط للتقييم التلقائي، أو اكتب قيمة البيع اليوم.",
      bn: "হীরার গহনা বা পাথর। ক্যারেট লিখলে দাম নিজে হবে, নয়তো আজকের বিক্রয় মূল্য লিখুন।",
    },
    cat_Livestock: {
      en: "Sheep, goats, cattle or camels kept for milk or breeding. Enter how many and the value of one animal — the Sunnah tiers are applied.",
      ur: "دودھ یا افزائش کے لیے بھیڑ بکری، گائے یا اونٹ۔ تعداد اور فی جانور قیمت لکھیں — سنت کے حساب سے زکوٰۃ بنے گی۔",
      hi: "दूध या प्रजनन के लिए भेड़-बकरी, गाय या ऊँट। संख्या और प्रति जानवर कीमत लिखें — सुन्नत के हिसाब से ज़कात बनेगी।",
      ar: "غنم أو بقر أو إبل للحليب أو التربية. أدخل العدد وقيمة الرأس — وتُطبّق أنصبة السنة.",
      bn: "দুধ বা প্রজননের জন্য ভেড়া-ছাগল, গরু বা উট। সংখ্যা ও প্রতি পশুর দাম লিখুন।",
    },
    cat_Agriculture: {
      en: "Crops you harvested. Enter the harvest value; rain-fed land pays 10%, irrigated 5%. No one-year wait — due at harvest.",
      ur: "فصل کی پیداوار۔ پیداوار کی قیمت لکھیں — بارانی زمین 10%، آب پاشی 5%۔ سال کا انتظار نہیں — کٹائی پر واجب۔",
      hi: "कटी हुई फ़सल। पैदावार की कीमत लिखें — बारिश वाली ज़मीन 10%, सिंचित 5%। साल का इंतज़ार नहीं — कटाई पर देय।",
      ar: "المحصول. أدخل قيمته — المسقي بالمطر 10% وبالري 5%. لا تنتظر سنة — تجب عند الحصاد.",
      bn: "কাটা ফসল। ফসলের মূল্য লিখুন — বৃষ্টির জমি ১০%, সেচের ৫%। বছরের অপেক্ষা নেই।",
    },
    cat_Cash: {
      en: "Money in hand, bank accounts and fixed deposits. Enter the total you hold today — not your monthly salary.",
      ur: "ہاتھ میں نقدی، بینک اکاؤنٹ اور FD۔ آج جو کل رقم موجود ہے وہ لکھیں — ماہانہ تنخواہ نہیں۔",
      hi: "हाथ की नक़दी, बैंक खाते और FD। आज जो कुल राशि मौजूद है वह लिखें — मासिक सैलरी नहीं।",
      ar: "النقد في اليد والحسابات والودائع. أدخل المجموع الذي تملكه اليوم — لا راتبك الشهري.",
      bn: "হাতের নগদ, ব্যাংক অ্যাকাউন্ট ও FD। আজ মোট যা আছে তা লিখুন — মাসিক বেতন নয়।",
    },
    cat_PF: {
      en: "Provident fund (PF/EPF). Enter the balance from your statement and the monthly contributions — the app estimates today's balance.",
      ur: "پراویڈنٹ فنڈ (PF/EPF)۔ اسٹیٹمنٹ کا بیلنس اور ماہانہ جمع رقم لکھیں — ایپ آج کا اندازہ لگائے گی۔",
      hi: "प्रोविडेंट फ़ंड (PF/EPF)। स्टेटमेंट का बैलेंस और मासिक जमा लिखें — ऐप आज का अनुमान लगाएगी।",
      ar: "صندوق الادخار. أدخل رصيد الكشف والاشتراكات الشهرية — ويُقدّر التطبيق رصيد اليوم.",
      bn: "প্রভিডেন্ট ফান্ড (PF/EPF)। স্টেটমেন্টের ব্যালেন্স ও মাসিক জমা লিখুন।",
    },
    cat_Stocks: {
      en: "Shares, mutual funds and similar investments. Enter today's total value shown in your broker or fund app.",
      ur: "حصص، میوچول فنڈ وغیرہ۔ بروکر ایپ میں آج کی کل قیمت لکھیں۔",
      hi: "शेयर, म्यूचुअल फ़ंड आदि। ब्रोकर ऐप में दिख रही आज की कुल कीमत लिखें।",
      ar: "الأسهم والصناديق الاستثمارية. أدخل القيمة الإجمالية اليوم من تطبيق الوسيط.",
      bn: "শেয়ার, মিউচুয়াল ফান্ড ইত্যাদি। ব্রোকার অ্যাপে আজকের মোট মূল্য লিখুন।",
    },
    cat_Business: {
      en: "Goods kept for sale plus business cash. Enter today's resale value of the stock — not the shop building or machines.",
      ur: "بیچنے کا مال اور کاروباری نقدی۔ اسٹاک کی آج کی قیمت لکھیں — دکان کی عمارت یا مشینیں نہیں۔",
      hi: "बेचने का माल और कारोबारी नक़दी। स्टॉक की आज की कीमत लिखें — दुकान की इमारत या मशीनें नहीं।",
      ar: "بضاعة التجارة ونقد العمل. أدخل قيمة البضاعة اليوم — لا المبنى ولا الآلات.",
      bn: "বিক্রির পণ্য ও ব্যবসার নগদ। স্টকের আজকের মূল্য লিখুন — দোকানের ভবন বা যন্ত্র নয়।",
    },
    cat_Property: {
      en: "Only property bought to resell counts fully for zakat. Your own home is exempt; for rentals the building is exempt — add saved rent under Cash.",
      ur: "صرف بیچنے کے لیے خریدی جائیداد پر پوری زکوٰۃ۔ اپنا گھر معاف؛ کرایے کی عمارت بھی معاف — بچا ہوا کرایہ نقدی میں لکھیں۔",
      hi: "सिर्फ़ बेचने के लिए खरीदी प्रॉपर्टी पर पूरी ज़कात। अपना घर माफ़; किराए की इमारत भी माफ़ — बचा किराया नक़दी में जोड़ें।",
      ar: "العقار المشترى للبيع فقط تجب فيه الزكاة كاملة. بيتك معفى، ومبنى الإيجار معفى — أضف الإيجار المدّخر في النقد.",
      bn: "শুধু বিক্রির জন্য কেনা সম্পত্তিতে পূর্ণ যাকাত। নিজের বাড়ি মাফ; ভাড়ার ভবনও মাফ — জমানো ভাড়া নগদে যোগ করুন।",
    },
    cat_Partnership: {
      en: "Your share in a joint business. Enter what your share is worth today.",
      ur: "مشترکہ کاروبار میں آپ کا حصہ۔ آج اس حصے کی قیمت لکھیں۔",
      hi: "साझे कारोबार में आपका हिस्सा। आज उस हिस्से की कीमत लिखें।",
      ar: "حصتك في شراكة. أدخل قيمة حصتك اليوم.",
      bn: "যৌথ ব্যবসায় আপনার অংশ। আজ তার মূল্য লিখুন।",
    },
    cat_Rikaz: {
      en: "Buried treasure or found valuables — rare. 20% is due once, immediately; no one-year wait.",
      ur: "دفن خزانہ یا ملا ہوا مال — نادر۔ 20% ایک بار فوراً واجب؛ سال کا انتظار نہیں۔",
      hi: "दबा खज़ाना या मिला माल — दुर्लभ। 20% एक बार तुरंत देय; साल का इंतज़ार नहीं।",
      ar: "الركاز — كنز مدفون. فيه الخُمس 20% مرة واحدة فوراً، بلا انتظار سنة.",
      bn: "পোঁতা গুপ্তধন — বিরল। ২০% একবার সঙ্গে সঙ্গে দেয়; বছরের অপেক্ষা নেই।",
    },
    cat_Liabilities: {
      en: "Money you owe — loans, credit card dues, borrowed money. Depending on your school, this reduces your zakatable wealth.",
      ur: "جو رقم آپ نے دینی ہے — قرض، کریڈٹ کارڈ وغیرہ۔ آپ کے مسلک کے مطابق یہ زکوٰۃ والے مال سے کم ہوتی ہے۔",
      hi: "जो राशि आपको देनी है — लोन, क्रेडिट कार्ड आदि। आपके मसलक के अनुसार यह ज़कात वाले माल से घटती है।",
      ar: "الديون التي عليك — قروض وبطاقات. بحسب مذهبك تُخصم من المال الزكوي.",
      bn: "আপনার ঋণ — লোন, ক্রেডিট কার্ড ইত্যাদি। মাযহাব অনুযায়ী এটি যাকাতযোগ্য সম্পদ কমায়।",
    },
  };

  let lang = "en";
  try {
    const savedLang = localStorage.getItem(LS_KEY);
    if (savedLang && LANG_LABELS[savedLang]) lang = savedLang;
  } catch (e) { /* storage unavailable */ }

  function getLang() { return lang; }

  function setLang(code) {
    lang = LANG_LABELS[code] ? code : "en";
    try { localStorage.setItem(LS_KEY, lang); } catch (e) { /* ignore */ }
  }

  function t(key) {
    const entry = S[key];
    if (!entry) return "";
    return entry[lang] || entry.en || "";
  }

  // Languages available for the currently selected currency (English first).
  function availableLangs() {
    let cur = "";
    try { cur = (global.ZKStore && global.ZKStore.getCurrency()) || ""; } catch (e) { /* ignore */ }
    const extra = CURRENCY_LANGS[cur] || [];
    return ["en"].concat(extra);
  }

  // If the saved language is not offered for the current currency, show English
  // (without erasing the saved preference — switching back to INR restores Urdu).
  function effectiveLang() {
    return availableLangs().indexOf(lang) >= 0 ? lang : "en";
  }

  function applyDirection(node, code) {
    if (RTL_LANGS.has(code)) { node.setAttribute("dir", "rtl"); node.setAttribute("lang", code); }
    else { node.removeAttribute("dir"); node.setAttribute("lang", code); }
  }

  // Bind a node to a help key so refresh() can re-translate it in place.
  function bind(node, key) {
    node.dataset.helpKey = key;
    const code = effectiveLang();
    const entry = S[key];
    node.textContent = entry ? (entry[code] || entry.en || "") : "";
    applyDirection(node, code);
    return node;
  }

  // Re-translate every bound node currently in the document.
  function refresh(root) {
    const scope = root || document;
    const code = effectiveLang();
    scope.querySelectorAll("[data-help-key]").forEach((node) => {
      const entry = S[node.dataset.helpKey];
      if (!entry) return;
      node.textContent = entry[code] || entry.en || "";
      applyDirection(node, code);
    });
  }

  global.ZKHelp = {
    LANG_LABELS, availableLangs, getLang, setLang, effectiveLang, t, bind, refresh,
  };
})(window);
