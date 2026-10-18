export const LANGUAGES = {
  en: { name: "English", tts: "en" },
  es: { name: "Spanish", tts: "es" },
  fr: { name: "French", tts: "fr" },
  de: { name: "German", tts: "de" },
  it: { name: "Italian", tts: "it" },
  pt: { name: "Portuguese", tts: "pt" },
  hi: { name: "Hindi", tts: "hi" },
  ja: { name: "Japanese", tts: "ja" },
  zh: { name: "Chinese", tts: "zh" },
  ar: { name: "Arabic", tts: "ar" },
};

export function languageName(code) {
  return LANGUAGES[code]?.name || "English";
}

export function ttsCode(code) {
  return LANGUAGES[code]?.tts || "en";
}
