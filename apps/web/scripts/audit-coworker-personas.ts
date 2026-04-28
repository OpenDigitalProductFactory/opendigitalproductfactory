/**
 * Coworker persona audit
 * (docs/superpowers/specs/2026-04-27-coworker-persona-audit-design.md).
 *
 * Walks every entry in packages/db/data/agent_registry.json and every persona
 * file under prompts/route-persona/ and prompts/specialist/, then runs the
 * spec's §4.2 invariants. Static — no DB. Read-only — no edits.
 *
 * Usage (local):
 *   pnpm --filter web exec tsx scripts/audit-coworker-personas.ts
 *
 * Usage (CI): wired into .github/workflows/audit-coworker-personas.yml
 *
 * Output: JSON report on stdout. Exit code 0 if no findings, 1 if any.
 *   --baseline <path>  compare against a prior report; exit 1 only if NEW
 *                      findings appeared (existing findings are tolerated as
 *                      already-tracked backfill items).
 *   --json-out <path>  write the structured report to a file in addition to
 *                      stdout.
 *
 * Why this script exists
 * ----------------------
 * 53 agents in the registry, 21 persona files on disk. The mismatch is
 * invisible without an audit, and the existing 21 personas have drifted from
 * the registry in fields the prompt-loader does not check (tool lists, value
 * stream, delegates_to). This script promotes "every coworker has a coherent
 * job description" from intention to a CI gate.
 */

import { readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

type Severity = "error" | "warn";

interface Finding {
  invariantId: string;
  severity: Severity;
  agentId: string | null;
  file: string | null;
  summary: string;
  detail: string;
}

interface Report {
  generatedAt: string;
  spec: string;
  invariantsChecked: number;
  errorCount: number;
  warnCount: number;
  findings: Finding[];
}

const findings: Finding[] = [];

function record(
  invariantId: string,
  severity: Severity,
  agentId: string | null,
  file: string | null,
  summary: string,
  detail: string,
): void {
  findings.push({ invariantId, severity, agentId, file, summary, detail });
}

// ─── Repo root resolution ──────────────────────────────────────────────────

function repoRoot(): string {
  let dir = process.cwd();
  while (dir !== "/" && dir !== resolve(dir, "..")) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = resolve(dir, "..");
  }
  return process.cwd();
}

const ROOT = repoRoot();

// ─── Frontmatter / section parser ──────────────────────────────────────────
//
// Personas are markdown with YAML frontmatter delimited by `---` lines.
// We avoid a YAML dependency: the frontmatter shape we care about is flat
// scalars and short flow-style lists (`[a, b, c]`). Anything more exotic in
// existing files will surface as a parse failure and become a finding.

interface Persona {
  filePath: string;          // absolute
  relPath: string;           // repo-relative, forward slashes
  category: "route-persona" | "specialist";
  slug: string;              // filename without .prompt.md
  frontmatter: Record<string, string | string[]>;
  body: string;              // markdown after second `---`
  composedBody: string;      // body with composesFrom resolved
}

function parseFrontmatter(text: string, relPath: string): { fm: Record<string, string | string[]>; body: string } | null {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return null;
  }
  const end = text.indexOf("\n---", 4);
  if (end < 0) return null;
  const yaml = text.slice(4, end).replace(/\r\n/g, "\n");
  const after = text.slice(end + 4);
  const body = after.startsWith("\n") ? after.slice(1) : after.startsWith("\r\n") ? after.slice(2) : after;

  const fm: Record<string, string | string[]> = {};
  const lines = yaml.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let raw = m[2].trim();
    if (raw === "" || raw === "[]") {
      // Multi-line block scalar: accumulate following indented lines as a list
      const list: string[] = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        i++;
        const item = lines[i].replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, "");
        if (item) list.push(item);
      }
      fm[key] = raw === "[]" ? [] : list.length > 0 ? list : "";
      continue;
    }
    // Flow-style list: [a, b, c] or ["a", "b"]
    if (raw.startsWith("[") && raw.endsWith("]")) {
      const inner = raw.slice(1, -1).trim();
      if (inner === "") {
        fm[key] = [];
      } else {
        fm[key] = inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      }
      continue;
    }
    // Quoted scalar
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      fm[key] = raw.slice(1, -1);
      continue;
    }
    fm[key] = raw;
  }
  void relPath;
  return { fm, body };
}

