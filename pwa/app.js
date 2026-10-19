const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const views = ["home", "add", "detail", "cook"];

const LANGS = [
  { code: "en", label: "English", voice: "en-US" },
  { code: "es", label: "Español", voice: "es-ES" },
  { code: "fr", label: "Français", voice: "fr-FR" },
  { code: "de", label: "Deutsch", voice: "de-DE" },
  { code: "it", label: "Italiano", voice: "it-IT" },
  { code: "pt", label: "Português", voice: "pt-BR" },
  { code: "hi", label: "हिन्दी", voice: "hi-IN" },
  { code: "ja", label: "日本語", voice: "ja-JP" },
  { code: "zh", label: "中文", voice: "zh-CN" },
  { code: "ar", label: "العربية", voice: "ar-SA" },
];

const STOP_WORDS = [
  "stop",
  "stop listening",
  "stop it",
  "cancel",
  "quiet",
  "be quiet",
  "shut up",
  "never mind",
  "nevermind",
  "that's all",
  "thats all",
  "pause",
  "halt",
];

const state = {
  recipes: [],
  query: "",
  addMode: "link",
  current: null,
  display: null,
  translations: {},
  language: "en",
  cookStep: 0,
  history: [],
  live: false,
  speaking: false,
  recognizing: false,
  lastFinal: "",
  lastFinalAt: 0,
  recognition: null,
  audio: null,
  agent: null,
  agentOn: false,
  agentAvailable: false,
  agentMuted: false,
  agentTimer: null,
  agentAiBubble: null,
  agentAiText: "",
  agentUserBubble: null,
  agentUserOpen: false,
  tentativeUser: "",
  agentGen: 0,
  switching: false,
  lastSwitchAt: 0,
  authEnabled: false,
  signedIn: false,
  publishableKey: "",
};

const LANG_ALIASES = {
  en: ["english", "angrezi", "अंग्रेज़ी", "अंग्रेजी"],
  es: ["spanish", "espanol", "español", "castellano"],
  fr: ["french", "francais", "français"],
  de: ["german", "deutsch"],
  it: ["italian", "italiano"],
  pt: ["portuguese", "portugues", "português"],
  hi: ["hindi", "हिन्दी", "हिंदी"],
  ja: ["japanese", "日本語", "nihongo"],
  zh: ["chinese", "mandarin", "中文", "zhongwen"],
  ar: ["arabic", "العربية", "arabi"],
};

const SWITCH_INTENT =
  /(speak|talk|reply|answer|respond|switch|change|say it|continue|from now|can you|please)/i;

function show(view) {
  if (view !== "cook" && state.agentOn) stopAgent();
  closeHistory();
  views.forEach((v) => ($(`#view-${v}`).hidden = v !== view));
  window.scrollTo({ top: 0 });
}

function chatStorageKey() {
  return `simmer:chat:${state.current?._id || "none"}`;
}

function loadChatHistory() {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(chatStorageKey()) || "[]");
  } catch {
    saved = [];
  }
  state.history = Array.isArray(saved) ? saved : [];
  const log = $("#chat-log");
  if (!log) return;
  log.innerHTML = "";
  state.history.forEach((m) => addBubble(m.role === "user" ? "user" : "bot", m.content));
}

function saveChatHistory() {
  try {
    localStorage.setItem(chatStorageKey(), JSON.stringify(state.history.slice(-60)));
  } catch {
    /* ignore quota */
  }
}



async function authHeaders() {
  if (!state.authEnabled) return {};
  try {
    const token = await window.Clerk?.session?.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      ...(await authHeaders()),
    },
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) showAuthGate();
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

async function fetchHealth() {
  const res = await fetch("/api/health");
  return res.ok ? res.json() : {};
}

function showLanding(on) {
  const landing = $("#landing");
  if (!landing) return;
  landing.hidden = !on;
  document.body.classList.toggle("landing-mode", on);
  if (on) window.scrollTo({ top: 0 });
}

function showAuthGate() {
  if (state.authEnabled) showLanding(true);
}

function loadClerkScript(publishableKey, timeout = 15000) {
  return new Promise((resolve, reject) => {
    if (window.Clerk) return resolve(window.Clerk);
    const timer = setTimeout(() => reject(new Error("Clerk SDK timed out")), timeout);
    const script = document.createElement("script");
    script.src = "https://unpkg.com/@clerk/clerk-js@5/dist/clerk.browser.js";
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.clerkPublishableKey = publishableKey;
    script.onload = () => {
      clearTimeout(timer);
      if (window.Clerk) resolve(window.Clerk);
      else reject(new Error("Clerk SDK did not initialize"));
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Clerk SDK failed to download"));
    };
    document.head.appendChild(script);
  });
}

function handleAuthChange(user) {
  const was = state.signedIn;
  state.signedIn = Boolean(user);
  $("#signin-btn").hidden = !state.authEnabled || state.signedIn;
  $("#account-wrap").hidden = !state.authEnabled || !state.signedIn;
  showLanding(state.authEnabled && !state.signedIn);

  if (state.signedIn) {
    renderProfile(user);
    if (!was) loadRecipes();
  } else if (was) {
    closeProfileMenu();
    resetSearch();
    state.recipes = [];
    state.current = null;
    state.display = null;
    state.history = [];
    renderHome();
    show("home");
  }
}

