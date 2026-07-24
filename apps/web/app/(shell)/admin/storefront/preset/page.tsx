import Link from "next/link";
import { prisma } from "@dpf/db";
import { StorefrontPresetPanel } from "@/components/admin/StorefrontPresetPanel";

/**
 * BI-6F9D487C — support/admin-only home for internal DPF instance tooling.
 *
 * These actions ("apply DPF production-instance preset", "view archetype
 * refinement diff") use internal project vocabulary (customer-zero,
 * seeded-install) and mutate business identity — they are not tasks for a
 * non-technical Restaurant/Venue owner. They used to live inline in the
 * owner-facing `/storefront/settings` page; they now live here, behind the
 * shell admin layout's `can(..., "view_admin")` gate (see
 * `app/(shell)/admin/layout.tsx`), which is the existing admin/support
 * role-gating pattern reused rather than inventing a new auth mechanism.
 */
export default async function StorefrontPresetAdminPage() {
  const config = await prisma.storefrontConfig.findFirst({
    select: { archetype: { select: { name: true } } },
  });

  return (
    <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--dpf-text)", margin: 0 }}>
          Storefront: support &amp; customer-zero tooling
        </h2>
        <p style={{ fontSize: 13, color: "var(--dpf-muted)", margin: "4px 0 0" }}>
          Internal actions for support and platform admins. Never shown on the owner-facing Storefront
          settings, team, or dashboard routes.
        </p>
      </div>

      <StorefrontPresetPanel />

      <div
        style={{
          padding: "16px",
          borderRadius: 8,
          border: "1px dashed var(--dpf-border)",
          background: "var(--dpf-surface-1)",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: "var(--dpf-text)" }}>
          Improve template
        </div>
        <p style={{ fontSize: 12, color: "var(--dpf-muted)", marginBottom: 8 }}>
          The live configuration may differ from the original {config?.archetype?.name ?? "archetype"}{" "}
          template. Review the changes and optionally contribute improvements back to help future users of
          this business type.
        </p>
        <Link
          href="/api/storefront/admin/archetypes/refinement"
          target="_blank"
          style={{
            display: "inline-block",
            padding: "6px 14px",
            borderRadius: 6,
            border: "1px solid var(--dpf-border)",
            fontSize: 12,
            color: "var(--dpf-text)",
            textDecoration: "none",
            background: "var(--dpf-surface-2)",
          }}
        >
          View refinement diff
        </Link>
        <span style={{ fontSize: 11, color: "var(--dpf-muted)", marginLeft: 8 }}>
          Or use the AI coworker skill: &quot;Improve template&quot;
        </span>
      </div>
    </div>
  );
}
