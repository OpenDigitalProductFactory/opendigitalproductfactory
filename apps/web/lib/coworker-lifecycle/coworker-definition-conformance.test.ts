// EP-COWORKER-LIFECYCLE Phase 1 conformance gate (BI-53ABC4A4).
//
// This test IS the CI gate: it assembles the real scattered coworker
// definition sources and fails on any conformance finding that is not in the
// committed baseline. The baseline captures pre-existing gaps only — it may
// shrink, never grow. Adding a new coworker incompletely (no grants, no route,
// no model floor, dead grant keys, skills that never reach it) fails the
// required Unit Tests job with a message naming the missing piece.
//
// To fix a failure: complete the definition (see
// docs/superpowers/specs/2026-07-07-coworker-lifecycle-standard-design.md for
// the checklist). Only if the gap is intentionally deferred may you add the
// finding to coworker-definition-baseline.json — with a comment in your PR
// explaining why.

import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  COWORKER_AGENT_SEEDS,
  HARDCODED_COWORKER_GRANTS,
  ONBOARDING_AGENT_GRANTS,
} from "@dpf/db/workforce-seed";
import { AGENT_MODEL_CONFIG_DEFAULTS } from "@dpf/db/agent-model-defaults";
import { SKILL_WILDCARD_AGENT_IDS } from "@dpf/db/seed-skills";

import { knownGrantKeys } from "@/lib/tak/agent-grants";
import { ROUTE_AGENT_MAP_ENTRIES } from "@/lib/tak/agent-routing";
import { ROUTE_CONTEXT_MAP } from "@/lib/tak/route-context-map";
import { COWORKER_SELF_TASKS } from "@/lib/operate/scheduled-jobs/coworker-self-tasks";

import {
  assembleCoworkerDefinitions,
  checkDefinitionConformance,
  findingKey,
  type CoworkerDefinitionSources,
} from "./coworker-definition";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");

type RegistryAgent = {
  agent_id: string;
  agent_name: string;
  config_profile?: { execution_runtime?: { type?: string } };
};

