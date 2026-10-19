import { NextResponse } from "next/server";
import { getExchangeRates } from "@/lib/exchangeRates";
import { rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * GET /api/exchange-rates
 *
 * Server-side proxy for the live market-rate hint. The upstream API key lives
 * only on the server (see lib/exchangeRates.ts); the browser never sees it.
 * Rate-limited per IP and cached at the edge for the same window as the
 * in-memory cache.
 */
export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = await rateLimit(`exchange-rates:${ip}`, 60, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter || 60) } }
    );
  }

  const data = await getExchangeRates();
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": data.stale
        ? "no-store"
        : "public, s-maxage=1800, stale-while-revalidate=300",
    },
  });
}
