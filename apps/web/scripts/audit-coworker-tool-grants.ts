/**
 * Coworker tool-grant audit
 * (docs/superpowers/specs/2026-04-27-coworker-tool-grant-spec-design.md).
 *
 * Walks the registry, the grant catalog, the TOOL_TO_GRANTS map, and the
 * skills directory, then runs the spec's §5.2 invariants. Static — no DB.
 * Read-only — no edits.
 *
 * Usage (local):
 *   pnpm --filter web exec tsx scripts/audit-coworker-tool-grants.ts
 *
 * Usage (CI): wired into .github/workflows/audit-coworker-tool-grants.yml
 *
 * Output: JSON report on stdout. Same baseline-comparison shape as the
 * persona audit and the routing audit.
 *
 * Why this script exists
 * ----------------------
 * The registry today references 99 distinct grant keys. Only 36 of those are
 * honored by any tool implementation in apps/web/lib/tak/agent-grants.ts.
 * The other 63 are aspirational scope a coworker carries on paper but cannot
 * exercise. There's no detection today — coworkers fail at call time and
 * operators get a default-deny log line. This audit moves that drift from
 * runtime mystery to PR-time finding.
 */

import { readFileSync, existsSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

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

// ─── Repo root ─────────────────────────────────────────────────────────────

function repoRoot(): string {
  let dir = process.cwd();
  while (dir !== "/" && dir !== resolve(dir, "..")) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = resolve(dir, "..");
  }
  return process.cwd();
}
const ROOT = repoRoot();

// ─── Loaders ───────────────────────────────────────────────────────────────

interface RegistryAgent {
  agent_id: string;
  agent_name: string;
  tier: string;
  value_stream: string;
  config_profile: { tool_grants: string[] };
}

interface CatalogGrant {
  key: string;
  description: string;
  category: string;
  sensitivity: string;
  honored_by_tools: string[];
  implies: string[];
}

interface SkillFile {
  relPath: string;
  name: string;
  assignTo: string[];
  allowedTools: string[];
}

function loadRegistry(): RegistryAgent[] {
  const raw = readFileSync(join(ROOT, "packages/db/data/agent_registry.json"), "utf8");
  return (JSON.parse(raw) as { agents: RegistryAgent[] }).agents;
}

function loadCatalog(): { grants: CatalogGrant[] } {
  return JSON.parse(readFileSync(join(ROOT, "packages/db/data/grant_catalog.json"), "utf8"));
}

function loadToolToGrants(): Record<string, string[]> {
  const src = readFileSync(join(ROOT, "apps/web/lib/tak/agent-grants.ts"), "utf8");
  const block = src.match(/TOOL_TO_GRANTS:[^=]*= \{([\s\S]*?)\n\};/);
  const map: Record<string, string[]> = {};
  if (!block) return map;
  for (const line of block[1].split("\n")) {
    const m = line.match(/^\s*([a-zA-Z0-9_]+):\s*\[([^\]]*)\]/);
    if (!m) continue;
    map[m[1]] = m[2]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return map;
}

function walkSkills(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkSkills(full, out);
    else if (entry.endsWith(".skill.md")) out.push(full);
  }
}

function parseSkillFrontmatter(filePath: string): SkillFile | null {
  const text = readFileSync(filePath, "utf8");
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end < 0) return null;
  const yaml = text.slice(4, end).replace(/\r\n/g, "\n");

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
      const list: string[] = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        i++;
        const item = lines[i].replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, "");
        if (item) list.push(item);
      }
      fm[key] = raw === "[]" ? [] : list.length > 0 ? list : "";
      continue;
    }
    if (raw.startsWith("[") && raw.endsWith("]")) {
      const inner = raw.slice(1, -1).trim();
      fm[key] = inner === ""
        ? []
        : inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      continue;
    }
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      fm[key] = raw.slice(1, -1);
      continue;
    }
    fm[key] = raw;
  }

  const relPath = filePath.slice(ROOT.length + 1).replace(/\\/g, "/");
  const name = typeof fm.name === "string" ? fm.name : relPath;
  const assignTo = Array.isArray(fm.assignTo) ? fm.assignTo : [];
  const allowedTools = Array.isArray(fm.allowedTools) ? fm.allowedTools : [];
  return { relPath, name, assignTo, allowedTools };
}