function loadPersona(category: "route-persona" | "specialist", slug: string): Persona | null {
  const relPath = `prompts/${category}/${slug}.prompt.md`;
  const filePath = join(ROOT, relPath);
  if (!existsSync(filePath)) return null;
  const text = readFileSync(filePath, "utf8");
  const parsed = parseFrontmatter(text, relPath);
  if (!parsed) return null;
  return {
    filePath,
    relPath: relPath.replace(/\\/g, "/"),
    category,
    slug,
    frontmatter: parsed.fm,
    body: parsed.body,
    composedBody: parsed.body, // resolved below
  };
}

function resolveComposes(persona: Persona, depth = 0): string {
  if (depth > 5) return persona.body;
  const composes = persona.frontmatter.composesFrom;
  if (!Array.isArray(composes) || composes.length === 0) return persona.body;
  let body = persona.body;
  for (const ref of composes) {
    const m = ref.match(/^([a-zA-Z_-]+)\/([a-zA-Z0-9_-]+)$/);
    if (!m) continue;
    const [, refCat, refSlug] = m;
    if (refCat !== "route-persona" && refCat !== "specialist") continue;
    const target = loadPersona(refCat as "route-persona" | "specialist", refSlug);
    if (!target) continue;
    const targetBody = resolveComposes(target, depth + 1);
    body = body.replace(`{{include:${ref}}}`, targetBody);
  }
  return body;
}

function listPersonas(): Persona[] {
  const personas: Persona[] = [];
  for (const cat of ["route-persona", "specialist"] as const) {
    const dir = join(ROOT, "prompts", cat);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".prompt.md")) continue;
      const slug = entry.replace(/\.prompt\.md$/, "");
      const p = loadPersona(cat, slug);
      if (p) {
        p.composedBody = resolveComposes(p);
        personas.push(p);
      }
    }
  }
  return personas;
}

// ─── Registry ──────────────────────────────────────────────────────────────

interface RegistryAgent {
  agent_id: string;
  agent_name: string;
  tier: string;
  value_stream: string;
  capability_domain: string;
  human_supervisor_id: string;
  hitl_tier_default: number;
  delegates_to: string[];
  escalates_to: string;
  config_profile: {
    tool_grants: string[];
  };
}

function loadRegistry(): RegistryAgent[] {
  const raw = readFileSync(join(ROOT, "packages/db/data/agent_registry.json"), "utf8");
  const parsed = JSON.parse(raw) as { agents: RegistryAgent[] };
  return parsed.agents;
}

// ─── Required body sections ───────────────────────────────────────────────
//
// Per spec §3.2 — six headed sections in order. We accept H1 (`# `) at the
// beginning of a line. Section presence is what's checked; order is checked
// by index-of comparison.

const REQUIRED_SECTIONS = [
  "# Role",
  "# Accountable For",
  "# Interfaces With",
  "# Out Of Scope",
  "# Tools Available",
  "# Operating Rules",
] as const;

function findSectionIndex(body: string, heading: string): number {
  // Match heading at start of line (anchor), case-sensitive, allow trailing whitespace.
  const re = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
  const m = body.match(re);
  return m && m.index !== undefined ? m.index : -1;
}

// ─── Invariant checks ──────────────────────────────────────────────────────

function checkPersona001(registry: RegistryAgent[], personaByAgentId: Map<string, Persona>): void {
  for (const agent of registry) {
    if (!personaByAgentId.has(agent.agent_id)) {
      record(
        "PERSONA-001",
        "error",
        agent.agent_id,
        null,
        `Registry agent ${agent.agent_id} (${agent.agent_name}) has no persona file`,
        `No persona file under prompts/route-persona/ or prompts/specialist/ declares agent_id: ${agent.agent_id}.\n\nFix: create prompts/${agent.tier === "orchestrator" ? "route-persona" : "specialist"}/<slug>.prompt.md following the schema in the persona-audit spec §3.`,
      );
    }
  }
}

function checkPersona002(registry: RegistryAgent[], personas: Persona[]): void {
  const registryIds = new Set(registry.map((a) => a.agent_id));
  for (const p of personas) {
    const aid = p.frontmatter.agent_id;
    if (typeof aid !== "string" || !aid) {
      // Reported under PERSONA-003
      continue;
    }
    if (!registryIds.has(aid)) {
      record(
        "PERSONA-002",
        "error",
        aid,
        p.relPath,
        `Persona ${p.relPath} references agent_id ${aid} which is not in the registry`,
        `Frontmatter agent_id must match an entry in packages/db/data/agent_registry.json. Either add the agent to the registry or correct the persona's agent_id.`,
      );
    }
  }
}

