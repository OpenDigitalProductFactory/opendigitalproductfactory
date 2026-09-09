// apps/web/scripts/seed-model-metadata-tags.ts
//
// EP-A33A5C61 slice 4 (BI-D9F158AF) — ONE-OFF codemod that collapses the four
// existing metadata homes into `/// @dpf` tags on the Prisma models:
//
//   • packages/db/src/table-classification.ts      → sensitivity
//   • apps/web/lib/govern/data/assets.ts registry   → lifecycle, categories, owner, steward
//   • apps/web/lib/operate/retention/policies.ts    → retention=<Nd> + timeAxis / retention=retained + basis
//   • scripts/stewardship-exemptions.txt            → retention=reference|config|domain|projection
//   • scripts/retention-enrollment-allowlist.json   → business-record, retention=domain
//   • apps/web/lib/govern/data/field-classification → scope (pci / phi) when any field carries it
//
// A model is tagged only when BOTH a lifecycle class and a retention
// disposition are determinable from the existing homes. Everything else stays
// untagged and lands in the shrink-only baseline of
// scripts/check-model-metadata-tags.mjs — a gap that is visible, not a guess
// presented as a decision. Idempotent: a model that already carries a tag is
// left alone.
//
//   pnpm --filter web exec tsx scripts/seed-model-metadata-tags.ts [--write]

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  formatModelMetadataTag,
  parseModelMetadataSource,
  type LifecycleClass,
  type ModelMetadata,
  type RetentionDisposition,
} from "../../../packages/db/src/model-metadata";
import { TABLE_CLASSIFICATION } from "../../../packages/db/src/table-classification";

import { DATA_ASSET_REGISTRY } from "../lib/govern/data/assets";
import { FIELD_DATA_CLASSIFICATION } from "../lib/govern/data/field-classification";
import { PURGE_POLICIES, RETAINED_DATASETS } from "../lib/operate/retention/policies";

const repoRoot = resolve(__dirname, "../../..");
const schemaDir = join(repoRoot, "packages/db/prisma/schema");
const write = process.argv.includes("--write");

const delegateFor = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

// ── Existing homes ──────────────────────────────────────────────────────────
// A model may be enrolled more than once with disjoint partitions (ToolExecution
// by auditClass). The MODEL-level window is the longest of them; partition
// windows stay in the policy file until slice 4d moves them to column tags.
const purgeByDelegate = new Map<string, (typeof PURGE_POLICIES)[number]>();
for (const p of PURGE_POLICIES) {
  const prior = purgeByDelegate.get(p.model);
  if (!prior || p.baseRetentionDays > prior.baseRetentionDays) purgeByDelegate.set(p.model, p);
}
const retainedByDelegate = new Map(RETAINED_DATASETS.map((r) => [r.model, r]));