async function initAuth() {
  let health = {};
  try {
    health = await fetchHealth();
  } catch {
    health = {};
  }
  state.authEnabled = Boolean(health.auth);
  state.publishableKey = health.publishableKey || "";
  if (!state.authEnabled) return false;

  try {
    const clerk = await loadClerkScript(state.publishableKey);
    if (!clerk.loaded) await clerk.load();
    clerk.addListener(({ user }) => handleAuthChange(user));
    handleAuthChange(clerk.user);
    return Boolean(clerk.user);
  } catch (err) {
    console.error("Clerk failed to load:", err);
    const box = $("#landing-error");
    if (box) {
      box.hidden = false;
      box.textContent = `Could not load sign-in: ${err?.message || "check the Clerk keys."}`;
    }
    showLanding(true);
    return false;
  }
}

const THEME_KEY = "simmer:theme";

function systemTheme() {
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

function currentTheme() {
  return document.documentElement.dataset.theme || systemTheme();
}

function updateThemeControls() {
  const dark = currentTheme() === "dark";
  $$("[data-theme-toggle]").forEach((btn) => {
    const label = dark ? "Switch to light theme" : "Switch to dark theme";
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
    const icon = btn.querySelector(".theme-icon");
    if (icon) icon.textContent = dark ? "☀️" : "🌙";
  });
  const meta = $("#theme-color");
  if (meta) meta.setAttribute("content", dark ? "#171310" : "#fff8f1");
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
  updateThemeControls();
}

function toggleTheme() {
  setTheme(currentTheme() === "dark" ? "light" : "dark");
}

function initTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") {
      document.documentElement.dataset.theme = stored;
    }
  } catch {
    /* ignore */
  }
  updateThemeControls();
  $$("[data-theme-toggle]").forEach((btn) => btn.addEventListener("click", toggleTheme));
  window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => {
    let stored = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch {
      /* ignore */
    }
    if (!stored) updateThemeControls();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === THEME_KEY && (event.newValue === "light" || event.newValue === "dark")) {
      document.documentElement.dataset.theme = event.newValue;
      updateThemeControls();
    }
  });
}

function clerkAppearance() {
  const dark = currentTheme() === "dark";
  return {
    variables: {
      colorPrimary: dark ? "#ff7a33" : "#e8590c",
      colorBackground: dark ? "#221c17" : "#ffffff",
      colorText: dark ? "#f4efe9" : "#201a15",
      colorTextSecondary: dark ? "#b3a89d" : "#756a60",
      colorInputBackground: dark ? "#2b231d" : "#fdf1e6",
      colorInputText: dark ? "#f4efe9" : "#201a15",
      colorDanger: dark ? "#ff6f66" : "#b42318",
      colorSuccess: dark ? "#5ac48a" : "#1f7a4d",
      borderRadius: "0.75rem",
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    },
    elements: {
      card: {
        backgroundColor: dark ? "#221c17" : "#ffffff",
        border: dark ? "1px solid #3a3129" : "1px solid #eadfd3",
        boxShadow: "0 24px 70px rgba(0, 0, 0, 0.45)",
      },
      modalBackdrop: { backgroundColor: "rgba(20, 12, 6, 0.62)" },
      formButtonPrimary: { fontWeight: "700", textTransform: "none" },
      headerTitle: { fontWeight: "800", letterSpacing: "-0.01em" },
      footerActionLink: { color: dark ? "#ff7a33" : "#e8590c", fontWeight: "600" },
      socialButtonsBlockButton: { borderRadius: "0.65rem" },
    },
  };
}

function openClerkSignIn() {
  const clerk = window.Clerk;
  if (clerk?.openSignIn) clerk.openSignIn({ appearance: clerkAppearance() });
  else clerk?.redirectToSignIn?.({ redirectUrl: location.href });
}

function openClerkSignUp() {
  const clerk = window.Clerk;
  if (clerk?.openSignUp) clerk.openSignUp({ appearance: clerkAppearance() });
  else clerk?.redirectToSignUp?.({ redirectUrl: location.href });
}

function userInitial(user) {
  const name =
    user?.fullName ||
    user?.firstName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress ||
    "S";
  return String(name).trim().charAt(0).toUpperCase() || "S";
}

function setAvatar(imageSelector, initialSelector, user) {
  const img = $(imageSelector);
  const initial = $(initialSelector);
  if (initial) initial.textContent = userInitial(user);
  if (!img) return;
  if (user?.imageUrl) {
    img.src = user.imageUrl;
    img.hidden = false;
    if (initial) initial.hidden = true;
  } else {
    img.hidden = true;
    if (initial) initial.hidden = false;
  }
}

