# Simmer

Share a cooking reel → get a clean recipe → cook hands-free with an open-AI buddy.

Built for the **Hacktoberfest Open-Source AI Challenge (Week 2: Side Hustle)**.

## What it does

- **Link → recipe:** share a Reel/Short/TikTok or paste a link or caption; Gemma extracts
  ingredients, amounts, timings and ordered steps.
- **Hands-free cooking:** a live voice loop (ElevenLabs Conversational AI) with a browser
  speech fallback, so you can ask questions mid-step without touching the phone.
- **10 languages:** read, chat and translate in English, Spanish, French, German, Italian,
  Portuguese, Hindi, Japanese, Chinese and Arabic.
- **Private cookbook:** Clerk auth, per-user recipes, thumbnails and saved chat history.
- **Installable PWA:** Android share target, offline shell and a light/dark theme.

## Stack

- **Gemma 4** (open-weight) turns messy captions/subtitles into structured recipes, powers the cook-buddy chat, and translates recipes into other languages.
- **MongoDB Atlas** stores your saved recipes (falls back to in-memory when no URI is set).
- **ElevenLabs** gives the cook-buddy a natural voice (falls back to the browser voice).
- **Clerk** handles sign-in so each cook only sees their own cookbook.
- **Sentry** traces the ingest and chat agent runs.
- **Render** hosts it (Docker); an optional **.tech** domain gives it a custom address.

---

## Local setup (step by step)

### 1. Install Node
Use Node 18 or newer (`node --version` to check). Node 20+ recommended.

### 2. Install dependencies
```bash
npm install
```

### 3. Create your env file
```bash
copy .env.example .env      # Windows
cp .env.example .env        # macOS / Linux
```

### 4. Get a Gemma API key (required)
1. Go to https://aistudio.google.com/apikey and sign in.
2. Click **Create API key** and copy it.
3. Paste it into `.env` as `GEMMA_API_KEY`.

Then confirm which Gemma models your key can use:
```bash
npm run models
```
This prints the available Gemma models. Set the one you want in `.env`:
```
GEMMA_MODEL=gemma-4-26b-a4b-it
```
> Gemma 4 is exposed as `gemma-4-26b-a4b-it` and `gemma-4-31b-it`. If you get a
> `models/... is not found` error, run `npm run models` and pick a listed id.

### 5. Start the app
```bash
npm run dev
```
Open http://localhost:3000. Paste a recipe link, or paste a caption, and press
**Turn it into a recipe**. Everything works with only `GEMMA_API_KEY` set
(recipes are stored in memory until you connect Atlas).

---

## Set up MongoDB Atlas (so recipes persist)

Optional, but needed for the "Best Use of MongoDB Atlas" category and for data
that survives restarts.

1. Go to https://www.mongodb.com/cloud/atlas/register and create a free account.
2. Create a **free M0 cluster** (any provider/region near you).
3. **Create a database user**: Security → Database Access → Add New Database User.
   Choose a username and password, give it "Read and write to any database".
4. **Allow your IP**: Security → Network Access → Add IP Address → Allow access
   from anywhere (`0.0.0.0/0`) for local dev. (You need this for Render too.)
