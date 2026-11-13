import Link from "next/link";

import { Surface } from "@/components/ui/Surface";
import type { AtlasTranslate } from "@/components/ops/workrooms/atlas/WorkAtlas";
import type { AtlasPicture } from "@/lib/work-management/atlas-projection";

/**
 * An area's Work view no longer lists rooms itself (design §6, rule 3): it
 * counts this portfolio's rooms from the Atlas projection and links into the
 * Atlas filtered to the portfolio.
 */
export function AtlasPortfolioLink({ picture, portfolio, t }: { picture: AtlasPicture; portfolio: string; t: AtlasTranslate }) {
  return (
    <Surface className="my-6" rounded="xl" data-atlas-portfolio-link={portfolio}>
      <p className="text-dpf-body text-[var(--dpf-text)]">
        {t("atlas.areaSummary", { total: picture.total, need: picture.counts["needs-person"], stuck: picture.counts.stuck })}
      </p>
      <Link href={`/ops/workrooms?portfolio=${encodeURIComponent(portfolio)}`}
        className="mt-2 inline-block rounded-sm text-dpf-caption font-medium text-[var(--dpf-accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
        {t("atlas.areaLink")}
      </Link>
    </Surface>
  );
}