function loadRegistryMirrors(): {
  agentId: string;
  agentName: string;
  executionRuntimeType?: string;
}[] {
  const raw = readFileSync(
    join(REPO_ROOT, "packages", "db", "data", "agent_registry.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as { agents?: RegistryAgent[] } | RegistryAgent[];
  const agents = Array.isArray(parsed) ? parsed : (parsed.agents ?? []);
  return agents.map((a) => ({
    agentId: a.agent_id,
    agentName: a.agent_name,
    executionRuntimeType: a.config_profile?.execution_runtime?.type,
  }));
}

function realSources(): CoworkerDefinitionSources {
  return {
    roster: COWORKER_AGENT_SEEDS.map((seed) => ({
      agentId: seed.agentId,
      slugId: seed.slugId,
      name: seed.name,
      sensitivity: seed.sensitivity,
    })),
    bootstrapAgentIds: Object.keys(ONBOARDING_AGENT_GRANTS),
    grantsByAgent: { ...HARDCODED_COWORKER_GRANTS, ...ONBOARDING_AGENT_GRANTS },
    knownGrantKeys: knownGrantKeys(),
    routePersonas: ROUTE_AGENT_MAP_ENTRIES.map(([routePrefix, entry]) => ({
      routePrefix,
      agentId: entry.agentId,
      sensitivity: entry.sensitivity,
    })),
    routeContexts: Object.entries(ROUTE_CONTEXT_MAP).map(([routePrefix, def]) => ({
      routePrefix,
      sensitivity: def.sensitivity,
    })),
    modelFloors: AGENT_MODEL_CONFIG_DEFAULTS.map((row) => ({
      agentId: row.agentId,
      minimumTier: row.minimumTier,
    })),
    skillWildcardAgentIds: SKILL_WILDCARD_AGENT_IDS,
    registryMirrors: loadRegistryMirrors(),
    selfTasks: Object.keys(COWORKER_SELF_TASKS).map((agentId) => ({ agentId })),
  };
}

describe("coworker definition conformance gate (EP-COWORKER-LIFECYCLE)", () => {
  it("produces no findings beyond the committed baseline, and the baseline is not stale", () => {
    if (process.env.UPDATE_COWORKER_DEFINITION_BASELINE === "1") {
      // Sanctioned regeneration path (mirrors the Module Size Guard --update
      // pattern). The baseline diff is reviewed in the PR; growing it for a
      // NEW coworker instead of completing the definition is a review reject.
      const regenerated = {
        comment:
          "Pre-existing coworker definition gaps (EP-COWORKER-LIFECYCLE). May only shrink. Regenerate: UPDATE_COWORKER_DEFINITION_BASELINE=1 pnpm exec vitest run lib/coworker-lifecycle",
        findings: checkDefinitionConformance(realSources()).map(findingKey),
      };
      writeFileSync(
        join(HERE, "coworker-definition-baseline.json"),
        `${JSON.stringify(regenerated, null, 2)}\n`,
      );
      return;
    }
    const baseline = JSON.parse(
      readFileSync(join(HERE, "coworker-definition-baseline.json"), "utf8"),
    ) as { findings: string[] };
    const baselineKeys = new Set(baseline.findings);

    const findings = checkDefinitionConformance(realSources());
    const currentKeys = new Set(findings.map(findingKey));

    const newFindings = findings.filter((f) => !baselineKeys.has(findingKey(f)));
    const staleBaseline = [...baselineKeys].filter((k) => !currentKeys.has(k));

    expect(
      newFindings,
      `New coworker definition conformance findings (complete the definition — see the checklist in docs/superpowers/specs/2026-07-07-coworker-lifecycle-standard-design.md — do not just extend the baseline):\n${newFindings
        .map((f) => `  [${f.checkId}] ${f.message}`)
        .join("\n")}`,
    ).toHaveLength(0);

    expect(
      staleBaseline,
      `Baseline entries no longer reproduce — the gaps were fixed. Remove them from coworker-definition-baseline.json so the ratchet only tightens:\n${staleBaseline
        .map((k) => `  ${k}`)
        .join("\n")}`,
    ).toHaveLength(0);
  });

  it("wildcard skill assignment reaches every roster coworker (docs-specialist typo fixed)", () => {
    expect(SKILL_WILDCARD_AGENT_IDS).not.toContain("docs-specialist");
    for (const seed of COWORKER_AGENT_SEEDS) {
      expect(SKILL_WILDCARD_AGENT_IDS).toContain(seed.agentId);
    }
    expect(SKILL_WILDCARD_AGENT_IDS).toContain("onboarding-coo");
  });

  it("assembles one definition per roster coworker with routes, floor, and grants joined", () => {
    const defs = assembleCoworkerDefinitions(realSources());
    expect(defs).toHaveLength(COWORKER_AGENT_SEEDS.length);
    const marketing = defs.find((d) => d.agentId === "marketing-specialist");
    expect(marketing?.grants).toContain("marketing_write");
    expect(marketing?.boundRoutes.length).toBeGreaterThan(0);
    expect(marketing?.modelFloor?.minimumTier).toBeTruthy();
    expect(marketing?.hasSelfTask).toBe(true);
  });

  it("uses the canonical coworker record route for registry-backed in-process coworkers", () => {
    const defs = assembleCoworkerDefinitions(realSources());
    const accessibility = defs.find(
      (d) => d.agentId === "ux-accessibility-agent",
    );

    expect(accessibility?.boundRoutes).toContain(
      "/platform/ai/agent/ux-accessibility-agent",
    );
  });

  it("does not require in-portal routes or model floors for external CLI runtimes", () => {
    const findings = checkDefinitionConformance(realSources());
    for (const agentId of [
      "external-claude-code",
      "external-codex",
      "external-grok",
    ]) {
      expect(
        findings.filter(
          (finding) =>
            finding.subject === agentId &&
            (finding.checkId === "LIFE-003" || finding.checkId === "LIFE-005"),
        ),
      ).toEqual([]);
    }
  });

  it("defines the Change Reviewer as an independent read-only coworker", () => {
    const defs = assembleCoworkerDefinitions(realSources());
    const reviewer = defs.find((d) => d.agentId === "change-reviewer");

    expect(reviewer).toBeDefined();
    expect(reviewer?.sensitivity).toBe("confidential");
    expect(reviewer?.boundRoutes.length).toBeGreaterThan(0);
    expect(reviewer?.modelFloor?.minimumTier).toBe("strong");
    expect(reviewer?.grants).toEqual(
      expect.arrayContaining([
        "file_read",
        "code_graph_read",
        "architecture_read",
        "spec_plan_read",
        "backlog_read",
        "registry_read",
      ]),
    );
    expect(reviewer?.grants).not.toEqual(
      expect.arrayContaining([
        "backlog_write",
        "build_plan_write",
        "sandbox_execute",
        "release_gate_create",
      ]),
    );
  });

  it("flags an incomplete new coworker on every missing axis", () => {
    const sources = realSources();
    const incomplete: CoworkerDefinitionSources = {
      ...sources,
      roster: [
        ...sources.roster,
        {
          agentId: "brand-new-specialist",
          slugId: "brand-new-specialist",
          name: "Brand New Specialist",
          sensitivity: "internal",
        },
      ],
    };
    const findings = checkDefinitionConformance(incomplete);
    const forNew = findings.filter((f) => f.subject.startsWith("brand-new-specialist"));
    const checks = forNew.map((f) => f.checkId).sort();
    expect(checks).toEqual(["LIFE-001", "LIFE-003", "LIFE-005", "LIFE-008"]);
  });

  it("flags dead grant keys on a new coworker", () => {
    const sources = realSources();
    const withDeadGrant: CoworkerDefinitionSources = {
      ...sources,
      grantsByAgent: {
        ...sources.grantsByAgent,
        "marketing-specialist": [
          ...(sources.grantsByAgent["marketing-specialist"] ?? []),
          "grant_no_tool_honors",
        ],
      },
    };
    const findings = checkDefinitionConformance(withDeadGrant);
    expect(
      findings.some(
        (f) => f.checkId === "LIFE-002" && f.subject === "marketing-specialist/grant_no_tool_honors",
      ),
    ).toBe(true);
  });
});
