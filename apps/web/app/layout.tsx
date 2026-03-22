import type { Metadata } from "next";
import "./globals.css";

// All pages in this app require database access at render time.
// Prevent Next.js from attempting static prerendering during docker build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Digital Product Factory",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
