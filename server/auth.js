import { verifyToken } from "@clerk/backend";

export function authEnabled() {
  return Boolean(
    (process.env.CLERK_SECRET_KEY || "").trim() &&
      (process.env.CLERK_PUBLISHABLE_KEY || "").trim()
  );
}

export function publishableKey() {
  return (process.env.CLERK_PUBLISHABLE_KEY || "").trim();
}

function bearer(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export async function resolveUserId(req) {
  if (!authEnabled()) return "guest";
  const token = bearer(req);
  if (!token) return null;
  try {
    const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
    return payload?.sub || null;
  } catch {
    return null;
  }
}

export async function requireAuth(req, res, next) {
  try {
    const userId = await resolveUserId(req);
    if (!userId) return res.status(401).json({ error: "Please sign in to continue." });
    req.userId = userId;
    next();
  } catch {
    res.status(401).json({ error: "Please sign in to continue." });
  }
}
