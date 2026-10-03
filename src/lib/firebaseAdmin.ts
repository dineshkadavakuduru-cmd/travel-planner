import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function initAdmin() {
  if (getApps().length === 0) {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

    if (!projectId || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
      throw new Error("Firebase Admin credentials are not configured");
    }

    initializeApp({
      credential: cert({
        projectId,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    });
  }
}

export function getAdminAuth() {
  initAdmin();
  return getAuth();
}

export function getAdminFirestore() {
  initAdmin();
  return getFirestore();
}