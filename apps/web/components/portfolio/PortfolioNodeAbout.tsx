// apps/web/components/portfolio/PortfolioNodeAbout.tsx
//
// Renders the TaxonomyNode.description as a full-width "About" band on the
// portfolio detail page (Task 3.3 of the discovery -> portfolio gap closure
// plan). When `about` is null the component renders nothing -- per spec
// section 6.4 we never show an empty band.

import type { ReactElement } from "react";

type Props = {
  about: string | null;
};

export function PortfolioNodeAbout({ about }: Props): ReactElement | null {
  if (about === null) return null;

  return (
    <section className="mt-6 pt-6 border-t border-[var(--dpf-border)]">
      <h2 className="text-base font-semibold text-[var(--dpf-text)] mb-2">About</h2>
      <p className="text-sm text-[var(--dpf-text)]">{about}</p>
    </section>
  );
}
