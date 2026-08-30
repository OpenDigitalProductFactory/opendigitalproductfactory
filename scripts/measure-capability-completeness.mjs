#!/usr/bin/env node
// scripts/measure-capability-completeness.mjs
//
// Capability Completeness — MECHANICAL MEASURE, NOT (YET) A GATE.
//
// Design: docs/architecture/2026-08-20-assurance-operating-loop-and-capability-completeness.md
//
// A coworker capability is real only when SEVEN PLANES resolve — identity,
// corpus/WSID, governance/WWWD, shape, cadence, tools+skills, evidence. All
// seven are built platform-wide; nothing asserted they resolve TOGETHER, which
// is how `compliance-officer` became the only roster coworker unable to reach
// its own profession corpus and how 8 of 67 skills came to be assigned to
// identities that are not coworkers.
//
// ─── v2: THE FULL INVENTORY, AND GRADED SCORING ───────────────────────────
//
// v1 measured the 23 workforce-seed coworkers and scored each plane pass/fail.
// Both were wrong in the same direction — they flattered the platform.
//
// INVENTORY. There is no single agent namespace. There are three, and they are
// joined by two different keys:
//   * packages/db/data/agent_registry.json — 70 canonical AGT-* agents, each
//     with a status (active | defined | draft), an IT4IT value-stream binding,
//     delegates_to / escalates_to, and a config_profile.
//   * packages/db/src/workforce-seed.ts — 23 slug-handled roster coworkers.
//   * docs/professions/registry.json — 86 profession ROLES bound to families.
// The bridge is COWORKER_SLUG_TO_CANONICAL_AGENT_ID (agent-identity.ts), so
// `coo` and `coo-orchestrator` are ONE identity under two handles. Joining on
// handles alone over-counts; joining on the roster alone under-counts by 55.
// The true inventory is 78 distinct identities, and this scores all of them.
//
// SCORING. Pass/fail cannot distinguish "nothing exists" from "it exists but
// nothing can reach it" — and the second is the failure mode that produced
// almost every defect this measure was built to find. So each plane is graded
// on a four-level ladder:
//
//   0 ABSENT     nothing exists for this plane
//   1 DECLARED   asserted somewhere, but not reachable or not backed
//   2 REACHABLE  wired and usable, but unproven
//   3 PROVEN     exercised, evidenced, or reconciled across namespaces
//
// CEILINGS. Some planes CANNOT reach 3 today because the substrate does not
// exist — a skill cannot declare a cadence, no room-shape registry exists, and
// a passing AssuranceRun is runtime state this static scan cannot see. Scoring
// against an unreachable maximum would make every agent look permanently
// broken and would hide which gaps are actually closeable. So every plane
// carries a declared ceiling, and two scores are reported:
//   attainable — against what the substrate currently permits (is this agent
//                as good as it CAN be today?)
//   absolute   — against the design's full ladder (how far is the PLATFORM
//                from its own contract?)
// A high attainable score with a low absolute score is the honest signature of
// "this agent is done; the platform is not".
//
// WHY MEASURE BEFORE GATING: scripts/measure-doc-staleness-coverage.mjs set the
// precedent — measure the real corpus, then decide on gating from the numbers.
// This writes a report and EXITS 0. `--check` verifies the committed artifact
// is in sync; it asserts no threshold.
//
// WHY SOURCE PARSING, NOT IMPORTS: the registries span two packages behind `@/`
// aliases and `tsx` is absent from a source-only worktree. The coworker
// tool-grant audit already regex-parses these same forms (see the note in
// apps/web/lib/tak/agent-grants.ts). Zero dependencies, by the same rule.
//
// OUTPUTS (deterministic — no timestamps, so --check is meaningful):
//   apps/web/lib/coworker-lifecycle/capability-completeness.generated.json
//   docs/maintenance/capability-completeness.md
//
// Usage:
//   node scripts/measure-capability-completeness.mjs           # write artifacts
//   node scripts/measure-capability-completeness.mjs --check    # CI: in sync?
//   node scripts/measure-capability-completeness.mjs --json     # JSON to stdout

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = (...parts) => path.join(REPO_ROOT, ...parts);

const JSON_OUT = P("apps", "web", "lib", "coworker-lifecycle", "capability-completeness.generated.json");
const MD_OUT = P("docs", "maintenance", "capability-completeness.md");

const SCHEMA_VERSION = "capability-completeness.v2";

// ─────────────────────── the scoring contract ───────────────────────

/** The four-level ladder every plane is graded on. */
export const LEVELS = {
  0: { key: "absent", label: "Absent", meaning: "Nothing exists for this plane." },
  1: { key: "declared", label: "Declared", meaning: "Asserted somewhere, but not reachable or not backed." },
  2: { key: "reachable", label: "Reachable", meaning: "Wired and usable, but unproven." },
  3: { key: "proven", label: "Proven", meaning: "Exercised, evidenced, or reconciled across namespaces." },
};

/**
 * Per-plane contract. `ceiling` is the highest level currently ATTAINABLE given
 * the substrate that exists; `blocker` says what would raise it. `weight`
 * reflects consequence, not effort — an agent that cannot consult the kernel
 * before a consequential act is more dangerous than one with a thin corpus.
 */
