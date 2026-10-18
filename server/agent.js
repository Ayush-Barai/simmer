import { languageName } from "./languages.js";

const API = "https://api.elevenlabs.io/v1/convai";
const AGENT_NAME = "Simmer Cook Buddy";

const GREETINGS = {
  en: (t) => `Hi, I'm Simmer, your cooking buddy. We're making ${t}. Ask me anything.`,
  es: (t) => `Hola, soy Simmer, tu ayudante de cocina. Estamos preparando ${t}. Pregúntame lo que quieras.`,
  fr: (t) => `Salut, je suis Simmer, ton aide de cuisine. On prepare ${t}. Pose-moi tes questions.`,
  de: (t) => `Hi, ich bin Simmer, dein Kochbuddy. Wir kochen ${t}. Frag mich alles.`,
  it: (t) => `Ciao, sono Simmer, il tuo aiuto in cucina. Stiamo preparando ${t}. Chiedimi quello che vuoi.`,
  pt: (t) => `Oi, eu sou o Simmer, seu ajudante de cozinha. Estamos fazendo ${t}. Pergunte o que quiser.`,
  hi: (t) => `नमस्ते, मैं Simmer हूँ, आपका कुकिंग साथी। हम ${t} बना रहे हैं। कुछ भी पूछें।`,
  ja: (t) => `こんにちは、Simmerです。今日は${t}を作ります。何でも聞いてください。`,
  zh: (t) => `你好，我是 Simmer，你的厨房帮手。我们正在做${t}。有什么都可以问我。`,
  ar: (t) => `مرحبا، أنا Simmer، مساعدك في المطبخ. نطبخ ${t}. اسألني أي شيء.`,
};

const CONTINUE = {
  en: "Okay, let's continue in English.",
  es: "Vale, seguimos en español.",
  fr: "D'accord, on continue en français.",
  de: "Okay, wir machen auf Deutsch weiter.",
  it: "Va bene, continuiamo in italiano.",
  pt: "Certo, vamos continuar em português.",
  hi: "ठीक है, अब हिंदी में बात करते हैं।",
  ja: "わかりました。日本語で続けましょう。",
  zh: "好的，我们继续说中文。",
  ar: "حسنًا، لنكمل بالعربية.",
};

export function agentEnabled() {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

function headers() {
  return {
    "xi-api-key": process.env.ELEVENLABS_API_KEY,
    "Content-Type": "application/json",
  };
}

let cachedId = (process.env.ELEVENLABS_AGENT_ID || "").trim();

const AGENT_CONFIG = {
  name: AGENT_NAME,
  conversation_config: {
    agent: {
      first_message: "Hi, I'm Simmer, your cooking buddy. Ask me anything about this recipe.",
      language: "en",
      prompt: {
        prompt:
          "You are Simmer, a calm, encouraging cooking buddy helping hands-free in the kitchen. Answer in 1-3 short spoken sentences. Always answer the exact question.",
      },
    },
  },
};

const ALLOW_OVERRIDES = {
  platform_settings: {
    overrides: {
      conversation_config_override: {
        agent: {
          first_message: true,
          language: true,
          prompt: { prompt: true },
        },
      },
    },
  },
};

async function findAgent() {
  const res = await fetch(`${API}/agents`, { headers: headers() });
  if (!res.ok) throw new Error(`ElevenLabs list agents failed (${res.status})`);
  const data = await res.json();
  return (data.agents || []).find((a) => a.name === AGENT_NAME)?.agent_id || "";
}

async function createAgent() {
  const res = await fetch(`${API}/agents/create`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(AGENT_CONFIG),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs create agent failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const { agent_id: id } = await res.json();
  await fetch(`${API}/agents/${id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(ALLOW_OVERRIDES),
  });
  return id;
}

async function ensureAgent() {
  if (cachedId) return cachedId;
  cachedId = (await findAgent()) || (await createAgent());
  return cachedId;
}

function recipeTitle(recipe, language) {
  return recipe.translations?.[language]?.title || recipe.title;
}

export function buildAgentPrompt(recipe, language) {
  const lang = languageName(language);
  return `You are Simmer, a calm, encouraging cooking buddy. You are helping someone cook THIS recipe right now, hands-free, while their hands are busy.

Keep every answer to 1-3 short spoken sentences. No lists, no markdown, no emoji.
Always answer the exact question. If they ask "how much X", give the amount from the ingredients. If they ask what is next, say the next step plainly. If they ask to change servings, scale the amounts and say the new numbers. If something is not in the recipe, suggest a sensible substitution and say it is a suggestion.
Reply in ${lang}, and only in ${lang}.

Recipe:
${JSON.stringify({
  title: recipeTitle(recipe, language),
  servings: recipe.servings,
  ingredients: recipe.ingredients,
  steps: recipe.steps,
  times: recipe.times,
})}`;
}

export async function createSession(recipe, language = "en", { resume = false } = {}) {
  const agentId = await ensureAgent();
  const res = await fetch(`${API}/conversation/get-signed-url?agent_id=${agentId}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`ElevenLabs signed url failed (${res.status})`);
  const { signed_url: signedUrl } = await res.json();

  const title = recipeTitle(recipe, language);
  const greeting = resume
    ? CONTINUE[language] || CONTINUE.en
    : (GREETINGS[language] || GREETINGS.en)(title);

  return {
    signedUrl,
    agentId,
    overrides: {
      agent: {
        prompt: { prompt: buildAgentPrompt(recipe, language) },
        firstMessage: greeting,
        language,
      },
    },
  };
}