function loadSkills(): SkillFile[] {
  const files: string[] = [];
  walkSkills(join(ROOT, "skills"), files);
  return files.map(parseSkillFrontmatter).filter((s): s is SkillFile => s !== null);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function effectiveGrants(directGrants: string[], catalog: CatalogGrant[]): Set<string> {
  const byKey = new Map(catalog.map((g) => [g.key, g]));
  const out = new Set<string>();
  const stack = [...directGrants];
  while (stack.length > 0) {
    const k = stack.pop()!;
    if (out.has(k)) continue;
    out.add(k);
    const def = byKey.get(k);
    if (def) for (const i of def.implies) stack.push(i);
  }
  return out;
}

function toolsAuthorized(grants: Set<string>, toolToGrants: Record<string, string[]>): Set<string> {
  const out = new Set<string>();
  for (const [tool, required] of Object.entries(toolToGrants)) {
    if (required.some((g) => grants.has(g))) out.add(tool);
  }
  return out;
}

// ─── Invariants ────────────────────────────────────────────────────────────

function checkGrant001(registry: RegistryAgent[], catalog: CatalogGrant[]): void {
  const catKeys = new Set(catalog.map((g) => g.key));
  const seen = new Set<string>();
  for (const a of registry) {
    for (const g of a.config_profile.tool_grants) {
      if (catKeys.has(g)) continue;
      const found = `${g}::${a.agent_id}`;
      if (seen.has(found)) continue;
      seen.add(found);
      record(
        "GRANT-001",
        "error",
        a.agent_id,
        "packages/db/data/grant_catalog.json",
        `Registry grant '${g}' on ${a.agent_id} is not in the catalog`,
        `Every grant key in agent_registry.json must have an entry in packages/db/data/grant_catalog.json. Add the catalog entry or remove the grant from the registry.`,
      );
    }
  }
}

function checkGrant002(catalog: CatalogGrant[], toolToGrants: Record<string, string[]>): void {
  const declaredTools = new Set(Object.keys(toolToGrants));
  for (const g of catalog) {
    if (g.honored_by_tools.length === 0) {
      record(
        "GRANT-002",
        "error",
        null,
        "packages/db/data/grant_catalog.json",
        `Catalog grant '${g.key}' has no honored_by_tools`,
        `Aspirational grant: declared in registry, present in catalog, but no tool implementation in apps/web/lib/tak/agent-grants.ts checks it. Either implement a tool that requires this grant or remove the grant from the registry and catalog.`,
      );
      continue;
    }
    for (const t of g.honored_by_tools) {
      if (!declaredTools.has(t)) {
        record(
          "GRANT-002",
          "error",
          null,
          "packages/db/data/grant_catalog.json",
          `Catalog grant '${g.key}' lists tool '${t}' which is absent from TOOL_TO_GRANTS`,
          `The catalog claims tool '${t}' honors this grant, but agent-grants.ts has no entry for that tool. Reconcile.`,
        );
      }
    }
  }
}

function checkGrant003(catalog: CatalogGrant[], toolToGrants: Record<string, string[]>): void {
  const catKeys = new Set(catalog.map((g) => g.key));
  for (const [tool, required] of Object.entries(toolToGrants)) {
    for (const g of required) {
      if (!catKeys.has(g)) {
        record(
          "GRANT-003",
          "error",
          null,
          "apps/web/lib/tak/agent-grants.ts",
          `Tool '${tool}' checks grant '${g}' which is not in the catalog`,
          `Every grant key referenced by TOOL_TO_GRANTS must have a catalog entry. Either add the catalog entry (and a registry agent that holds the grant) or change the tool's required grants.`,
        );
      }
    }
  }
}

function checkGrant004(
  registry: RegistryAgent[],
  catalog: CatalogGrant[],
  toolToGrants: Record<string, string[]>,
  skills: SkillFile[],
): void {
  const agentByName = new Map(registry.map((a) => [a.agent_name, a]));
  const agentById = new Map(registry.map((a) => [a.agent_id, a]));

  for (const skill of skills) {
    if (skill.allowedTools.length === 0) continue;
    const targets: RegistryAgent[] =
      skill.assignTo.length === 1 && skill.assignTo[0] === "*"
        ? registry
        : skill.assignTo
            .map((t) => agentById.get(t) ?? agentByName.get(t))
            .filter((a): a is RegistryAgent => a !== undefined);

    if (targets.length === 0) {
      record(
        "GRANT-004",
        "warn",
        null,
        skill.relPath,
        `Skill '${skill.name}' assignTo references unknown agent(s): ${skill.assignTo.join(", ")}`,
        `assignTo entries must be agent_id, agent_name, or "*". Unknown values are ignored at runtime — likely a typo.`,
      );
      continue;
    }

    for (const a of targets) {
      const grants = effectiveGrants(a.config_profile.tool_grants, catalog);
      const allowed = toolsAuthorized(grants, toolToGrants);
      const missing = skill.allowedTools.filter((t) => !allowed.has(t));
      if (missing.length > 0) {
        record(
          "GRANT-004",
          "error",
          a.agent_id,
          skill.relPath,
          `Skill '${skill.name}' allowedTools not authorized by ${a.agent_id}'s grants`,
          `Missing authorization for: ${missing.join(", ")}.\n\nFix: either grant ${a.agent_id} a key that authorizes these tools, or remove the tools from the skill's allowedTools.`,
        );
      }
    }
  }
}

function checkGrant008(registry: RegistryAgent[], catalog: CatalogGrant[]): void {
  const byKey = new Map(catalog.map((g) => [g.key, g]));
  for (const a of registry) {
    if (a.tier !== "specialist") continue;
    const grants = a.config_profile.tool_grants;
    const hasWrite = grants.some((k) => {
      const def = byKey.get(k);
      if (!def) return false;
      return /(_write|_create|_execute|_publish|_emit|_provision|_trigger)$/.test(k);
    });
    if (!hasWrite) {
      record(
        "GRANT-008",
        "warn",
        a.agent_id,
        null,
        `Specialist ${a.agent_id} has no write/execute grants`,
        `Specialists are expected to perform actions. ${a.agent_id} has only read-class grants: ${grants.join(", ")}. Possibly mis-tiered as specialist when it should be a read-only advisor role, or missing the grants its job requires.`,
      );
    }
  }
}

function checkGrant010(catalog: CatalogGrant[]): void {
  for (const g of catalog) {
    if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(g.key) && !/^[a-z][a-z0-9_]*$/.test(g.key)) {
      record(
        "GRANT-010",
        "warn",
        null,
        "packages/db/data/grant_catalog.json",
        `Grant key '${g.key}' is off-pattern`,
        `Convention: lowercase snake_case, ideally <noun>_<verb> (e.g. backlog_read, iac_execute).`,
      );
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
  return `${f.invariantId}::${f.agentId ?? ""}::${f.file ?? ""}::${f.summary}`;
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
  const catalog = loadCatalog();
  const toolToGrants = loadToolToGrants();
  const skills = loadSkills();

  checkGrant001(registry, catalog.grants);
  checkGrant002(catalog.grants, toolToGrants);
  checkGrant003(catalog.grants, toolToGrants);
  checkGrant004(registry, catalog.grants, toolToGrants, skills);
  checkGrant008(registry, catalog.grants);
  checkGrant010(catalog.grants);

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warnCount = findings.filter((f) => f.severity === "warn").length;

  const report: Report = {
    generatedAt: new Date().toISOString(),
    spec: "docs/superpowers/specs/2026-04-27-coworker-tool-grant-spec-design.md",
    invariantsChecked: 6,
    errorCount,
    warnCount,
    findings,
  };

  report.findings.sort((a, b) => findingKey(a).localeCompare(findingKey(b)));

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
        for (const f of newErrors) console.error(`  [${f.invariantId}] ${f.summary}`);
        exitCode = 1;
      }
      if (diff.resolvedViolations.length > 0) {
        console.error(`\n[audit] resolved (these can be removed from the baseline):`);
        for (const f of diff.resolvedViolations) console.error(`  [${f.invariantId}] ${f.summary}`);
      }
    }
  } else {
    exitCode = errorCount > 0 ? 1 : 0;
  }

  process.exit(exitCode);
}

main();