export const PLANE_CONTRACT = {
  identity: {
    label: "Identity",
    asserts: "It is one reconciled identity, not a name in one registry.",
    weight: 1,
    ceiling: 3,
    blocker: null,
    criteria: {
      0: "Referenced somewhere (a skill target, a profession role) but present in no identity registry.",
      1: "Present in exactly one registry — canonical-only, or roster-only with no canonical mapping.",
      2: "Present and bridged across registries, but not marked active.",
      3: "Bridged AND registry status is active.",
    },
  },
  corpus: {
    label: "Corpus / WSID",
    asserts: "It can reach its profession's craft corpus before deciding.",
    weight: 1,
    ceiling: 3,
    blocker: null,
    criteria: {
      0: "Bound to no profession family.",
      1: "Bound to a family that has no corpus pages.",
      2: "Corpus pages exist, but evaluate_profession_decision is unreachable (missing grant).",
      3: "Corpus pages exist and the retrieval tool is reachable.",
    },
  },
  governance: {
    label: "Governance / WWWD",
    asserts: "It can consult the kernel, and has somewhere to escalate.",
    weight: 2,
    ceiling: 3,
    blocker: null,
    criteria: {
      0: "Holds no grants at all.",
      1: "Holds grants, but principle_decide is unreachable.",
      2: "principle_decide is reachable.",
      3: "Reachable AND a human supervisor or escalation target is declared.",
    },
  },
  shape: {
    label: "Shape",
    asserts: "Its work has declared stages and gates.",
    weight: 1,
    ceiling: 2,
    blocker: "The work-shape registry has landed (apps/web/lib/work-management/work-shapes.ts). Level 3 needs an observed running instance, which nothing records yet — the ceiling rises to 3 when instance evidence lands.",
    criteria: {
      0: "No declared work shape.",
      1: "A shape is named but has no stages or gates.",
      2: "Stages and gates are declared.",
      3: "Declared, and instances of the shape are running.",
    },
  },
  cadence: {
    label: "Cadence",
    asserts: "Something makes it run without being asked.",
    weight: 1,
    ceiling: 3,
    blocker: null,
    criteria: {
      0: "No recurring trigger — any Proactivity setting is a silent no-op.",
      1: "Named by a scheduled job, but owns no self-task of its own.",
      2: "Has a COWORKER_SELF_TASKS entry driven by its Proactivity setting.",
      3: "Self-task PLUS a cadence declared on the skill itself.",
    },
  },
  toolsAndSkills: {
    label: "Tools + Skills",
    asserts: "It has skills authored for it and tools it can actually call.",
    weight: 2,
    ceiling: 3,
    blocker: null,
    criteria: {
      0: "No grants and no skills.",
      1: "Grants or wildcard skills only — nothing authored for this agent.",
      2: "At least one directly-assigned skill and at least one reachable tool.",
      3: "As level 2, and every backingSkillId on its services resolves to a real skill.",
    },
  },
  evidence: {
    label: "Evidence",
    asserts: "Certification exercises a real domain act, not a generic probe.",
    weight: 1,
    ceiling: 2,
    blocker: "A passing AssuranceRun is runtime state a static scan cannot see. Ceiling rises to 3 when the measure reads the ledger.",
    criteria: {
      0: "Not in the certification set at all.",
      1: "Generic derivedReadProbe only — passes with zero domain capability.",
      2: "A curated golden journey exercising a real domain act.",
      3: "Curated journey with a recorded passing AssuranceRun.",
    },
  },
};

export const PLANES = Object.keys(PLANE_CONTRACT);

/** Identity classes. Expectations differ by class; none is excluded. */
export const IDENTITY_CLASSES = {
  "active-roster": "Active in the canonical registry and seeded onto the workforce roster.",
  "active-registry-only": "Active in the canonical registry but absent from the workforce roster.",
  "roster-only": "On the workforce roster but absent from the canonical agent registry.",
  "defined-roster": "Declared in the canonical registry (not active) and seeded onto the roster.",
  "declared-only": "Declared in the canonical registry and never seeded anywhere.",
};

// ─────────────────────────── source readers ───────────────────────────

function read(rel) {
  const full = P(rel);
  if (!fs.existsSync(full)) throw new Error(`Missing expected source file: ${rel}`);
  return fs.readFileSync(full, "utf8");
}

export function normalizeGeneratedPath(value) {
  return value.replaceAll("\\", "/");
}

