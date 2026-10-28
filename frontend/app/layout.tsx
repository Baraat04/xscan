import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Courier_Prime, Public_Sans } from "next/font/google";
import { Shell } from "@/components/Shell";
import { StoreProvider } from "@/components/Store";
import "./globals.css";

const courier = Courier_Prime({ variable: "--font-courier", subsets: ["latin", "latin-ext"], weight: ["400", "700"], style: ["normal", "italic"] });
const publicSans = Public_Sans({ variable: "--font-public", subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: "xscan — Tender Tribunal",
  description: "Public tenders from TED and SAM.gov, screened, then argued by a prosecutor, a defense and a court before any risk is called.",
};

export const viewport: Viewport = { themeColor: "#1a2957" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${courier.variable} ${publicSans.variable}`}>
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
