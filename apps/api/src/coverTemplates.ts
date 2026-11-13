/**
 * Cover continuity WhatsApp templates (PRD v1.4, PS-118 and PS-127 to PS-137). Utility category, task-specific, en / hi / mr.
 * None is submitted to Meta yet: every entry is "Draft: not submitted" until a WhatsApp provider is chosen and the wording has
 * passed native-speaker and worker-dignity review. No template carries an address, key or gate detail except
 * `cover_gate_key_note`, which is sent only after the person accepted and the owner approved (or standing approval applied).
 */
import type { Lang } from './templates.js';

type V = Record<string, string>;
export interface CoverTemplate { category: 'utility'; approval: string; purpose: string; requirement: string; buttons?: string[]; fallback: 'sms' | 'none'; body: Record<Lang, (v: V) => string> }
const DRAFT = 'Draft: not submitted (no WhatsApp provider yet)';

export const COVER_TEMPLATES: Record<string, CoverTemplate> = {
  cover_reminder: {
    category: 'utility', approval: DRAFT, requirement: 'PS-127', fallback: 'sms', purpose: 'One reminder per visit to the assigned caregiver, 90 min before (8 PM the evening before for tasks before 10 AM).',
    buttons: ['Yes, I’ll do it', 'Can’t make it', 'Send someone else'],
    body: {
      en: v => `Hello ${v.name}! Reminder: ${v.day} at ${v.time}, ${v.pets}: ${v.tasks}.\nWill you come?`,
      hi: v => `नमस्ते ${v.name} जी! ${v.day} ${v.time} बजे ${v.pets} का काम है: ${v.tasks}।\nक्या आप आएँगी?`,
      mr: v => `नमस्कार ${v.name} ताई! ${v.day} ${v.time} वाजता ${v.pets} चे काम आहे: ${v.tasks}.\nतुम्ही येणार का?`
    }
  },
  cover_cant_come_ack: {
    category: 'utility', approval: DRAFT, requirement: 'PS-128', fallback: 'none', purpose: 'Acknowledges “can’t come”; says the owner was told and that task access is removed.',
    body: {
      en: () => 'OK, thank you for telling us. The owner has been told. You won’t get prompts or home details for this visit.',
      hi: () => 'ठीक है, बताने के लिए धन्यवाद। मालिक को बता दिया है। इस विज़िट के संदेश और घर की जानकारी अब नहीं आएगी।',
      mr: () => 'ठीक आहे, कळवल्याबद्दल धन्यवाद. मालकांना सांगितले आहे. या भेटीचे संदेश आणि घराची माहिती आता येणार नाही.'
    }
  },
  cover_backup_request: {
    category: 'utility', approval: DRAFT, requirement: 'PS-130, PS-138', fallback: 'sms', purpose: 'Asks a pre-approved backup. Task, time and tower only; handling note for a first-time carer.',
    buttons: ['Yes', 'No', 'I have read this'],
    body: {
      en: v => `Hi ${v.name}! ${v.owner} (${v.tower}) needs help ${v.day} at ${v.time}: ${v.pet}, ${v.tasks}. Can you do it? Reply Yes or No.${v.note ? `\n\nHandling note, please read first: ${v.note}` : ''}\nAddress, gate and key details come only after ${v.owner} confirms.`,
      hi: v => `नमस्ते ${v.name}! ${v.owner} (${v.tower}) को ${v.day} ${v.time} बजे मदद चाहिए: ${v.pet}, ${v.tasks}। क्या आप कर पाएँगे? हाँ / नहीं।${v.note ? `\n\nपहले यह पढ़ें: ${v.note}` : ''}\nपता, गेट और चाबी की जानकारी ${v.owner} की पुष्टि के बाद ही मिलेगी।`,
      mr: v => `नमस्कार ${v.name}! ${v.owner} (${v.tower}) यांना ${v.day} ${v.time} वाजता मदत हवी आहे: ${v.pet}, ${v.tasks}. तुम्ही करू शकाल का? हो / नाही.${v.note ? `\n\nआधी हे वाचा: ${v.note}` : ''}\nपत्ता, गेट आणि चावीची माहिती ${v.owner} यांच्या पुष्टीनंतरच मिळेल.`
    }
  },
  cover_substitute_link: {
    category: 'utility', approval: DRAFT, requirement: 'PS-128', fallback: 'sms', purpose: 'One-time task link to a substitute named by the caregiver, sent only after the owner approves.',
    body: {
      en: v => `Hello ${v.name}! ${v.by} asked you to cover ${v.day} at ${v.time} at ${v.owner}’s home: ${v.tasks}. This link works for this one task only: ${v.link}`,
      hi: v => `नमस्ते ${v.name}! ${v.by} ने आपको ${v.day} ${v.time} बजे ${v.owner} के घर के काम के लिए भेजा है: ${v.tasks}। यह लिंक सिर्फ़ इसी एक काम के लिए है: ${v.link}`,
      mr: v => `नमस्कार ${v.name}! ${v.by} ताईंनी तुम्हाला ${v.day} ${v.time} वाजता ${v.owner} यांच्या घरी कामासाठी पाठवले आहे: ${v.tasks}. ही लिंक फक्त या एका कामासाठी आहे: ${v.link}`
    }
  },
  cover_not_found_owner: {
    category: 'utility', approval: DRAFT, requirement: 'PS-133', fallback: 'sms', purpose: 'Tells the owner nobody accepted, with who was asked, last fed and watered, and the options. Also read out on the automated call.',
    body: {
      en: v => `Cover not found for ${v.pet}: ${v.tasks} (${v.time}). Asked: ${v.asked}. ${v.last}. Open Pawsure to choose: I’ll handle it, Ask someone else, Ask my whole care circle${v.move === '1' ? ', Move or skip' : ''}. Pawsure is not an emergency service.`,
      hi: v => `${v.pet} के लिए कोई नहीं मिला: ${v.tasks} (${v.time})। पूछा गया: ${v.asked}। ${v.last}। Pawsure खोलकर चुनें। Pawsure आपातकालीन सेवा नहीं है।`,
      mr: v => `${v.pet} साठी कोणी मिळाले नाही: ${v.tasks} (${v.time}). विचारले: ${v.asked}. ${v.last}. Pawsure उघडून निवडा. Pawsure ही आपत्कालीन सेवा नाही.`
    }
  },
  cover_adhoc_link: {
    category: 'utility', approval: DRAFT, requirement: 'PS-133', fallback: 'sms', purpose: 'One-time 15-minute task link to a number the owner typed in. Task, time and tower only.',
    body: {
      en: v => `Hi ${v.name}! ${v.owner} (${v.tower}) is asking if you can help with ${v.pet} ${v.day} at ${v.time}: ${v.tasks}. This link works for 15 minutes and for this task only: ${v.link}\nThe address and key details are shared only after you accept and ${v.owner} approves.`,
      hi: v => `नमस्ते ${v.name}! ${v.owner} (${v.tower}) पूछ रहे हैं: क्या आप ${v.day} ${v.time} बजे ${v.pet} की मदद कर पाएँगे: ${v.tasks}? यह लिंक 15 मिनट और सिर्फ़ इसी काम के लिए है: ${v.link}`,
      mr: v => `नमस्कार ${v.name}! ${v.owner} (${v.tower}) विचारत आहेत: तुम्ही ${v.day} ${v.time} वाजता ${v.pet} साठी मदत करू शकाल का: ${v.tasks}? ही लिंक १५ मिनिटे आणि फक्त या कामासाठी आहे: ${v.link}`
    }
  },
  cover_extension_request: {
    category: 'utility', approval: DRAFT, requirement: 'PS-136', fallback: 'sms', purpose: 'Asks the current caregiver to cover the extra time when the owner is delayed.',
    buttons: ['Yes', 'Only until …', 'Can’t'],
    body: {
      en: v => `${v.owner} is delayed until ${v.until}. Can you do these? ${v.tasks}`,
      hi: v => `${v.owner} को आने में देर होगी (${v.until} बजे तक)। क्या आप यह कर पाएँगी? ${v.tasks}`,
      mr: v => `${v.owner} यांना यायला उशीर होणार आहे (${v.until} पर्यंत). तुम्ही हे करू शकाल का? ${v.tasks}`
    }
  },
  cover_gate_key_note: {
    category: 'utility', approval: DRAFT, requirement: 'PS-137', fallback: 'none', purpose: 'Confirmation with address, gate and key note. Only after acceptance and owner approval.',
    body: {
      en: v => `Confirmed ✅ ${v.day} at ${v.time}: ${v.tasks}\nFlat ${v.flat}, ${v.tower}\nGate: ${v.gate}\nKey: ${v.key}\n${v.pet}: ${v.instructions}${v.note ? `\nHandling note: ${v.note}` : ''}\nWhen you’re done, send a photo here.`,
      hi: v => `पक्का ✅ ${v.day} ${v.time} बजे: ${v.tasks}\nफ़्लैट ${v.flat}, ${v.tower}\nगेट: ${v.gate}\nचाबी: ${v.key}\n${v.pet}: ${v.instructions}${v.note ? `\nध्यान दें: ${v.note}` : ''}\nकाम होने पर यहाँ फ़ोटो भेजें।`,
      mr: v => `नक्की ✅ ${v.day} ${v.time} वाजता: ${v.tasks}\nफ्लॅट ${v.flat}, ${v.tower}\nगेट: ${v.gate}\nचावी: ${v.key}\n${v.pet}: ${v.instructions}${v.note ? `\nलक्षात ठेवा: ${v.note}` : ''}\nकाम झाल्यावर इथे फोटो पाठवा.`
    }
  },
  cluster_advisory: {
    category: 'utility', approval: DRAFT, requirement: 'PS-135', fallback: 'sms', purpose: 'Evening-before advisory to owners in a cluster when many helpers may be absent.',
    body: {
      en: v => `Many helpers may not come tomorrow (${v.reason}). Confirm cover tonight. Pawsure is asking your helper this evening and will tell you if a task is at risk.`,
      hi: v => `कल कई हेल्पर नहीं आ पाएँगे (${v.reason})। आज रात ही इंतज़ाम पक्का करें। Pawsure आज शाम आपके हेल्पर से पूछ रहा है।`,
      mr: v => `उद्या अनेक मदतनीस येऊ शकणार नाहीत (${v.reason}). आज रात्रीच व्यवस्था नक्की करा. Pawsure आज संध्याकाळी तुमच्या मदतनीसाला विचारत आहे.`
    }
  }
};