const exemptions = new Map<string, string>();
for (const raw of readFileSync(join(repoRoot, "scripts/stewardship-exemptions.txt"), "utf8").split(/\r?\n/)) {
  const line = raw.replace(/#.*$/, "").trim();
  if (!line) continue;
  const [model, reason] = line.split(/\s+/);
  if (model && reason) exemptions.set(model, reason);
}
const EXEMPTION_TO_RETENTION: Record<string, RetentionDisposition> = {
  "reference-data": { kind: "reference" },
  "config-singleton": { kind: "config" },
  "domain-lifecycle-managed": { kind: "domain" },
  "derived-projection": { kind: "projection" },
};

const allowlist = JSON.parse(readFileSync(join(repoRoot, "scripts/retention-enrollment-allowlist.json"), "utf8")) as {
  entries: { model: string }[];
};
const allowlisted = new Set(allowlist.entries.map((e) => e.model));

const scopeByModel = new Map<string, "pci-cardholder" | "phi-health">();
for (const [key, fc] of Object.entries(FIELD_DATA_CLASSIFICATION)) {
  const model = key.split(".")[0];
  const scope = (fc as { regulatedScope?: string }).regulatedScope;
  if (scope === "pci-cardholder" || scope === "phi-health") {
    const prior = scopeByModel.get(model);
    // phi and pci on one model: keep the first seen; the field registry stays the fine-grained truth.
    if (!prior) scopeByModel.set(model, scope);
  }
}

function derive(model: string): ModelMetadata | null {
  const delegate = delegateFor(model);
  const asset = DATA_ASSET_REGISTRY.byPrismaModel.get(model);
  const purge = purgeByDelegate.get(delegate);
  const retained = retainedByDelegate.get(delegate);
  const exemption = exemptions.get(model);

  let retention: RetentionDisposition | null = null;
  let basis: string | undefined;
  let timeAxis: string | undefined;
  if (purge) {
    retention = { kind: "purge", days: purge.baseRetentionDays };
    timeAxis = purge.timestampField;
  } else if (retained) {
    retention = { kind: "retained" };
    basis = retained.regulatoryBasis;
  } else if (exemption && EXEMPTION_TO_RETENTION[exemption]) {
    retention = EXEMPTION_TO_RETENTION[exemption];
  } else if (allowlisted.has(model)) {
    retention = { kind: "domain" };
  }
  if (!retention) return null;

  let lifecycle: LifecycleClass | null = (asset?.lifecycleClass as LifecycleClass | undefined) ?? null;
  if (!lifecycle) {
    if (purge) lifecycle = "telemetry-bounded";
    else if (retained) lifecycle = "regulated-record";
    else if (allowlisted.has(model)) lifecycle = "business-record";
    else if (exemption) lifecycle = "operational";
  }
  if (!lifecycle) return null;
  // A registry class that forbids purging cannot keep a purge window; the
  // policy file is the executable truth today, so the window wins and the
  // class is downgraded to the purgeable class — visible in the diff for review.
  if (retention.kind === "purge" && !["telemetry-bounded", "ephemeral", "operational"].includes(lifecycle)) {
    lifecycle = "telemetry-bounded";
  }

  const sensitivity = (TABLE_CLASSIFICATION[model] ?? asset?.sensitivity) as ModelMetadata["sensitivity"] | undefined;
  const metadata: ModelMetadata = { lifecycle, retention };
  if (sensitivity) metadata.sensitivity = sensitivity;
  if (asset?.categories?.length) metadata.categories = [...asset.categories] as ModelMetadata["categories"];
  const scope = scopeByModel.get(model);
  if (scope) metadata.scope = scope;
  if (asset?.ownerRole) metadata.owner = asset.ownerRole;
  if (asset?.stewardRole) metadata.steward = asset.stewardRole;
  if (timeAxis) metadata.timeAxis = timeAxis;
  if (basis) metadata.basis = basis;
  return metadata;
}

// ── Apply ───────────────────────────────────────────────────────────────────
let tagged = 0;
let skipped = 0;
let already = 0;
const byClass = new Map<string, number>();
for (const file of readdirSync(schemaDir).filter((f) => f.endsWith(".prisma")).sort()) {
  const path = join(schemaDir, file);
  const source = readFileSync(path, "utf8");
  const parsed = parseModelMetadataSource(source, file);
  already += parsed.entries.length;
  const lines = source.split("\n");
  const inserts: Array<{ before: number; text: string }> = [];
  for (const u of parsed.untagged) {
    const meta = derive(u.model);
    if (!meta) {
      skipped += 1;
      continue;
    }
    inserts.push({ before: u.line - 1, text: formatModelMetadataTag(meta) });
    tagged += 1;
    byClass.set(meta.lifecycle, (byClass.get(meta.lifecycle) ?? 0) + 1);
  }
  if (inserts.length === 0) continue;
  for (const ins of inserts.sort((a, b) => b.before - a.before)) {
    lines.splice(ins.before, 0, ins.text);
  }
  const next = lines.join("\n");
  const check = parseModelMetadataSource(next, file);
  if (check.issues.length > 0) {
    console.error(`[seed-model-metadata-tags] ${file} would not parse cleanly:`);
    for (const i of check.issues) console.error(`  ${i.model ?? "?"}:${i.line} ${i.message}`);
    process.exitCode = 1;
    continue;
  }
  if (write) writeFileSync(path, next, "utf8");
}
console.log(`[seed-model-metadata-tags] ${write ? "wrote" : "dry-run"}: tagged=${tagged} already=${already} left-untagged=${skipped}`);
for (const [cls, n] of [...byClass.entries()].sort()) console.log(`  ${cls}: ${n}`);
