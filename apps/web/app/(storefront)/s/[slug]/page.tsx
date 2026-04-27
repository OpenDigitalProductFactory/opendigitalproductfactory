import { notFound } from "next/navigation";
import { getPublicStorefront } from "@/lib/storefront-data";
import { SectionRenderer } from "@/components/storefront/SectionRenderer";

export default async function StorefrontHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const storefront = await getPublicStorefront(slug);
  if (!storefront) notFound();

  return (
    <div>
      {storefront.archetypeId === "software-platform" && (
        <section
          style={{
            margin: "0 auto 32px",
            maxWidth: 960,
            padding: "20px 24px",
            borderRadius: 16,
            border: "1px solid var(--dpf-border)",
            background: "linear-gradient(135deg, var(--dpf-surface-1), var(--dpf-surface-2))",
            color: "var(--dpf-text)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--dpf-muted)" }}>
            Customer-Zero Production Instance
          </div>
          <h1 style={{ margin: "8px 0 10px", fontSize: 32, lineHeight: 1.1 }}>
            {storefront.orgName}
          </h1>
          <p style={{ margin: 0, maxWidth: 720, fontSize: 16, color: "var(--dpf-muted)" }}>
            {storefront.description ?? storefront.tagline ?? "Run your digital product operation on the platform that runs itself."}
          </p>
        </section>
      )}
      {storefront.sections.map((section) => (
        <SectionRenderer
          key={section.id}
          section={section}
          storefront={storefront}
          orgSlug={slug}
        />
      ))}
    </div>
  );
}
