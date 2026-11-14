/** Friend WhatsApp templates (FF-*), en / hi / mr. Utility templates only; need native-speaker review before Meta submission (PS-118). */
import type { ParsedRequest } from '@pawsure/domain';
export type Lang = 'en' | 'hi' | 'mr';

const DV: Record<'hi' | 'mr', Record<string, string>> = {
  hi: { Bruno: 'ब्रूनो', Misty: 'मिस्टी', Neha: 'नेहा', Arjun: 'अर्जुन', Meera: 'मीरा', Priya: 'प्रिया', Kavya: 'काव्या', Farhan: 'फ़रहान', Rahul: 'राहुल' },
  mr: { Bruno: 'ब्रुनो', Misty: 'मिस्टी', Neha: 'नेहा', Arjun: 'अर्जुन', Meera: 'मीरा', Priya: 'प्रिया', Kavya: 'काव्या', Farhan: 'फरहान', Rahul: 'राहुल' }
};
const tr = (l: Lang, x: string) => (l === 'en' ? x : DV[l][x] ?? x);
const hm = (m: number) => `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')}`;

/** The exact request text a friend receives — previewed and approved by the owner before sending (PS-059). No flat, key or schedule details. */
export function requestText(l: Lang, v: { friend: string; owner: string; tower: string; pet: string; pets?: string[]; pronoun: string; p: ParsedRequest }) {
  const AND = { en: ' and ', hi: ' और ', mr: ' आणि ' }[l];
  const f = v.friend.split(' ')[0]!, o = v.owner.split(' ')[0]!, pet = (v.pets?.length ? v.pets : [v.pet]).map(x => tr(l, x)).join(AND), t = v.p.tasks, time = hm(v.p.time ?? 0), dur = v.p.durationMin;
  const home = v.p.access === 'Someone at home';
  if (l === 'en') {
    const parts: string[] = [];
    if (t.includes('feed') || t.includes('water') || t.includes('litter') || t.includes('toilet')) parts.push('feed ' + pet);
    if (t.includes('walk')) parts.push(parts.length ? `take ${v.pronoun} for a short walk` : `take ${pet} for a short walk`);
    if (t.includes('meds')) parts.push(`give ${pet} the medicine in ${o}’s written instructions`);
    return `Hi ${f}! ${o} (${v.tower}) is asking: could you ${parts.join(' and ')} at ${time} today? About ${dur} min.\n${home ? 'Someone will be at home.' : `Access: key handover — details only after ${o} confirms.`}\nReply Yes / No / suggest another time.`;
  }
  if (l === 'hi') {
    const parts: string[] = [];
    if (t.some(x => ['feed', 'water', 'litter', 'toilet'].includes(x))) parts.push(`${pet} को खाना खिला`);
    if (t.includes('walk')) parts.push(parts.length ? 'थोड़ा नीचे घुमा' : `${pet} को थोड़ा नीचे घुमा`);
    if (t.includes('meds')) parts.push('लिखी हुई दवा दे');
    return `नमस्ते ${tr(l, f)}! ${tr(l, o)} (${v.tower}) पूछ रहे हैं: क्या आप आज ${time} बजे ${parts.join(' और ')} सकते हैं? लगभग ${dur} मिनट।\n${home ? 'घर पर कोई होगा।' : `चाबी: हैंडओवर — पूरी जानकारी ${tr(l, o)} की पुष्टि के बाद ही।`}\nजवाब दें: हाँ / नहीं / दूसरा समय बताएं।`;
  }
  const parts: string[] = [];
  if (t.some(x => ['feed', 'water', 'litter', 'toilet'].includes(x))) parts.push(`${pet}ला जेवण द्याल`);
  if (t.includes('walk')) parts.push(parts.length ? 'थोडे खाली फिरवून आणाल' : `${pet}ला थोडे खाली फिरवून आणाल`);
  if (t.includes('meds')) parts.push('लिहिलेले औषध द्याल');
  return `नमस्कार ${tr(l, f)}! ${tr(l, o)} (${v.tower}) विचारत आहेत: तुम्ही आज ${time} वाजता ${parts.join(' आणि ')} का? साधारण ${dur} मिनिटे.\n${home ? 'घरी कोणीतरी असेल.' : `चावी: हस्तांतर — पूर्ण माहिती ${tr(l, o)} यांच्या पुष्टीनंतरच.`}\nउत्तर द्या: हो / नाही / दुसरी वेळ सांगा.`;
}

