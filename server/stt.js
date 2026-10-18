const ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text";
const MAX_BYTES = 24 * 1024 * 1024;

export function sttEnabled() {
  return Boolean((process.env.ELEVENLABS_API_KEY || "").trim());
}

export async function transcribeAudio(buffer, { filename = "audio.mp3", mime = "audio/mpeg" } = {}) {
  const key = (process.env.ELEVENLABS_API_KEY || "").trim();
  if (!key || !buffer?.length) return "";
  if (buffer.length > MAX_BYTES) {
    console.warn(`STT skipped: audio is too large (${buffer.length} bytes)`);
    return "";
  }

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime }), filename);
  form.append("model_id", (process.env.ELEVENLABS_STT_MODEL || "scribe_v1").trim());

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "xi-api-key": key },
      body: form,
      signal: AbortSignal.timeout(180000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`ElevenLabs STT failed (${res.status}): ${body.slice(0, 200)}`);
      return "";
    }
    const data = await res.json();
    return (data.text || "").trim();
  } catch (err) {
    console.warn("ElevenLabs STT error:", err.message);
    return "";
  }
}
