import { LANGUAGES } from "./languages.js";
import { translateRecipe } from "./translate.js";
import { getRecipe, saveTranslation } from "./db.js";

const LANGS = Object.keys(LANGUAGES).filter((code) => code !== "en");
const jobs = new Map();

function jobKey(id, language) {
  return `${id}:${language}`;
}

function startTranslation(recipe, id, ownerId, language) {
  const key = jobKey(id, language);
  if (jobs.has(key)) return jobs.get(key);

  const job = translateRecipe(recipe, language)
    .then(async (translated) => {
      await saveTranslation(id, language, translated, ownerId);
      return translated;
    })
    .finally(() => jobs.delete(key));

  jobs.set(key, job);
  return job;
}

export function prefetchTranslations(recipe, id, ownerId) {
  if (!recipe || !id) return Promise.resolve();
  const missing = LANGS.filter((language) => !recipe.translations?.[language]);
  if (missing.length === 0) return Promise.resolve();

  return Promise.allSettled(
    missing.map((language) =>
      startTranslation(recipe, id, ownerId, language).catch((err) => {
        console.error(`Translation ${language} failed for ${id}: ${err.message}`);
      })
    )
  );
}

export async function ensureTranslation(recipe, id, ownerId, language) {
  if (language === "en") return recipe;
  if (recipe.translations?.[language]) return recipe.translations[language];

  const fresh = await getRecipe(id, ownerId);
  if (fresh?.translations?.[language]) return fresh.translations[language];

  return startTranslation(fresh || recipe, id, ownerId, language);
}
