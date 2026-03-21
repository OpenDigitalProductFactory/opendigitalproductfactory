export function HeroSection({
  content,
  orgName,
  tagline,
}: {
  content: Record<string, unknown>;
  orgName: string;
  tagline: string | null;
}) {
  const bg = content.backgroundImageUrl as string | undefined;
  return (
    <div style={{
      padding: "80px 0 60px",
      textAlign: "center",
      background: bg
        ? `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(${bg}) center/cover`
        : "linear-gradient(135deg, var(--dpf-accent, #4f46e5) 0%, var(--dpf-accent-2, #7c3aed) 100%)",
      color: "var(--dpf-text)",
      borderRadius: 12,
      marginBottom: 40,
    }}>
      <h1 style={{ fontSize: 40, fontWeight: 800, margin: "0 0 12px" }}>
        {(content.headline as string) || orgName}
      </h1>
      {((content.subheading as string) || tagline) && (
        <p style={{ fontSize: 18, opacity: 0.9, margin: "0 auto 24px", maxWidth: 600 }}>
          {(content.subheading as string) || tagline}
        </p>
      )}
    </div>
  );
}
