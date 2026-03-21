import Link from "next/link";

export function DonationSection({
  content,
  orgSlug,
}: {
  content: Record<string, unknown>;
  orgSlug: string;
}) {
  const title = (content.campaignTitle as string) || "Support Us";
  const description = content.campaignDescription as string | undefined;

  return (
    <div style={{
      padding: "40px 0",
      textAlign: "center",
      borderTop: "1px solid var(--dpf-border)",
    }}>
      <h2 style={{ fontSize: 28, fontWeight: 700, color: "var(--dpf-text)", margin: "0 0 12px" }}>{title}</h2>
      {description && (
        <p style={{ fontSize: 15, color: "var(--dpf-text)", lineHeight: 1.6, margin: "0 auto 24px", maxWidth: 560 }}>
          {description}
        </p>
      )}
      <Link
        href={`/s/${orgSlug}/donate`}
        style={{
          display: "inline-block",
          padding: "10px 28px",
          background: "var(--dpf-accent, #4f46e5)",
          color: "var(--dpf-text)",
          borderRadius: 6,
          fontSize: 15,
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        Donate
      </Link>
    </div>
  );
}
