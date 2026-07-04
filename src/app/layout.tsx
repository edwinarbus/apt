import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter, Space_Grotesk } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { PreloadResources } from "./preload-resources";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// The brand wordmark ("Apt") — a distinct geometric display face so the mark
// reads as a considered logo, not just bold UI text.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-brand",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

// Mono for data readouts: counts, prices, coordinates, status, timestamps.
const plexMono = IBM_Plex_Mono({
  variable: "--font-mono-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Apt. — SF apartment finder",
  description:
    "Private San Francisco rental radar. Monitors sources, normalizes and dedupes listings, tracks price and availability. Always verify with the original listing.",
  // Personal, single-user tool — never meant to be discoverable or indexed.
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#06090f",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${plexMono.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="h-[100dvh] min-h-0 overflow-hidden">
        <PreloadResources />
        <main className="h-full min-h-0">{children}</main>
      </body>
    </html>
  );
}
