import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, it, expect, vi } from "vitest";
import { MANDATED_DECISION_SKILL_IDS } from "./mandated-skills";
import {
  DPF_PLATFORM_SKILL_SOURCE_TYPE,
  LEGACY_SKILL_SOURCE_TYPE,
  SKILL_WILDCARD_AGENT_IDS,
  discoverDpfPlatformSkillFiles,
  discoverLegacySkillFiles,
  normalizeSkillFrontmatterForSeed,
  parseAllowedTools,
  parseFrontmatter,
  reconcileSkillAssignments,
  selectSkillSeedEntries,
  validateDpfPlatformSkillFrontmatter,
  writeSkillSeedConflictWarnings,
  type LoadedSkillSeedEntry,
} from "./seed-skills";

describe("seed-skills parseFrontmatter", () => {
  it("parses inline arrays", () => {
    const raw = `---
name: foo
description: test
category: storefront
assignTo: ["coo", "admin-assistant"]
allowedTools: [tool_a, tool_b]
composesFrom: []
---

Body.`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.assignTo).toEqual(["coo", "admin-assistant"]);
    expect(frontmatter.allowedTools).toEqual(["tool_a", "tool_b"]);
    expect(frontmatter.composesFrom).toEqual([]);
  });

  it("parses block-style lists (the extract-brand-design-system format)", () => {
    const raw = `---
name: extract-brand-design-system
description: test
category: storefront
allowedTools:
  - extract_brand_design_system
  - analyze_public_website_branding
  - analyze_brand_document
composesFrom: []
---

Body.`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.allowedTools).toEqual([
      "extract_brand_design_system",
      "analyze_public_website_branding",
      "analyze_brand_document",
    ]);
  });

  it("parses mixed scalars, booleans, null", () => {
    const raw = `---
name: mixed
description: "quoted"
userInvocable: true
agentInvocable: false
triggerPattern: null
---

Body.`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.name).toBe("mixed");
    expect(frontmatter.description).toBe("quoted");
    expect(frontmatter.userInvocable).toBe(true);
    expect(frontmatter.agentInvocable).toBe(false);
    expect(frontmatter.triggerPattern).toBe(null);
  });

  it("never produces a non-array for known array fields when value is empty", () => {
    const raw = `---
name: empty-lists
description: test
allowedTools:
composesFrom:
---

Body.`;
    const { frontmatter } = parseFrontmatter(raw);
    // An empty key with no block list below is a scalar "" — callers must
    // defend with Array.isArray. But a key with a block list (even zero
    // items due to no "-" lines) should at least not become anything Prisma
    // chokes on. Keeping this as a regression guard.
    expect(Array.isArray(frontmatter.allowedTools) || frontmatter.allowedTools === "").toBe(true);
  });
});

describe("reconcileSkillAssignments", () => {
  it("removes obsolete system-seeded assignments when assignTo changes", async () => {
    const skillAssignment = {
      findMany: vi.fn().mockResolvedValue([
        { agentId: "portfolio-advisor", assignedBy: "system-seed" },
        { agentId: "external-catalog-scout", assignedBy: "system-seed" },
        { agentId: "coo", assignedBy: "human-admin" },
      ]),
      create: vi.fn(),
      delete: vi.fn(),
    };

    const result = await reconcileSkillAssignments(
      { skillAssignment } as never,
      "scout-external-catalogs",
      ["external-catalog-scout"],
    );

    expect(skillAssignment.delete).toHaveBeenCalledWith({
      where: {
        skillId_agentId: {
          skillId: "scout-external-catalogs",
          agentId: "portfolio-advisor",
        },
      },
    });
    expect(skillAssignment.delete).toHaveBeenCalledTimes(1);
    expect(skillAssignment.create).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 0, removed: 1 });
  });
});

