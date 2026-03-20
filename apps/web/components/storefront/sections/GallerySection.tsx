interface GalleryImage {
  url: string;
  caption?: string;
}

export function GallerySection({ content }: { content: Record<string, unknown> }) {
  const images = Array.isArray(content.images) ? (content.images as GalleryImage[]) : [];

  if (images.length === 0) return null;

  return (
    <div style={{ padding: "40px 0" }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: 12,
      }}>
        {images.map((img, i) => (
          <div key={i} style={{ borderRadius: 8, overflow: "hidden" }}>
            <img
              src={img.url}
              alt={img.caption ?? ""}
              style={{ width: "100%", height: 180, objectFit: "cover", display: "block" }}
            />
            {img.caption && (
              <div style={{ fontSize: 12, color: "#6b7280", padding: "4px 0" }}>{img.caption}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
