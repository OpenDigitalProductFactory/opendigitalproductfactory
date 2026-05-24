import type { Metadata } from "next";
import "./globals.css";

// All pages in this app require database access at render time.
// Prevent Next.js from attempting static prerendering during docker build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Digital Product Factory",
};

// BI-QUIESCE-006 — boot-time identity injected as window.__DPF_BOOT__ so
// the PlatformBanner can detect bundle-hash mismatch after a swap and
// trigger a soft reload (spec §7.2 defensive layer). Values come from
// process.env so a docker rebuild updates them automatically.
const BOOT_VERSION = process.env.PORTAL_VERSION ?? "unknown";
const BOOT_BUNDLE_HASH =
  process.env.PORTAL_BUNDLE_HASH ?? process.env.PORTAL_GIT_SHA ?? "unknown";
const BOOT_JSON = JSON.stringify({ version: BOOT_VERSION, bundleHash: BOOT_BUNDLE_HASH });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <script
          // Safe inline — boot values are env-only, never user-supplied.
          dangerouslySetInnerHTML={{ __html: `window.__DPF_BOOT__=${BOOT_JSON};` }}
        />
        {children}
      </body>
    </html>
  );
}
