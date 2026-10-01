/**
 * The citation is load-bearing (BI-DEDAC950, design §3.4).
 *
 * A refusal that names a principle slug is only useful if `wiki_query` finds
 * the page. This test resolves every cited slug against the page files by the
 * seeders' own slug rules (exported from @dpf/db, never re-implemented here),
 * and checks each page is a published principle that states a rule.
 *
 * It also prints the inventory of gate codes that cite nothing — rules a gate
 * enforces that no page states — and ratchets its size: it may fall, never rise.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  kernelWikiPageSlug,
  parseFrontmatter,
  professionCorpusPageSlug,
  type WikiPageFrontmatter,
} from "@dpf/db/wiki-frontmatter";

import { READINESS_CODES, type InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness/types";
import { CANONICAL_PRIMITIVES } from "@/lib/canonical-primitives";

import {
  ALIGNMENT_REFUSAL_PRINCIPLE,
  DIRECTIONAL_ESCALATION_PRINCIPLE,
  READINESS_GOVERNING_PRINCIPLE,
  RESEARCH_PRINCIPLE_BY_PROFILE,
  governingPrinciplesFor,
  governingRulesLine,
  unwrittenRuleInventory,
} from "./governing-principles";

// __dirname = apps/web/lib/kernel → 4 `..` to reach the repo root.
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const KERNEL_WIKI_DIR = join(REPO_ROOT, "docs", "founder-kernel", "wiki");
const PROFESSIONS_DIR = join(REPO_ROOT, "docs", "professions");

/**
 * The count of `null` citations today. Lower it when a page is written for a
 * code; never raise it. A new gate code either cites a page or is added here
 * knowingly, as a visible unwritten rule.
 */
const UNWRITTEN_RULE_CEILING = 20;

function walkMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walkMarkdown(full);
    return entry.endsWith(".md") && !entry.startsWith("README") ? [full] : [];
  });
}

type PageFile = { path: string; raw: string; frontmatter: WikiPageFrontmatter; body: string };

/** slug → every page file the seeders would write under that slug. */
function indexPagesBySlug(): Map<string, PageFile[]> {
  const index = new Map<string, PageFile[]>();
  const add = (slug: string, path: string) => {
    const raw = readFileSync(path, "utf8");
    const { frontmatter, body } = parseFrontmatter<WikiPageFrontmatter>(raw);
    index.set(slug, [...(index.get(slug) ?? []), { path, raw, frontmatter, body }]);
  };
  for (const path of walkMarkdown(KERNEL_WIKI_DIR)) {
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(readFileSync(path, "utf8"));
    add(kernelWikiPageSlug(frontmatter, path, KERNEL_WIKI_DIR), path);
  }
  for (const family of readdirSync(PROFESSIONS_DIR)) {
    const familyDir = join(PROFESSIONS_DIR, family);
    if (!statSync(familyDir).isDirectory()) continue;
    for (const path of walkMarkdown(join(familyDir, "wiki"))) add(professionCorpusPageSlug(path, PROFESSIONS_DIR), path);
  }
  return index;
}

/** The body under `## Rule` (or `## The rule`), up to the next level-2 heading. */
function ruleSection(body: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+(the\s+)?rule\s*$/i.test(line.trim()));
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

function citedSlugs(): Array<{ where: string; slug: string }> {
  const cited: Array<{ where: string; slug: string }> = [];
  const push = (where: string, slug: string | null | undefined) => {
    if (slug) cited.push({ where, slug });
  };
  for (const [code, slug] of Object.entries(READINESS_GOVERNING_PRINCIPLE)) push(`readiness ${code}`, slug);
  for (const [profile, slug] of Object.entries(RESEARCH_PRINCIPLE_BY_PROFILE)) push(`research (${profile})`, slug);
  for (const [reason, slug] of Object.entries(DIRECTIONAL_ESCALATION_PRINCIPLE)) push(`directional ${reason}`, slug);
  for (const [code, slug] of Object.entries(ALIGNMENT_REFUSAL_PRINCIPLE)) push(`alignment ${code}`, slug);
  for (const primitive of CANONICAL_PRIMITIVES) push(`canonical primitive ${primitive.name}`, primitive.principleSlug);
  return cited;
}

