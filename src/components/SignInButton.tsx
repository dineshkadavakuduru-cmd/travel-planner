"use client";

import { useAuth } from "./AuthProvider";
import Image from "next/image";

export default function SignInButton() {
  const { user, signInWithGoogle, logOut, loading } = useAuth();

  if (loading) {
    return (
      <div className="w-8 h-8 border-2 border-sand-light/20 border-t-gold-brass rounded-full animate-spin"></div>
    );
  }

  if (user) {
    return (
      <div className="flex items-center gap-3">
        {user.photoURL && (
          <Image
            src={user.photoURL}
            alt={user.displayName || "User"}
            width={32}
            height={32}
            className="rounded-full border border-gold-brass/40"
          />
        )}
        <span className="font-mono text-sm text-sand-light/70 hidden sm:block">
          {user.displayName}
        </span>
        <button
          onClick={logOut}
          className="font-mono text-xs px-3 py-1.5 border border-sand-light/20 text-sand-light/70 rounded-lg hover:border-coral-warm/40 hover:text-coral-warm transition-colors"
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={signInWithGoogle}
      className="font-mono text-xs px-4 py-2 bg-gold-brass text-bg-deep rounded-lg hover:bg-gold-brass/90 transition-colors font-semibold"
    >
      Sign In
    </button>
  );
}
