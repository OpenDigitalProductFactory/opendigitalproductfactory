export function AboutSection({ content }: { content: Record<string, unknown> }) {
  const imageUrl = typeof content.imageUrl === "string" ? content.imageUrl : null;
  return (
    <div style={{ padding: "40px 0", display: "flex", gap: 32, alignItems: "flex-start", flexWrap: "wrap" }}>
      {imageUrl && (
        <img src={imageUrl} alt="" style={{ width: 280, borderRadius: 8, flexShrink: 0 }} />
      )}
      <p style={{ fontSize: 15, lineHeight: 1.75, color: "var(--dpf-text)", flex: 1 }}>{(content.body as string | undefined) ?? ""}</p>
    </div>
  );
}
