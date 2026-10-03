import { getAdminAuth } from "@/lib/firebaseAdmin";

export async function verifyIdToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) return null;

  try {
    return await getAdminAuth().verifyIdToken(token);
  } catch {
    return null;
  }
}
