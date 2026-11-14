/**
 * Languages people can choose: English and the 22 languages of the Eighth Schedule of the Constitution.
 * `messages` marks the languages whose WhatsApp/SMS messages are written today (en, hi, mr); the others are
 * saved as the person's choice and get English messages until a native speaker writes and reviews them.
 */
export interface Language { code: string; name: string; native: string; messages: boolean }
export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', native: 'English', messages: true },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', messages: true },
  { code: 'mr', name: 'Marathi', native: 'मराठी', messages: true },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', messages: false },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', messages: false },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', messages: false },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', messages: false },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', messages: false },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', messages: false },
  { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ', messages: false },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', messages: false },
  { code: 'ur', name: 'Urdu', native: 'اردو', messages: false },
  { code: 'as', name: 'Assamese', native: 'অসমীয়া', messages: false },
  { code: 'mai', name: 'Maithili', native: 'मैथिली', messages: false },
  { code: 'sat', name: 'Santali', native: 'ᱥᱟᱱᱛᱟᱲᱤ', messages: false },
  { code: 'ks', name: 'Kashmiri', native: 'کٲشُر', messages: false },
  { code: 'ne', name: 'Nepali', native: 'नेपाली', messages: false },
  { code: 'sd', name: 'Sindhi', native: 'سنڌي', messages: false },
  { code: 'kok', name: 'Konkani', native: 'कोंकणी', messages: false },
  { code: 'doi', name: 'Dogri', native: 'डोगरी', messages: false },
  { code: 'mni', name: 'Manipuri', native: 'মৈতৈলোন্', messages: false },
  { code: 'brx', name: 'Bodo', native: 'बड़ो', messages: false },
  { code: 'sa', name: 'Sanskrit', native: 'संस्कृतम्', messages: false }
];
export const LANG_CODES = LANGUAGES.map(l => l.code) as [string, ...string[]];
/** The language messages are sent in: the person's choice when written, otherwise English. */
export const msgLang = (code: string | null | undefined): 'en' | 'hi' | 'mr' => (code === 'hi' || code === 'mr' ? code : 'en');
