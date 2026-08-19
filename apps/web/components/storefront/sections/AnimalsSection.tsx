import type { PublicAdoptableAnimal } from "@/lib/storefront/storefront-types";
import { MediaImage } from "../MediaImage";

// Legacy free-form shape (content.animals), kept as a fallback for storefronts
// whose animals were authored as section JSON before the AdoptableAnimal entity.
interface LegacyAnimal {
  name: string;
  species: string;
  imageUrl?: string;
  description?: string;
}

const STATUS_LABEL: Record<string, string> = {
  available: "Available",
  pending: "Adoption pending",
  hold: "On hold",
};

function AnimalCard({ animal }: { animal: PublicAdoptableAnimal }) {
  const meta = [animal.breed, animal.age, animal.sex, animal.size].filter(Boolean).join(" · ");
  return (
    <div
      style={{
        border: "1px solid var(--dpf-border)",
        borderRadius: 8,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ position: "relative" }}>
        <MediaImage src={animal.primaryPhotoUrl} alt={animal.name} height={160} />
        {animal.status !== "available" && (
          <span
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              fontSize: 11,
              background: "rgba(0,0,0,0.7)",
              color: "#fff",
              borderRadius: 4,
              padding: "2px 6px",
            }}
          >
            {STATUS_LABEL[animal.status] ?? animal.status}
          </span>
        )}
      </div>
      <div style={{ fontWeight: 600, fontSize: 15, color: "var(--dpf-text)" }}>{animal.name}</div>
      {(animal.species || meta) && (
        <div style={{ fontSize: 13, color: "var(--dpf-muted)" }}>
          {[animal.species, meta].filter(Boolean).join(" — ")}
        </div>
      )}
      {animal.description && (
        <div style={{ fontSize: 13, color: "var(--dpf-text)", lineHeight: 1.5 }}>
          {animal.description}
        </div>
      )}
    </div>
  );
}

export function AnimalsSection({
  content,
  animals,
}: {
  content: Record<string, unknown>;
  animals?: PublicAdoptableAnimal[];
}) {
  const intro = content.intro as string | undefined;
  const legacy = Array.isArray(content.animals) ? (content.animals as LegacyAnimal[]) : [];
  const records = animals ?? [];

  if (!intro && records.length === 0 && legacy.length === 0) {
    return (
      <div
        style={{
          padding: "32px 0",
          color: "var(--dpf-muted)",
          fontSize: 14,
          fontStyle: "italic",
          textAlign: "center",
        }}
      >
        Add animals in Admin → Animals to populate this section.
      </div>
    );
  }

  return (
    <div style={{ padding: "40px 0" }}>
      {intro && (
        <p style={{ fontSize: 15, color: "var(--dpf-text)", lineHeight: 1.6, marginBottom: 24 }}>
          {intro}
        </p>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 16,
        }}
      >
        {records.length > 0
          ? records.map((animal) => <AnimalCard key={animal.id} animal={animal} />)
          : legacy.map((animal, i) => (
              <div
                key={i}
                style={{
                  border: "1px solid var(--dpf-border)",
                  borderRadius: 8,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <MediaImage src={animal.imageUrl} alt={animal.name} height={140} />
                <div style={{ fontWeight: 600, fontSize: 15, color: "var(--dpf-text)" }}>
                  {animal.name}
                </div>
                <div style={{ fontSize: 13, color: "var(--dpf-muted)" }}>{animal.species}</div>
                {animal.description && (
                  <div style={{ fontSize: 13, color: "var(--dpf-text)", lineHeight: 1.5 }}>
                    {animal.description}
                  </div>
                )}
              </div>
            ))}
      </div>
    </div>
  );
}
