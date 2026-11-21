import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const schibsted = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Guest reviews · Azzurro Hotels",
  description: "Booking.com review insights for the four Azzurro Hotels properties",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body className={`${schibsted.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
