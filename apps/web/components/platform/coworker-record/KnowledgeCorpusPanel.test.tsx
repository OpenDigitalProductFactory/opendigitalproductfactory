import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { translate } from "@dpf/i18n";

import { KnowledgeCorpusPanel, knowledgeCorpusLabels } from "./KnowledgeCorpusPanel";
import { corpusScopeForAgent, extraFamilyGrantKey } from "@/lib/tak/corpus-read-scope";
import { PROFESSION_REGISTRY } from "@/lib/decision-perspective/resolve-profession-profile";

// BI-825D3487 (AC-CRG-6): the identity page shows the corpus as the resolver sees it.

const [familyA, familyB] = PROFESSION_REGISTRY.families;
const scopeFor = (grants: string[], revoked: string[], name = familyA!.roles[0]!, mode: "enforce" | "report-only" = "enforce") =>
  corpusScopeForAgent({
    agentId: "AGT-X", slugId: null, name,
    toolGrants: grants.map((grantKey) => ({ grantKey })),
    toolGrantRevocations: revoked.map((grantKey) => ({ grantKey })),
  }, mode);

const labels = (mode: string) => knowledgeCorpusLabels((key, args) => translate("en-US", "coworkerRecord", key as never, args), mode);

describe("KnowledgeCorpusPanel", () => {
  it("AC-CRG-6: shows kernel, organization and family grants and that the coworker is mapped", () => {
    const html = renderToStaticMarkup(
      <KnowledgeCorpusPanel scope={scopeFor([extraFamilyGrantKey(familyB!.professionKey)], ["wiki_kernel_read"])} labels={labels("enforce")} />,
    );
    expect(html).toContain("Knowledge corpus");
    expect(html).toMatch(/Platform kernel[\s\S]*Revoked/);
    expect(html).toMatch(/Organization knowledge[\s\S]*Granted/);
    expect(html).toContain(familyA!.label);
    expect(html).toContain(familyB!.label);
    expect(html).toContain("Own family");
    expect(html).toContain("Mapped");
  });

  it("explains an unmapped coworker in report-only mode", () => {
    const html = renderToStaticMarkup(
      <KnowledgeCorpusPanel scope={scopeFor([], [], "no-such-role", "report-only")} labels={labels("report-only")} />,
    );
    expect(html).toContain("Not mapped");
    expect(html).toMatch(/report-only/i);
  });

  it("uses theme tokens, never hard-coded colours", () => {
    const html = renderToStaticMarkup(<KnowledgeCorpusPanel scope={scopeFor([], [])} labels={labels("enforce")} />);
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b|text-white|text-black|gray-\d/i);
    expect(html).toContain("var(--dpf-");
  });
});