5. Click **Connect → Drivers**. Copy the connection string, it looks like:
   ```
   mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
6. Replace `<user>` and `<password>` with your database user, then paste it into
   `.env`:
   ```
   MONGODB_URI=mongodb+srv://...
   MONGODB_DB=simmer
   ```
7. Restart the app (`npm run dev`). The console should print
   `Connected to MongoDB Atlas.` instead of the in-memory message.

---

## Environment variables

| Variable | Required | What it does |
|---|---|---|
| `GEMMA_API_KEY` | Yes | Gemma API key from Google AI Studio |
| `GEMMA_MODEL` | No | Default `gemma-4-26b-a4b-it` |
| `MONGODB_URI` | No | Atlas connection string (else in-memory) |
| `MONGODB_DB` | No | Database name, default `simmer` |
| `ELEVENLABS_API_KEY` | No | Natural voice (else browser voice) |
| `ELEVENLABS_VOICE_ID` | No | Voice to use (free plans need an account voice; blank = auto-pick) |
| `ELEVENLABS_AGENT_ID` | No | Conversational AI agent for the live hands-free agent (needs a key with Conversational AI permission) |
| `CLERK_PUBLISHABLE_KEY` | No | Enables sign-in in the browser (safe to expose) |
| `CLERK_SECRET_KEY` | No | Verifies session tokens on the server (never expose) |
| `YT_SUB_LANGS` | No | YouTube subtitle languages to prefer, default `en.*,en` |
| `SENTRY_DSN` | No | Enables agent tracing |
| `PORT` | No | Default `3000`; Render sets it automatically |

---

## Deploy on Render

`render.yaml` describes a Docker web service named `simmer` on the free plan, with the
health check at `/api/health`. `.dockerignore` keeps `.env` and `node_modules` out of the
image.

### 1. Push to GitHub

Create an **empty** repo at https://github.com/new (no README, no `.gitignore`), then:

```bash
git init -b main
git add .
git commit -m "Simmer: AI recipe PWA"
git remote add origin https://github.com/<you>/simmer.git
git push -u origin main
```

`.env` is ignored already — never commit it.

### 2. Create the Render service

1. In Render, choose **New → Blueprint**.
2. Connect GitHub, pick the `simmer` repo and grant access if asked.
3. Click **Apply**. Render reads `render.yaml` and creates the web service.
4. Fill the secrets Render prompts for:
   - `GEMMA_API_KEY` (required)
   - `MONGODB_URI` (recommended; otherwise recipes are in-memory)
   - `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` (sign-in and private cookbooks)
   - `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` (live voice agent; voice falls back to
     the browser without them)
   - `SENTRY_DSN` (optional)
5. Deploy. The first Docker build takes a few minutes because it installs `yt-dlp`.
6. Open the service URL. `/api/health` should return `{ "ok": true, ... }`.

Manual alternative: **New → Web Service** → pick the repo → **Language: Docker** →
health check path `/api/health` → add the same environment variables.

### 3. Connect the rest

- **MongoDB Atlas:** allow `0.0.0.0/0` in **Network Access** (Render IPs rotate). Run
  `npm run init-db` once from your machine with the same `MONGODB_URI` to create indexes.
- **Clerk:** test keys (`pk_test_...`) work on the Render URL. For production keys, add
  the Render hostname under **Domains** in the Clerk dashboard.
- **Custom `.tech` domain:** Render → **Settings → Custom Domains** → add the domain, then
  create the DNS records Render shows. HTTPS is automatic.
- **PWA / share target:** open the Render URL on Android Chrome and install it. The share
  sheet needs HTTPS, which Render provides.

> Render's free plan sleeps after ~15 minutes idle. The first request afterwards takes
> roughly 30–60 seconds; recipes stay safe in Atlas.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with auto-reload |
| `npm start` | Start normally |
| `npm run models` | List the Gemma models your API key can use |
| `npm run check-db` | Test the MongoDB connection and explain any problem |
| `npm run init-db` | Create the `recipes` collection, schema validator and indexes |
| `npm run claim` | Attach existing unowned recipes to your Clerk user (and backfill thumbnails) |

---

## Troubleshooting

**`models/gemma-3-27b-it is not found`**
Your key uses Gemma 4. Run `npm run models` and set `GEMMA_MODEL` to a listed id
(for example `gemma-4-26b-a4b-it`).

**`bad auth : authentication failed`**
The username or password in `MONGODB_URI` is wrong. `npm run check-db` will say if the
password is still a `<placeholder>` or has characters that need URL-encoding
(`@ : / ? # [ ] %` must be percent-encoded, e.g. `@` becomes `%40`).

**`tlsv1 alert internal error` / `SSL alert number 80`**
Atlas is refusing your IP because it is not in **Network Access**. `npm run check-db`
prints your current public IP — add it in Atlas → Security → Network Access → Add IP
Address. If your ISP changes your IP often (most mobile / CGNAT connections do), choose
**Allow Access from Anywhere (`0.0.0.0/0`)** so it stops breaking. Simmer also forces
IPv4 (`family: 4`) to avoid broken IPv6 routes.

