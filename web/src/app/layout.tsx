import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import { Shell } from "@/components/shell";
import { StatusProvider } from "@/lib/status";
import "./globals.css";

const labil = localFont({ src: [{ path: "./Variable.woff2", weight: "100 800", style: "normal" }], variable: "--font-brand", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono-brand" });

export const metadata: Metadata = {
  title: "Wayfare: an AI that books your trip",
  description: "Tell an AI your trip. It plans it, books it and pays for it on any chain, and a NEAR contract decides every payment. The agent never holds your card or your keys.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${labil.variable} ${mono.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <StatusProvider>
          <Shell>{children}</Shell>
        </StatusProvider>
      </body>
    </html>
  );
}
