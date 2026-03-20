import type { PublicItem } from "@/lib/storefront-types";
import { ItemCard } from "../ItemCard";

export function ItemsGrid({ items, orgSlug }: { items: PublicItem[]; orgSlug: string }) {
  if (items.length === 0) return null;
  return (
    <div style={{ paddingTop: 32 }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        gap: 16,
      }}>
        {items.map((item) => (
          <ItemCard key={item.id} item={item} orgSlug={orgSlug} />
        ))}
      </div>
    </div>
  );
}
