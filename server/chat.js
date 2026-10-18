import { generate, generateStream, parseReply } from "./gemma.js";
import { languageName } from "./languages.js";

export function buildChatPrompt(recipe, message, history = [], language = "en", { json = true } = {}) {
  const recent = history
    .slice(-6)
    .map((m) => `${m.role === "user" ? "Cook" : "Simmer"}: ${m.content}`)
    .join("\n");
  const replyLanguage = languageName(language);
  const format = json
    ? `Return ONLY a JSON object of the form {"reply": "<your answer>"}. No markdown, no lists, no extra text.`
    : `Reply with only your spoken answer, as plain text. No JSON, no markdown, no lists, no emoji.`;

  return `You are Simmer, a calm, encouraging cooking buddy. You are helping someone cook THIS recipe right now, hands-free, while their hands are busy.

${format}

Recipe:
${JSON.stringify({
  title: recipe.title,
  servings: recipe.servings,
  ingredients: recipe.ingredients,
  steps: recipe.steps,
  times: recipe.times,
})}

Rules:
- Answer in 1-3 short spoken sentences. No lists, no markdown, no emoji.
- Always answer the exact question. If they ask "how much X", give the amount from the ingredients.
- If they ask what is next, tell the next step plainly.
- If they ask to change servings, scale the amounts and say the new numbers.
- If something is not in the recipe, suggest a sensible common substitution and say it is a suggestion.
- Reply in ${replyLanguage}, and only in ${replyLanguage}.

Conversation so far:
${recent}

Cook: ${message}
Simmer:`;
}

export async function cookBuddyReply(recipe, message, history = [], language = "en") {
  const prompt = buildChatPrompt(recipe, message, history, language, { json: true });
  const raw = await generate(prompt, { temperature: 0.5 });
  return parseReply(raw);
}

export async function streamCookBuddyReply(recipe, message, history = [], language = "en", onText) {
  const prompt = buildChatPrompt(recipe, message, history, language, { json: false });
  return generateStream(prompt, { temperature: 0.5, onText });
}