/** Short session replies (inside the 24-hour window after the person wrote to us; not templates). */
export const COVER_REPLY: Record<string, Record<Lang, (v: V) => string>> = {
  thanks_yes: { en: () => 'Thank you! The owner has been told.', hi: () => 'धन्यवाद! मालिक को बता दिया है।', mr: () => 'धन्यवाद! मालकांना कळवले आहे.' },
  who_will_come: { en: () => 'Who will come? Send their name and phone number. Nothing about the home is shared unless the owner approves.', hi: () => 'कौन आएगा? नाम और फ़ोन नंबर भेजें। मालिक की मंज़ूरी के बिना घर की कोई जानकारी नहीं दी जाएगी।', mr: () => 'कोण येणार आहे? नाव आणि फोन नंबर पाठवा. मालकांनी मान्यता दिल्याशिवाय घराची कोणतीही माहिती दिली जाणार नाही.' },
  sub_asked: { en: v => `Thank you. We’ve asked the owner. ${v.name} gets the task link only after they approve.`, hi: v => `धन्यवाद। मालिक से पूछा है। उनकी मंज़ूरी के बाद ही ${v.name} को काम का लिंक मिलेगा।`, mr: v => `धन्यवाद. मालकांना विचारले आहे. त्यांनी मान्यता दिल्यावरच ${v.name} यांना कामाची लिंक मिळेल.` },
  sub_approved: { en: v => `The owner approved ${v.name}. Thank you!`, hi: v => `मालिक ने ${v.name} को मंज़ूरी दे दी। धन्यवाद!`, mr: v => `मालकांनी ${v.name} यांना मान्यता दिली. धन्यवाद!` },
  sub_declined: { en: v => `The owner did not approve ${v.name}. Thank you.`, hi: v => `मालिक ने ${v.name} को मंज़ूरी नहीं दी। धन्यवाद।`, mr: v => `मालकांनी ${v.name} यांना मान्यता दिली नाही. धन्यवाद.` },
  no_visits: { en: () => 'OK. You have no visits left to confirm.', hi: () => 'ठीक है। आपका कोई काम बाकी नहीं है।', mr: () => 'ठीक आहे. तुमचे कोणतेही काम बाकी नाही.' },
  hold_wait: { en: v => `Thank you! ${v.owner} will confirm in a few minutes. Please wait for the confirmation before going.`, hi: v => `धन्यवाद! ${v.owner} कुछ मिनट में पुष्टि करेंगे। कृपया पुष्टि का इंतज़ार करें।`, mr: v => `धन्यवाद! ${v.owner} काही मिनिटांत पुष्टी करतील. कृपया पुष्टीची वाट पहा.` },
  someone_first: { en: v => `Thank you! Someone else offered first and ${v.owner} is confirming. We’ll tell you if you’re needed.`, hi: v => `धन्यवाद! किसी और ने पहले हाँ कहा है। ज़रूरत हुई तो बताएँगे।`, mr: v => `धन्यवाद! दुसऱ्या कोणीतरी आधी होकार दिला आहे. गरज पडल्यास कळवू.` },
  no_problem: { en: () => 'No problem. Thank you for replying. Saying no never counts against you.', hi: () => 'कोई बात नहीं। जवाब देने के लिए धन्यवाद।', mr: () => 'काही हरकत नाही. उत्तर दिल्याबद्दल धन्यवाद.' },
  closed: { en: () => 'Thank you. Cover is sorted, so this request is closed. No action needed.', hi: () => 'धन्यवाद। इंतज़ाम हो गया है, यह अनुरोध बंद है।', mr: () => 'धन्यवाद. व्यवस्था झाली आहे, ही विनंती बंद आहे.' },
  already: { en: () => 'Thank you! This is already covered or closed. No action needed.', hi: () => 'धन्यवाद! यह पहले ही हो चुका है।', mr: () => 'धन्यवाद! हे आधीच झाले आहे.' },
  released: { en: v => `${v.owner} didn’t confirm in time, so you’re released. Thank you for offering!`, hi: v => `${v.owner} समय पर पुष्टि नहीं कर पाए। मदद की पेशकश के लिए धन्यवाद!`, mr: v => `${v.owner} वेळेत पुष्टी करू शकले नाहीत. मदतीसाठी धन्यवाद!` },
  read_first: { en: v => `Before you say yes, please read the handling note for ${v.pet} and confirm that you have read it.`, hi: v => `हाँ कहने से पहले ${v.pet} के बारे में लिखी बात पढ़ें और बताएँ कि पढ़ ली है।`, mr: v => `होकार देण्यापूर्वी ${v.pet} बद्दलची सूचना वाचा आणि वाचल्याचे कळवा.` },
  note_ok: { en: () => 'Thank you. You can now reply Yes or No.', hi: () => 'धन्यवाद। अब आप हाँ या नहीं कह सकते हैं।', mr: () => 'धन्यवाद. आता तुम्ही हो किंवा नाही सांगू शकता.' },
  done_thanks: { en: () => 'Thank you! The owner has been told. Address and key details are no longer shown.', hi: () => 'धन्यवाद! मालिक को बता दिया है। पता और चाबी की जानकारी अब नहीं दिखेगी।', mr: () => 'धन्यवाद! मालकांना कळवले आहे. पत्ता आणि चावीची माहिती आता दिसणार नाही.' },
  removed: { en: () => 'Thanks for telling us. Address and key details have been removed.', hi: () => 'बताने के लिए धन्यवाद। पता और चाबी की जानकारी हटा दी गई है।', mr: () => 'कळवल्याबद्दल धन्यवाद. पत्ता आणि चावीची माहिती काढून टाकली आहे.' },
  gate_ok: { en: v => `Gate: ${v.owner} has approved you at the society gate.`, hi: v => `गेट: ${v.owner} ने गेट पर आपको मंज़ूरी दे दी है।`, mr: v => `गेट: ${v.owner} यांनी गेटवर तुम्हाला मान्यता दिली आहे.` },
  key_plan: { en: v => `Key: ${v.key}`, hi: v => `चाबी: ${v.key}`, mr: v => `चावी: ${v.key}` },
  not_understood: { en: () => 'Sorry, we didn’t understand. If you can’t come, write “can’t come”. To talk to a person, write “help”.', hi: () => 'समझ नहीं आया। नहीं आ सकतीं तो “नहीं आ पाऊँगी” लिखें।', mr: () => 'समजले नाही. जमणार नसेल तर “येऊ शकत नाही” लिहा.' }
};
export const REMINDER_BUTTONS: Record<Lang, [string, string, string]> = { en: ['Yes, I’ll do it', 'Can’t make it', 'Send someone else'], hi: ['हाँ, मैं करूँगी', 'नहीं आ पाऊँगी', 'किसी और को भेजूँगी'], mr: ['होय, मी करेन', 'येऊ शकत नाही', 'दुसऱ्याला पाठवते'] };
export const YES_NO: Record<Lang, [string, string, string]> = { en: ['Yes', 'No', 'I have read this'], hi: ['हाँ', 'नहीं', 'मैंने पढ़ लिया'], mr: ['हो', 'नाही', 'मी वाचले'] };
export const EXT_BUTTONS: Record<Lang, (until: string) => [string, string, string]> = { en: u => ['Yes', `Only until ${u}`, 'Can’t'], hi: u => ['हाँ', `सिर्फ़ ${u} बजे तक`, 'नहीं हो पाएगा'], mr: u => ['हो', `फक्त ${u} पर्यंत`, 'जमणार नाही'] };
export const DAY_WORD: Record<Lang, [string, string]> = { en: ['today', 'tomorrow'], hi: ['आज', 'कल'], mr: ['आज', 'उद्या'] };