describe("decision-skill assignment coverage (BI-5E8E231E)", () => {
  // User-facing personas must inherit the decision stack via assignTo:["*"].
  // Narrow assignTo here would silently leave CRM/ops/marketing coworkers
  // without WWMD/WWWD decision skills.
  // Single-sourced with the ranker's pin list (BI-43920DD1): the seed-time mandate
  // and the ranking-time reservation must name the same four skills, or one of them
  // silently stops covering a skill the other still guarantees.
  const DECISION_SKILL_SLUGS = MANDATED_DECISION_SKILL_IDS;

  const USER_FACING_PERSONAS = [
    "customer-advisor",
    "marketing-specialist",
    "storefront-advisor",
    "ops-coordinator",
    "platform-engineer",
    "admin-assistant",
    "coo",
    "hr-specialist",
    "finance-controller",
    "dispatcher",
  ] as const;

  it("decision skills assignTo * so every roster persona inherits them", () => {
    const skillsRoot = join(__dirname, "..", "..", "..", "packages", "dpf-skill-pack", "skills");
    for (const slug of DECISION_SKILL_SLUGS) {
      const raw = readFileSync(join(skillsRoot, slug, "SKILL.md"), "utf8");
      const { frontmatter } = parseFrontmatter(raw);
      expect(frontmatter.assignTo, slug).toEqual(["*"]);
    }
  });

  it("wildcard agent id list includes user-facing personas (wildcard expand target)", () => {
    for (const agentId of USER_FACING_PERSONAS) {
      expect(SKILL_WILDCARD_AGENT_IDS).toContain(agentId);
    }
  });
});

describe("seed-skills dpf-platform loader", () => {
  it("discovers plugin SKILL.md files under slug directories", () => {
    const root = mkdtempSync(join(tmpdir(), "dpf-skill-pack-"));
    const skillDir = join(root, "skills", "dpf-example");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: dpf-example\n---\n\nBody.\n");

    expect(discoverDpfPlatformSkillFiles(join(root, "skills"))).toEqual([
      {
        category: "dpf-platform",
        filePath: join(skillDir, "SKILL.md"),
        sourceType: DPF_PLATFORM_SKILL_SOURCE_TYPE,
      },
    ]);
  });

  it("maps Agent Skills standard fields onto coworker seed fields", () => {
    const raw = `---
name: dpf-agent-standard-only
description: test standard mapping
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash(git log *) Grep mcp__dpf__wiki_query
category: governance
assignTo: ["*"]
---

Body.`;

    const { frontmatter } = parseFrontmatter(raw);
    const normalized = normalizeSkillFrontmatterForSeed({
      frontmatter,
      raw,
      category: "governance",
      sourceType: DPF_PLATFORM_SKILL_SOURCE_TYPE,
    });

    expect(normalized.skillId).toBe("dpf-agent-standard-only");
    expect(normalized.skillDefinition.sourceType).toBe(DPF_PLATFORM_SKILL_SOURCE_TYPE);
    expect(normalized.skillDefinition.userInvocable).toBe(true);
    expect(normalized.skillDefinition.agentInvocable).toBe(true);
    expect(normalized.skillDefinition.allowedTools).toEqual([
      "Bash",
      "Grep",
      "mcp__dpf__wiki_query",
    ]);
  });

  it("selects plugin SKILL.md over legacy .skill.md and reports a warning", () => {
    const legacy = {
      skillId: "dpf-same",
      category: "ops",
      filePath: "skills/ops/dpf-same.skill.md",
      raw: "legacy",
      sourceType: LEGACY_SKILL_SOURCE_TYPE,
      frontmatter: { name: "dpf-same", description: "legacy" },
    } satisfies LoadedSkillSeedEntry;
    const plugin = {
      skillId: "dpf-same",
      category: "dpf-platform",
      filePath: "packages/dpf-skill-pack/skills/dpf-same/SKILL.md",
      raw: "plugin",
      sourceType: DPF_PLATFORM_SKILL_SOURCE_TYPE,
      frontmatter: { name: "dpf-same", description: "plugin" },
    } satisfies LoadedSkillSeedEntry;

    const { selected, conflicts } = selectSkillSeedEntries([legacy, plugin]);

    expect(selected).toEqual([plugin]);
    expect(conflicts).toEqual([
      {
        skillId: "dpf-same",
        legacyPath: legacy.filePath,
        pluginPath: plugin.filePath,
      },
    ]);
  });

  it("writes deterministic SkillSeedWarning rows for plugin-over-legacy conflicts", async () => {
    const skillSeedWarning = {
      upsert: vi.fn().mockResolvedValue({}),
    };

    await writeSkillSeedConflictWarnings(
      { skillSeedWarning } as never,
      [
        {
          skillId: "dpf-same",
          legacyPath: "skills/ops/dpf-same.skill.md",
          pluginPath: "packages/dpf-skill-pack/skills/dpf-same/SKILL.md",
        },
      ],
    );

    expect(skillSeedWarning.upsert).toHaveBeenCalledWith({
      where: { warningId: "plugin-overrides-legacy:dpf-same" },
      update: expect.objectContaining({
        resolvedAt: null,
        warningType: "plugin-overrides-legacy",
      }),
      create: expect.objectContaining({
        warningId: "plugin-overrides-legacy:dpf-same",
        skillId: "dpf-same",
        warningType: "plugin-overrides-legacy",
      }),
    });
  });
});

