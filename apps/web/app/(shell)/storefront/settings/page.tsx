import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";

export default async function StorefrontSettingsPage() {
  const config = await prisma.storefrontConfig.findFirst({
    select: {
      id: true,
      tagline: true,
      description: true,
      contactEmail: true,
      contactPhone: true,
      heroImageUrl: true,
    },
  });
  if (!config) redirect("/storefront/setup");

  async function updateSettings(formData: FormData) {
    "use server";
    // Re-derive the config ID server-side. Never trust a client-supplied ID.
    const record = await prisma.storefrontConfig.findFirst({ select: { id: true } });
    if (!record) redirect("/storefront/setup");
    await prisma.storefrontConfig.update({
      where: { id: record.id },
      data: {
        tagline: (formData.get("tagline") as string) || null,
        description: (formData.get("description") as string) || null,
        contactEmail: (formData.get("contactEmail") as string) || null,
        contactPhone: (formData.get("contactPhone") as string) || null,
        heroImageUrl: (formData.get("heroImageUrl") as string) || null,
      },
    });
    redirect("/storefront/settings");
  }

  return (
    <form action={updateSettings} style={{ maxWidth: 480, display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600 }}>Settings</h2>
      {[
        { name: "tagline", label: "Tagline", defaultValue: config.tagline ?? "" },
        { name: "description", label: "Description", defaultValue: config.description ?? "" },
        { name: "contactEmail", label: "Contact email", defaultValue: config.contactEmail ?? "" },
        { name: "contactPhone", label: "Contact phone", defaultValue: config.contactPhone ?? "" },
        { name: "heroImageUrl", label: "Hero image URL", defaultValue: config.heroImageUrl ?? "" },
      ].map((field) => (
        <label key={field.name} style={{ fontSize: 13 }}>
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
          color: "#fff",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          alignSelf: "flex-start",
        }}
      >
        Save Changes
      </button>
    </form>
  );
}
