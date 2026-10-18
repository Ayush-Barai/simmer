import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sttEnabled, transcribeAudio } from "./stt.js";

const CANDIDATES = [
  ["yt-dlp"],
  ["python", "-m", "yt_dlp"],
  ["python3", "-m", "yt_dlp"],
  ["py", "-m", "yt_dlp"],
];

let cachedCmd;

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let child;
    try {
      child = spawn(cmd[0], [...cmd.slice(1), ...args], { windowsHide: true });
    } catch {
      return resolve({ ok: false, out, err: "spawn failed" });
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (err += d));
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, out, err });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, out, err });
    });
  });
}

export async function detectYtDlp() {
  if (cachedCmd !== undefined) return cachedCmd;
  for (const cmd of CANDIDATES) {
    const res = await run(cmd, ["--version"], 15000);
    if (res.ok) {
      cachedCmd = cmd;
      return cmd;
    }
  }
  cachedCmd = null;
  return null;
}

function toText(data) {
  return (data.events || [])
    .flatMap((e) => e.segs || [])
    .map((s) => s.utf8 || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchTranscript(url) {
  const cmd = await detectYtDlp();
  if (!cmd) return "";

  const langs = process.env.YT_SUB_LANGS || "en.*,en";
  const dir = await mkdtemp(path.join(tmpdir(), "simmer-"));

  try {
    await run(
      cmd,
      [
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        langs,
        "--sub-format",
        "json3",
        "--paths",
        dir,
        "-o",
        "%(id)s.%(ext)s",
        url,
      ],
      60000
    );

    const files = (await readdir(dir)).filter((f) => f.endsWith(".json3"));
    let best = "";
    for (const file of files) {
      try {
        const text = toText(JSON.parse(await readFile(path.join(dir, file), "utf8")));
        if (text.length > best.length) best = text;
      } catch {
        /* skip unreadable file */
      }
    }
    return best;
  } catch {
    return "";
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function cookieArgs() {
  const cookies = (process.env.YTDLP_COOKIES || "").trim();
  return cookies ? ["--cookies", cookies] : [];
}

export async function fetchVideoMeta(url) {
  const cmd = await detectYtDlp();
  if (!cmd) return null;

  const res = await run(
    cmd,
    [
      ...cookieArgs(),
      "--dump-single-json",
      "--skip-download",
      "--no-warnings",
      "--no-playlist",
      url,
    ],
    45000
  );
  if (!res.ok || !res.out.trim()) return null;

  try {
    const data = JSON.parse(res.out);
    return {
      title: data.title || "",
      description: data.description || "",
      duration: Number(data.duration) || 0,
      thumbnail: data.thumbnail || "",
    };
  } catch {
    return null;
  }
}

let cachedFfmpeg;

async function hasFfmpeg() {
  if (cachedFfmpeg !== undefined) return cachedFfmpeg;
  const res = await run(["ffmpeg"], ["-version"], 10000);
  cachedFfmpeg = res.ok;
  return cachedFfmpeg;
}

const AUDIO_MIME = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".3gp": "audio/3gpp",
};

export async function fetchAudioTranscript(url) {
  if (!sttEnabled()) return "";
  const cmd = await detectYtDlp();
  if (!cmd) return "";

  const dir = await mkdtemp(path.join(tmpdir(), "simmer-audio-"));
  try {
    const args = [
      ...cookieArgs(),
      "--no-playlist",
      "--no-warnings",
      "-f",
      "ba/b",
      "-o",
      path.join(dir, "audio.%(ext)s"),
    ];
    if (await hasFfmpeg()) {
      args.push("-x", "--audio-format", "mp3", "--audio-quality", "5");
    }
    args.push(url);

    const res = await run(cmd, args, 240000);
    if (!res.ok) {
      console.warn("Audio download failed:", (res.err || "").trim().slice(-300));
      return "";
    }

    const files = (await readdir(dir)).filter(
      (f) => !f.endsWith(".part") && !f.endsWith(".ytdl")
    );
    if (!files.length) return "";

    let best = { buffer: null, name: "" };
    for (const file of files) {
      const buffer = await readFile(path.join(dir, file));
      if (!best.buffer || buffer.length > best.buffer.length) {
        best = { buffer, name: file };
      }
    }
    if (!best.buffer) return "";

    const ext = path.extname(best.name).toLowerCase();
    const mime = AUDIO_MIME[ext] || "application/octet-stream";
    const text = await transcribeAudio(best.buffer, { filename: best.name, mime });
    if (!text) console.warn("Audio downloaded but no speech was transcribed.");
    return text;
  } catch (err) {
    console.warn("Audio transcription failed:", err.message);
    return "";
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
