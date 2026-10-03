import type { Metadata, Viewport } from "next";
import { Fraunces, Manrope, IBM_Plex_Mono } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
import SignInButton from "@/components/SignInButton";
import Link from "next/link";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: { default: "Travel Planner", template: "%s | Travel Planner" },
  description: "Build realistic, place-rich itineraries around your budget and travel style.",
  applicationName: "Travel Planner",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  openGraph: { title: "Travel Planner", description: "Plan your next escape with a real itinerary.", type: "website" },
  twitter: { card: "summary_large_image", title: "Travel Planner", description: "Plan your next escape with a real itinerary." },
};

export const viewport: Viewport = { themeColor: "#0B1120", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${manrope.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg-deep text-sand-light">
        <AuthProvider>
          <header className="border-b border-sand-light/10 bg-bg-surface/50 backdrop-blur-md sticky top-0 z-50">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2">
                <span className="font-display text-xl font-bold text-sand-light">
                  Travel<span className="text-gold-brass">Planner</span>
                </span>
              </Link>
              <nav className="flex items-center gap-4">
                <Link
                  href="/trips"
                  className="font-mono text-xs text-sand-light/70 hover:text-gold-brass transition-colors hidden sm:block"
                >
                  My Trips
                </Link>
                <SignInButton />
              </nav>
            </div>
          </header>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