function checkPersona003(personas: Persona[]): void {
  const required: Array<{ key: string; type: "string" | "list" | "number" }> = [
    { key: "name", type: "string" },
    { key: "displayName", type: "string" },
    { key: "description", type: "string" },
    { key: "category", type: "string" },
    { key: "version", type: "string" },
    { key: "agent_id", type: "string" },
    { key: "reports_to", type: "string" },
    { key: "delegates_to", type: "list" },
    { key: "value_stream", type: "string" },
    { key: "hitl_tier", type: "string" },
    { key: "status", type: "string" },
  ];
  for (const p of personas) {
    const missing: string[] = [];
    for (const f of required) {
      const v = p.frontmatter[f.key];
      if (v === undefined) {
        missing.push(`${f.key} (absent)`);
        continue;
      }
      if (f.type === "list" && !Array.isArray(v)) {
        missing.push(`${f.key} (not a list)`);
      } else if (f.type === "string" && typeof v !== "string") {
        missing.push(`${f.key} (not a scalar)`);
      } else if (f.type === "string" && v === "" && f.key !== "value_stream") {
        // value_stream may be empty for cross-cutting agents (per spec §3.1)
        missing.push(`${f.key} (empty)`);
      }
    }
    if (missing.length > 0) {
      record(
        "PERSONA-003",
        "error",
        (p.frontmatter.agent_id as string) ?? null,
        p.relPath,
        `Persona ${p.relPath} missing required frontmatter fields`,
        `Missing or invalid: ${missing.join(", ")}.\n\nFix: see schema in docs/superpowers/specs/2026-04-27-coworker-persona-audit-design.md §3.1.`,
      );
    }
  }
}

function checkPersona004(registry: RegistryAgent[], personaByAgentId: Map<string, Persona>): void {
  for (const agent of registry) {
    const p = personaByAgentId.get(agent.agent_id);
    if (!p) continue; // covered by PERSONA-001

    const drifts: string[] = [];

    const personaVS = p.frontmatter.value_stream;
    if (typeof personaVS === "string" && personaVS !== "" && personaVS !== agent.value_stream) {
      drifts.push(`value_stream: persona='${personaVS}' registry='${agent.value_stream}'`);
    }

    const personaHitl = p.frontmatter.hitl_tier;
    if (typeof personaHitl === "string" && personaHitl !== "" && Number(personaHitl) !== agent.hitl_tier_default) {
      drifts.push(`hitl_tier: persona='${personaHitl}' registry=${agent.hitl_tier_default}`);
    }

    const personaDelegates = p.frontmatter.delegates_to;
    if (Array.isArray(personaDelegates)) {
      const personaSet = new Set(personaDelegates);
      const registrySet = new Set(agent.delegates_to);
      const missingFromPersona = [...registrySet].filter((x) => !personaSet.has(x));
      const extraInPersona = [...personaSet].filter((x) => !registrySet.has(x));
      if (missingFromPersona.length > 0 || extraInPersona.length > 0) {
        drifts.push(
          `delegates_to: persona=[${[...personaSet].join(",")}] registry=[${[...registrySet].join(",")}]`,
        );
      }
    }

    if (drifts.length > 0) {
      record(
        "PERSONA-004",
        "error",
        agent.agent_id,
        p.relPath,
        `Persona frontmatter drifts from registry for ${agent.agent_id}`,
        drifts.map((d) => `  ${d}`).join("\n") +
          "\n\nFix: registry is canonical. Update persona frontmatter to match.",
      );
    }
  }
}

function checkPersona005(personas: Persona[]): void {
  for (const p of personas) {
    const missing: string[] = [];
    let lastIdx = -1;
    let outOfOrder = false;
    for (const heading of REQUIRED_SECTIONS) {
      const idx = findSectionIndex(p.composedBody, heading);
      if (idx < 0) {
        missing.push(heading);
      } else if (idx < lastIdx) {
        outOfOrder = true;
      } else {
        lastIdx = idx;
      }
    }
    if (missing.length > 0 || outOfOrder) {
      record(
        "PERSONA-005",
        "error",
        (p.frontmatter.agent_id as string) ?? null,
        p.relPath,
        `Persona ${p.relPath} missing or misordered required body sections`,
        (missing.length > 0 ? `Missing: ${missing.join(", ")}\n` : "") +
          (outOfOrder ? `Sections present but out of order. Required order: ${REQUIRED_SECTIONS.join(" → ")}\n` : "") +
          "\nFix: see schema in docs/superpowers/specs/2026-04-27-coworker-persona-audit-design.md §3.2.",
      );
    }
  }
}

