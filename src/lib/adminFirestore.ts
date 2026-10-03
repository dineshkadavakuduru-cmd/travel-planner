import { getAdminFirestore } from "@/lib/firebaseAdmin";

export function getAdminFirestoreClient() {
  return getAdminFirestore();
}
