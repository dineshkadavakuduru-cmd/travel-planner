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

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://travel-planner-omega-eight.vercel.app";

export const metadata: Metadata = {
  title: { default: "Travel Planner — AI Day-by-Day Itineraries", template: "%s | Travel Planner" },
  description: "Enter Hyderabad to Tokyo, a $2,000 budget, and 5 days — get a day-by-day itinerary with real places, food picks, routes, and budget tracking in INR, USD, EUR, or GBP.",
  applicationName: "Travel Planner",
  metadataBase: new URL(siteUrl),
  alternates: { canonical: "/" },
  icons: { icon: "/favicon.ico" },
  openGraph: {
    title: "Travel Planner — AI Day-by-Day Itineraries",
    description: "Real places, food picks, and routes within your budget. Plan Hyderabad → Tokyo in seconds.",
    url: "/",
    siteName: "Travel Planner",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Travel Planner — AI Day-by-Day Itineraries",
    description: "Real places, food picks, and routes within your budget.",
  },
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
