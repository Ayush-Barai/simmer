import * as Sentry from "@sentry/node";

export function initSentry() {
  if (!process.env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 1.0,
    environment: process.env.NODE_ENV || "development",
  });
  return true;
}

export { Sentry };
