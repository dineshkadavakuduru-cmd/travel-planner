import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const limiters = new Map<string, Ratelimit>();

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function toWindow(windowMs: number): `${number} ${"s" | "m" | "h"}` {
  if (windowMs >= 3600000 && windowMs % 3600000 === 0) return `${windowMs / 3600000} h`;
  if (windowMs >= 60000 && windowMs % 60000 === 0) return `${windowMs / 60000} m`;
  return `${Math.max(1, Math.round(windowMs / 1000))} s`;
}

function getRatelimit(limit: number, windowMs: number): Ratelimit | null {
  const cacheKey = `${limit}:${windowMs}`;
  const cached = limiters.get(cacheKey);
  if (cached) return cached;

  const redis = getRedis();
  if (!redis) {
    console.warn("Upstash Redis not configured, rate limiting is fail-open (dev only). Set UPSTASH_REDIS_REST_URL/TOKEN for production.");
    return null;
  }

  const rl = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, toWindow(windowMs)),
    analytics: true,
    prefix: "travel-planner:ratelimit",
  });
  limiters.set(cacheKey, rl);
  return rl;
}

export async function rateLimit(key: string, limit: number, windowMs: number) {
  const rl = getRatelimit(limit, windowMs);

  if (!rl) {
    return { allowed: true, remaining: limit - 1 };
  }

  const identifier = `${key}:${limit}:${windowMs}`;
  const result = await rl.limit(identifier);

  return {
    allowed: result.success,
    remaining: result.remaining,
    retryAfter: result.reset ? Math.ceil((result.reset - Date.now()) / 1000) : undefined,
  };
}