import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import { Suspense } from "react";
import { Shell } from "@/components/Shell";
import "./globals.css";
import { Providers } from "./providers";

const schibsted = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Guest reviews | Azzurro Hotels", template: "%s | Azzurro guest reviews" },
  description: "Booking.com review insights for the four Azzurro Hotels properties",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body className={`${schibsted.variable} antialiased`}>
        <Providers>
          {/* filters live in the URL (useSearchParams), which needs a Suspense boundary */}
          <Suspense>
            <Shell>{children}</Shell>
          </Suspense>
        </Providers>
      </body>
    </html>
  );
}