**Voice replies are silent (ElevenLabs)**
A free ElevenLabs plan cannot use *library* voices via the API — you get
`402 paid_plan_required`. Set `ELEVENLABS_VOICE_ID` to a voice from your own
account's **My Voices**, or leave it blank and Simmer will auto-pick one that works.
Without any key, Simmer uses the browser's built-in voice.

**`No addresses found at host` or `check-db` says the host does not resolve**
The `MONGODB_URI` is wrong. The host must end in `.mongodb.net`, like
`cluster0.abcde.mongodb.net` — not `ai.mongodb.com` or a placeholder. Re-copy the
string from Atlas → **Connect → Drivers** and replace only the `<password>`.
The app keeps working on the in-memory store until this is fixed.

---

## API

- `POST /api/ingest` `{ url, caption? }`
- `GET /api/recipes`
- `GET /api/recipes/:id`
- `DELETE /api/recipes/:id`
- `POST /api/chat` `{ recipeId, message, history, language }`
- `POST /api/translate` `{ recipeId, language }`
- `GET /api/agent/session?recipeId=...&language=en&resume=1` (ElevenLabs live agent)
- `POST /api/tts` `{ text, language }`
- `GET /api/health`

When Clerk is configured, every route except `/api/health` requires
`Authorization: Bearer <Clerk session token>`.

## Use it on your phone (share straight from a reel)

Simmer is an installable **PWA with a share target**, so a reel or Short can go
straight in from the phone's share sheet:

1. Deploy Simmer to an **HTTPS** URL (e.g. Render). The phone needs HTTPS and the
   server must be reachable, because the video/site is read on the server (yt-dlp).
2. Open that URL on the phone → browser menu → **Add to Home screen / Install app**.
3. In YouTube / Instagram / TikTok, tap **Share** → choose **Simmer**. Simmer opens on
   the Add screen, drops the link in, and starts building the recipe by itself.
4. On iPhone (no share target) → **Share → Copy link**, open Simmer, paste it.

What works from a bare shared link:

- **YouTube Shorts / YouTube:** works when the video has captions (yt-dlp) or a written
  description — this is the best case.
- **Instagram Reels / TikTok:** bot-walled, so the **link alone usually returns nothing**.
  Use **Copy caption**, then share/paste the caption into Simmer — that always works.
  If a share carries the caption in the text, Simmer pulls the link out of the text
  automatically.

## Sign in with Clerk (private cookbook per person)

Simmer uses **Clerk** for authentication. Each recipe is stamped with the signed-in
user's Clerk user id, and every API route only returns/deletes that user's recipes.