function renderProfile(user) {
  if (!user) return;
  const name =
    user.fullName ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.username ||
    "Simmer cook";
  const email =
    user.primaryEmailAddress?.emailAddress ||
    user.emailAddresses?.[0]?.emailAddress ||
    "";
  const nameEl = $("#profile-name");
  const emailEl = $("#profile-email");
  if (nameEl) nameEl.textContent = name;
  if (emailEl) emailEl.textContent = email || "Signed in";
  setAvatar("#account-avatar", "#account-initial", user);
  setAvatar("#profile-avatar", "#profile-initial", user);
  const joinedEl = $("#profile-joined");
  if (joinedEl) {
    joinedEl.textContent = user.createdAt
      ? new Date(user.createdAt).toLocaleDateString(undefined, {
          month: "short",
          year: "numeric",
        })
      : "—";
  }
  const countEl = $("#profile-recipes");
  if (countEl) countEl.textContent = String(state.recipes.length);
}

function openProfileMenu() {
  const menu = $("#profile-menu");
  if (!menu) return;
  renderProfile(window.Clerk?.user);
  menu.hidden = false;
  $("#account-chip")?.setAttribute("aria-expanded", "true");
}

function closeProfileMenu() {
  const menu = $("#profile-menu");
  if (menu) menu.hidden = true;
  $("#account-chip")?.setAttribute("aria-expanded", "false");
}

function toggleProfileMenu() {
  const menu = $("#profile-menu");
  if (!menu) return;
  if (menu.hidden) openProfileMenu();
  else closeProfileMenu();
}

function currentVoiceLang() {
  return LANGS.find((l) => l.code === state.language)?.voice || "en-US";
}

function displayRecipe() {
  return state.display || state.current;
}

function ingredientLine(ing) {
  const qty = [ing.qty, ing.unit].filter(Boolean).join(" ");
  return { qty, item: ing.item || "" };
}

function resetSearch() {
  state.query = "";
  const input = $("#search-input");
  if (input) input.value = "";
  const clear = $("#search-clear");
  if (clear) clear.hidden = true;
}

