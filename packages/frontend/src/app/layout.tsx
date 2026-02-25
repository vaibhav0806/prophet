import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";
import { Sidebar } from "../components/sidebar";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const displayFont = localFont({
  src: "./fonts/TurboDriver-Italic.woff2",
  variable: "--font-display",
  weight: "700",
});

export const metadata: Metadata = {
  title: "Prophit — Prediction Market Arbitrage",
  description: "Automated prediction market arbitrage trading platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${displayFont.variable} antialiased bg-[#0A0A0A] text-[#E8E8E8] font-sans`}
      >
        <div className="gold-accent-line" aria-hidden />
        <Providers>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 min-w-0 overflow-auto">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
