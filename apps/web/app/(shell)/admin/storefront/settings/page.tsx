import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function StorefrontSettingsPage() {
  const config = await prisma.storefrontConfig.findFirst({
    select: {
      id: true,
      tagline: true,
      description: true,
      contactEmail: true,
      contactPhone: true,
      heroImageUrl: true,
      organization: { select: { slug: true } },
      archetype: { select: { name: true, isBuiltIn: true } },
    },
  });
  if (!config) redirect("/admin/storefront/setup");

  async function updateSettings(formData: FormData) {
    "use server";
    const record = await prisma.storefrontConfig.findFirst({
      select: { id: true, organizationId: true },
    });
    if (!record) redirect("/admin/storefront/setup");
    const newSlug = (formData.get("slug") as string | null)?.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "") || null;
    await Promise.all([
      prisma.storefrontConfig.update({
        where: { id: record.id },
        data: {
          tagline: (formData.get("tagline") as string) || null,
          description: (formData.get("description") as string) || null,
          contactEmail: (formData.get("contactEmail") as string) || null,
          contactPhone: (formData.get("contactPhone") as string) || null,
          heroImageUrl: (formData.get("heroImageUrl") as string) || null,
        },
      }),
      ...(newSlug ? [prisma.organization.update({
        where: { id: record.organizationId },
        data: { slug: newSlug },
      })] : []),
    ]);
    redirect("/admin/storefront/settings");
  }

  return (
    <form action={updateSettings} style={{ maxWidth: 480, display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--dpf-text, #111827)" }}>Settings</h2>
      <label key="slug" style={{ fontSize: 13, color: "var(--dpf-text, #111827)" }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Storefront URL slug</div>
        <input
          type="text"
          name="slug"
          defaultValue={config.organization?.slug ?? ""}
          style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dpf-border)", fontSize: 14, fontFamily: "monospace" }}
        />
        <div style={{ fontSize: 11, color: "#b45309", marginTop: 4 }}>
          Warning: changing this will break existing bookmarked links to your storefront.
        </div>
      </label>
      {[
        { name: "tagline", label: "Tagline", defaultValue: config.tagline ?? "" },
        { name: "description", label: "Description", defaultValue: config.description ?? "" },
        { name: "contactEmail", label: "Contact email", defaultValue: config.contactEmail ?? "" },
        { name: "contactPhone", label: "Contact phone", defaultValue: config.contactPhone ?? "" },
        { name: "heroImageUrl", label: "Hero image URL", defaultValue: config.heroImageUrl ?? "" },
      ].map((field) => (
        <label key={field.name} style={{ fontSize: 13, color: "var(--dpf-text, #111827)" }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{field.label}</div>
          <input
            type="text"
            name={field.name}
            defaultValue={field.defaultValue}
            style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--dpf-border)", fontSize: 14 }}
          />
        </label>
      ))}
      <button
        type="submit"
        style={{
          padding: "8px 20px",
          borderRadius: 6,
          border: "none",
          background: "var(--dpf-accent, #4f46e5)",
          color: "var(--dpf-text)",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          alignSelf: "flex-start",
        }}
      >
        Save Changes
      </button>

      {/* Improve template section */}
      <div style={{
        marginTop: 24,
        padding: "16px",
        borderRadius: 8,
        border: "1px dashed var(--dpf-border)",
        background: "var(--dpf-surface-1)",
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: "var(--dpf-text)" }}>
          Improve template
        </div>
        <p style={{ fontSize: 12, color: "var(--dpf-muted)", marginBottom: 8 }}>
          Your live configuration may differ from the original {config.archetype?.name ?? "archetype"} template.
          Review the changes and optionally contribute improvements back to help future users of this business type.
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
    </form>
  );
}
