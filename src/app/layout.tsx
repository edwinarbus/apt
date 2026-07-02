import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { Header } from "@/components/Header";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Apt — SF apartment scout",
  description:
    "Personal, non-commercial San Francisco apartment monitoring. Always verify with the original listing.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="flex h-screen min-h-0 flex-col overflow-hidden">
        <Header />
        <main className="min-h-0 flex-1">{children}</main>
      </body>
    </html>
  );
}
