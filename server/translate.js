import { generate, parseJson } from "./gemma.js";
import { languageName } from "./languages.js";

export async function translateRecipe(recipe, language) {
  const name = languageName(language);

  const prompt = `Translate the human-readable text of this cooking recipe into ${name}.

Return ONLY JSON with the same shape as the input:
{
  "title": string,
  "servings": number,
  "ingredients": [{ "qty": number|null, "unit": string, "item": string }],
  "steps": [string],
  "times": { "prep": string, "cook": string },
  "tags": [string]
}

Rules:
- Translate: title, every step, times.prep, times.cook, every ingredient unit and item, and the tags.
- Keep every number, quantity and unit amount identical (do not change "200", "2", "0.5").
- Keep times in the same short form ("10m", "1h") but localize the letter if natural.
- Do not add or remove ingredients, steps or tags.
- Do not include any commentary, only JSON.

Recipe:
${JSON.stringify({
  title: recipe.title,
  servings: recipe.servings,
  ingredients: recipe.ingredients,
  steps: recipe.steps,
  times: recipe.times,
  tags: recipe.tags,
})}`;

  const raw = await generate(prompt, { temperature: 0.2 });
  const out = parseJson(raw);

  return {
    title: out.title || recipe.title,
    servings: Number(out.servings) || recipe.servings,
    ingredients: Array.isArray(out.ingredients) ? out.ingredients : recipe.ingredients,
    steps: Array.isArray(out.steps) ? out.steps : recipe.steps,
    times: out.times || recipe.times,
    tags: Array.isArray(out.tags) ? out.tags : recipe.tags,
  };
}
