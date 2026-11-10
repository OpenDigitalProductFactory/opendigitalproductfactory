import { describe, expect, it } from "vitest";
import { HARDCODED_COWORKER_GRANTS } from "@dpf/db/workforce-seed";

import {
  COWORKER_READ_BASELINE_GRANTS,
  TOOL_TO_GRANTS,
  expandGrants,
} from "./agent-grants";

const effectiveGrants = new Set(
  expandGrants([
    ...HARDCODED_COWORKER_GRANTS["market-research-analyst"],
    ...COWORKER_READ_BASELINE_GRANTS,
  ]),
);

function canReach(toolName: string): boolean {
  const required = TOOL_TO_GRANTS[toolName];
  if (!required) return false;
  return required.length === 0 || required.some((grant) => effectiveGrants.has(grant));
}

describe("Market Research Analyst authority boundary", () => {
  it("can research public sources, read CRM context, and propose enrichment", () => {
    for (const tool of [
      "search_public_web",
      "fetch_public_website",
      "list_customer_accounts",
      "propose_crm_enrichment",
    ]) {
      expect(canReach(tool), `${tool} must remain reachable`).toBe(true);
    }
  });

  it("cannot mutate CRM records, documents, knowledge, wiki, or org doctrine", () => {
    expect(effectiveGrants).not.toContain("crm_write");
    expect(effectiveGrants).not.toContain("document_write");
    expect(effectiveGrants).not.toContain("registry_write");

    for (const tool of [
      "apply_crm_enrichment",
      "doc_save",
      "doc_link",
      "create_knowledge_article",
      "wiki_ingest",
      "record_org_business_answer",
    ]) {
      expect(canReach(tool), `${tool} must remain outside this propose-only role`).toBe(false);
    }
  });
});
