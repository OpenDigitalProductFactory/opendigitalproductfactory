interface Testimonial {
  author: string;
  text?: string;
  quote?: string;
  role?: string;
}

export function TestimonialsSection({ content }: { content: Record<string, unknown> }) {
  const testimonials = Array.isArray(content.testimonials)
    ? (content.testimonials as Testimonial[])
    : [];

  if (testimonials.length === 0) return null;

  return (
    <div style={{ padding: "40px 0" }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: 20,
      }}>
        {testimonials.map((t, i) => (
          <div key={i} style={{
            border: "1px solid var(--dpf-border)",
            borderRadius: 8,
            padding: 20,
            background: "var(--dpf-surface-2)",
          }}>
            <p style={{ fontSize: 14, color: "var(--dpf-text)", lineHeight: 1.6, margin: "0 0 12px", fontStyle: "italic" }}>
              &ldquo;{t.text ?? t.quote ?? ""}&rdquo;
            </p>
            <div style={{ fontWeight: 600, fontSize: 13, color: "var(--dpf-text)" }}>{t.author}</div>
            {t.role && (
              <div style={{ fontSize: 12, color: "var(--dpf-muted)", marginTop: 2 }}>{t.role}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