/** Strip line comments so a commented-out example never parses as a real entry. */
export function stripLineComments(src) {
  return src.replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Extract a `NAME = { ... }` object-literal body by brace matching from the
 * first `{` after the identifier. Brace-matching (not a greedy regex) keeps a
 * nested array or object from truncating the block.
 */
export function objectLiteralBody(src, identifier) {
  const idx = src.indexOf(identifier);
  if (idx === -1) return null;
  const open = src.indexOf("{", idx);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/** Parse `key: ["a", "b"]` pairs (quoted or bare keys) from an object body. */
export function parseStringArrayMap(body) {
  const out = new Map();
  if (!body) return out;
  const re = /["']?([A-Za-z_][A-Za-z0-9_-]*)["']?\s*:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const values = [...m[2].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
    if (!out.has(m[1])) out.set(m[1], values);
  }
  return out;
}

/** Parse `"key": "value"` string pairs from an object body. */
export function parseStringMap(body) {
  const out = new Map();
  if (!body) return out;
  const re = /["']?([A-Za-z_][A-Za-z0-9_-]*)["']?\s*:\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(body)) !== null) if (!out.has(m[1])) out.set(m[1], m[2]);
  return out;
}

/** Parse the top-level keys of an object body whose values are arrays/objects. */
export function parseTopLevelKeys(body) {
  const keys = [];
  if (!body) return keys;
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
    else if (depth === 0 && (c === '"' || c === "'")) {
      const end = body.indexOf(c, i + 1);
      if (end === -1) break;
      const candidate = body.slice(i + 1, end);
      if (/^\s*:/.test(body.slice(end + 1)) && /^[a-z][a-z0-9-]*$/.test(candidate)) keys.push(candidate);
      i = end;
    }
  }
  return keys;
}

/** Minimal frontmatter reader for skill files — the subset actually in use. */
export function parseSkillFrontmatter(raw) {
  const m = raw.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const value = kv[2].trim();
    fm[kv[1]] = value.startsWith("[")
      ? [...value.matchAll(/["']?([A-Za-z0-9_*-]+)["']?/g)].map((x) => x[1]).filter(Boolean)
      : value.replace(/^["']|["']$/g, "");
  }
  return fm;
}

function walk(dir, filter, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, acc);
    else if (filter(full)) acc.push(full);
  }
  return acc;
}

/** One-way grant expansion, mirroring expandGrants() in agent-grants.ts. */
export function expandGrants(held, implications) {
  const out = new Set(held);
  for (const g of held) for (const implied of implications.get(g) ?? []) out.add(implied);
  return out;
}

export function canCall(tool, expanded, toolToGrants) {
  const required = toolToGrants.get(tool);
  if (!required) return { reachable: false, reason: `tool "${tool}" not in TOOL_TO_GRANTS` };
  const missing = required.filter((g) => !expanded.has(g));
  return missing.length === 0
    ? { reachable: true, requires: required }
    : { reachable: false, requires: required, missingGrants: missing };
}

// ─────────────────────────── load substrate ───────────────────────────

export function loadSubstrate() {
  const workforce = stripLineComments(read("packages/db/src/workforce-seed.ts"));
  const grantsSrc = stripLineComments(read("apps/web/lib/tak/agent-grants.ts"));
  const identitySrc = stripLineComments(read("packages/db/src/agent-identity.ts"));

  // ── Namespace 1: the canonical AGT-* agent registry.
  const registry = JSON.parse(read("packages/db/data/agent_registry.json")).agents ?? [];

  // ── Namespace 2: the workforce roster (slug handles).
  const roster = [];
  const rosterRe = /agentId:\s*"([a-z0-9-]+)"\s*,\s*\n\s*slugId:/g;
  let m;
  while ((m = rosterRe.exec(workforce)) !== null) roster.push(m[1]);

  const rosterNames = new Map();
  const nameRe = /agentId:\s*"([a-z0-9-]+)"[\s\S]{0,200}?name:\s*"([^"]+)"/g;
  while ((m = nameRe.exec(workforce)) !== null) if (!rosterNames.has(m[1])) rosterNames.set(m[1], m[2]);

  // ── The bridge between them. Without it `coo` and `coo-orchestrator` count twice.
  const slugToCanonical = parseStringMap(
    objectLiteralBody(identitySrc, "COWORKER_SLUG_TO_CANONICAL_AGENT_ID"),
  );

  // ── Grants. Keyed by slug for roster coworkers, by agent_name for registry agents.
  const grantsRegion = workforce.slice(
    workforce.indexOf("HARDCODED_COWORKER_GRANTS"),
    workforce.indexOf("ONBOARDING_AGENT_GRANTS"),
  );
  const heldGrants = parseStringArrayMap(objectLiteralBody(grantsRegion, "HARDCODED_COWORKER_GRANTS"));
  const onboardingGrants = parseStringArrayMap(
    objectLiteralBody(workforce.slice(workforce.indexOf("ONBOARDING_AGENT_GRANTS")), "ONBOARDING_AGENT_GRANTS"),
  );
  for (const [k, v] of onboardingGrants) if (!heldGrants.has(k)) heldGrants.set(k, v);
  // Registry-only agents are seeded from config_profile.tool_grants, not from
  // HARDCODED_COWORKER_GRANTS. Omitting this source made 53 agents look locked
  // out of WSID even though both the canonical registry and live
  // AgentToolGrant rows held registry_read. Roster coworkers remain governed
  // by the workforce seed below; this adds the other authoritative namespace.
  for (const agent of registry) {
    const grants = agent.config_profile?.tool_grants;
    if (Array.isArray(grants) && !heldGrants.has(agent.agent_name)) {
      heldGrants.set(agent.agent_name, grants);
    }
  }
  // Bootstrap-created agents are real runtime identities even though they are
  // not in the workforce-seed roster; a skill assigned to one does reach it.
  const onboardingAgents = new Set(onboardingGrants.keys());

  const grantImplications = parseStringArrayMap(objectLiteralBody(grantsSrc, "GRANT_IMPLICATIONS"));
  const toolToGrants = parseStringArrayMap(objectLiteralBody(grantsSrc, "TOOL_TO_GRANTS"));

  // ── Namespace 3: profession families and their corpora.
  const professions = JSON.parse(read("docs/professions/registry.json"));
  const professionOfRole = new Map();
  const corpusPages = new Map();
  for (const family of professions.families ?? []) {
    const key = family.professionKey;
    const wikiDir = P("docs", "professions", key, "wiki");
    corpusPages.set(key, fs.existsSync(wikiDir)
      ? fs.readdirSync(wikiDir).filter((f) => f.endsWith(".md")).length
      : 0);
    for (const role of family.roles ?? []) if (!professionOfRole.has(role)) professionOfRole.set(role, key);
  }

  // ── Skills, across BOTH namespaces. A scan that knows only one reports
  //    false unbacked anchors — the first run of this script did exactly that.
  const skills = [];
  for (const file of walk(P("skills"), (f) => f.endsWith(".skill.md"))) {
    const fm = parseSkillFrontmatter(fs.readFileSync(file, "utf8"));
    if (!fm) continue;
    skills.push({
      file: normalizeGeneratedPath(path.relative(REPO_ROOT, file)),
      name: fm.name ?? path.basename(file, ".skill.md"),
      assignTo: Array.isArray(fm.assignTo) ? fm.assignTo : [],
      taskType: fm.taskType ?? null,
      cadence: fm.cadence ?? null,
    });
  }
  const packSkillNames = new Set();
  const packDir = P("packages", "dpf-skill-pack", "skills");
  if (fs.existsSync(packDir)) {
    for (const entry of fs.readdirSync(packDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMd = path.join(packDir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;
      const fm = parseSkillFrontmatter(fs.readFileSync(skillMd, "utf8"));
      packSkillNames.add(fm?.name ?? entry.name);
      packSkillNames.add(entry.name);
    }
  }

  // ── Shape sources: the declared work-shape registry (TAK §8.11).
  const shapesSrc = stripLineComments(read("apps/web/lib/work-management/work-shapes.ts"));
  const shapeAgents = new Map();
  for (const m2 of shapesSrc.matchAll(/accountablePrincipalRef:\s*"agent:([a-z0-9-]+)"/g)) {
    const stagesDeclared = /stages:\s*\[/.test(shapesSrc);
    const gatesDeclared = /kind:\s*"governed-decision"/.test(shapesSrc);
    shapeAgents.set(m2[1], { stagesDeclared, gatesDeclared });
  }

  // ── Cadence sources.
  const selfTasksSrc = stripLineComments(read("apps/web/lib/operate/scheduled-jobs/coworker-self-tasks.ts"));
  const selfTaskAgents = new Set(parseTopLevelKeys(objectLiteralBody(selfTasksSrc, "COWORKER_SELF_TASKS")));
  const jobCatalog = read("apps/web/lib/operate/scheduled-jobs/catalog.ts");

  // ── Evidence: curated golden journeys.
  const journeysSrc = stripLineComments(read("apps/web/lib/coworker-lifecycle/golden-journeys.ts"));
  const curatedJourneyAgents = new Set(parseTopLevelKeys(objectLiteralBody(journeysSrc, "CURATED_JOURNEYS")));

  // ── Consequential-tool gate coverage.
  //
  // apps/web/lib/tak/decision-routing-governance-hook.ts enforces the rule the
  // operator actually wants: a consequential tool cannot be called unless
  // principle_decide was consulted first (a consult clears the gate for a
  // window). The mechanism is built, wired, and enforce-by-default. What
  // governs how much of the platform it covers is one hand-maintained set —
  // CONSEQUENTIAL_DECISION_TOOLS — and an undeclared tool is ordinary by
  // default. So the gate's REACH, not its existence, is the live risk, and it
  // is worth measuring on every run.
  const toolDefs = new Map();
  const packFiles = [
    ...walk(P("apps", "web", "lib", "mcp", "packs"), (f) => f.endsWith(".ts") && !f.includes(".test.")),
    P("apps", "web", "lib", "mcp-tools.ts"),
  ];
  for (const file of packFiles) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    const re = /name:\s*"([a-z0-9_]+)"([\s\S]{0,3000}?)(?=\n\s*\{\s*\n\s*name:\s*"|$)/g;
    let mm;
    while ((mm = re.exec(src)) !== null) {
      const se = /sideEffect:\s*(true|false)/.exec(mm[2]);
      const cq = /consequence:\s*"([a-z]+)"/.exec(mm[2]);
      if (se && !toolDefs.has(mm[1])) {
        toolDefs.set(mm[1], { sideEffect: se[1] === "true", consequence: cq ? cq[1] : null });
      }
    }
  }
  // The gated set mirrors deriveConsequentialToolNames() in
  // apps/web/lib/tak/consequential-tool-coverage.ts: the transitional SEED,
  // UNIONED with every side-effecting tool that DECLARES a consequence. Source
  // text, not runtime, so the number is reproducible in CI without a database.
  const gateSrc = read("apps/web/lib/tak/decision-routing-governance-hook.ts");
  const seedNames = (() => {
    const i = gateSrc.indexOf("export const CONSEQUENTIAL_DECISION_TOOLS");
    if (i === -1) return [];
    const open = gateSrc.indexOf("[", i);
    const close = gateSrc.indexOf("]", open);
    return open === -1 || close === -1
      ? []
      : [...gateSrc.slice(open, close).matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]);
  })();
  const consequentialTools = new Set(seedNames);
  for (const [name, def] of toolDefs) {
    if (def.sideEffect && def.consequence) consequentialTools.add(name);
  }
  // The gate can only REACH the derived set if the composition root installs
  // the resolver. If that call is ever dropped the gate silently falls back to
  // the seed, so coverage is reported as the seed rather than as the intent.
  const resolverInstalled = read("apps/web/lib/governance/register-tool-governance-hooks.ts")
    .includes("installConsequentialToolResolver(getConsequentialToolNames)");

  // ── Service catalog: provider agent -> declared backing skills.
  const catalogSrc = read("packages/db/src/coworker-service-catalog-seed.ts");
  const servicesByAgent = new Map();
  const allBackingSkillIds = new Set();
  const svcRe = /serviceSeed\(\s*"([^"]+)"\s*,\s*"([a-z0-9-]+)"\s*,\s*\{([\s\S]*?)\n\s*\}\)/g;
  while ((m = svcRe.exec(catalogSrc)) !== null) {
    const ids = [...m[3].matchAll(/backingSkillIds:\s*\[([^\]]*)\]/g)]
      .flatMap((x) => [...x[1].matchAll(/["']([^"']+)["']/g)].map((y) => y[1]));
    if (!servicesByAgent.has(m[2])) servicesByAgent.set(m[2], []);
    servicesByAgent.get(m[2]).push({ serviceKey: m[1], backingSkillIds: ids });
    for (const id of ids) allBackingSkillIds.add(id);
  }

  return {
    registry, roster, rosterNames, slugToCanonical, heldGrants, grantImplications,
    toolToGrants, professionOfRole, corpusPages, skills, packSkillNames,
    selfTaskAgents, jobCatalog, curatedJourneyAgents, servicesByAgent, allBackingSkillIds,
    shapeAgents,
    onboardingAgents, toolDefs, consequentialTools, resolverInstalled, seedNames,
  };
}

/**
 * Join the three namespaces into ONE inventory of distinct identities.
 * Bridge order matters: slug -> canonical AGT id first, then handle match.
 * Handle-join alone counts `coo` and `coo-orchestrator` as two agents.
 */
export function buildInventory(s) {
  const byId = new Map();
  const byName = new Map();
  for (const a of s.registry) {
    byId.set(a.agent_id, a);
    byName.set(a.agent_name, a);
  }

  const identities = new Map();
  for (const a of s.registry) {
    identities.set(a.agent_id, {
      key: a.agent_id,
      handles: new Set([a.agent_name]),
      registry: a,
      onRoster: false,
      rosterSlug: null,
    });
  }
  for (const slug of s.roster) {
    const canonical = s.slugToCanonical.get(slug) ?? (byName.has(slug) ? byName.get(slug).agent_id : null);
    if (canonical && identities.has(canonical)) {
      const ident = identities.get(canonical);
      ident.handles.add(slug);
      ident.onRoster = true;
      ident.rosterSlug = slug;
    } else {
      identities.set(slug, {
        key: slug,
        handles: new Set([slug]),
        registry: null,
        onRoster: true,
        rosterSlug: slug,
      });
    }
  }

  for (const ident of identities.values()) {
    const status = ident.registry?.status ?? null;
    ident.identityClass =
      status === null ? "roster-only"
        : status === "active" ? (ident.onRoster ? "active-roster" : "active-registry-only")
        : ident.onRoster ? "defined-roster"
        : "declared-only";
    ident.displayName =
      ident.registry?.displayName
      ?? (ident.rosterSlug ? s.rosterNames.get(ident.rosterSlug) : null)
      ?? ident.registry?.agent_name
      ?? ident.key;
  }
  return [...identities.values()];
}

// ─────────────────────────── the graded measure ───────────────────────────

/** Resolve a value across every handle an identity answers to. */
function firstHandle(ident, lookup) {
  for (const h of ident.handles) {
    const v = lookup(h);
    if (v !== undefined && v !== null) return { handle: h, value: v };
  }
  return null;
}

export function scoreIdentity(ident, s) {
  // A bridged roster identity is reseeded from HARDCODED_COWORKER_GRANTS, which
  // is authoritative for its live standing grants. Registry-only identities
  // instead use agent_registry.json config_profile.tool_grants.
  const grantHandles = ident.onRoster && ident.rosterSlug
    ? [ident.rosterSlug]
    : [...ident.handles];
  const grantHit = firstHandle(
    { handles: grantHandles },
    (h) => (s.heldGrants.has(h) ? s.heldGrants.get(h) : null),
  );
  const held = grantHit?.value ?? [];
  const expanded = expandGrants(held, s.grantImplications);

  // ── Plane 1: Identity ──────────────────────────────────────────────────
  const bridged = ident.registry !== null && ident.onRoster;
  const active = ident.registry?.status === "active";
  const identityLevel = bridged ? (active ? 3 : 2) : 1;
  const identity = {
    level: identityLevel,
    detail: bridged
      ? active
        ? "bridged across registries and active"
        : `bridged, but registry status is "${ident.registry.status}"`
      : ident.registry === null
        ? "on the workforce roster but absent from the canonical agent registry"
        : `in the canonical registry only (status "${ident.registry.status}"), never seeded onto the roster`,
    handles: [...ident.handles].sort(),
  };

  // ── Plane 2: Corpus / WSID ─────────────────────────────────────────────
  const profHit = firstHandle(ident, (h) => s.professionOfRole.get(h) ?? null);
  const professionKey = profHit?.value ?? null;
  const pages = professionKey ? (s.corpusPages.get(professionKey) ?? 0) : 0;
  const wsid = canCall("evaluate_profession_decision", expanded, s.toolToGrants);
  const corpusLevel = !professionKey ? 0 : pages === 0 ? 1 : wsid.reachable ? 3 : 2;
  const corpus = {
    level: corpusLevel,
    professionKey,
    corpusPages: pages,
    missingGrants: wsid.missingGrants ?? [],
    detail: !professionKey
      ? "bound to no profession family"
      : pages === 0
        ? `profession "${professionKey}" has no corpus pages`
        : wsid.reachable
          ? `${pages} corpus pages, reachable`
          : `corpus exists (${pages} pages) but evaluate_profession_decision is unreachable — missing: ${(wsid.missingGrants ?? []).join(", ") || "grants undeclared"}`,
  };

  // ── Plane 3: Governance / WWWD ─────────────────────────────────────────
  const wwmd = canCall("principle_decide", expanded, s.toolToGrants);
  const escalates = ident.registry?.escalates_to ?? ident.registry?.human_supervisor_id ?? null;
  const governanceLevel = held.length === 0 ? 0 : !wwmd.reachable ? 1 : escalates ? 3 : 2;
  // How much of what this agent can actually DO is gated by a kernel consult.
  // Deliberately reported alongside the ladder rather than folded into it: the
  // ladder measures whether the agent can consult, this measures whether the
  // platform makes it. Folding them would blame the agent for a platform gap.
  const reachableSideEffecting = [...(s.toolDefs ?? new Map()).entries()]
    .filter(([name, def]) => def.sideEffect && (s.toolToGrants.get(name) ?? []).every((g) => expanded.has(g)))
    .map(([name]) => name);
  const reachableGated = reachableSideEffecting.filter((n) => (s.consequentialTools ?? new Set()).has(n));

  const governance = {
    level: governanceLevel,
    missingGrants: wwmd.missingGrants ?? [],
    escalatesTo: escalates,
    reachableSideEffectingTools: reachableSideEffecting.length,
    reachableGatedTools: reachableGated.length,
    ungatedConsequenceNote:
      reachableSideEffecting.length > 0 && reachableGated.length === 0
        ? `every one of its ${reachableSideEffecting.length} reachable side-effecting tool(s) executes with no kernel consultation required`
        : null,
    detail: held.length === 0
      ? "holds no grants at all — no tool surface is authorised"
      : !wwmd.reachable
        ? `principle_decide unreachable — missing: ${(wwmd.missingGrants ?? []).join(", ")}`
        : escalates
          ? `principle_decide reachable; escalates to ${escalates}`
          : "principle_decide reachable, but no escalation target is declared",
  };

  // ── Plane 4: Shape ─────────────────────────────────────────────────────
  // A shape counts for an identity when the registry names it as accountable
  // for at least one stage. L2 = the shape declares stages AND at least one
  // advance that requires a governed decision rather than a status write.
  const shapeEntry = [...ident.handles].map((h) => s.shapeAgents?.get(h)).find(Boolean);
  const shape = shapeEntry
    ? {
        level: shapeEntry.stagesDeclared && shapeEntry.gatesDeclared ? 2 : 1,
        detail: shapeEntry.stagesDeclared && shapeEntry.gatesDeclared
          ? "accountable for a stage of a declared work shape with stages and governed-decision gates"
          : "named by a work shape that declares no stages or no gates",
      }
    : { level: 0, detail: "no declared work shape — nothing bounds what its standing work may do" };

  // ── Plane 5: Cadence ───────────────────────────────────────────────────
  const hasSelfTask = [...ident.handles].some((h) => s.selfTaskAgents.has(h));
  const namedInJob = [...ident.handles].some((h) => s.jobCatalog.includes(`"${h}"`));
  // L3 additionally requires a skill ASSIGNED TO THIS IDENTITY that declares
  // its own cadence — the coworker's own definition says when it runs, rather
  // than the schedule living only in a hand-written registry (TAK §8.11).
  const cadenceSkill = (s.skills ?? []).find(
    (sk) => sk.taskType === "recurring" && sk.cadence
      && sk.assignTo.some((t) => ident.handles.has(t) || t === "*"),
  );
  const cadenceLevel = hasSelfTask && cadenceSkill ? 3 : hasSelfTask ? 2 : namedInJob ? 1 : 0;
  const cadence = {
    level: cadenceLevel,
    detail: cadenceLevel === 3
      ? `self-task PLUS a cadence declared on skill "${cadenceSkill.name}" (${cadenceSkill.cadence})`
      : hasSelfTask
        ? "COWORKER_SELF_TASKS entry driven by its Proactivity setting"
        : namedInJob
          ? "named by a scheduled job, but owns no self-task"
          : "no recurring trigger — any Proactivity setting is a silent no-op",
  };

  // ── Plane 6: Tools + Skills ────────────────────────────────────────────
  const direct = s.skills.filter((sk) => sk.assignTo.some((t) => ident.handles.has(t)));
  const wildcard = s.skills.filter((sk) => sk.assignTo.includes("*"));
  const reachableTools = [...s.toolToGrants.entries()]
    .filter(([, req]) => req.every((g) => expanded.has(g))).length;
  const skillNames = new Set([...s.skills.map((sk) => sk.name), ...s.packSkillNames]);
  const services = [...ident.handles].flatMap((h) => s.servicesByAgent.get(h) ?? []);
  const unbacked = [...new Set(
    services.flatMap((svc) => svc.backingSkillIds).filter((id) => !skillNames.has(id)),
  )].sort();
  const toolsLevel =
    held.length === 0 && direct.length === 0 ? 0
      : direct.length === 0 || reachableTools === 0 ? 1
      : unbacked.length > 0 ? 2
      : 3;
  const toolsAndSkills = {
    level: toolsLevel,
    directSkills: direct.length,
    wildcardSkills: wildcard.length,
    reachableTools,
    heldGrants: held,
    services: services.length,
    unbackedSkillIds: unbacked,
    detail: held.length === 0 && direct.length === 0
      ? "no grants and no skills — it cannot act"
      : direct.length === 0
        ? `no skill authored for it (${wildcard.length} wildcard only), ${reachableTools} reachable tool(s)`
        : reachableTools === 0
          ? `${direct.length} skill(s) but no reachable tool`
          : unbacked.length > 0
            ? `${direct.length} skill(s), ${reachableTools} tool(s); ${unbacked.length} service backing skill(s) missing: ${unbacked.join(", ")}`
            : `${direct.length} skill(s), ${reachableTools} tool(s), all service backings resolve`,
  };

  // ── Plane 7: Evidence ──────────────────────────────────────────────────
  const curated = [...ident.handles].some((h) => s.curatedJourneyAgents.has(h));
  const evidenceLevel = !ident.onRoster ? 0 : curated ? 2 : 1;
  const evidence = {
    level: evidenceLevel,
    detail: !ident.onRoster
      ? "not on the roster, so the certification sweep never exercises it"
      : curated
        ? "curated golden journey exercising a domain act"
        : "derivedReadProbe only — passes certification with zero domain capability",
  };

  const planes = { identity, corpus, governance, shape, cadence, toolsAndSkills, evidence };

  let earned = 0, attainableMax = 0, absoluteMax = 0;
  for (const p of PLANES) {
    const { weight, ceiling } = PLANE_CONTRACT[p];
    const level = Math.min(planes[p].level, 3);
    planes[p].levelKey = LEVELS[level].key;
    planes[p].ceiling = ceiling;
    planes[p].atCeiling = level >= ceiling;
    earned += level * weight;
    attainableMax += ceiling * weight;
    absoluteMax += 3 * weight;
  }

  return {
    key: ident.key,
    displayName: ident.displayName,
    identityClass: ident.identityClass,
    handles: [...ident.handles].sort(),
    registryStatus: ident.registry?.status ?? null,
    valueStream: ident.registry?.value_stream ?? null,
    tier: ident.registry?.tier ?? null,
    score: {
      earned,
      attainableMax,
      absoluteMax,
      attainablePct: attainableMax === 0 ? 0 : Math.round((earned / attainableMax) * 100),
      absolutePct: Math.round((earned / absoluteMax) * 100),
    },
    planes,
    gaps: PLANES
      .filter((p) => planes[p].level < PLANE_CONTRACT[p].ceiling)
      .map((p) => ({ plane: p, level: planes[p].level, ceiling: PLANE_CONTRACT[p].ceiling, detail: planes[p].detail })),
    blockedPlanes: PLANES
      .filter((p) => PLANE_CONTRACT[p].ceiling < 3)
      .map((p) => ({ plane: p, ceiling: PLANE_CONTRACT[p].ceiling, blocker: PLANE_CONTRACT[p].blocker })),
  };
}

export function measure(s) {
  const inventory = buildInventory(s);
  const agents = inventory.map((ident) => scoreIdentity(ident, s))
    .sort((a, b) => a.score.attainablePct - b.score.attainablePct || a.key.localeCompare(b.key));

  // ── assignTo health ──────────────────────────────────────────────────
  //
  // A skill's assignTo is written VERBATIM into SkillAssignment.agentId
  // (seed-skills.ts), and the column has no relation to any registry, so the
  // write always succeeds. Whether it ever reaches a coworker is a separate
  // question with three distinct failure modes — collapsing them into one
  // "stranded" count hides which fix each one needs:
  //
  //   unresolved  the handle exists in NO namespace. Referential integrity.
  //   unseeded    it names a canonical agent that was declared and never
  //               seeded onto the roster. Nothing to reach at runtime.
  //   unbridged   it names a canonical agent that IS bridged to a roster slug,
  //               but the seeder writes the unbridged handle. The bridge exists
  //               in agent-identity.ts; the seeder simply does not consult it.
  //               This one is a pure rewrite — the coworker is right there.
  const handleToIdentity = new Map();
  for (const i of inventory) for (const h of i.handles) handleToIdentity.set(h, i);
  const rosterSlugs = new Set(s.roster);

  function classifyTarget(t) {
    if (t === "*") return { target: t, health: "reachable", via: "wildcard" };
    if (rosterSlugs.has(t)) return { target: t, health: "reachable", via: "roster slug" };
    if (s.onboardingAgents.has(t)) return { target: t, health: "reachable", via: "bootstrap agent" };
    const ident = handleToIdentity.get(t);
    if (!ident) return { target: t, health: "unresolved" };
    if (ident.rosterSlug) {
      return { target: t, health: "unbridged", rosterSlug: ident.rosterSlug, canonical: ident.key };
    }
    return { target: t, health: "unseeded", canonical: ident.key, status: ident.registry?.status ?? null };
  }

  const unresolved = new Map();
  const targetHealth = new Map();
  const stranded = [];
  for (const sk of s.skills) {
    const classified = sk.assignTo.map(classifyTarget);
    for (const c of classified) {
      if (!targetHealth.has(c.target)) targetHealth.set(c.target, { ...c, files: [] });
      targetHealth.get(c.target).files.push(sk.file);
      if (c.health === "unresolved") {
        if (!unresolved.has(c.target)) unresolved.set(c.target, []);
        unresolved.get(c.target).push(sk.file);
      }
    }
    if (classified.length > 0 && classified.every((c) => c.health !== "reachable")) {
      stranded.push({
        file: sk.file,
        name: sk.name,
        assignTo: sk.assignTo,
        health: classified.map((c) => ({ target: c.target, health: c.health, rosterSlug: c.rosterSlug ?? null, canonical: c.canonical ?? null })),
      });
    }
  }
  const assignToHealth = [...targetHealth.values()]
    .filter((t) => t.health !== "reachable")
    .map((t) => ({ ...t, files: t.files.sort() }))
    .sort((a, b) => a.target.localeCompare(b.target));
  const skillNames = new Set([...s.skills.map((sk) => sk.name), ...s.packSkillNames]);
  const unbackedSkillIds = [...s.allBackingSkillIds].filter((id) => !skillNames.has(id)).sort();

  const byClass = {};
  for (const cls of Object.keys(IDENTITY_CLASSES)) {
    const rows = agents.filter((a) => a.identityClass === cls);
    byClass[cls] = {
      count: rows.length,
      meaning: IDENTITY_CLASSES[cls],
      medianAttainablePct: rows.length === 0 ? null
        : rows.map((r) => r.score.attainablePct).sort((x, y) => x - y)[Math.floor(rows.length / 2)],
    };
  }

  const planeLevels = {};
  for (const p of PLANES) {
    const dist = { 0: 0, 1: 0, 2: 0, 3: 0 };
    for (const a of agents) dist[a.planes[p].level]++;
    planeLevels[p] = {
      label: PLANE_CONTRACT[p].label,
      weight: PLANE_CONTRACT[p].weight,
      ceiling: PLANE_CONTRACT[p].ceiling,
      blocker: PLANE_CONTRACT[p].blocker,
      distribution: dist,
      atCeiling: agents.filter((a) => a.planes[p].atCeiling).length,
    };
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    design: "docs/architecture/2026-08-20-assurance-operating-loop-and-capability-completeness.md",
    contract: { levels: LEVELS, planes: PLANE_CONTRACT, identityClasses: IDENTITY_CLASSES },
    summary: {
      agents: agents.length,
      sources: {
        canonicalRegistry: s.registry.length,
        workforceRoster: s.roster.length,
        professionRoles: s.professionOfRole.size,
        note: "Joined via COWORKER_SLUG_TO_CANONICAL_AGENT_ID; a handle-only join over-counts.",
      },
      byClass,
      atFullAttainable: agents.filter((a) => a.score.attainablePct === 100).length,
      medianAttainablePct: agents.length === 0 ? 0
        : agents.map((a) => a.score.attainablePct).sort((x, y) => x - y)[Math.floor(agents.length / 2)],
      medianAbsolutePct: agents.length === 0 ? 0
        : agents.map((a) => a.score.absolutePct).sort((x, y) => x - y)[Math.floor(agents.length / 2)],
      planeLevels,
      skills: {
        total: s.skills.length,
        stranded: stranded.length,
        cadenceCapable: s.skills.filter((sk) => sk.taskType === "recurring").length,
        unresolvedAssignTargets: [...unresolved.keys()].sort(),
        assignToHealth: {
          unresolved: assignToHealth.filter((t) => t.health === "unresolved").length,
          unseeded: assignToHealth.filter((t) => t.health === "unseeded").length,
          unbridged: assignToHealth.filter((t) => t.health === "unbridged").length,
        },
      },
      unbackedSkillIds,
      consequentialGate: (() => {
        const defs = [...(s.toolDefs ?? new Map()).entries()];
        const sideEffecting = defs.filter(([, d]) => d.sideEffect).map(([n]) => n);
        const classified = sideEffecting.filter((n) => (s.consequentialTools ?? new Set()).has(n));
        const byClass = { outward: 0, irreversible: 0, authority: 0 };
        for (const [name, d] of defs) {
          if (d.sideEffect && d.consequence && byClass[d.consequence] !== undefined) {
            byClass[d.consequence]++;
          }
          void name;
        }
        return {
          mechanism:
            "apps/web/lib/tak/decision-routing-governance-hook.ts — principle_decide must be consulted before a consequential tool; a consult clears the gate for CONSULT_WINDOW_MS. Enforce by default, fail-open.",
          derivation:
            "DERIVED from ToolDefinition.consequence (TAK §8.4.1), unioned with the transitional CONSEQUENTIAL_DECISION_TOOLS seed. See apps/web/lib/tak/consequential-tool-coverage.ts.",
          resolverInstalled: s.resolverInstalled === true,
          seedOnly: (s.seedNames ?? []).slice().sort(),
          byConsequenceClass: byClass,
          sideEffectingTools: sideEffecting.length,
          gateClassified: classified.length,
          ungated: sideEffecting.length - classified.length,
          coveragePct: sideEffecting.length === 0 ? 0 : Math.round((classified.length / sideEffecting.length) * 100),
          classifiedTools: classified.sort(),
          note: s.resolverInstalled === true
            ? "The gate is built, enforced, and its reach is derived from each tool's declared consequence. What remains ungated is every side-effecting tool that has declared NOTHING — deliberately still ordinary by default, because flipping that default moves the whole remainder behind the gate at once."
            : "REGRESSION: register-tool-governance-hooks.ts no longer installs the derived resolver, so the live gate has fallen back to the transitional seed regardless of what is declared.",
        };
      })(),
    },
    agents,
    orphans: {
      strandedSkills: stranded.sort((a, b) => a.file.localeCompare(b.file)),
      assignToHealth,
      unresolvedAssignTargets: [...unresolved.entries()]
        .map(([target, files]) => ({ target, files: files.sort() }))
        .sort((a, b) => a.target.localeCompare(b.target)),
      unbackedSkillIds,
    },
  };
}

// ─────────────────────────── rendering ───────────────────────────

export function renderMarkdown(r) {
  const L = [];
  const S = r.summary;
  L.push("---", 'title: "Capability Completeness — Measured"', "area: maintenance", "---", "");
  L.push("# Capability Completeness — Measured", "");
  L.push("<!-- GENERATED by scripts/measure-capability-completeness.mjs — do not edit by hand. -->", "");
  L.push(`Design: [\`${r.design}\`](../architecture/${path.basename(r.design)})`, "");
  L.push(
    "A capability is real only when all seven planes resolve. Each plane is graded",
    "on a four-level ladder rather than pass/fail, because the failure mode that",
    "produced almost every defect here is *declared but unreachable* — which a",
    "binary check cannot tell apart from *absent*.",
    "",
  );

  L.push("## The ladder", "", "| Level | Name | Means |", "|---|---|---|");
  for (const [n, lv] of Object.entries(r.contract.levels)) L.push(`| ${n} | ${lv.label} | ${lv.meaning} |`);
  L.push("");

  L.push(
    "**Two scores are reported.** *Attainable* measures an agent against what the",
    "substrate currently permits; *absolute* measures it against the full design.",
    "Where a plane's ceiling is below 3 the substrate itself is the blocker, so a",
    "high attainable score with a low absolute score reads as \"this agent is done;",
    "the platform is not\".",
    "",
  );

  L.push("## Inventory", "");
  L.push(`- Distinct agent identities measured: **${S.agents}**`);
  L.push(`  - canonical agent registry: ${S.sources.canonicalRegistry} · workforce roster: ${S.sources.workforceRoster} · profession roles: ${S.sources.professionRoles}`);
  L.push(`  - ${S.sources.note}`);
  L.push(`- At 100% of attainable: **${S.atFullAttainable}**`);
  L.push(`- Median attainable: **${S.medianAttainablePct}%** · median absolute: **${S.medianAbsolutePct}%**`);
  L.push(`- Skills: **${S.skills.total}** total, **${S.skills.stranded}** stranded, **${S.skills.cadenceCapable}** able to declare a cadence`);
  if (S.skills.unresolvedAssignTargets.length) {
    L.push(`- Unresolved \`assignTo\` targets: ${S.skills.unresolvedAssignTargets.map((t) => `\`${t}\``).join(", ")}`);
  }
  if (S.unbackedSkillIds.length) {
    L.push(`- Unbacked \`backingSkillIds\`: ${S.unbackedSkillIds.map((t) => `\`${t}\``).join(", ")}`);
  }
  L.push("");

  const cg = S.consequentialGate;
  if (cg) {
    L.push("## Consequential-tool gate coverage", "");
    L.push(
      "The rule autonomy depends on: a consequential tool cannot execute unless",
      "`principle_decide` was consulted first, so every key decision leaves a record.",
      "The mechanism is built, wired, and enforce-by-default.", "",
      `- Side-effecting tools: **${cg.sideEffectingTools}**`,
      `- Gate-classified: **${cg.gateClassified}** (${cg.classifiedTools.map((t) => `\`${t}\``).join(", ") || "none"})`,
      `- **Ungated: ${cg.ungated}** — ${cg.coveragePct}% coverage`,
      "",
      cg.note,
      "",
    );
  }

  L.push("## By identity class", "", "| Class | Count | Median attainable | Meaning |", "|---|---|---|---|");
  for (const [cls, v] of Object.entries(S.byClass)) {
    L.push(`| \`${cls}\` | ${v.count} | ${v.medianAttainablePct === null ? "—" : v.medianAttainablePct + "%"} | ${v.meaning} |`);
  }
  L.push("");

  L.push("## Plane levels across the inventory", "");
  L.push("| Plane | Weight | Ceiling | L0 | L1 | L2 | L3 | At ceiling |", "|---|---|---|---|---|---|---|---|");
  for (const [, v] of Object.entries(S.planeLevels)) {
    const d = v.distribution;
    L.push(`| ${v.label} | ${v.weight} | ${v.ceiling} | ${d[0]} | ${d[1]} | ${d[2]} | ${d[3]} | ${v.atCeiling}/${S.agents} |`);
  }
  L.push("");

  const blocked = Object.entries(S.planeLevels).filter(([, v]) => v.ceiling < 3);
  if (blocked.length) {
    L.push("### Planes the substrate currently caps", "");
    for (const [, v] of blocked) L.push(`- **${v.label}** — ceiling ${v.ceiling}. ${v.blocker}`);
    L.push("");
  }

  L.push("## Grading criteria", "");
  for (const p of Object.keys(r.contract.planes)) {
    const c = r.contract.planes[p];
    L.push(`### ${c.label}  ·  weight ${c.weight}  ·  ceiling ${c.ceiling}`, "", `_${c.asserts}_`, "");
    for (const [n, text] of Object.entries(c.criteria)) L.push(`- **${n}** — ${text}`);
    L.push("");
  }

  L.push("## Every agent", "", "| Agent | Class | Attain | Abs | Id | Corp | Gov | Shp | Cad | T+S | Ev |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const a of r.agents) {
    const lv = (p) => a.planes[p].level;
    L.push(
      `| \`${a.key}\` | ${a.identityClass} | ${a.score.attainablePct}% | ${a.score.absolutePct}% | ` +
      `${lv("identity")} | ${lv("corpus")} | ${lv("governance")} | ${lv("shape")} | ${lv("cadence")} | ${lv("toolsAndSkills")} | ${lv("evidence")} |`,
    );
  }
  L.push("");

  const worst = r.agents.filter((a) => a.gaps.length > 0).slice(0, 10);
  if (worst.length) {
    L.push("## Widest gaps — detail", "");
    for (const a of worst) {
      L.push(`### \`${a.key}\` — ${a.displayName} · ${a.identityClass} · ${a.score.attainablePct}% attainable`, "");
      for (const g of a.gaps) {
        L.push(`- **${r.contract.planes[g.plane].label}** (level ${g.level} of ${g.ceiling}) — ${g.detail}`);
      }
      L.push("");
    }
  }

  if (r.orphans.assignToHealth.length) {
    L.push("## assignTo health", "",
      "A skill's `assignTo` is written verbatim into `SkillAssignment.agentId`, a column",
      "with no relation to any registry, so the write always succeeds. Three distinct",
      "failure modes hide behind that, each needing a different fix:", "",
      "| Target | Health | Skills | What it needs |", "|---|---|---|---|");
    for (const t of r.orphans.assignToHealth) {
      const fix =
        t.health === "unbridged"
          ? `rewrite to the roster slug \`${t.rosterSlug}\` — the bridge already exists in agent-identity.ts, the seeder just does not consult it`
          : t.health === "unseeded"
            ? `names canonical \`${t.canonical}\` (status ${t.status ?? "unknown"}), declared but never seeded — seed it, or repoint the skill`
            : "in no namespace at all — decide whether this identity should exist";
      L.push(`| \`${t.target}\` | ${t.health} | ${t.files.length} | ${fix} |`);
    }
    L.push("");
  }

  if (r.orphans.strandedSkills.length) {
    L.push("## Stranded skills", "",
      "Assigned to an identity in no namespace this inventory knows, so the assignment reaches nobody.",
      "`SkillAssignment.agentId` has no relation to any registry, so the write always succeeds.", "",
      "| Skill | assignTo | File |", "|---|---|---|");
    for (const sk of r.orphans.strandedSkills) {
      L.push(`| \`${sk.name}\` | ${sk.assignTo.map((t) => `\`${t}\``).join(", ")} | \`${sk.file}\` |`);
    }
    L.push("");
  }
  return L.join("\n") + "\n";
}

