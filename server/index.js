import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { initSentry, Sentry } from "./sentry.js";
import { ingestRecipe } from "./ingest.js";
import { cookBuddyReply, streamCookBuddyReply } from "./chat.js";
import { synthesize } from "./voice.js";
import { translateRecipe } from "./translate.js";
import { agentEnabled, createSession } from "./agent.js";
import { authEnabled, publishableKey, requireAuth } from "./auth.js";
import {
  connectDb,
  dbMode,
  saveRecipe,
  listRecipes,
  getRecipe,
  deleteRecipe,
  saveTranslation,
} from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pwaDir = path.join(__dirname, "..", "pwa");

const tracing = initSentry();
const app = express();
app.use(express.json({ limit: "512kb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    db: dbMode(),
    voice: Boolean(process.env.ELEVENLABS_API_KEY),
    agent: agentEnabled(),
    auth: authEnabled(),
    publishableKey: publishableKey(),
  });
});

app.post("/api/ingest", requireAuth, async (req, res) => {
  const { url = "", caption = "" } = req.body || {};
  if (!url && !caption) {
    return res.status(400).json({ error: "Add a link or paste the recipe caption." });
  }
  try {
    const recipe = await Sentry.startSpan(
      { name: "ingest", op: "ai" },
      () => ingestRecipe({ url, caption })
    );
    const id = await saveRecipe(recipe, req.userId);
    res.json({ ...recipe, _id: id });
  } catch (err) {
    const status = err.code ? 422 : 500;
    res.status(status).json({ error: err.message });
  }
});

app.get("/api/recipes", requireAuth, async (req, res) => {
  res.json(await listRecipes(req.userId));
});

app.get("/api/recipes/:id", requireAuth, async (req, res) => {
  const recipe = await getRecipe(req.params.id, req.userId);
  if (!recipe) return res.status(404).json({ error: "Recipe not found" });
  res.json(recipe);
});

app.delete("/api/recipes/:id", requireAuth, async (req, res) => {
  const recipe = await getRecipe(req.params.id, req.userId);
  if (!recipe) return res.status(404).json({ error: "Recipe not found" });
  await deleteRecipe(req.params.id, req.userId);
  res.json({ ok: true });
});

app.post("/api/chat", requireAuth, async (req, res) => {
  const { recipeId, message, history = [], language = "en" } = req.body || {};
  if (!message) return res.status(400).json({ error: "Say something to Simmer." });
  const recipe = await getRecipe(recipeId, req.userId);
  if (!recipe) return res.status(404).json({ error: "Open a recipe first." });

  const wantsStream =
    req.query.stream === "1" || String(req.headers.accept || "").includes("text/event-stream");

  if (wantsStream) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    try {
      await Sentry.startSpan({ name: "cook-buddy-stream", op: "ai" }, () =>
        streamCookBuddyReply(recipe, message, history, language, (chunk) => res.write(chunk))
      );
      res.end();
    } catch (err) {
      if (!res.headersSent) res.status(500);
      res.end(`\n[${err.message}]`);
    }
    return;
  }

  try {
    const reply = await Sentry.startSpan(
      { name: "cook-buddy", op: "ai" },
      () => cookBuddyReply(recipe, message, history, language)
    );
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/translate", requireAuth, async (req, res) => {
  const { recipeId, language } = req.body || {};
  if (!language) return res.status(400).json({ error: "Pick a language." });
  const recipe = await getRecipe(recipeId, req.userId);
  if (!recipe) return res.status(404).json({ error: "Open a recipe first." });
  if (language === "en") return res.json(recipe);
  if (recipe.translations?.[language]) return res.json(recipe.translations[language]);
  try {
    const translated = await Sentry.startSpan(
      { name: "translate", op: "ai" },
      () => translateRecipe(recipe, language)
    );
    await saveTranslation(recipeId, language, translated, req.userId);
    res.json(translated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/agent/session", requireAuth, async (req, res) => {
  if (!agentEnabled()) return res.status(501).json({ error: "Live agent is not configured." });
  const recipe = await getRecipe(req.query.recipeId, req.userId);
  if (!recipe) return res.status(404).json({ error: "Open a recipe first." });
  const language = String(req.query.language || "en");
  const resume = req.query.resume === "1";
  try {
    const session = await Sentry.startSpan({ name: "agent-session", op: "ai" }, () =>
      createSession(recipe, language, { resume })
    );
    res.json(session);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/tts", requireAuth, async (req, res) => {
  const { text = "", language = "en" } = req.body || {};
  const audio = await synthesize(text.trim(), language);
  if (!audio) return res.status(204).end();
  res.setHeader("Content-Type", "audio/mpeg");
  res.send(audio);
});

app.use(
  express.static(pwaDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".webmanifest")) {
        res.setHeader("Content-Type", "application/manifest+json");
      }
      if (/\.(html|js|css|webmanifest)$/.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  })
);

app.get("*", (_req, res) => res.sendFile(path.join(pwaDir, "index.html")));

if (tracing) app.use(Sentry.expressErrorHandler());

const port = process.env.PORT || 3000;
connectDb()
  .catch((err) => console.error("DB connection failed:", err.message))
  .finally(() => {
    app.listen(port, () => console.log(`Simmer running on http://localhost:${port}`));
  });