export const renderCover = (t: string, lang: Lang, v: V = {}) => (COVER_TEMPLATES[t]?.body[lang] ?? COVER_TEMPLATES[t]!.body.en)(v);
export const renderReply = (t: string, lang: Lang, v: V = {}) => (COVER_REPLY[t]?.[lang] ?? COVER_REPLY[t]!.en)(v);
/** Template catalogue for the console and docs: every template with its languages and approval status. */
export const templateCatalogue = () => Object.entries(COVER_TEMPLATES).map(([id, t]) => ({ id, category: t.category, approval: t.approval, requirement: t.requirement, purpose: t.purpose, languages: Object.keys(t.body), buttons: t.buttons ?? [], smsFallback: t.fallback === 'sms', sample: t.body.en({ name: 'Sunita', day: 'today', time: '4:00 PM', pets: 'Bruno', pet: 'Bruno', tasks: 'Toilet pad change + water top-up', owner: 'Neha', tower: 'Tower B', by: 'Sunita', link: 'https://…/t/…', asked: 'Mrs Desai, Ankita', last: 'Last fed: 1:08 PM', until: '9:00 PM', flat: 'B-1104', gate: 'approved', key: 'collect from Ankita', instructions: 'Pads are under the sink.', reason: 'red rain alert', note: '', move: '1' }) }));
/** Names in Devanagari for Hindi and Marathi messages (owner-entered names would be transliterated at sign-up in production). */
const DV: Record<'hi' | 'mr', Record<string, string>> = {
  hi: { Sunita: 'सुनीता', Bruno: 'ब्रूनो', Misty: 'मिस्टी', Neha: 'नेहा', Lata: 'लता', Ritu: 'ऋतु', Vikram: 'विक्रम', Arjun: 'अर्जुन', Meera: 'मीरा' },
  mr: { Sunita: 'सुनीता', Bruno: 'ब्रुनो', Misty: 'मिस्टी', Neha: 'नेहा', Lata: 'लता', Ritu: 'ऋतू', Vikram: 'विक्रम', Arjun: 'अर्जुन', Meera: 'मीरा' }
};
export const inScript = (lang: Lang, text: string) => lang === 'en' ? text : text.replace(/[A-Z][a-z]+/g, w => DV[lang][w] ?? w);