describe("governing principles: every citation resolves", () => {
  const index = indexPagesBySlug();

  it.each(citedSlugs())("$where → $slug resolves to exactly one published principle with a rule", ({ slug }) => {
    const pages = index.get(slug) ?? [];
    expect(pages.map((page) => page.path), `slug ${slug} must resolve to exactly one page file`).toHaveLength(1);
    const page = pages[0]!;
    const normalised = page.path.replace(/\\/g, "/");
    expect(
      normalised.includes("/docs/founder-kernel/wiki/principles/") || /\/docs\/professions\/[^/]+\/wiki\//.test(normalised),
      `${slug} must live under the kernel principles or a profession wiki`,
    ).toBe(true);
    expect([undefined, "published"]).toContain(page.frontmatter.status);
    expect(page.frontmatter.pageKind).toBe("principle");
    expect(ruleSection(page.body), `${slug} must have a non-empty ## Rule section`).not.toBe("");
  });

  it("rejects a slug that names no page (the check is not vacuous)", () => {
    expect(index.get("principles/no-such-principle-exists")).toBeUndefined();
    // The pre-BI-DEDAC950 bare form of the report-kit slug resolved to nothing.
    expect(index.get("compose-report-kit-for-reporting-ux")).toBeUndefined();
  });
});

describe("governing principles: tables", () => {
  it("the readiness table is total over READINESS_CODES", () => {
    expect(Object.keys(READINESS_GOVERNING_PRINCIPLE).sort()).toEqual([...READINESS_CODES].sort());
  });

  it("ratchets the unwritten-rule inventory: it may shrink, never grow", () => {
    const inventory = unwrittenRuleInventory();
    console.info(
      `[governing-principles] ${inventory.length} gate codes enforce a rule no page states:\n`
      + inventory.map((entry) => `  - ${entry}`).join("\n"),
    );
    expect(inventory.length).toBeLessThanOrEqual(UNWRITTEN_RULE_CEILING);
  });
});

function decision(overrides: Partial<InitiativeReadinessDecision>): InitiativeReadinessDecision {
  const requirement = (code: InitiativeReadinessDecision["unmet"][number]["code"]) => ({
    code, state: "missing" as const, accountableRole: "x", evidenceRefs: [], evidenceLane: "none" as const,
    unreadEvidenceRefs: [], nextAction: null,
  });
  return {
    decisionId: "d", policyVersion: "p",
    subject: { kind: "backlog-item", id: "BI-1" },
    transitionObject: { kind: "backlog-item", id: "BI-1", expectedVersion: "v", targetState: "implementation" },
    profile: "feature", target: "implementation", verdict: "input-required",
    satisfied: [requirement("CLASSIFICATION_REQUIRED")],
    unmet: [requirement("DELIVERY_EVIDENCE_REQUIRED"), requirement("STALE_EVIDENCE")],
    blockers: [requirement("ARTIFACT_AUTHOR_REQUIRED")],
    evaluatedAt: "2026-09-25T00:00:00.000Z",
    ...overrides,
  };
}

describe("governingPrinciplesFor", () => {
  it("cites every unmet or blocking code that has a page, and nothing else", () => {
    expect(governingPrinciplesFor(decision({}))).toEqual({
      DELIVERY_EVIDENCE_REQUIRED: READINESS_GOVERNING_PRINCIPLE.DELIVERY_EVIDENCE_REQUIRED,
      ARTIFACT_AUTHOR_REQUIRED: READINESS_GOVERNING_PRINCIPLE.ARTIFACT_AUTHOR_REQUIRED,
    });
  });

  it("is profile-aware for RESEARCH_REQUIRED", () => {
    const research = [{
      code: "RESEARCH_REQUIRED" as const, state: "missing" as const, accountableRole: "x", evidenceRefs: [],
      evidenceLane: "none" as const, unreadEvidenceRefs: [], nextAction: null,
    }];
    expect(governingPrinciplesFor(decision({ profile: "feature", unmet: research, blockers: [] })))
      .toEqual({ RESEARCH_REQUIRED: "principles/design-research-required" });
    expect(governingPrinciplesFor(decision({ profile: "fix", unmet: research, blockers: [] })))
      .toEqual({ RESEARCH_REQUIRED: RESEARCH_PRINCIPLE_BY_PROFILE.fix });
    expect(RESEARCH_PRINCIPLE_BY_PROFILE.fix).not.toBe("principles/design-research-required");
  });

  it("returns an empty map for an allowed decision", () => {
    expect(governingPrinciplesFor(decision({ verdict: "allowed", unmet: [], blockers: [] }))).toEqual({});
  });

  it("renders one wiki_query line, or nothing when no rule is cited", () => {
    expect(governingRulesLine({ DELIVERY_EVIDENCE_REQUIRED: "principles/build-gate-mandatory" })).toBe(
      "Governing rules: DELIVERY_EVIDENCE_REQUIRED → principles/build-gate-mandatory (look up with wiki_query).",
    );
    expect(governingRulesLine({})).toBeNull();
  });
});