function recipeMatches(recipe, terms) {
  const haystack = [
    recipe.title,
    recipe.sourceText || "",
    ...(recipe.tags || []),
    ...(recipe.ingredients || []).map((ing) => ing.item),
    ...(recipe.steps || []),
  ]
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function renderHome() {
  const list = $("#recipe-list");
  const empty = $("#home-empty");
  const searchEmpty = $("#search-empty");
  const query = state.query.trim();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const recipes = terms.length ? state.recipes.filter((r) => recipeMatches(r, terms)) : state.recipes;

  list.innerHTML = "";
  empty.hidden = state.recipes.length > 0;
  if (searchEmpty) {
    const noMatches = terms.length > 0 && recipes.length === 0 && state.recipes.length > 0;
    searchEmpty.hidden = !noMatches;
    if (noMatches) searchEmpty.textContent = `No recipes match “${query}”.`;
  }

  recipes.forEach((recipe) => {
    const li = document.createElement("li");
    const card = document.createElement("button");
    card.className = "card";
    card.dataset.id = recipe._id;

    const time = [recipe.times?.prep, recipe.times?.cook].filter(Boolean).join(" + ");
    card.innerHTML = `
      <span class="card-thumb" aria-hidden="true"></span>
      <span class="card-body">
        <span class="card-title"></span>
        <span class="card-meta"></span>
      </span>
    `;
    const thumb = card.querySelector(".card-thumb");
    if (recipe.image) {
      thumb.style.backgroundImage = `url("${String(recipe.image).replace(/"/g, "%22")}")`;
    } else {
      thumb.textContent = "🍲";
    }
    card.querySelector(".card-title").textContent = recipe.title;
    card.querySelector(".card-meta").textContent =
      [time, `${recipe.ingredients.length} ingredients`, `${recipe.steps.length} steps`]
        .filter(Boolean)
        .join(" · ");
    card.addEventListener("click", () => openRecipe(recipe._id));
    li.appendChild(card);
    list.appendChild(li);
  });
}

async function loadRecipes() {
  try {
    state.recipes = await api("/api/recipes");
  } catch {
    state.recipes = [];
  }
  renderHome();
  const countEl = $("#profile-recipes");
  if (countEl) countEl.textContent = String(state.recipes.length);
}

async function openRecipe(id) {
  try {
    state.current = await api(`/api/recipes/${id}`);
  } catch (err) {
    alert(err.message);
    return;
  }
  state.translations = { ...(state.current.translations || {}) };
  state.display =
    state.language === "en"
      ? state.current
      : state.translations[state.language] || state.current;
  renderDetail();
  show("detail");
  if (state.language !== "en" && !state.translations[state.language]) {
    applyLanguage(state.language);
  }
}

function renderDetail() {
  const recipe = displayRecipe();
  $("#detail-title").textContent = recipe.title;

  const time = [
    recipe.times?.prep && `Prep ${recipe.times.prep}`,
    recipe.times?.cook && `Cook ${recipe.times.cook}`,
  ]
    .filter(Boolean)
    .join(" · ");
  $("#detail-meta").textContent = `${recipe.servings} servings${time ? " · " + time : ""}`;

  const tags = $("#detail-tags");
  tags.innerHTML = "";
  (recipe.tags || []).forEach((tag) => {
    const li = document.createElement("li");
    li.textContent = tag;
    tags.appendChild(li);
  });

  const ingredients = $("#detail-ingredients");
  ingredients.innerHTML = "";
  recipe.ingredients.forEach((ing) => {
    const { qty, item } = ingredientLine(ing);
    const li = document.createElement("li");
    const qtyEl = document.createElement("span");
    qtyEl.className = "qty";
    qtyEl.textContent = qty;
    const itemEl = document.createElement("span");
    itemEl.textContent = item;
    li.append(qtyEl, itemEl);
    ingredients.appendChild(li);
  });

  const steps = $("#detail-steps");
  steps.innerHTML = "";
  recipe.steps.forEach((step) => {
    const li = document.createElement("li");
    li.textContent = step;
    steps.appendChild(li);
  });

  const source = $("#detail-source");
  source.hidden = !state.current.sourceUrl;
  if (state.current.sourceUrl) source.href = state.current.sourceUrl;

  const original = $("#detail-original");
  if (original) {
    const text = state.current.sourceText || "";
    original.hidden = !text;
    original.open = false;
    $("#detail-original-text").textContent = text;
  }
}

function populateLangSelects() {
  const options = LANGS.map((l) => `<option value="${l.code}">${l.label}</option>`).join("");
  $$(".lang-select").forEach((select) => {
    select.innerHTML = options;
    select.value = state.language;
  });
}

function syncLangSelects() {
  $$(".lang-select").forEach((select) => {
    select.value = state.language;
  });
}

function setLangBusy(busy) {
  $$(".lang-select").forEach((s) => (s.disabled = busy));
  const status = $("#lang-status");
  if (status) status.textContent = busy ? "Loading translation…" : "";
}

async function ensureTranslation(lang) {
  if (lang === "en" || !state.current) return state.current;
  if (state.translations[lang]) return state.translations[lang];

  const cacheKey = `simmer:tr:${state.current._id}:${lang}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      state.translations[lang] = JSON.parse(cached);
      return state.translations[lang];
    }
  } catch {
    /* ignore bad cache */
  }

  const data = await api("/api/translate", {
    method: "POST",
    body: JSON.stringify({ recipeId: state.current._id, language: lang }),
  });
  state.translations[lang] = data;
  try {
    localStorage.setItem(cacheKey, JSON.stringify(data));
  } catch {
    /* ignore quota */
  }
  return data;
}

async function applyLanguage(lang) {
  state.language = lang;
  syncLangSelects();
  if (state.recognition) state.recognition.lang = currentVoiceLang();
  if (!state.current) return;

  setLangBusy(true);
  try {
    state.display = await ensureTranslation(lang);
  } catch (err) {
    addBubble("bot", `Could not translate: ${err.message}`);
    state.display = state.current;
  } finally {
    setLangBusy(false);
  }

  renderDetail();
  if (!$("#view-cook").hidden) {
    $("#cook-title").textContent = displayRecipe().title;
    renderCookStep();
  }
}

function startCooking() {
  state.cookStep = 0;
  $("#cook-title").textContent = displayRecipe().title;
  renderCookStep();
  loadChatHistory();
  show("cook");
}

function renderCookStep() {
  const steps = displayRecipe().steps;
  $("#cook-progress").textContent = `Step ${state.cookStep + 1} of ${steps.length}`;
  $("#cook-step-text").textContent = steps[state.cookStep] || "All done. Enjoy your meal!";
  $("#step-prev").disabled = state.cookStep === 0;
  $("#step-next").disabled = state.cookStep === steps.length - 1;
}

function browserSpeak(text, done) {
  if (!("speechSynthesis" in window)) {
    done();
    return;
  }
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = currentVoiceLang();
  const voices = speechSynthesis.getVoices();
  const match = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(state.language));
  if (match) utter.voice = match;
  utter.onend = done;
  utter.onerror = done;
  state.speaking = true;
  try {
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
  } catch {
    done();
  }
}

function speak(text) {
  if (!text) return Promise.resolve();
  return new Promise(async (resolve) => {
    state.speaking = true;
    stopRecognition();

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      state.speaking = false;
      state.audio = null;
      resumeRecognition();
      resolve();
    };

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ text, language: state.language }),
      });
      if (res.ok && res.status !== 204) {
        const blob = await res.blob();
        const audio = new Audio(URL.createObjectURL(blob));
        state.audio = audio;
        audio.onended = finish;
        audio.onerror = () => browserSpeak(text, finish);
        audio.play().catch(() => browserSpeak(text, finish));
        return;
      }
    } catch {
      /* fall through to browser voice */
    }

    browserSpeak(text, finish);
  });
}

function stopSpeaking() {
  state.speaking = false;
  if (state.audio) {
    try {
      state.audio.pause();
    } catch {
      /* ignore */
    }
    state.audio = null;
  }
  if ("speechSynthesis" in window) {
    try {
      speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }
}

function addBubble(role, text) {
  const log = $("#chat-log");
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  bubble.textContent = text;
  log.appendChild(bubble);
  log.scrollTop = log.scrollHeight;
  return bubble;
}

const speakQueue = [];
let speakBusy = false;

function queueSpeak(text) {
  const clean = text.trim();
  if (!clean) return;
  speakQueue.push(clean);
  pumpSpeak();
}

async function pumpSpeak() {
  if (speakBusy) return;
  speakBusy = true;
  try {
    while (speakQueue.length) {
      await speak(speakQueue.shift());
    }
  } finally {
    speakBusy = false;
  }
}

function clearSpeakQueue() {
  speakQueue.length = 0;
}

async function askSimmer(message) {
  if (!message.trim()) return;
  pushHistory("user", message);

  const bubble = addBubble("bot", "");
  bubble.classList.add("thinking");
  let reply = "";
  let spoken = 0;

  const flushSentences = (force) => {
    const pending = reply.slice(spoken);
    const matches = pending.match(/[^.!?…。！？]+[.!?…。！？]+/g) || [];
    let take = matches.join("").length;
    if (force && take < pending.length) take = pending.length;
    if (take <= 0) return;
    spoken += take;
    queueSpeak(pending.slice(0, take));
  };

  const payload = {
    recipeId: state.current._id,
    message,
    history: state.history,
    language: state.language,
  };

  try {
    const res = await fetch("/api/chat?stream=1", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(payload),
    });
    if (!res.ok || !res.body) throw new Error("stream unavailable");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      if (reply === "") bubble.classList.remove("thinking");
      reply += chunk;
      bubble.textContent = reply;
      $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
      flushSentences(false);
    }
    flushSentences(true);
  } catch {
    clearSpeakQueue();
    try {
      const { reply: text } = await api("/api/chat", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      reply = text;
      bubble.textContent = reply;
      queueSpeak(reply);
    } catch (err) {
      bubble.classList.remove("thinking");
      bubble.textContent = err.message;
      return;
    }
  }

  bubble.classList.remove("thinking");
  state.history.push({ role: "assistant", content: reply });
  saveChatHistory();
}

function isStopCommand(text) {
  const t = text.toLowerCase().replace(/[.!?,"']/g, "").trim();
  return STOP_WORDS.includes(t);
}

function startRecognition() {
  if (!state.recognition || state.recognizing || state.speaking) return;
  try {
    state.recognition.start();
    state.recognizing = true;
  } catch {
    /* already started */
  }
}

function stopRecognition() {
  try {
    state.recognition?.stop();
  } catch {
    /* ignore */
  }
}

function resumeRecognition() {
  if (state.live) startRecognition();
}

function handleTranscript(text) {
  const clean = text.trim();
  if (!clean) return;

  const now = Date.now();
  if (clean.toLowerCase() === state.lastFinal.toLowerCase() && now - state.lastFinalAt < 4000) {
    return;
  }
  state.lastFinal = clean;
  state.lastFinalAt = now;
  $("#ask-input").value = "";

  if (isStopCommand(clean)) {
    addBubble("user", clean);
    addBubble("bot", "Okay, stopping. Tap the mic whenever you need me.");
    stopLive();
    return;
  }

  askSimmer(clean);
}

function startLive() {
  if (!state.recognition) return;
  state.live = true;
  state.lastFinal = "";
  const btn = $("#mic-btn");
  btn.classList.add("listening");
  btn.setAttribute("aria-pressed", "true");
  btn.setAttribute("aria-label", "Stop hands-free listening");
  btn.textContent = "⏹";
  startRecognition();
}

function stopLive() {
  state.live = false;
  stopRecognition();
  clearSpeakQueue();
  stopSpeaking();
  const btn = $("#mic-btn");
  if (btn) {
    btn.classList.remove("listening");
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-label", "Start hands-free listening");
    btn.textContent = "🎤";
  }
}

function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $("#mic-btn");
  if (!btn) return;
  if (!SR && !state.agentAvailable) return;

  btn.hidden = false;

  if (SR) {
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = currentVoiceLang();
    state.recognition = rec;

    rec.onresult = (event) => {
      if (state.speaking) return;
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = (result[0]?.transcript || "").trim();
        if (result.isFinal) {
          handleTranscript(text);
        } else {
          interim += `${text} `;
        }
      }
      if (interim) $("#ask-input").value = interim;
    };

    rec.onerror = (event) => {
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) {
        stopLive();
      }
    };

    rec.onend = () => {
      state.recognizing = false;
      if (state.live && !state.speaking) startRecognition();
    };
  }

  btn.addEventListener("click", toggleVoice);
}

const AGENT_SDK_URL = "https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.28.0/+esm";
const AGENT_HINT_LIVE = "Tap the mic to talk live with Simmer (real voice agent).";
const AGENT_HINT_FALLBACK = 'Tap the mic to talk hands-free. Say "stop" to end.';
let agentSDK = null;

async function loadAgentSDK() {
  if (!agentSDK) agentSDK = await import(AGENT_SDK_URL);
  return agentSDK;
}

function setOrb(stateName) {
  const orb = $("#agent-orb");
  if (orb) orb.dataset.state = stateName;
}

function setAgentStatus(text, orbState) {
  const el = $("#agent-status");
  if (el) el.textContent = text;
  if (orbState) setOrb(orbState);
}

function addTranscript(role, text) {
  const el = $("#agent-transcript");
  if (!el) return null;
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  bubble.textContent = text;
  el.appendChild(bubble);
  el.scrollTop = el.scrollHeight;
  return bubble;
}

function openAgentOverlay({ preserve = false } = {}) {
  const recipe = displayRecipe();
  $("#agent-recipe").textContent = recipe?.title || "";
  if (!preserve) $("#agent-transcript").innerHTML = "";
  setAgentStatus(preserve ? "Switching…" : "Connecting…", "connecting");
  setMuted(false);
  $("#agent-overlay").hidden = false;
}

function closeAgentOverlay() {
  const el = $("#agent-overlay");
  if (el) el.hidden = true;
}

function setMuted(muted) {
  state.agentMuted = muted;
  const btn = $("#agent-mute");
  if (btn) {
    btn.setAttribute("aria-pressed", muted ? "true" : "false");
    btn.textContent = muted ? "Unmute" : "Mute";
  }
  try {
    state.agent?.setMicMuted?.(muted);
  } catch {
    /* ignore */
  }
}

function startAgentTimer() {
  stopAgentTimer();
  const started = Date.now();
  const el = $("#agent-timer");
  state.agentTimer = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    if (el) {
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      el.textContent = `${mm}:${ss}`;
    }
  }, 1000);
}

function stopAgentTimer() {
  if (state.agentTimer) {
    clearInterval(state.agentTimer);
    state.agentTimer = null;
  }
  const el = $("#agent-timer");
  if (el) el.textContent = "";
}

function pushHistory(role, content) {
  const text = (content || "").trim();
  if (!text) return;
  const last = state.history[state.history.length - 1];
  if (last && last.role === role && last.content === text) return;
  state.history.push({ role, content: text });
  saveChatHistory();
  addBubble(role === "user" ? "user" : "bot", text);
}

function commitAssistantTurn() {
  const text = state.agentAiText;
  state.agentAiText = "";
  state.agentAiBubble = null;
  pushHistory("assistant", text);
}

function commitUserTurn() {
  if (!state.agentUserOpen) return;
  state.agentUserOpen = false;
  const text = state.tentativeUser;
  state.tentativeUser = "";
  pushHistory("user", text);
}

function handleAgentMessage(source, message) {
  if (!message) return;
  if (source === "user") {
    commitAssistantTurn();
    if (state.agentUserOpen && state.agentUserBubble) {
      state.agentUserBubble.textContent = message;
    } else {
      state.agentUserBubble = addTranscript("user", message);
      state.agentUserOpen = true;
    }
    state.tentativeUser = message;
    const wanted = detectLanguageSwitch(message);
    if (wanted) requestLanguageSwitch(wanted);
  } else {
    if (state.agentUserOpen) {
      commitUserTurn();
      state.agentUserBubble = null;
    }
    if (
      state.agentAiBubble &&
      (message.startsWith(state.agentAiText) || state.agentAiText.startsWith(message))
    ) {
      state.agentAiBubble.textContent = message;
    } else {
      state.agentAiBubble = addTranscript("bot", message);
    }
    state.agentAiText = message;
  }
}

function detectLanguageSwitch(text) {
  const t = text.toLowerCase();
  if (!SWITCH_INTENT.test(t)) return "";
  for (const [code, aliases] of Object.entries(LANG_ALIASES)) {
    if (aliases.some((a) => t.includes(a.toLowerCase()))) return code;
  }
  return "";
}

function requestLanguageSwitch(code) {
  if (!code || code === state.language) return;
  const now = Date.now();
  if (state.switching || now - state.lastSwitchAt < 5000) return;
  state.lastSwitchAt = now;
  switchAgentLanguage(code);
}

async function switchAgentLanguage(code) {
  const lang = LANGS.find((l) => l.code === code);
  state.switching = true;
  commitAssistantTurn();
  commitUserTurn();
  state.agentUserBubble = null;

  state.agentGen += 1;
  try {
    await state.agent?.endSession();
  } catch {
    /* ignore */
  }
  state.agent = null;
  state.agentOn = false;
  stopAgentTimer();

  state.language = code;
  syncLangSelects();
  addTranscript("system", `Switching to ${lang?.label || code}…`);

  if (state.current) {
    ensureTranslation(code)
      .then((translated) => {
        state.display = translated;
        renderDetail();
        $("#cook-title").textContent = displayRecipe().title;
      })
      .catch(() => {});
  }

  await startAgent({ resume: true, preserve: true });
  state.switching = false;
}

function resetAgent() {
  state.agent = null;
  state.agentOn = false;
  stopAgentTimer();
}

async function startAgent({ resume = false, preserve = false } = {}) {
  if (!state.current) return false;
  openAgentOverlay({ preserve });
  const gen = ++state.agentGen;
  try {
    const url = `/api/agent/session?recipeId=${encodeURIComponent(
      state.current._id
    )}&language=${state.language}${resume ? "&resume=1" : ""}`;
    const res = await fetch(url, { headers: await authHeaders() });
    if (!res.ok) throw new Error("agent unavailable");
    const { signedUrl, overrides } = await res.json();

    await navigator.mediaDevices.getUserMedia({ audio: true });
    const { Conversation } = await loadAgentSDK();

    state.agentAiBubble = null;
    state.agentAiText = "";
    state.agentUserBubble = null;
    state.agentUserOpen = false;
    state.tentativeUser = "";

    state.agent = await Conversation.startSession({
      signedUrl,
      connectionType: "websocket",
      overrides,
      onConnect: () => {
        if (gen !== state.agentGen) return;
        state.agentOn = true;
        startAgentTimer();
        setAgentStatus("Connected. Just talk.", "listening");
        $("#ask-input").disabled = true;
      },
      onModeChange: ({ mode }) => {
        if (gen !== state.agentGen) return;
        setAgentStatus(
          mode === "speaking" ? "Simmer is talking…" : "Listening…",
          mode === "speaking" ? "speaking" : "listening"
        );
      },
      onMessage: ({ source, message }) => {
        if (gen !== state.agentGen) return;
        handleAgentMessage(source, message);
      },
      onError: (err) => {
        if (gen !== state.agentGen) return;
        setAgentStatus(`Error: ${err?.message || err}`);
      },
      onDisconnect: () => {
        if (gen !== state.agentGen) return;
        commitAssistantTurn();
        commitUserTurn();
        resetAgent();
        closeAgentOverlay();
        $("#ask-input").disabled = false;
      },
    });
    return true;
  } catch {
    if (gen === state.agentGen) {
      resetAgent();
      closeAgentOverlay();
      $("#ask-input").disabled = false;
    }
    return false;
  }
}

async function stopAgent() {
  commitAssistantTurn();
  commitUserTurn();
  try {
    await state.agent?.endSession();
  } catch {
    /* ignore */
  }
  resetAgent();
  closeAgentOverlay();
  $("#ask-input").disabled = false;
}

async function openAgentFromTop() {
  if (state.agentOn) {
    openAgentOverlay({ preserve: true });
    return;
  }
  if (!state.current) {
    if (state.recipes.length) await openRecipe(state.recipes[0]._id);
    else {
      show("home");
      return;
    }
  }
  const started = await startAgent();
  if (!started) {
    show("cook");
    startLive();
  }
}

async function toggleVoice() {
  if (state.agentOn) return stopAgent();
  if (state.live) return stopLive();
  if (state.agentAvailable) {
    const started = await startAgent();
    if (started) return;
  }
  startLive();
}

function openHistory() {
  const log = $("#history-log");
  if (log) {
    log.innerHTML = "";
    state.history.forEach((m) => {
      const bubble = document.createElement("div");
      bubble.className = `bubble ${m.role === "user" ? "user" : "bot"}`;
      bubble.textContent = m.content;
      log.appendChild(bubble);
    });
  }
  $("#history-overlay").hidden = false;
}

function closeHistory() {
  const el = $("#history-overlay");
  if (el) el.hidden = true;
}

function clearHistory() {
  state.history = [];
  saveChatHistory();
  $("#chat-log").innerHTML = "";
  const log = $("#history-log");
  if (log) log.innerHTML = "";
}

function setAddMode(mode) {
  state.addMode = mode === "text" ? "text" : "link";

  $$(".add-mode").forEach((btn) => {
    const active = btn.dataset.addMode === state.addMode;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });

  $("#add-link-fields").hidden = state.addMode !== "link";
  $("#add-text-fields").hidden = state.addMode !== "text";

  const hint = $("#add-hint");
  if (hint) {
    hint.textContent =
      state.addMode === "link"
        ? "Add a link and Simmer will pull out the ingredients and steps."
        : "Paste a recipe you already have. Simmer keeps your original words and turns them into clean steps.";
  }
}

async function addRecipe({ url, caption }) {
  const status = $("#add-status");
  const submit = $("#add-submit");
  status.className = "status";
  status.textContent =
    caption && !url
      ? "Reading your recipe and asking Gemma... this can take a minute."
      : "Reading the description and audio... this can take a minute.";
  submit.disabled = true;
  try {
    const recipe = await api("/api/ingest", {
      method: "POST",
      body: JSON.stringify({ url, caption }),
    });
    status.textContent = "Saved!";
    $("#add-form").reset();
    resetSearch();
    await loadRecipes();
    state.current = recipe;
    state.translations = {};
    state.display = recipe;
    renderDetail();
    show("detail");
  } catch (err) {
    status.className = "status error";
    status.textContent = err.message;
  } finally {
    submit.disabled = false;
  }
}

function handleSharedLink() {
  const params = new URLSearchParams(location.search);
  let url = params.get("url") || "";
  let text = params.get("text") || "";
  if (!url) {
    const m = text.match(/https?:\/\/[^\s]+/);
    if (m) {
      url = m[0];
      text = text.replace(m[0], "").trim();
    }
  }
  if (!url && !text) return false;
  history.replaceState({}, "", "/");
  show("add");
  if (!url && text) {
    setAddMode("text");
    $("#add-description").value = text;
    addRecipe({ caption: text });
    return true;
  }
  setAddMode("link");
  $("#add-url").value = url;
  addRecipe({ url, caption: text });
  return true;
}

function wireEvents() {
  const signIn = (event) => {
    event.preventDefault();
    openClerkSignIn();
  };
  const signUp = (event) => {
    event.preventDefault();
    openClerkSignUp();
  };
  $("#signin-btn")?.addEventListener("click", signIn);
  $("#landing")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-signin]")) signIn(event);
    if (event.target.closest("[data-signup]")) signUp(event);
  });
  $("#account-chip")?.addEventListener("click", toggleProfileMenu);
  $("#profile-signout")?.addEventListener("click", async () => {
    closeProfileMenu();
    await window.Clerk?.signOut?.();
  });
  $("#profile-manage")?.addEventListener("click", () => {
    closeProfileMenu();
    const clerk = window.Clerk;
    if (clerk?.openUserProfile) clerk.openUserProfile({ appearance: clerkAppearance() });
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#account-wrap")) closeProfileMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeProfileMenu();
  });

  document.body.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-nav]");
    if (nav) {
      const target = nav.dataset.nav;
      if (target === "home") loadRecipes();
      show(target);
    }
  });

  $$(".lang-select").forEach((select) => {
    select.addEventListener("change", (event) => applyLanguage(event.target.value));
  });

  const searchInput = $("#search-input");
  if (searchInput) {
    const clearBtn = $("#search-clear");
    const syncClear = () => {
      if (clearBtn) clearBtn.hidden = !searchInput.value;
    };
    searchInput.addEventListener("input", () => {
      state.query = searchInput.value;
      syncClear();
      if ($("#view-home").hidden) show("home");
      renderHome();
    });
    searchInput.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      resetSearch();
      renderHome();
    });
    clearBtn?.addEventListener("click", () => {
      resetSearch();
      renderHome();
      searchInput.focus();
    });
  }

  $$(".add-mode").forEach((btn) => {
    btn.addEventListener("click", () => {
      setAddMode(btn.dataset.addMode);
      const target = state.addMode === "text" ? $("#add-description") : $("#add-url");
      target?.focus();
    });
  });

  $("#add-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const status = $("#add-status");
    status.className = "status";

    if (state.addMode === "text") {
      const text = $("#add-description").value.trim();
      if (!text) {
        status.className = "status error";
        status.textContent = "Paste your recipe first.";
        return;
      }
      addRecipe({ caption: text });
      return;
    }

    const url = $("#add-url").value.trim();
    if (!url) {
      status.className = "status error";
      status.textContent = "Add a recipe link first.";
      return;
    }
    addRecipe({ url });
  });

  $("#talk-btn").addEventListener("click", openAgentFromTop);
  $("#agent-mute").addEventListener("click", () => setMuted(!state.agentMuted));
  $("#agent-end").addEventListener("click", stopAgent);
  $("#history-btn").addEventListener("click", openHistory);
  $("#history-close").addEventListener("click", closeHistory);
  $("#history-clear").addEventListener("click", clearHistory);
  $("#history-overlay").addEventListener("click", (event) => {
    if (event.target === $("#history-overlay")) closeHistory();
  });

  $("#start-cooking").addEventListener("click", startCooking);
  $("#cook-back").addEventListener("click", () => show("detail"));
  $("#step-prev").addEventListener("click", () => {
    if (state.cookStep > 0) {
      state.cookStep -= 1;
      renderCookStep();
    }
  });
  $("#step-next").addEventListener("click", () => {
    if (state.cookStep < displayRecipe().steps.length - 1) {
      state.cookStep += 1;
      renderCookStep();
    }
  });
  $("#step-speak").addEventListener("click", () => speak(displayRecipe().steps[state.cookStep]));

  $("#ask-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("#ask-input");
    askSimmer(input.value);
    input.value = "";
  });

  $("#delete-recipe").addEventListener("click", async () => {
    if (!confirm("Delete this recipe?")) return;
    await api(`/api/recipes/${state.current._id}`, { method: "DELETE" });
    await loadRecipes();
    show("home");
  });
}

async function setupAgent() {
  try {
    const health = await api("/api/health");
    state.agentAvailable = Boolean(health.agent);
  } catch {
    state.agentAvailable = false;
  }
  const talk = $("#talk-btn");
  if (talk) talk.hidden = !state.agentAvailable;

  const hint = $("#voice-hint");
  if (hint) {
    hint.hidden = false;
    hint.textContent = state.agentAvailable ? AGENT_HINT_LIVE : AGENT_HINT_FALLBACK;
  }
}

function setupLanding() {
  const items = $$("#landing .reveal");
  if (!items.length) return;
  if (!("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("in"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.15 }
  );
  items.forEach((el) => observer.observe(el));
}

function revealApp(startedAt) {
  const boot = $("#boot");
  if (!boot) return Promise.resolve();
  const wait = Math.max(0, 600 - (performance.now() - startedAt));
  const settle = wait
    ? new Promise((resolve) => setTimeout(resolve, wait))
    : Promise.resolve();
  return settle
    .then(
      () =>
        new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    )
    .then(() => {
      boot.classList.add("is-done");
      document.body.removeAttribute("aria-busy");
      setTimeout(() => boot.remove(), 450);
    });
}

async function main() {
  const startedAt = performance.now();
  try {
    wireEvents();
    initTheme();
    populateLangSelects();
    setupLanding();
    const signedIn = await initAuth();
    await setupAgent();
    setupVoice();
    if (!state.authEnabled || signedIn) {
      await loadRecipes();
      if (!handleSharedLink()) show("home");
    } else {
      show("home");
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  } catch (err) {
    console.error("Startup failed:", err);
  } finally {
    await revealApp(startedAt);
  }
}

main();
