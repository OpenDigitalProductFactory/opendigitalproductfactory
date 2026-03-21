interface Animal {
  name: string;
  species: string;
  imageUrl?: string;
  description?: string;
}

export function AnimalsSection({ content }: { content: Record<string, unknown> }) {
  const intro = content.intro as string | undefined;
  const animals = Array.isArray(content.animals) ? (content.animals as Animal[]) : [];

  if (!intro && animals.length === 0) return null;

  return (
    <div style={{ padding: "40px 0" }}>
      {intro && (
        <p style={{ fontSize: 15, color: "var(--dpf-text)", lineHeight: 1.6, marginBottom: 24 }}>{intro}</p>
      )}
      {animals.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 16,
        }}>
          {animals.map((animal, i) => (
            <div key={i} style={{
              border: "1px solid var(--dpf-border)",
              borderRadius: 8,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}>
              {animal.imageUrl && (
                <img
                  src={animal.imageUrl}
                  alt={animal.name}
                  style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 4 }}
                />
              )}
              <div style={{ fontWeight: 600, fontSize: 15, color: "var(--dpf-text)" }}>{animal.name}</div>
              <div style={{ fontSize: 13, color: "var(--dpf-muted)" }}>{animal.species}</div>
              {animal.description && (
                <div style={{ fontSize: 13, color: "var(--dpf-text)", lineHeight: 1.5 }}>{animal.description}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
