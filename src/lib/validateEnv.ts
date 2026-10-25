/**
 * Environment configuration check.
 *
 * Requirements are split by where each value is actually *needed*, because
 * treating every variable as a hard server requirement previously crashed
 * request handling: `/api/generate` called `validateEnv()` before doing any
 * work, so a deployment missing a client-only or optional variable returned an
 * opaque HTTP 500 (empty body) for every valid trip instead of an itinerary.
 *
 * - SERVER_REQUIRED: without these a server route cannot do its job.
 * - SERVER_OPTIONAL: features degrade gracefully when absent (place
 *   enrichment, Static Maps, authenticated saves) — never fatal.
 * - CLIENT_ONLY: read by the browser SDK; the app runs signed-out / with a
 *   placeholder map when they are missing (see components/AuthProvider and
 *   /api/static-map). Server routes must never require them.
 *
 * `validateEnv()` never throws. It returns a report so routes can answer with
 * a clear, retryable JSON error, and it logs the same problems once.
 */

const SERVER_REQUIRED_ENV_VARS = ["OPENAI_API_KEY"] as const;

const SERVER_OPTIONAL_ENV_VARS = [
  "GOOGLE_GEOCODING_API_KEY",
  "GOOGLE_PLACES_API_KEY",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
] as const;

const CLIENT_ONLY_ENV_VARS = [
  "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
] as const;

const PLACEHOLDER_ENV_VARS = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_GOOGLE_MAP_ID",
  "EXCHANGE_RATE_API_KEY",
] as const;

export interface EnvReport {
  /** False when a variable that a server route hard-depends on is missing. */
  ok: boolean;
  /** Required variables that are absent; an empty list means the route is usable. */
  missingRequired: string[];
  /** Variables whose features are disabled but which never block a request. */
  missingOptional: string[];
  /** Variables that look misconfigured (e.g. left as a placeholder). */
  misconfigured: string[];
}

function isPlaceholder(value: string): boolean {
  return value.includes("your_");
}

export function checkEnv(): EnvReport {
  const missingRequired: string[] = [];
  const missingOptional: string[] = [];
  const misconfigured: string[] = [];

  for (const key of SERVER_REQUIRED_ENV_VARS) {
    if (!process.env[key]) missingRequired.push(key);
  }

  for (const key of SERVER_OPTIONAL_ENV_VARS) {
    if (!process.env[key]) missingOptional.push(key);
  }

  for (const key of [...SERVER_OPTIONAL_ENV_VARS, ...CLIENT_ONLY_ENV_VARS, ...PLACEHOLDER_ENV_VARS]) {
    const value = process.env[key];
    if (value && isPlaceholder(value)) {
      misconfigured.push(`${key} is still set to its .env.example placeholder`);
    }
  }

  // A literal "\n" in the private key is a common copy/paste error that only
  // surfaces later as an auth failure; flag it here.
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (privateKey && privateKey.includes("\\n") && !privateKey.includes("\n")) {
    misconfigured.push("FIREBASE_PRIVATE_KEY appears to have literal \\n characters — ensure it is multiline");
  }

  return {
    ok: missingRequired.length === 0,
    missingRequired,
    missingOptional,
    misconfigured,
  };
}

let logged = false;

/**
 * Check required/optional env vars and log the outcome once. Never throws.
 * Callers must branch on the returned `ok` flag and return a clear error.
 */
export function validateEnv(): EnvReport {
  const report = checkEnv();

  if (!logged) {
    logged = true;
    if (report.misconfigured.length > 0) {
      console.warn("Environment variable misconfiguration detected:");
      report.misconfigured.forEach((m) => console.warn(`  - ${m}`));
    }
    if (report.missingOptional.length > 0) {
      console.warn(`Optional env vars not set (features degrade): ${report.missingOptional.join(", ")}`);
    }
    if (report.ok) {
      console.log("✓ Required environment variables validated");
    } else {
      console.error(`Missing required environment variables: ${report.missingRequired.join(", ")}`);
    }
  }

  return report;
}

/** True when itinerary generation has the key it needs. */
export function isGenerationConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function isPlacesApiConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

export function isMapsApiConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);
}
