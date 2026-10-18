import { ttsCode } from "./languages.js";

const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
const MODEL_ID = "eleven_turbo_v2_5";

let fallbackVoice = null;

async function speakOnce(key, voiceId, text, language) {
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: text.slice(0, 800),
        model_id: MODEL_ID,
        language_code: ttsCode(language),
        voice_settings: { stability: 0.4, similarity_boost: 0.8 },
      }),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function pickUsableVoice(key, excludeId) {
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": key },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const voice = (data.voices || []).find((v) => v.voice_id !== excludeId);
    return voice?.voice_id || null;
  } catch {
    return null;
  }
}

export async function synthesize(text, language = "en") {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key || !text) return null;

  const preferred = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;

  const audio = await speakOnce(key, preferred, text, language);
  if (audio) return audio;

  if (!fallbackVoice) {
    fallbackVoice = await pickUsableVoice(key, preferred);
  }
  if (fallbackVoice) {
    return speakOnce(key, fallbackVoice, text, language);
  }
  return null;
}
