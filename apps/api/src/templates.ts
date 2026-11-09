/**
 * Helper WhatsApp templates (utility category, pre-approved per PS-118). en / hi / mr.
 * Wording must pass native-speaker and worker-dignity review before Meta template submission.
 */
export type Lang = 'en' | 'hi' | 'mr';
type T = Record<Lang, (v: Record<string, string>) => string>;

export const TEMPLATES: Record<string, T> = {
  W1_CONSENT: {
    en: v => `Hello ${v.name}! ${v.owner} has invited you to Pawsure for ${v.pets}.\n\n• Your work gets a record.\n• Only the bowl or the pet — never your face.\n• You can stop any time.\n\nWould you like to join?`,
    hi: v => `नमस्ते ${v.name} जी! ${v.owner} ने आपको ${v.pets} के काम के लिए Pawsure पर बुलाया है।\n\n• आपके काम का रिकॉर्ड बनेगा।\n• सिर्फ़ कटोरा या पालतू जानवर — आपका चेहरा कभी नहीं।\n• आप कभी भी रोक सकती हैं।\n\nक्या आप तैयार हैं?`,
    mr: v => `नमस्कार ${v.name} ताई! ${v.owner} यांनी तुम्हाला ${v.pets} च्या कामासाठी Pawsure वर बोलावले आहे.\n\n• तुमच्या कामाची नोंद राहील.\n• फक्त भांडे किंवा पाळीव प्राणी — तुमचा चेहरा कधीच नाही.\n• तुम्ही कधीही थांबवू शकता.\n\nतुम्ही तयार आहात का?`
  },
  W2_METHOD: {
    en: () => 'How would you like to show a task is done? You can change this any time by replying “change”.',
    hi: () => 'काम होने की खबर कैसे देंगी? “बदलो” लिखकर कभी भी बदल सकती हैं।',
    mr: () => 'काम झाल्याचे कसे कळवाल? “बदल” लिहून कधीही बदलू शकता.'
  },
  W_NOT_NOW: { en: () => 'OK. Nothing will be recorded. We’ve told the owner.', hi: () => 'ठीक है। कुछ भी रिकॉर्ड नहीं होगा। मालिक को बता दिया है।', mr: () => 'ठीक आहे. काहीही नोंदवले जाणार नाही. मालकांना कळवले आहे.' },
  W_METHOD_SET: { en: v => `Done — ${v.method}. Reply “change” any time.`, hi: v => `ठीक है — ${v.method}। “बदलो” लिखकर बदलें।`, mr: v => `ठीक आहे — ${v.method}. “बदल” लिहून बदला.` },
  W3_PROMPT: {
    en: v => `🐾 ${v.pet} — ${v.task} (${v.time})\n${v.how}`,
    hi: v => `🐾 ${v.pet} — ${v.task} (${v.time})\n${v.how}`,
    mr: v => `🐾 ${v.pet} — ${v.task} (${v.time})\n${v.how}`
  },
  HOW_PHOTO: { en: () => 'When done, send a photo of the bowl and type today’s code from the card. No faces.', hi: () => 'काम के बाद कटोरे की फ़ोटो भेजें और कार्ड से आज का कोड लिखें। चेहरा नहीं।', mr: () => 'काम झाल्यावर भांड्याचा फोटो पाठवा आणि कार्डवरचा आजचा कोड लिहा. चेहरा नको.' },
  HOW_VOICE: { en: () => 'When done, send a voice note saying what you did.', hi: () => 'काम के बाद वॉइस नोट भेजें: क्या किया बताएं।', mr: () => 'काम झाल्यावर आवाज संदेश पाठवा: काय केले ते सांगा.' },
  HOW_IVR: { en: () => 'Give a missed call when you arrive, then call the IVR and enter today’s code.', hi: () => 'आते समय मिस्ड कॉल दें, फिर IVR पर आज का कोड डालें।', mr: () => 'येताना मिस्ड कॉल द्या, मग IVR वर आजचा कोड टाका.' },
  W_THANKS: { en: () => 'Thank you! Recorded ✅', hi: () => 'धन्यवाद! दर्ज हो गया ✅', mr: () => 'धन्यवाद! नोंद झाली ✅' },
  W_REUSED: { en: () => 'This photo was sent before. Please send a new one.', hi: () => 'यह फ़ोटो पहले आ चुकी है। कृपया नई फ़ोटो भेजें।', mr: () => 'हा फोटो आधी आला होता. कृपया नवीन फोटो पाठवा.' },
  W_WRONG_CODE: { en: () => 'That code isn’t today’s. Please check the card.', hi: () => 'कोड आज का नहीं है। कृपया कार्ड दोबारा देखें।', mr: () => 'कोड आजचा नाही. कृपया कार्ड पुन्हा पहा.' },
  W_STOPPED: { en: () => 'Stopped. Nothing will be recorded now. Reply “start” to begin again.', hi: () => 'रोक दिया। अब कुछ रिकॉर्ड नहीं होगा। फिर शुरू करने के लिए “शुरू” लिखें।', mr: () => 'थांबवले. आता काहीही नोंदवले जाणार नाही. पुन्हा सुरू करायचे असल्यास “सुरू” लिहा.' },
  W_PROBLEM_ACK: { en: v => v.urgent === '1' ? 'Thank you. The owner and backup are being called now. Vet numbers are in the emergency card below.' : 'Thank you. The owner has been told.', hi: v => v.urgent === '1' ? 'धन्यवाद। मालिक और बैकअप को अभी कॉल किया जा रहा है।' : 'धन्यवाद। मालिक को बता दिया है।', mr: v => v.urgent === '1' ? 'धन्यवाद. मालक आणि बॅकअपला आत्ता फोन केला जात आहे.' : 'धन्यवाद. मालकांना कळवले आहे.' },
  W_SUPPORT: { en: () => 'A Pawsure team member will call you between 8 AM and 10 PM.', hi: () => 'Pawsure से कोई आपको सुबह 8 से रात 10 के बीच फ़ोन करेगा।', mr: () => 'Pawsure चा माणूस तुम्हाला सकाळी ८ ते रात्री १० दरम्यान फोन करेल.' },
  W_PRACTICE: { en: () => 'Practice only — nothing is recorded. Try sending a photo of the bowl.', hi: () => 'सिर्फ़ अभ्यास — कुछ रिकॉर्ड नहीं होगा। कटोरे की फ़ोटो भेजकर देखें।', mr: () => 'फक्त सराव — काहीही नोंदवले जात नाही. भांड्याचा फोटो पाठवून पहा.' },
  W_DISPUTE: { en: v => `The owner’s return check doesn’t match today’s “${v.task}”. Points for it are on hold while it’s checked (max 7 days). This is not a finding against you.`, hi: v => `मालिक की जाँच आज के “${v.task}” से मेल नहीं खाती। जाँच तक इसके पॉइंट रुके हैं (अधिकतम 7 दिन)। यह आपके ख़िलाफ़ कोई फ़ैसला नहीं है।`, mr: v => `मालकांची तपासणी आजच्या “${v.task}” शी जुळत नाही. तपासणीपर्यंत त्याचे पॉइंट थांबवले आहेत (कमाल 7 दिवस). हा तुमच्याविरुद्ध निर्णय नाही.` }
};
Object.assign(TEMPLATES, {
  W_POINTS: { en: (v: V) => `Points from this home this month: ${v.month} (limit 125). Total you can use: ${v.available}. On hold: ${v.held}. ${v.next} more for a ₹20 coupon. No cash.`, hi: (v: V) => `इस घर से इस महीने के पॉइंट: ${v.month} (सीमा 125)। कुल: ${v.available}। रुके हुए: ${v.held}। ₹20 कूपन के लिए ${v.next} और। नकद नहीं।`, mr: (v: V) => `या घरातून या महिन्याचे पॉइंट: ${v.month} (मर्यादा 125). एकूण: ${v.available}. थांबवलेले: ${v.held}. ₹20 कूपनसाठी आणखी ${v.next}. रोख नाही.` },
  W_WEEKLY: { en: (v: V) => `This week: ${v.week} points from this home. Total: ${v.available}. Reply “points” any time.`, hi: (v: V) => `इस हफ़्ते: इस घर से ${v.week} पॉइंट। कुल: ${v.available}। कभी भी “points” लिखें।`, mr: (v: V) => `या आठवड्यात: या घरातून ${v.week} पॉइंट. एकूण: ${v.available}. कधीही “points” लिहा.` },
  W_HOLD_DECIDED: { en: (v: V) => v.decision === 'release' ? `Your held points were released. Reason: ${v.reason}` : `Your held points were not given. Reason: ${v.reason}. Reply “help” if you disagree.`, hi: (v: V) => v.decision === 'release' ? `आपके रुके पॉइंट दे दिए गए। कारण: ${v.reason}` : `आपके रुके पॉइंट नहीं दिए गए। कारण: ${v.reason}। असहमत हों तो “help” लिखें।`, mr: (v: V) => v.decision === 'release' ? `तुमचे थांबवलेले पॉइंट दिले. कारण: ${v.reason}` : `तुमचे थांबवलेले पॉइंट दिले नाहीत. कारण: ${v.reason}. असहमत असल्यास “help” लिहा.` },
  W_SHARE_OFF: { en: () => 'Sharing your record isn’t switched on yet. Nothing was shared.', hi: () => 'रिकॉर्ड शेयर करना अभी चालू नहीं है। कुछ भी शेयर नहीं हुआ।', mr: () => 'रेकॉर्ड शेअर करणे अजून सुरू नाही. काहीही शेअर झाले नाही.' },
  W_SHARE_LINK: { en: (v: V) => `Your link: ${v.link} — it shows counts only, no homes or pets. Reply “stop link” to turn it off.`, hi: (v: V) => `आपका लिंक: ${v.link} — सिर्फ़ गिनती दिखती है, घर या पालतू नहीं। बंद करने के लिए “stop link” लिखें।`, mr: (v: V) => `तुमची लिंक: ${v.link} — फक्त संख्या दिसते, घर किंवा प्राणी नाही. बंद करण्यासाठी “stop link” लिहा.` },
  W_SHARE_STOPPED: { en: () => 'Your link is off. Anyone who opens it now sees nothing.', hi: () => 'आपका लिंक बंद है। अब खोलने पर कुछ नहीं दिखेगा।', mr: () => 'तुमची लिंक बंद आहे. आता उघडल्यावर काहीही दिसणार नाही.' },
  PHOTO_SAMPLE: { en: () => 'Today please also send one photo of the bowl (no faces).', hi: () => 'आज कटोरे की एक फ़ोटो भी भेजें (चेहरा नहीं)।', mr: () => 'आज भांड्याचा एक फोटोही पाठवा (चेहरा नको).' },
  W_MYDATA: { en: (v: V) => `Request ${v.id} received. We’ll reply within 7 days. You can also call 8 AM–10 PM.`, hi: (v: V) => `अनुरोध ${v.id} मिला। 7 दिनों में जवाब देंगे।`, mr: (v: V) => `विनंती ${v.id} मिळाली. 7 दिवसांत उत्तर देऊ.` }
});
type V = Record<string, string>;
export const BUTTONS: Record<string, Record<Lang, string>> = {
  consent_yes: { en: 'Yes', hi: 'हाँ', mr: 'हो' }, consent_notnow: { en: 'Not now', hi: 'अभी नहीं', mr: 'आत्ता नको' },
  method_photo: { en: '📷 Photo', hi: '📷 फ़ोटो', mr: '📷 फोटो' }, method_voice: { en: '🎤 Voice note', hi: '🎤 वॉइस नोट', mr: '🎤 आवाज संदेश' }, method_ivr: { en: '☎ Missed call + code', hi: '☎ मिस्ड कॉल + कोड', mr: '☎ मिस्ड कॉल + कोड' }
};
export const render = (t: keyof typeof TEMPLATES, lang: Lang, v: Record<string, string> = {}) => TEMPLATES[t]![lang](v);
