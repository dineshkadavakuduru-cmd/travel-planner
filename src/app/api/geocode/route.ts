import { NextResponse } from "next/server";
import { verifyIdToken } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { validateEnv } from "@/lib/validateEnv";

export async function GET(request: Request) {
  validateEnv();
  const decoded = await verifyIdToken(request).catch(() => null);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const identity = decoded ? `user:${decoded.uid}` : `ip:${ip}`;
  const limit = await rateLimit(`geocode:${identity}`, decoded ? 120 : 30, 60 * 1000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many geocoding requests" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter || 60) } });

  const address = new URL(request.url).searchParams.get("address")?.trim();
  if (!address || address.length < 3) return NextResponse.json({ error: "Address is required" }, { status: 400 });
  const key = process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return NextResponse.json({ error: "Geocoding is not configured" }, { status: 503 });

  try {
    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`);
    if (!response.ok) return NextResponse.json({ error: "Geocoding provider failed" }, { status: 502 });
    const data = await response.json();
    const location = data.results?.[0]?.geometry?.location;
    if (!location) return NextResponse.json({ error: "Location not found" }, { status: 404 });
    return NextResponse.json({ lat: location.lat, lng: location.lng, formattedAddress: data.results[0].formatted_address });
  } catch (error) {
    console.error("Geocoding error:", error);
    return NextResponse.json({ error: "Failed to geocode address" }, { status: 500 });
  }
}
