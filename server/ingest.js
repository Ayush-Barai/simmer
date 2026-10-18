import { generate, parseJson } from "./gemma.js";
import { fetchAudioTranscript, fetchTranscript, fetchVideoMeta } from "./transcript.js";

const RECIPE_SCHEMA = `{
  "title": string,
  "servings": number,
  "ingredients": [{ "qty": number|null, "unit": string, "item": string }],
  "steps": [string],
  "times": { "prep": string, "cook": string },
  "tags": [string],
  "isRecipe": boolean
}`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PAGE_HEADERS = {
  "User-Agent": UA,
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};
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

function decodeEscaped(raw) {
  if (!raw) return "";
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
}

function jsonTextField(html, patterns) {
  for (const re of patterns) {
    const found = html.match(re)?.[1];
    if (found) {
      const text = decodeEscaped(found).trim();
      if (text) return text;
    }
  }
  return "";
}

function socialCaption(html) {
  const candidates = [
    jsonTextField(html, [
      /"edge_media_to_caption"\s*:\s*\{\s*"edges"\s*:\s*\[\s*\{\s*"node"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/i,
      /"accessibility_caption"\s*:\s*"((?:[^"\\]|\\.)*)"/i,
      /"caption"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/i,
      /"desc"\s*:\s*"((?:[^"\\]|\\.)*)"/i,
    ]),
  ];
  return [...new Set(candidates.filter(Boolean))].join("\n");
}

const BOILERPLATE =
  /^(log in|log into|sign up|see instagram|instagram photos and videos|tiktok - make your day|watch the latest|discover short videos|video by )/i;
const NOISE_EXACT = /^instagram$/i;

function cleanPageText(text) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const kept = lines.filter((line) => !BOILERPLATE.test(line) && !NOISE_EXACT.test(line));
  const out = (kept.length ? kept : lines).join("\n").trim();
  if (/log in to instagram|sign up for instagram|page isn't available|this page isn't available/i.test(out)) {
    return "";
  }
  return out;
}

function htmlToText(html) {
  return (html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function instagramShortcode(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return null;
    return u.pathname.match(/\/(?:reel|reels|p|tv)\/([^/?#]+)/)?.[1] || null;
  } catch {
    return null;
  }
}

async function fetchInstagramEmbed(url) {
  const code = instagramShortcode(url);
  if (!code) return "";

  for (const variant of [
    `https://www.instagram.com/reel/${code}/embed/captioned/`,
    `https://www.instagram.com/p/${code}/embed/captioned/`,
  ]) {
    try {
      const res = await fetch(variant, {
        headers: PAGE_HEADERS,
        signal: AbortSignal.timeout(12000),
      });
      const html = await res.text();
      const plain = htmlToText(
        html.match(/class="Caption"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || ""
      );
      const text = cleanPageText(
        [
          socialCaption(html),
          metaContent(html, "og:description"),
          metaContent(html, "description"),
          plain,
        ]
          .filter(Boolean)
          .join("\n")
      );
      if (text.length > 40) return text;
    } catch {
      /* try the next embed variant */
    }
  }
  return "";
}

export async function fetchPageText(url) {
  if (!url) return "";

  if (youtubeId(url)) {
    const yt = await fetchYouTubeText(url);
    if (yt) return yt.slice(0, 8000);
  }

  let text = "";
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: PAGE_HEADERS,
      signal: AbortSignal.timeout(12000),
    });
    const html = await res.text();
    const title =
      metaContent(html, "og:title") ||
      metaContent(html, "twitter:title") ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ||
      "";
    const description =
      metaContent(html, "og:description") ||
      metaContent(html, "twitter:description") ||
      metaContent(html, "description");
    text = cleanPageText([title, description, socialCaption(html)].filter(Boolean).join("\n"));
  } catch {
    /* fall through to the embed / yt-dlp fallbacks */
  }

  if (instagramShortcode(url) && text.length < 120) {
    const embed = await fetchInstagramEmbed(url);
    if (embed) {
      text = cleanPageText([text, embed].filter(Boolean).join("\n"));
    }
  }

  if (isVideoUrl(url) && !youtubeId(url)) {
    const meta = await fetchVideoMeta(url);
    if (meta) {
      const extra = [meta.title, meta.description].filter(Boolean).join("\n");
      const alreadyIncluded = meta.description && text.includes(meta.description.slice(0, 80));
      if (extra && !alreadyIncluded) {
        text = cleanPageText([text, extra].filter(Boolean).join("\n"));
      }
    }
  }

  return text.slice(0, 8000);
}

export async function fetchPageImage(url) {
  if (!url) return "";
  const id = youtubeId(url);
  if (id) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: PAGE_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    const raw = metaContent(html, "og:image") || metaContent(html, "twitter:image");
    if (raw) return new URL(raw, url).toString();
  } catch {
    /* fall through to yt-dlp */
  }
  if (isVideoUrl(url)) {
    const meta = await fetchVideoMeta(url);
    if (meta?.thumbnail) return meta.thumbnail;
  }
  return "";
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
  let text = [caption, fetched].filter(Boolean).join("\n\n").trim();
  const video = isVideoUrl(url);

  const complete = (recipe) => recipe.ingredients.length > 0 && recipe.steps.length > 0;

  let recipe = null;
  if (text) recipe = await buildRecipe(text, url);

  if ((!recipe || !complete(recipe)) && video) {
    const transcript = await fetchAudioTranscript(url);
    if (transcript) {
      text = [transcript, text].filter(Boolean).join("\n\n").trim();
      recipe = await buildRecipe(text, url);
    }
  }

  if (!text) {
    const err = new Error(
      video
        ? "This post is private or blocked, so Simmer couldn't read its description or audio. Try a public link or a YouTube version."
        : "Could not read this link. Try a public recipe page or a YouTube version."
    );
    err.code = "NO_TEXT";
    throw err;
  }

  if (!recipe || (recipe.ingredients.length === 0 && recipe.steps.length === 0)) {
    const err = new Error(
      video
        ? "Simmer read the description and audio but couldn't find a full recipe. Try a video that says or shows the ingredients and steps."
        : "That text does not look like a recipe. Try a link to the recipe itself."
    );
    err.code = video ? "VIDEO_NO_TEXT" : "NOT_A_RECIPE";
    throw err;
  }

  recipe.image = await fetchPageImage(url);
  return recipe;
}
