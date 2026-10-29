import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Fira_Sans_Condensed, Fira_Sans_Extra_Condensed, IBM_Plex_Mono } from "next/font/google";
import { Shell } from "@/components/Shell";
import { StoreProvider } from "@/components/Store";
import "./globals.css";

// The bureau's printed form: labels, headings and the interface are set in Fira's condensed cuts,
// everything typed onto the form in IBM Plex Mono. All three carry Cyrillic, so Kazakh and Russian tenders keep the face.
const form = Fira_Sans_Extra_Condensed({ variable: "--font-form-face", subsets: ["latin", "latin-ext", "cyrillic", "greek"], weight: ["500", "600", "700"] });
const ui = Fira_Sans_Condensed({ variable: "--font-ui-face", subsets: ["latin", "latin-ext", "cyrillic", "greek"], weight: ["400", "500", "600"] });
// Plex Mono has no Greek: those letters fall to Consolas or Courier New, both monospaced, not to a generated sans fallback.
const typed = IBM_Plex_Mono({ variable: "--font-typed-face", subsets: ["latin", "latin-ext", "cyrillic"], weight: ["400", "500", "700"], adjustFontFallback: false, fallback: ["Consolas", "Courier New", "monospace"] });

export const metadata: Metadata = {
  title: "xscan — Tender check",
  description: "Real public tenders from TED, USAspending and any procurement website, screened for warning signs and argued by an AI prosecutor, defense and court.",
};

export const viewport: Viewport = { themeColor: "#b5bab1", colorScheme: "light" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${form.variable} ${ui.variable} ${typed.variable}`}>
      <body>
        <StoreProvider>
          <Suspense fallback={null}>
            <Shell>{children}</Shell>
          </Suspense>
        </StoreProvider>
      </body>
    </html>
  );
}
