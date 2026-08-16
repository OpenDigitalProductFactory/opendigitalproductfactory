import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

export const activeLifecycleFiles = [
  "AGENTS.md", "install-dpf.ps1", "install-dpf.sh", "dpf-reinstall.ps1", "dpf-reinstall.sh",
  "uninstall-dpf.ps1", "uninstall-dpf.sh", "scripts/fresh-install.ps1", "scripts/setup.sh",
  "scripts/installer/lib/doctor.sh", "scripts/verify-install-windows.ps1", "scripts/verify-install-edge.sh",
  ".github/workflows/release-gates.yml", "package.json", "packages/db/package.json",
  "apps/web/app/api/diagnostics/preflight/route.ts",
  "docs/user-guide/contributing/developer-setup.md", "docs/user-guide/contributing/dev-container.md",
  "docs/user-guide/operations/infrastructure-discovery.md", "docs/user-guide/ai-workforce/decision-perspective.md",
];

export const forbiddenOperationalPatterns = [
  { id: "neo4j-name", pattern: /neo4j/i }, { id: "qdrant-name", pattern: /qdrant/i },
  { id: "neo4j-ports", pattern: /\b(?:7474|7687)\b/ }, { id: "qdrant-port", pattern: /\b6333\b/ },
  { id: "neo4j-credential", pattern: /NEO4J_AUTH/ }, { id: "qdrant-env", pattern: /QDRANT_(?:URL|INTERNAL_URL)/ },
];

// Compatibility exceptions must be exact and temporary. None are needed in the active surface today.
export const legacyExceptions = [];
export const expectedRemediation = [];

export async function auditLifecycleSurfaces(root) {
  const violations = [];
  const exceptionHits = new Map(legacyExceptions.map((entry) => [entry.id, 0]));
  const remediationHits = new Map(expectedRemediation.map((entry) => [entry.id, 0]));
  for (const file of activeLifecycleFiles) {
    const text = await readFile(resolve(root, file), "utf8");
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      for (const rule of forbiddenOperationalPatterns) {
        if (!rule.pattern.test(line)) continue;
        const exact = (entries, hits) => entries.find((entry) => {
          const match = entry.file === file && entry.line === line && entry.rule === rule.id;
          if (match) hits.set(entry.id, hits.get(entry.id) + 1);
          return match;
        });
        if (exact(legacyExceptions, exceptionHits) || exact(expectedRemediation, remediationHits)) continue;
        violations.push({ file, line: index + 1, rule: rule.id, text: line.trim() });
      }
    }
  }
  const stale = [...legacyExceptions, ...expectedRemediation].filter((entry) =>
    (exceptionHits.get(entry.id) ?? remediationHits.get(entry.id) ?? 0) !== 1);
  return { violations, stale, remediationCount: [...remediationHits.values()].reduce((a, b) => a + b, 0) };
}

// CodeQL js/redos #372: `[^ ]+` excludes only a literal SPACE, so it also
// matched tabs — exactly like the adjacent `\s+`. One `(?:--[^ ]+\s+)` iteration
// could therefore cover what two iterations cover, the ambiguity that drives
// exponential backtracking. Keeping the classes disjoint (`\S+` for tokens,
// `[^\S\r\n]+` for horizontal gaps) removes every ambiguous split.
// Using horizontal-only whitespace also fixes a latent correctness bug: the old
// `\s+` matched newlines, so a COPY match could run past the end of its line.
const COPY_INPUT_RE = /^COPY[^\S\r\n]+(?!.*--from=)(?:--\S+[^\S\r\n]+)*(\S+)[^\S\r\n]+[^\r\n]+$/gm;

export function promoterCopyInputs(dockerfile) {
  // The literal carries /g, so reset lastIndex rather than sharing cursor state
  // between calls.
  COPY_INPUT_RE.lastIndex = 0;
  return [...dockerfile.matchAll(COPY_INPUT_RE)].map((match) => match[1]);
}

export function assertHostStateWiring(compose) {
  const required = ["${DPF_STATE_DIR:-${HOME}/.dpf}:/dpf-state:ro", "DPF_STATE_DIR_HOST: ${DPF_STATE_DIR:-${HOME}/.dpf}"];
  return required.filter((needle) => !compose.includes(needle));
}

export function formatAuditFailure(result, root) {
  return [...result.violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.text}`),
    ...result.stale.map((v) => `stale lifecycle exception ${v.id} (${relative(root, resolve(root, v.file))})`)].join("\n");
}
