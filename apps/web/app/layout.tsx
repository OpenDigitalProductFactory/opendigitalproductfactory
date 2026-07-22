import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DialogHost } from "@/components/ui/Dialog";

// All pages in this app require database access at render time.
// Prevent Next.js from attempting static prerendering during docker build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Digital Product Factory",
};

// Explicit device-width viewport so public/mobile surfaces (e.g. the 390px
// restaurant storefront flow) scale correctly and never render zoomed-out
// with horizontal overflow. maximum-scale is intentionally omitted so users
// can still pinch-zoom (accessibility).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// BI-QUIESCE-006 — boot-time identity injected as window.__DPF_BOOT__ so
// the PlatformBanner can detect bundle-hash mismatch after a swap and
// trigger a soft reload (spec §7.2 defensive layer). Values come from
// process.env so a docker rebuild updates them automatically.
//
// CRITICAL (BI-864E83B0-followup): bundleHash MUST be derived from the same
// source as /api/internal/quiescence-state (getDeployedSha → DEPLOYED_SHA),
// otherwise the two identities never match and every mismatch check is a
// false positive. The old value read PORTAL_BUNDLE_HASH/PORTAL_GIT_SHA, which
// nothing sets in the container, so boot was "unknown" while the API returned
// the real DEPLOYED_SHA — a permanent mismatch that drove a page-reload loop
// once a consumer started checking it. DEPLOYED_SHA is always populated on a
// built image (the Dockerfile seeds it from the baked /app/.dpf-image-version).
const BOOT_VERSION = process.env.PORTAL_VERSION ?? "unknown";
const BOOT_BUNDLE_HASH =
  process.env.DEPLOYED_SHA ??
  process.env.PORTAL_BUNDLE_HASH ??
  process.env.PORTAL_GIT_SHA ??
  "unknown";
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
        {/* BI-B0E4F3F1 — single host for in-app confirm/alert/prompt dialogs,
            replacing native window.confirm/alert/prompt (unreachable by automation). */}
        <DialogHost />
      </body>
    </html>
  );
}
