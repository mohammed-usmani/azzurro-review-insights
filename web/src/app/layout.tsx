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

// Saved choice first, otherwise the computer's setting. Runs before paint, so there is no flash of the wrong theme.
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // the theme script sets data-theme before first paint, so React must not complain about the attribute
    <html lang="en-AU" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
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
