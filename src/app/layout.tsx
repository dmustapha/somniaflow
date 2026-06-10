import type { Metadata } from "next";
import { IBM_Plex_Mono, DM_Sans, Playfair_Display } from "next/font/google";
import "./globals.css";

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

const sans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const serif = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SomniaFlow — On-Chain Agent Orchestration",
  description:
    "First multi-agent orchestration protocol on Somnia. Agents coordinated and verified on-chain via Shannon testnet. No off-chain coordinator.",
  icons: {
    icon: "/logo-v1.svg",
    shortcut: "/logo-v1.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mono.variable} ${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
