"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Customer-facing not-found boundary for the token-addressed public routes
 * that live directly under `/s/…` — `quote/[token]`, `pay/[token]`,
 * `approve/[token]`, `expense-approve/[token]` — which sit as SIBLINGS of
 * `[slug]`, not descendants of it. `s/[slug]/not-found.tsx` only catches
 * notFound() calls thrown inside the `[slug]` segment, so a bad/expired
 * token on these routes previously fell all the way through to the global
 * operator-oriented 404 (BI-B9D54962). Unlike the slug-scoped boundary, no
 * storefront/org context is resolvable here — the token IS the only lookup
 * key, and it didn't resolve — so recovery stays deliberately generic and
 * never invents a storefront link, but still never points at internal
 * Workspace/Docs.
 */
export default function StorefrontTokenNotFound() {
  const pathname = usePathname() ?? "";

  const linkKind = pathname.startsWith("/s/quote/")
    ? "quote"
    : pathname.startsWith("/s/pay/")
      ? "payment"
      : pathname.startsWith("/s/expense-approve/")
        ? "expense approval"
        : pathname.startsWith("/s/approve/")
          ? "approval"
          : "link";

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "64px 20px", textAlign: "center" }}>
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
        This {linkKind} link is not valid
      </h1>
      <p style={{ color: "var(--dpf-muted)", fontSize: 15, lineHeight: 1.6, marginBottom: 24 }}>
        It may have expired, already been used, or been copied incorrectly. If a
        business sent you this {linkKind} link, please ask them to resend a
        fresh one.
      </p>
      <Link
        href="/"
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
        Go to homepage
      </Link>
    </div>
  );
}
