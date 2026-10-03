import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { verifyIdToken } from "@/lib/auth";
import { getAdminFirestoreClient } from "@/lib/adminFirestore";
import { sanitizeTripData } from "@/lib/schemas";
import { toTrip } from "@/lib/types";

function unauthorized() {
  return NextResponse.json({ error: "Authentication required" }, { status: 401 });
}

export async function POST(request: Request) {
  const decoded = await verifyIdToken(request);
  if (!decoded) return unauthorized();

  try {
    const { tripData } = await request.json();
    if (!tripData || typeof tripData !== "object") {
      return NextResponse.json({ error: "Missing required field: tripData" }, { status: 400 });
    }

    const sanitizedData = sanitizeTripData(tripData);

    const db = getAdminFirestoreClient();
    const ref = await db.collection("trips").add({
      ...sanitizedData,
      ownerId: decoded.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true, tripId: ref.id }, { status: 201 });
  } catch (error) {
    console.error("Save trip error:", error);
    const message = error instanceof Error ? error.message : "Failed to save trip";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const decoded = await verifyIdToken(request);

  try {
    const { searchParams } = new URL(request.url);
    const tripId = searchParams.get("tripId");
    const userId = searchParams.get("userId");
    if (userId && (!decoded || userId !== decoded.uid)) return unauthorized();

    const db = getAdminFirestoreClient();
    if (tripId) {
      const snapshot = await db.collection("trips").doc(tripId).get();
      const tripData = snapshot.data();
      const canRead = snapshot.exists && (tripData?.isPublic === true || tripData?.ownerId === decoded?.uid);
      if (!canRead) {
        if (!decoded) return unauthorized();
        return NextResponse.json({ error: "Trip not found" }, { status: 404 });
      }
      return NextResponse.json({ id: snapshot.id, ...tripData });
    }

    if (!decoded) return unauthorized();

    const snapshot = await db.collection("trips").where("ownerId", "==", decoded.uid).limit(50).get();
    const trips = snapshot.docs
      .map((doc) => toTrip({ id: doc.id }, doc.data()))
      .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
    return NextResponse.json(trips);
  } catch (error) {
    console.error("Get trips error:", error);
    return NextResponse.json({ error: "Failed to get trips" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const decoded = await verifyIdToken(request);
  if (!decoded) return unauthorized();

  try {
    const tripId = new URL(request.url).searchParams.get("tripId");
    if (!tripId) return NextResponse.json({ error: "Missing tripId" }, { status: 400 });

    const db = getAdminFirestoreClient();
    const ref = db.collection("trips").doc(tripId);
    const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.data()?.ownerId !== decoded.uid) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }
    await ref.delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete trip error:", error);
    return NextResponse.json({ error: "Failed to delete trip" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const decoded = await verifyIdToken(request);
  if (!decoded) return unauthorized();

  try {
    const { tripId, tripData } = await request.json();
    if (!tripId || !tripData || typeof tripData !== "object") {
      return NextResponse.json({ error: "Missing required fields: tripId, tripData" }, { status: 400 });
    }

    const db = getAdminFirestoreClient();
    const ref = db.collection("trips").doc(tripId);
    const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.data()?.ownerId !== decoded.uid) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }

    const sanitizedData = sanitizeTripData({
      ...tripData,
      ownerId: decoded.uid, // Ensure ownerId cannot be changed
    });

    await ref.update({
      ...sanitizedData,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update trip error:", error);
    const message = error instanceof Error ? error.message : "Failed to update trip";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