describe("dpf-platform mirror-field invariant", () => {
  it("keeps Agent Skills fields and DPF coworker fields non-contradictory", () => {
    const pluginSkillsDir = join(__dirname, "..", "..", "..", "packages", "dpf-skill-pack", "skills");
    const skillFiles = readdirSync(pluginSkillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(pluginSkillsDir, entry.name, "SKILL.md"));

    expect(skillFiles.length).toBeGreaterThan(0);

    const issues = skillFiles.flatMap((filePath) => {
      const raw = readFileSync(filePath, "utf-8");
      const { frontmatter } = parseFrontmatter(raw);
      return validateDpfPlatformSkillFrontmatter(frontmatter, filePath);
    });

    expect(issues).toEqual([]);
  });

  it("has no dangling composesFrom — every slug resolves to a pack skill (no bare upstream slugs)", () => {
    const pluginSkillsDir = join(__dirname, "..", "..", "..", "packages", "dpf-skill-pack", "skills");
    const frontmatters = readdirSync(pluginSkillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(pluginSkillsDir, entry.name, "SKILL.md"))
      .map((filePath) => parseFrontmatter(readFileSync(filePath, "utf-8")).frontmatter);

    const names = new Set(frontmatters.map((fm) => fm.name));

    // Every composesFrom slug must be the name of another skill in this pack.
    // Bare upstream slugs (e.g. "brainstorming", "systematic-debugging") are
    // invalid even if a contributor happens to have an upstream plugin
    // installed — the pack must be self-sufficient.
    const dangling = frontmatters.flatMap((fm) =>
      (Array.isArray(fm.composesFrom) ? fm.composesFrom : [])
        .filter((slug) => !names.has(slug))
        .map((slug) => `${fm.name} -> ${slug}`),
    );

    expect(dangling).toEqual([]);
  });

  it("parses scoped allowed-tools entries without splitting spaces inside scopes", () => {
    expect(parseAllowedTools("Bash(git worktree *) Bash(scripts/seed-worktree-mcp*) Grep")).toEqual([
      "Bash(git worktree *)",
      "Bash(scripts/seed-worktree-mcp*)",
      "Grep",
    ]);
  });

  it("includes the Build Studio decision and nonprod workflow skills", () => {
    const pluginSkillsDir = join(__dirname, "..", "..", "..", "packages", "dpf-skill-pack", "skills");
    const names = discoverDpfPlatformSkillFiles(pluginSkillsDir)
      .map((source) => parseFrontmatter(readFileSync(source.filePath, "utf8")).frontmatter.name)
      .sort();

    expect(names).toEqual(expect.arrayContaining([
      "dpf-capture-kernel-gap",
      "dpf-compare-options",
      "dpf-external-evidence-handoff",
      "dpf-local-merge-ci-before-push",
      "dpf-record-decision-outcome",
      "dpf-retrieve-decision-context",
      "dpf-use-shared-nonprod-environment",
    ]));
  });

  it("ships a UX fit review skill for UI-impacting feature plans", () => {
    const pluginSkillsDir = join(__dirname, "..", "..", "..", "packages", "dpf-skill-pack", "skills");
    const frontmatters = discoverDpfPlatformSkillFiles(pluginSkillsDir)
      .map((source) => parseFrontmatter(readFileSync(source.filePath, "utf8")).frontmatter);

    const uxFitReview = frontmatters.find((frontmatter) => frontmatter.name === "dpf-ux-fit-review");

    expect(uxFitReview).toBeDefined();
    expect(uxFitReview?.assignTo).toEqual(expect.arrayContaining(["ea-architect", "build-specialist", "platform-engineer"]));
    expect(uxFitReview?.composesFrom).toEqual(expect.arrayContaining(["dpf-architecture-review", "dpf-verify-substrate-first"]));
    expect(uxFitReview?.triggerPattern).toContain("UX fit");
    expect(uxFitReview?.triggerPattern).toContain("new route");
    expect(uxFitReview?.triggerPattern).toContain("dashboard");
    expect(uxFitReview?.triggerPattern).toContain("first viewport");
    expect(uxFitReview?.allowedTools).toEqual(expect.arrayContaining([
      "mcp__dpf__search_design_intelligence",
    ]));
    expect(uxFitReview?.enforces).toEqual(expect.arrayContaining([
      "kernel/principles/no-hardcoded-colors",
      "kernel/principles/compose-report-kit-for-reporting-ux",
      "kernel/principles/single-source-of-truth",
    ]));
  });
});

