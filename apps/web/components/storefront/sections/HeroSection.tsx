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
      padding: "clamp(48px, 12vw, 80px) 20px clamp(36px, 9vw, 60px)",
      textAlign: "center",
      background: bg
        ? `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(${bg}) center/cover`
        : "linear-gradient(135deg, var(--dpf-accent, #4f46e5) 0%, var(--dpf-accent-2, #7c3aed) 100%)",
      color: "var(--dpf-text)",
      borderRadius: 12,
      marginBottom: 40,
      maxWidth: "100%",
      boxSizing: "border-box",
    }}>
      <h1 style={{ fontSize: "clamp(28px, 8vw, 40px)", fontWeight: 800, margin: "0 0 12px", overflowWrap: "break-word" }}>
        {(content.headline as string) || orgName}
      </h1>
      {((content.subheading as string) || tagline) && (
        <p style={{ fontSize: "clamp(15px, 4.5vw, 18px)", opacity: 0.9, margin: "0 auto 24px", maxWidth: 600, overflowWrap: "break-word" }}>
          {(content.subheading as string) || tagline}
        </p>
      )}
    </div>
  );
}
