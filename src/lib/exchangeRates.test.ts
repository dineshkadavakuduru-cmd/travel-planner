import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetExchangeRateCache, getExchangeRates, staticRates } from "./exchangeRates";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const PROVIDER_BODY = {
  conversion_rates: { USD: 1, INR: 83.5, EUR: 0.93, GBP: 0.8, JPY: 158, KWD: 0.31 },
  time_last_update_utc: "Sun, 19 Oct 2026 00:00:01 +0000",
};

describe("exchangeRates", () => {
  beforeEach(() => {
    __resetExchangeRateCache();
    delete process.env.EXCHANGE_RATE_API_KEY;
  });

  it("maps a successful provider response to a live snapshot with a timestamp", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(PROVIDER_BODY)) as unknown as FetchLike;
    const snap = await getExchangeRates({ fetchImpl, now: () => 0 });

    expect(snap.source).toBe("live");
    expect(snap.stale).toBe(false);
    expect(snap.base).toBe("USD");
    expect(snap.rates.INR).toBe(83.5);
    expect(snap.rates.USD).toBe(1);
    expect(snap.updatedAt).toBe("2026-10-19T00:00:01.000Z");
    expect(snap.retrievedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("serves from cache within the TTL without hitting the provider again", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return jsonResponse(PROVIDER_BODY);
    }) as unknown as FetchLike;

    const first = await getExchangeRates({ fetchImpl, now: () => 1000 });
    const second = await getExchangeRates({ fetchImpl, now: () => 1000 + 60_000 });

    expect(calls).toBe(1);
    expect(first.source).toBe("live");
    expect(second.source).toBe("cache");
    expect(second.stale).toBe(false);
  });

  it("refreshes once the TTL has elapsed", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return jsonResponse(PROVIDER_BODY);
    }) as unknown as FetchLike;

    await getExchangeRates({ fetchImpl, now: () => 0 });
    await getExchangeRates({ fetchImpl, now: () => 31 * 60 * 1000 });

    expect(calls).toBe(2);
  });

  it("falls back to a stale cache (never NaN) when a refresh fails", async () => {
    const okFetch = vi.fn(async () => jsonResponse(PROVIDER_BODY)) as unknown as FetchLike;
    await getExchangeRates({ fetchImpl: okFetch, now: () => 0 });

    const failFetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as FetchLike;
    const snap = await getExchangeRates({ fetchImpl: failFetch, now: () => 31 * 60 * 1000 });

    expect(snap.source).toBe("cache");
    expect(snap.stale).toBe(true);
    expect(snap.rates.INR).toBe(83.5);
  });

  it("falls back to the static reference table when there is no cache", async () => {
    const failFetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as FetchLike;
    const snap = await getExchangeRates({ fetchImpl: failFetch, now: () => 0 });

    expect(snap.source).toBe("static");
    expect(snap.stale).toBe(true);
    expect(snap.updatedAt).toBeNull();
    expect(snap.rates).toEqual(staticRates());
  });

  it("rejects a malformed provider body and falls back", async () => {
    const badFetch = vi.fn(async () => jsonResponse({ nope: true })) as unknown as FetchLike;
    const snap = await getExchangeRates({ fetchImpl: badFetch, now: () => 0 });
    expect(snap.source).toBe("static");
  });

  it("times out a hung provider via AbortController and falls back", async () => {
    vi.useFakeTimers();
    try {
      const hangingFetch = vi.fn(
        (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError"))
            );
          })
      ) as unknown as FetchLike;

      const promise = getExchangeRates({ fetchImpl: hangingFetch, now: () => 0 });
      await vi.advanceTimersByTimeAsync(4000);
      const snap = await promise;

      expect(snap.source).toBe("static");
      expect(snap.stale).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
