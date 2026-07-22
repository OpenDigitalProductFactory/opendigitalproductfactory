"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Customer-facing not-found boundary for the public storefront. A visitor who
 * hits a stale or unsupported `/s/<slug>/…` URL must recover back into the SHOP,
 * not the internal workspace/docs the global 404 points at. The slug isn't a
 * prop on a Next not-found, so we recover it from the pathname and route every
 * link back to that storefront's own customer surfaces.
 */
export default function StorefrontNotFound() {
  const pathname = usePathname() ?? "";
  const match = pathname.match(/^\/s\/([^/]+)/);
  const slug = match?.[1] ?? "";
  const base = slug ? `/s/${slug}` : "/";

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "64px 0", textAlign: "center" }}>
      <div
        aria-hidden="true"
        style={{
          margin: "0 auto 16px",
          width: 44,
          height: 44,
          borderRadius: "50%",
          border: "1px solid var(--dpf-border)",
          background: "var(--dpf-surface-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          color: "var(--dpf-accent)",
        }}
      >
        404
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: "var(--dpf-text)" }}>
        We couldn&apos;t find that page
      </h1>
      <p style={{ color: "var(--dpf-muted)", fontSize: 15, lineHeight: 1.6, marginBottom: 24 }}>
        The link may be out of date. Let&apos;s get you back to somewhere useful.
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        <Link
          href={base}
          style={{
            display: "inline-block",
            padding: "10px 18px",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
            background: "var(--dpf-accent)",
            color: "var(--dpf-surface-1)",
          }}
        >
          Back to home
        </Link>
        {slug && (
          <>
            <Link
              href={`${base}/inquire`}
              style={{
                display: "inline-block",
                padding: "10px 18px",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: "none",
                border: "1px solid var(--dpf-border)",
                color: "var(--dpf-text)",
                background: "var(--dpf-surface-1)",
              }}
            >
              Contact us
            </Link>
            <Link
              href={`${base}/sign-in`}
              style={{
                display: "inline-block",
                padding: "10px 18px",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: "none",
                border: "1px solid var(--dpf-border)",
                color: "var(--dpf-text)",
                background: "var(--dpf-surface-1)",
              }}
            >
              Sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