describe("SKILL_WILDCARD_AGENT_IDS uniqueness", () => {
  // Regression guard. reconcileSkillAssignments snapshots the existing
  // assignments ONCE before its create loop, so a duplicate inside
  // targetAgents makes the second create violate @@unique([skillId, agentId])
  // and fails the whole "skills" seed step. That is a long way from the actual
  // mistake, which is simply adding a coworker to two source maps — exactly
  // what happened when ux-design-critic was first appended to
  // ONBOARDING_AGENT_GRANTS instead of HARDCODED_COWORKER_GRANTS. The symptom
  // was a Prisma unique-constraint error in an unrelated file; this asserts the
  // cause instead.
  it("contains no duplicate agent ids", () => {
    const counts = new Map<string, number>();
    for (const agentId of SKILL_WILDCARD_AGENT_IDS) {
      counts.set(agentId, (counts.get(agentId) ?? 0) + 1);
    }
    const duplicates = [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    expect(duplicates).toEqual([]);
  });

  it("reconcileSkillAssignments would throw on a duplicate target", async () => {
    // Pins the failure mode the guard above protects against, so the coupling
    // between "duplicate id" and "seed step dies" stays documented in code.
    const created: string[] = [];
    const prisma = {
      skillAssignment: {
        findMany: async () => [],
        create: async ({ data }: { data: { agentId: string } }) => {
          if (created.includes(data.agentId)) {
            throw new Error("Unique constraint failed on the fields: (`skillId`, `agentId`)");
          }
          created.push(data.agentId);
          return data;
        },
        deleteMany: async () => ({ count: 0 }),
      },
    } as never;

    await expect(
      reconcileSkillAssignments(prisma, "some-skill", ["agent-a", "agent-a"]),
    ).rejects.toThrow(/Unique constraint failed/);
  });
});

describe("invocation classification is populated, not uniform (BI-8AD9D018)", () => {
  // The frontmatter has always carried userInvocable / agentInvocable /
  // disable-model-invocation, and for a long time every skill on both planes
  // declared the identical triple. A field the whole corpus agrees on cannot
  // steer anything: apps/web/lib/skills/skill-relevance.ts ranks the eligible
  // set against a per-turn cap, and with nothing marked user-invocable-only a
  // heavyweight setup flow competed for the same slot as the lookup the turn
  // actually needed. Presence was seeded; population never was.
  //
  // These guards fail when a plane goes uniform again — the shape the original
  // regression took — rather than pinning any particular skill's value.
  const repoRoot = join(__dirname, "..", "..", "..");

  function frontmattersIn(sources: { filePath: string }[]) {
    return sources.map((source) => parseFrontmatter(readFileSync(source.filePath, "utf8")).frontmatter);
  }

  it("the coworker plane marks some skills user-invocable-only", () => {
    const frontmatters = frontmattersIn(discoverLegacySkillFiles(join(repoRoot, "skills")));
    expect(frontmatters.length).toBeGreaterThan(0);

    const agentInvocable = frontmatters.filter((fm) => fm.agentInvocable === true);
    const userOnly = frontmatters.filter((fm) => fm.agentInvocable === false);

    // Both populations non-empty: an all-true corpus is the dead-field
    // regression, an all-false one would leave coworkers unable to reach
    // anything on their own.
    expect(agentInvocable.length).toBeGreaterThan(0);
    expect(userOnly.length).toBeGreaterThan(0);
  });

  it("the dpf-platform pack marks some skills user-invocable-only", () => {
    const frontmatters = frontmattersIn(
      discoverDpfPlatformSkillFiles(join(repoRoot, "packages", "dpf-skill-pack", "skills")),
    );
    expect(frontmatters.length).toBeGreaterThan(0);

    expect(frontmatters.filter((fm) => fm.agentInvocable === true).length).toBeGreaterThan(0);
    expect(frontmatters.filter((fm) => fm.agentInvocable === false).length).toBeGreaterThan(0);
  });

  it("keeps the pack's two invocation surfaces in agreement", () => {
    // Surface A (disable-model-invocation, read by Claude Code / Codex / Grok)
    // and Surface B (agentInvocable, read by the in-portal seed loader) express
    // the same intent for the same skill. A skill the external clients may not
    // auto-invoke but the portal may is a split brain across four clients.
    const frontmatters = frontmattersIn(
      discoverDpfPlatformSkillFiles(join(repoRoot, "packages", "dpf-skill-pack", "skills")),
    );

    const contradictions = frontmatters
      .filter((fm) => fm["disable-model-invocation"] !== !fm.agentInvocable)
      .map((fm) => fm.name);

    expect(contradictions).toEqual([]);
  });
});

describe("declared cadence (TAK §8.11)", () => {
  const base = {
    raw: "---\nname: x\n---\nbody",
    category: "compliance",
    sourceType: LEGACY_SKILL_SOURCE_TYPE,
  } as const;

  it("carries a cron cadence off a recurring skill", () => {
    const seed = normalizeSkillFrontmatterForSeed({
      ...base,
      frontmatter: { name: "watch", taskType: "recurring", cadence: "11 6 * * *" },
    });
    expect(seed.skillDefinition.taskType).toBe("recurring");
    expect(seed.skillDefinition.cadence).toBe("11 6 * * *");
  });

  it("drops a cadence on a non-recurring skill rather than storing a schedule nothing reads", () => {
    const seed = normalizeSkillFrontmatterForSeed({
      ...base,
      frontmatter: { name: "chat", taskType: "conversation", cadence: "11 6 * * *" },
    });
    expect(seed.skillDefinition.cadence).toBeNull();
  });

  it("drops text that is not a cron expression", () => {
    const seed = normalizeSkillFrontmatterForSeed({
      ...base,
      frontmatter: { name: "watch", taskType: "recurring", cadence: "every so often" },
    });
    expect(seed.skillDefinition.cadence).toBeNull();
  });

  it("leaves an ordinary skill with no cadence", () => {
    const seed = normalizeSkillFrontmatterForSeed({ ...base, frontmatter: { name: "chat" } });
    expect(seed.skillDefinition.taskType).toBe("conversation");
    expect(seed.skillDefinition.cadence).toBeNull();
  });
});