// ─────────────────────────── main ───────────────────────────

function main() {
  const args = new Set(process.argv.slice(2));
  const report = measure(loadSubstrate());
  const json = JSON.stringify(report, null, 2) + "\n";
  const md = renderMarkdown(report);

  if (args.has("--json")) {
    process.stdout.write(json);
    return;
  }

  if (args.has("--check")) {
    const drift = [];
    for (const [file, want] of [[JSON_OUT, json], [MD_OUT, md]]) {
      const have = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      if (have !== want) drift.push(normalizeGeneratedPath(path.relative(REPO_ROOT, file)));
    }
    if (drift.length) {
      console.error("Capability-completeness artifacts are out of sync:");
      for (const f of drift) console.error(`  - ${f}`);
      console.error("\nRegenerate with: node scripts/measure-capability-completeness.mjs");
      process.exit(1);
    }
    console.log("Capability-completeness artifacts are in sync.");
    return;
  }

  fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
  fs.mkdirSync(path.dirname(MD_OUT), { recursive: true });
  fs.writeFileSync(JSON_OUT, json);
  fs.writeFileSync(MD_OUT, md);

  const S = report.summary;
  console.log(`Capability completeness — ${S.agents} distinct agent identities`);
  console.log(`  (registry ${S.sources.canonicalRegistry} + roster ${S.sources.workforceRoster}, joined)`);
  console.log(`  at 100% of attainable: ${S.atFullAttainable}`);
  console.log(`  median attainable ${S.medianAttainablePct}% · median absolute ${S.medianAbsolutePct}%`);
  console.log("  class breakdown:");
  for (const [cls, v] of Object.entries(S.byClass)) {
    console.log(`    ${cls.padEnd(24)} ${String(v.count).padStart(3)}  median ${v.medianAttainablePct ?? "—"}%`);
  }
  console.log("  plane levels (L0/L1/L2/L3, ceiling):");
  for (const [, v] of Object.entries(S.planeLevels)) {
    const d = v.distribution;
    console.log(`    ${v.label.padEnd(20)} ${d[0]}/${d[1]}/${d[2]}/${d[3]}   ceiling ${v.ceiling}`);
  }
  console.log(`  skills: ${S.skills.stranded}/${S.skills.total} stranded · ${S.skills.cadenceCapable} can declare a cadence`);
  console.log(`\nWrote ${normalizeGeneratedPath(path.relative(REPO_ROOT, JSON_OUT))}`);
  console.log(`Wrote ${normalizeGeneratedPath(path.relative(REPO_ROOT, MD_OUT))}`);
}

if (process.argv[1]?.endsWith("measure-capability-completeness.mjs")) {
  main();
}
