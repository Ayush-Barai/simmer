import { generate, parseJson } from "./gemma.js";
import { fetchTranscript } from "./transcript.js";

const RECIPE_SCHEMA = `{
  "title": string,
  "servings": number,
  "ingredients": [{ "qty": number|null, "unit": string, "item": string }],
  "steps": [string],
  "times": { "prep": string, "cook": string },
  "tags": [string],
  "isRecipe": boolean
}`;

const UA = "Mozilla/5.0 (compatible; SimmerBot/1.0)";
const VIDEO_HOSTS =
  /(?:^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|vimeo\.com)$/i;

function youtubeId(url) {
  try {
    const u = new URL(url);
    if (/(^|\.)youtu\.be$/i.test(u.hostname)) {
      return u.pathname.split("/").filter(Boolean)[0] || null;
    }
    if (/(^|\.)youtube\.com$/i.test(u.hostname)) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const m = u.pathname.match(/\/(?:shorts|embed|live)\/([^/?#]+)/);
      if (m) return m[1];
    }
  } catch {
    /* not a valid URL */
  }
  return null;
}

function isVideoUrl(url) {
  try {
    return VIDEO_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function metaContent(html, name) {
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${safe}["'][^>]+content=["']([^"']*)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${safe}["']`,
      "i"
    ),
  ];
  for (const re of patterns) {
    const found = html.match(re)?.[1];
    if (found) return found.replace(/&amp;/g, "&");
  }
  return "";
}

async function fetchYouTubeMeta(url) {
  const id = youtubeId(url);
  if (!id) return { title: "", description: "" };
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${id}`, {
      headers: { "User-Agent": UA },
    });
    const html = await res.text();

    const title = metaContent(html, "og:title");
    const rawDesc = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/)?.[1];
    let description = "";
    if (rawDesc) {
      try {
        description = JSON.parse(`"${rawDesc}"`);
      } catch {
        description = rawDesc.replace(/\\n/g, "\n");
      }
    }
    return { title, description };
  } catch {
    return { title: "", description: "" };
  }
}

async function fetchYouTubeText(url) {
  const [meta, transcript] = await Promise.all([
    fetchYouTubeMeta(url),
    fetchTranscript(url),
  ]);
  return [meta.title, meta.description, transcript].filter(Boolean).join("\n\n");
}

export async function fetchPageText(url) {
  if (!url) return "";

  if (youtubeId(url)) {
    const yt = await fetchYouTubeText(url);
    if (yt) return yt.slice(0, 8000);
  }

  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": UA },
    });
    const html = await res.text();
    const parts = [
      metaContent(html, "og:title"),
      metaContent(html, "og:description"),
      metaContent(html, "description"),
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "",
    ];
    return parts.filter(Boolean).join("\n").slice(0, 8000);
  } catch {
    return "";
  }
}

export async function fetchPageImage(url) {
  if (!url) return "";
  const id = youtubeId(url);
  if (id) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    const raw = metaContent(html, "og:image") || metaContent(html, "twitter:image");
    if (!raw) return "";
    return new URL(raw, url).toString();
  } catch {
    return "";
  }
}

export async function buildRecipe(text, sourceUrl) {
  const prompt = `You convert messy food captions, subtitles and page text into one clean recipe.

Return ONLY JSON matching this exact schema:
${RECIPE_SCHEMA}

Rules:
- If the text is not a cooking recipe, set "isRecipe" to false and leave other fields empty.
- Convert amounts to numbers when possible (e.g. "1/2 cup" -> qty 0.5, unit "cup").
- Keep steps faithful and complete: preserve the heat level, technique, timing and any quantities that appear in the text. Do not merge, drop or over-summarize details. One clear sentence per action; use 1-2 sentences when that is what it takes to keep the real meaning.
- Keep steps in cooking order.
- Estimate prep/cook times like "10m", "1h" if not stated.
- Add 1-4 short lowercase tags (e.g. "quick", "vegetarian").
- Never invent ingredients that are not in the text.
- Do not explain your reasoning. Output the JSON object and nothing else.

Text to convert:
"""
${text.slice(0, 6000)}
"""`;

  const raw = await generate(prompt, { temperature: 0.3 });
  const recipe = parseJson(raw);

  return {
    title: recipe.title || "Untitled recipe",
    servings: Number(recipe.servings) || 2,
    ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
    steps: Array.isArray(recipe.steps) ? recipe.steps : [],
    times: recipe.times || { prep: "", cook: "" },
    tags: Array.isArray(recipe.tags) ? recipe.tags : [],
    sourceUrl: sourceUrl || "",
    createdAt: new Date(),
  };
}

export async function ingestRecipe({ url, caption }) {
  const fetched = await fetchPageText(url);
  const text = [caption, fetched].filter(Boolean).join("\n\n").trim();
  const video = isVideoUrl(url);

  if (!text) {
    const err = new Error(
      video
        ? "This video has no readable text. Open it, tap the caption or description, copy the recipe, and paste it in the caption box."
        : "Could not read this link. Open it and paste the caption or recipe text."
    );
    err.code = "NO_TEXT";
    throw err;
  }

  const recipe = await buildRecipe(text, url);
  recipe.image = await fetchPageImage(url);
  if (recipe.ingredients.length === 0 && recipe.steps.length === 0) {
    const err = new Error(
      video
        ? "This video keeps the recipe in its audio, so there is no text to read. Open it, tap the caption or description (…more), copy the recipe, and paste it in the caption box."
        : "That text does not look like a recipe. Try pasting the caption or ingredient list."
    );
    err.code = video ? "VIDEO_NO_TEXT" : "NOT_A_RECIPE";
    throw err;
  }
  return recipe;
}
