const REQUIRED_ENV_VARS = [
  "OPENAI_API_KEY",
  "GOOGLE_GEOCODING_API_KEY",
  "GOOGLE_PLACES_API_KEY",
  "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
];

const OPTIONAL_ENV_VARS = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_GOOGLE_MAP_ID",
];

let validated = false;

export function validateEnv() {
  if (validated) return;

  const missing: string[] = [];
  const misconfigured: string[] = [];

  for (const key of REQUIRED_ENV_VARS) {
    const value = process.env[key];
    if (!value) {
      missing.push(key);
    } else if (key === "FIREBASE_PRIVATE_KEY") {
      // Check for common misconfiguration (literal \n instead of actual newlines)
      if (value.includes("\\n") && !value.includes("\n")) {
        misconfigured.push(`${key} (appears to have literal \\n characters — ensure it's multiline in your env)`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.map((k) => `  - ${k}`).join("\n")}\n\nCreate a .env.local file from .env.example and add the missing values.`
    );
  }

  if (misconfigured.length > 0) {
    console.warn("Environment variable misconfiguration detected:");
    misconfigured.forEach((m) => console.warn(`  - ${m}`));
  }

  // Only cache success: a failed validation must throw again next call,
  // otherwise callers fall through to confusing downstream errors.
  validated = true;
  console.log("✓ All required environment variables validated");
}

export function isPlacesApiConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

export function isMapsApiConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);
}