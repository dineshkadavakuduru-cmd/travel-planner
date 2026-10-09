"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import { getAuthClient } from "@/lib/firebase";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  logOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let auth;
    try {
      auth = getAuthClient();
    } catch {
      // Firebase not configured (missing NEXT_PUBLIC_FIREBASE_* env).
      // Run in signed-out mode instead of crashing every page.
      console.warn("Firebase is not configured; continuing without auth.");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time init fallback, not a render loop
      setLoading(false);
      return;
    }
    let unsubscribe: () => void = () => {};
    try {
      unsubscribe = onAuthStateChanged(auth, (user) => {
        setUser(user);
        setLoading(false);
      });
    } catch {
      console.warn("Firebase auth listener failed; continuing without auth.");
      setLoading(false);
    }

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    let auth;
    try {
      auth = getAuthClient();
    } catch {
      throw new Error("Sign-in is unavailable: Firebase is not configured.");
    }
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const logOut = async () => {
    let auth;
    try {
      auth = getAuthClient();
    } catch {
      return;
    }
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, logOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