1. Create a free app at [dashboard.clerk.com](https://dashboard.clerk.com).
2. Copy both API keys into `.env`:
   ```env
   CLERK_PUBLISHABLE_KEY=pk_test_...
   CLERK_SECRET_KEY=sk_test_...
   ```
3. Restart the server. Signed-out visitors land on the marketing page with **Sign in**
   and **Sign up**; once signed in, the avatar in the header opens a profile card
   (name, email, recipe count, joined date, manage account, sign out).

Details:

- The browser loads Clerk's SDK from the CDN, exchanges the session for a short-lived
  JWT, and sends it as `Authorization: Bearer <token>`.
- The server verifies that JWT with `@clerk/backend` (`verifyToken`) before touching
  the database.
- Leave both keys blank and Simmer stays in **guest mode** (no login, no isolation) so
  local demos still work.
- If you saved recipes before enabling Clerk, sign up once and run `npm run claim` to
  attach those unowned recipes to your account (it also backfills thumbnails).
- Recipe thumbnails come from YouTube's video preview or the page's `og:image`, and
  are shown on the home screen.
- Light and dark themes are available everywhere via the header toggle. The choice is
  stored in `localStorage`, defaults to the OS preference, and is also applied to the
  Clerk sign-in, sign-up and account modals.

## Notes

- The share button works on Android Chrome. On iPhone, paste the link + caption.
- Private/walled reels: paste the caption and Simmer still builds the recipe.
- Recipes are cached on the device, so cook mode keeps working with no signal.

## Hands-free cook mode

Open a recipe → **Start cooking**, then tap the **mic** to turn on live mode:

- It keeps listening while you talk, and Simmer answers out loud.
- It stops listening while Simmer talks, so it never answers itself.
- Say **"stop"** (or "quiet", "cancel", "never mind") to turn live mode off.
- Tap the mic again to turn it off manually.

Tapping the mic opens the **live agent interface** when the ElevenLabs agent is
configured (see below); otherwise it falls back to the browser's speech recognition.
Either way the replies use the cooked-in ElevenLabs voice, or your device's voice when
no key is set.

**View chat history** (next to *Ask Simmer*) reopens the whole conversation for that
recipe — it is saved on the device, so it survives reloads and app restarts.

## Live voice agent (ElevenLabs Conversational AI)

Open a recipe → **Start cooking** → tap the **mic**. Simmer opens a full **agent
interface** (animated orb, live status, rolling transcript, elapsed timer, **Mute**
and **End**) and starts a real-time voice agent that already knows *this* recipe:

- Full duplex: the agent listens and speaks at once, and you can interrupt it (barge-in).
- The recipe (title, servings, ingredients, steps, times) is passed as a per-session
  **system-prompt override**, so answers are grounded in the recipe and the spoken
  language matches the one you picked.
- Simmer creates the agent automatically on first use and reuses it after that.
- **Switch language by voice:** just say *"speak in Hindi"* / *"switch to Spanish"* /
  *"answer in English"*. Simmer ends that session, reopens it in the requested language
  (with a short "continuing in…" greeting) and keeps the recipe context.
- **From anywhere:** the **Ask Simmer** button in the header jumps straight into the
  agent (opening your most recent recipe if none is open).

Requirements: an `ELEVENLABS_API_KEY` whose key has the **Conversational AI** permission
(`convai_read`, `convai_write`). This is a **paid-plan** feature. Set `ELEVENLABS_AGENT_ID`
to reuse an existing agent, or leave it blank to let Simmer create one.

If the agent can't start (no key, no plan, denied mic), Simmer silently falls back to the
device's built-in voice mode below.

## Translate a recipe (and its voice)

On a recipe (or in cook mode), pick a **Language** from the dropdown:

- **Gemma** translates the title, ingredients, steps and tags — numbers stay exact.
- The translation is saved on the recipe in MongoDB, so it is instant next time.
- The **spoken** language follows the selection: Simmer answers and reads steps in
  that language, and the mic listens in that language too.

Languages: English, Español, Français, Deutsch, Italiano, Português, हिन्दी, 日本語,
中文, العربية.

## How links are read

Simmer fetches the readable text behind a link before asking Gemma to structure it.

- **Recipe blogs / food sites:** it reads the page title and description.
- **YouTube / Shorts:** Simmer downloads the video's **subtitles** (auto-generated
  captions included) with **yt-dlp** and turns the spoken recipe into steps, and also
  reads the description. This is what makes "cook along with this Short" work.
  If a video has no captions and no description text, Simmer asks you to paste it.
- **TikTok / Instagram:** bot-walled, so the link alone usually yields nothing —
  paste the caption and Simmer will build the recipe from it.

Adding a pasted caption always works, even when the link cannot be read.

### YouTube subtitles need `yt-dlp` (recommended)

YouTube recipes are usually spoken, not written, so Simmer uses **yt-dlp** to grab
the subtitles:

- Windows: `python -m pip install -U yt-dlp`
- macOS/Linux: `pip install -U yt-dlp` (or `brew install yt-dlp`)

The Docker image already installs `yt-dlp`. Without it, YouTube links fall back to the
description only. Set `YT_SUB_LANGS` to change which subtitle languages are preferred
(default `en.*,en`).

---

## License

MIT - see [LICENSE](LICENSE).