export const FRIEND_MSG: Record<string, Record<Lang, string>> = {
  waiting_for_owner: { en: 'Thank you! The owner will confirm in a few minutes. Please don’t go until they confirm.', hi: 'धन्यवाद! मालिक कुछ मिनट में पुष्टि करेंगे। पुष्टि से पहले न जाएँ।', mr: 'धन्यवाद! मालक काही मिनिटांत पुष्टी करतील. पुष्टीपूर्वी जाऊ नका.' },
  closed_covered: { en: 'Thanks so much — they found cover. This request is closed.', hi: 'बहुत धन्यवाद — किसी और ने मदद कर दी। यह अनुरोध बंद है।', mr: 'खूप धन्यवाद — दुसरी व्यवस्था झाली. ही विनंती बंद आहे.' },
  already_covered: { en: 'Thank you! This is already covered. No action needed.', hi: 'धन्यवाद! इसकी व्यवस्था हो चुकी है। कुछ करने की ज़रूरत नहीं।', mr: 'धन्यवाद! याची व्यवस्था झाली आहे. काही करायची गरज नाही.' },
  request_closed: { en: 'Thank you! This request has closed. No action needed.', hi: 'धन्यवाद! यह अनुरोध बंद हो गया है।', mr: 'धन्यवाद! ही विनंती बंद झाली आहे.' },
  released: { en: 'The owner didn’t confirm in time, so you’re released. Thank you for offering!', hi: 'मालिक ने समय पर पुष्टि नहीं की, इसलिए आप मुक्त हैं। धन्यवाद!', mr: 'मालकांनी वेळेत पुष्टी केली नाही, म्हणून तुम्ही मोकळे आहात. धन्यवाद!' },
  ask_time_again: { en: 'Sorry, we couldn’t read a time. Please reply with a time, for example 5:30.', hi: 'माफ़ कीजिए, समय समझ नहीं आया। कृपया समय लिखें, जैसे 5:30।', mr: 'माफ करा, वेळ समजली नाही. कृपया वेळ लिहा, उदा. 5:30.' },
  declined_ack: { en: 'No problem — thanks for letting them know. Declining never counts against you.', hi: 'कोई बात नहीं — बताने के लिए धन्यवाद। मना करने से आप पर कोई असर नहीं पड़ता।', mr: 'हरकत नाही — कळवल्याबद्दल धन्यवाद. नकार दिल्याचा तुमच्यावर काही परिणाम होत नाही.' },
  reconfirm: { en: 'The owner changed the time. Can you still help? Please reply Yes / No.', hi: 'मालिक ने समय बदल दिया है। क्या आप अब भी मदद कर सकते हैं? हाँ / नहीं।', mr: 'मालकांनी वेळ बदलली आहे. तुम्ही अजूनही मदत करू शकता का? हो / नाही.' },
  cancelled_by_owner: { en: 'The owner cancelled this request — no action needed. Thank you!', hi: 'मालिक ने यह अनुरोध रद्द कर दिया — कुछ करने की ज़रूरत नहीं।', mr: 'मालकांनी ही विनंती रद्द केली — काही करायची गरज नाही.' },
  access_removed: { en: 'Address and key details for this visit have been removed.', hi: 'इस विज़िट के पते और चाबी की जानकारी हटा दी गई है।', mr: 'या भेटीचा पत्ता आणि चावीची माहिती काढून टाकली आहे.' },
  reminder: { en: 'Reminder: the request closes in 7 minutes.', hi: 'याद दिलाना: अनुरोध 7 मिनट में बंद होगा।', mr: 'आठवण: विनंती 7 मिनिटांत बंद होईल.' },
  invite: { en: 'would like you to be someone they can ask for help with their pet now and then. You choose what and when, and can stop any time. Being invited doesn’t make you findable — you opt in yourself.', hi: 'चाहते हैं कि आप कभी-कभी उनके पालतू की मदद कर सकें। क्या और कब — आप तय करेंगे। आमंत्रण से आप खोज में नहीं आते; यह आप ख़ुद चुनते हैं।', mr: 'यांना वाटते की तुम्ही कधीतरी त्यांच्या पाळीव प्राण्याला मदत करावी. काय आणि कधी — तुम्ही ठरवाल. निमंत्रणामुळे तुम्ही शोधात येत नाही; ते तुम्ही स्वतः निवडता.' }
};
export const BTN: Record<string, Record<Lang, string>> = { yes: { en: 'Yes', hi: 'हाँ', mr: 'हो' }, no: { en: 'No', hi: 'नहीं', mr: 'नाही' } };
