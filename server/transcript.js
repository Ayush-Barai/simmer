import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
