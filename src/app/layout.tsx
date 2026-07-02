import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { Header } from "@/components/Header";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
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
  title: "Apt Scout — SF rental radar",
  description:
    "Private San Francisco rental radar. Monitors sources, normalizes and dedupes listings, tracks price and availability. Always verify with the original listing.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
      className={`${inter.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="flex h-[100dvh] min-h-0 flex-col overflow-hidden">
        <Header />
        <main className="min-h-0 flex-1">{children}</main>
      </body>
    </html>
  );
}