function checkPersona006(registry: RegistryAgent[], personaByAgentId: Map<string, Persona>): void {
  const registryIds = new Set(registry.map((a) => a.agent_id));
  for (const p of personaByAgentId.values()) {
    const interfacesIdx = findSectionIndex(p.composedBody, "# Interfaces With");
    if (interfacesIdx < 0) continue;
    // Slice from start of "# Interfaces With" to next H1 heading.
    const tail = p.composedBody.slice(interfacesIdx);
    const nextH1 = tail.slice(2).search(/^# /m);
    const section = nextH1 < 0 ? tail : tail.slice(0, nextH1 + 2);
    const refs = [...section.matchAll(/\bAGT-[A-Z0-9-]+\b/g)].map((m) => m[0]);
    const unknown = refs.filter((r) => !registryIds.has(r));
    if (unknown.length > 0) {
      record(
        "PERSONA-006",
        "error",
        (p.frontmatter.agent_id as string) ?? null,
        p.relPath,
        `Persona ${p.relPath} '# Interfaces With' references unknown agent_id(s)`,
        `Unknown: ${[...new Set(unknown)].join(", ")}.\n\nFix: every agent_id named in '# Interfaces With' must exist in the registry. Either fix the typo or add the agent.`,
      );
    }
  }
}

function checkPersona007(registry: RegistryAgent[], personaByAgentId: Map<string, Persona>): void {
  // Warn-only here — promoted to error in the tool-grant audit (GRANT-006).
  for (const agent of registry) {
    const p = personaByAgentId.get(agent.agent_id);
    if (!p) continue;
    const idx = findSectionIndex(p.composedBody, "# Tools Available");
    if (idx < 0) continue; // covered by PERSONA-005
    const tail = p.composedBody.slice(idx);
    const nextH1 = tail.slice(2).search(/^# /m);
    const section = nextH1 < 0 ? tail : tail.slice(0, nextH1 + 2);
    // Bulleted grant keys like "- backlog_read" or "- backlog_read — read backlog items"
    const personaGrants = [...section.matchAll(/^\s*[-*]\s+([a-z][a-z0-9_]*)\b/gm)].map((m) => m[1]);
    if (personaGrants.length === 0) continue; // section exists but is freeform — let it pass for now
    const personaSet = new Set(personaGrants);
    const registrySet = new Set(agent.config_profile.tool_grants);
    const missing = [...registrySet].filter((x) => !personaSet.has(x));
    const extra = [...personaSet].filter((x) => !registrySet.has(x));
    if (missing.length > 0 || extra.length > 0) {
      record(
        "PERSONA-007",
        "warn",
        agent.agent_id,
        p.relPath,
        `Persona '# Tools Available' for ${agent.agent_id} drifts from registry tool_grants`,
        `Missing from persona: ${missing.join(", ") || "(none)"}\nExtra in persona: ${extra.join(", ") || "(none)"}\n\nFix: regenerate this section from the registry (see tool-grant spec §6).`,
      );
    }
  }
}

function checkPersona008(personas: Persona[]): void {
  for (const p of personas) {
    const desc = p.frontmatter.description;
    if (typeof desc === "string" && desc.length > 120) {
      record(
        "PERSONA-008",
        "warn",
        (p.frontmatter.agent_id as string) ?? null,
        p.relPath,
        `Persona description exceeds 120 chars (${desc.length})`,
        `Soft cap. Tighten or move detail into the body.`,
      );
    }
  }
}

function checkPersona010(personas: Persona[]): void {
  const allFiles = new Set(personas.map((p) => `${p.category}/${p.slug}`));
  for (const p of personas) {
    const composes = p.frontmatter.composesFrom;
    if (!Array.isArray(composes)) continue;
    for (const ref of composes) {
      if (!allFiles.has(ref)) {
        record(
          "PERSONA-010",
          "warn",
          (p.frontmatter.agent_id as string) ?? null,
          p.relPath,
          `composesFrom target '${ref}' does not exist`,
          `Listed in ${p.relPath} but no file at prompts/${ref}.prompt.md.`,
        );
      }
    }
  }
}

// ─── Baseline diff ─────────────────────────────────────────────────────────

interface BaselineDiff {
  newViolations: Finding[];
  resolvedViolations: Finding[];
  unchanged: Finding[];
}

function findingKey(f: Finding): string {
  return `${f.invariantId}::${f.agentId ?? ""}::${f.file ?? ""}`;
}

function diffAgainstBaseline(current: Finding[], baselinePath: string): BaselineDiff | null {
  if (!existsSync(baselinePath)) return null;
  const raw = readFileSync(baselinePath, "utf8");
  const baseline = JSON.parse(raw) as Report;
  const baselineKeys = new Set(baseline.findings.map(findingKey));
  const currentKeys = new Set(current.map(findingKey));
  return {
    newViolations: current.filter((f) => !baselineKeys.has(findingKey(f))),
    resolvedViolations: baseline.findings.filter((f) => !currentKeys.has(findingKey(f))),
    unchanged: current.filter((f) => baselineKeys.has(findingKey(f))),
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  let baselinePath: string | null = null;
  let jsonOutPath: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--baseline" && args[i + 1]) {
      baselinePath = args[i + 1];
      i++;
    } else if (args[i] === "--json-out" && args[i + 1]) {
      jsonOutPath = args[i + 1];
      i++;
    }
  }

  if (baselinePath && !baselinePath.match(/^([a-zA-Z]:[\\/]|\/)/)) {
    baselinePath = join(ROOT, baselinePath);
  }
  if (jsonOutPath && !jsonOutPath.match(/^([a-zA-Z]:[\\/]|\/)/)) {
    jsonOutPath = join(ROOT, jsonOutPath);
  }

  const registry = loadRegistry();
  const personas = listPersonas();
  const personaByAgentId = new Map<string, Persona>();
  for (const p of personas) {
    const aid = p.frontmatter.agent_id;
    if (typeof aid === "string" && aid) personaByAgentId.set(aid, p);
  }

  checkPersona001(registry, personaByAgentId);
  checkPersona002(registry, personas);
  checkPersona003(personas);
  checkPersona004(registry, personaByAgentId);
  checkPersona005(personas);
  checkPersona006(registry, personaByAgentId);
  checkPersona007(registry, personaByAgentId);
  checkPersona008(personas);
  checkPersona010(personas);

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warnCount = findings.filter((f) => f.severity === "warn").length;

  const report: Report = {
    generatedAt: new Date().toISOString(),
    spec: "docs/superpowers/specs/2026-04-27-coworker-persona-audit-design.md",
    invariantsChecked: 9,
    errorCount,
    warnCount,
    findings,
  };

  // Stable serialization: sort findings so JSON diffs are meaningful.
  report.findings.sort((a, b) => {
    const k = findingKey(a).localeCompare(findingKey(b));
    return k;
  });

  console.log(JSON.stringify(report, null, 2));

  if (jsonOutPath) {
    writeFileSync(jsonOutPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.error(`[audit] wrote ${jsonOutPath}`);
  }

  let exitCode = 0;
  if (baselinePath) {
    const diff = diffAgainstBaseline(findings, baselinePath);
    if (diff === null) {
      console.error(`[audit] baseline ${baselinePath} not found — treating all findings as new`);
      exitCode = errorCount > 0 ? 1 : 0;
    } else {
      console.error(`[audit] baseline diff: unchanged=${diff.unchanged.length} resolved=${diff.resolvedViolations.length} new=${diff.newViolations.length}`);
      const newErrors = diff.newViolations.filter((f) => f.severity === "error");
      if (newErrors.length > 0) {
        console.error(`\n[audit] NEW ERROR-LEVEL VIOLATIONS BLOCK MERGE:`);
        for (const f of newErrors) {
          console.error(`  [${f.invariantId}] ${f.summary}`);
        }
        exitCode = 1;
      }
      if (diff.resolvedViolations.length > 0) {
        console.error(`\n[audit] resolved (these can be removed from the baseline):`);
        for (const f of diff.resolvedViolations) {
          console.error(`  [${f.invariantId}] ${f.summary}`);
        }
      }
    }
  } else {
    exitCode = errorCount > 0 ? 1 : 0;
  }

  void basename; // silence unused if any future import shifts
  process.exit(exitCode);
}

main();
