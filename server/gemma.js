const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const FALLBACK_MODELS = [
  "gemma-4-26b-a4b-it",
  "gemma-4-31b-it",
  "gemma-3-27b-it",
  "gemma-3-12b-it",
  "gemma-3-4b-it",
];

function candidateModels() {
  const configured = (process.env.GEMMA_MODEL || "").trim();
  return [...new Set([configured, ...FALLBACK_MODELS].filter(Boolean))];
}

let resolved = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT = [429, 500, 502, 503, 504];

function isModelNotFound(err) {
  return /not found|not supported|404/i.test(err.message || "");
}

function isTransient(err) {
  return !err.status || TRANSIENT.includes(err.status);
}

export async function listModels() {
  const key = process.env.GEMMA_API_KEY;
  if (!key) throw new Error("GEMMA_API_KEY is not set");
  const res = await fetch(`${BASE}?key=${key}`);
  if (!res.ok) throw new Error(`Could not list models (${res.status})`);
  const data = await res.json();
  return (data.models || []).map((m) => ({
    id: (m.name || "").replace("models/", ""),
    generate: (m.supportedGenerationMethods || m.supportedActions || []).includes(
      "generateContent"
    ),
  }));
}

async function post(model, prompt, generationConfig, key) {
  const res = await fetch(`${BASE}/${model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig,
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    const err = new Error(`Model ${model} failed (${res.status}): ${body.slice(0, 300)}`);
    err.status = res.status;
    err.body = body;
    return { err };
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return { err: new Error(`Model ${model} returned an unreadable response`) };
  }
  const text = (data.candidates?.[0]?.content?.parts || [])
    .filter((p) => !p.thought)
    .map((p) => p.text || "")
    .join("")
    .trim();
  return { text };
}

async function callModel(model, prompt, temperature, key) {
  const { err, text } = await post(model, prompt, { temperature, maxOutputTokens: 8192 }, key);
  if (err) throw err;
  if (!text) throw new Error(`Model ${model} returned an empty response`);
  return text;
}

export async function generateStream(prompt, { temperature = 0.4, onText } = {}) {
  const key = process.env.GEMMA_API_KEY;
  if (!key) throw new Error("GEMMA_API_KEY is not set");

  const models = resolved ? [resolved] : candidateModels();
  let res;
  let lastError;
  for (const model of models) {
    res = await fetch(`${BASE}/${model}:streamGenerateContent?alt=sse&key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: 8192 },
      }),
    });
    if (res.ok) {
      resolved = model;
      break;
    }
    const body = await res.text();
    lastError = new Error(`Stream failed (${res.status}): ${body.slice(0, 200)}`);
    if (!isModelNotFound(lastError)) throw lastError;
  }
  if (!res?.ok) throw lastError;

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let obj;
      try {
        obj = JSON.parse(payload);
      } catch {
        continue;
      }
      for (const p of obj.candidates?.[0]?.content?.parts || []) {
        if (p.thought || !p.text) continue;
        full += p.text;
        if (onText) onText(p.text);
      }
    }
  }
  return full;
}

export async function generate(prompt, { temperature = 0.4 } = {}) {
  const key = process.env.GEMMA_API_KEY;
  if (!key) throw new Error("GEMMA_API_KEY is not set");

  const models = resolved ? [resolved] : candidateModels();
  let lastError;

  for (const model of models) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const text = await callModel(model, prompt, temperature, key);
        resolved = model;
        return text;
      } catch (err) {
        lastError = err;
        if (isTransient(err) && attempt < 2) {
          await sleep(600 * (attempt + 1));
          continue;
        }
        if (!isModelNotFound(err)) throw err;
        break;
      }
    }
  }

  throw new Error(
    `${lastError.message} — Run "npm run models" to see the Gemma models your key can use, then set GEMMA_MODEL.`
  );
}

function extractObjects(text) {
  const found = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      i += 1;
      continue;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let j = i; j < text.length; j += 1) {
      const ch = text[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) break;
    try {
      found.push(JSON.parse(text.slice(i, end + 1)));
    } catch {
      /* skip non-JSON blocks like {qty, unit, item} */
    }
    i = end + 1;
  }
  return found;
}

export function parseJson(text) {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const objects = extractObjects(cleaned);
  if (objects.length === 0) throw new Error("Model did not return JSON");

  const recipeLike = objects.filter(
    (o) =>
      o &&
      (Array.isArray(o.ingredients) || Array.isArray(o.steps) || typeof o.title === "string")
  );
  return recipeLike.length ? recipeLike[recipeLike.length - 1] : objects[objects.length - 1];
}

export function parseReply(text) {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const objects = extractObjects(cleaned);
  const withReply = objects.filter(
    (o) => o && typeof o.reply === "string" && o.reply.trim()
  );
  if (withReply.length) return withReply[withReply.length - 1].reply.trim();

  const lines = cleaned.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const answer = lines.filter((l) => !l.startsWith("*") && !/^(wait|final|result|check)/i.test(l));
  return (answer[answer.length - 1] || lines[lines.length - 1] || cleaned).trim();
}
