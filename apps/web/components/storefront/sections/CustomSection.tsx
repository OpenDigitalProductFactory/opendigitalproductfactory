export function CustomSection({ content }: { content: Record<string, unknown> }) {
  const markdown = (content.markdown as string) ?? "";
  if (!markdown) return null;
  return (
    <div style={{ padding: "40px 0" }}>
      <pre style={{ fontSize: 14, color: "#374151", lineHeight: 1.6, whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
        {markdown}
      </pre>
    </div>
  );
}
