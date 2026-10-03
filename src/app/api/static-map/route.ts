import { NextResponse } from "next/server";

interface StaticMapRequest {
  spots: Array<{ name: string; lat: number; lng: number }>;
  food: Array<{ name: string; lat: number; lng: number }>;
  width?: number;
  height?: number;
  zoom?: number;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as StaticMapRequest;
    const { spots = [], food = [] } = body;
    const width = Math.min(1200, Math.max(200, Math.floor(body.width ?? 600)));
    const height = Math.min(800, Math.max(200, Math.floor(body.height ?? 400)));
    const { zoom } = body;

    const allPoints = [
      ...spots.filter((s) => s.lat && s.lng).map((s) => ({ lat: s.lat, lng: s.lng, label: s.name, color: "C9A227" })),
      ...food.filter((f) => f.lat && f.lng).map((f) => ({ lat: f.lat, lng: f.lng, label: f.name, color: "E8674A" })),
    ].slice(0, 20);

    if (allPoints.length === 0) {
      return NextResponse.json({ url: null, error: "No valid locations" });
    }

    const apiKey = process.env.GOOGLE_STATIC_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_GEOCODING_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ url: null, error: "Static Maps API key not configured" }, { status: 503 });
    }

    // Calculate bounds to determine center and zoom if not provided
    let centerLat = allPoints[0].lat;
    let centerLng = allPoints[0].lng;
    let calculatedZoom = zoom;

    if (!calculatedZoom && allPoints.length > 1) {
      const lats = allPoints.map((p) => p.lat);
      const lngs = allPoints.map((p) => p.lng);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);

      centerLat = (minLat + maxLat) / 2;
      centerLng = (minLng + maxLng) / 2;

      const latDiff = maxLat - minLat;
      const lngDiff = maxLng - minLng;
      const maxDiff = Math.max(latDiff, lngDiff);

      // Rough zoom calculation based on span
      if (maxDiff > 10) calculatedZoom = 8;
      else if (maxDiff > 5) calculatedZoom = 10;
      else if (maxDiff > 1) calculatedZoom = 12;
      else if (maxDiff > 0.5) calculatedZoom = 13;
      else if (maxDiff > 0.1) calculatedZoom = 14;
      else calculatedZoom = 15;
    } else if (!calculatedZoom) {
      calculatedZoom = 13;
    }

    // Build markers parameter for Static Maps API
    // Format: markers=color:0xC9A227|label:1|lat,lng&markers=color:0xE8674A|label:2|lat,lng
    const markerParams = allPoints.map((point, index) => {
      const label = String(index + 1);
      return `markers=color:0x${point.color}|label:${label}|${point.lat},${point.lng}`;
    }).join("&");

    // Map style parameters for dark theme matching the app
    const styleParams = [
      "style=feature:all|element:geometry|color:0x131C31",
      "style=feature:all|element:labels.text.stroke|color:0x131C31",
      "style=feature:all|element:labels.text.fill|color:0xE8DCC4",
      "style=feature:road|element:geometry|color:0x1E2A45",
      "style=feature:water|element:geometry|color:0x0B1120",
    ].join("&");

    const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?` +
      `center=${centerLat},${centerLng}&` +
      `zoom=${calculatedZoom}&` +
      `size=${width}x${height}&` +
      `scale=2&` +
      `format=png&` +
      `maptype=roadmap&` +
      `${markerParams}&` +
      `${styleParams}&` +
      `key=${apiKey}`;

    return NextResponse.json({ url: staticMapUrl, center: { lat: centerLat, lng: centerLng }, zoom: calculatedZoom });
  } catch (error) {
    console.error("Static map generation error:", error);
    return NextResponse.json({ url: null, error: "Failed to generate static map" }, { status: 500 });
  }
}