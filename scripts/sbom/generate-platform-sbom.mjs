#!/usr/bin/env node
// scripts/sbom/generate-platform-sbom.mjs
//
// Platform-wide CycloneDX 1.7 SBOM + dependency-reduction / efficiency
// analysis, generated straight from pnpm-lock.yaml — the same source of
// truth apps/web/lib/assurance/cyclonedx-generator.ts reads. Pure Node:
// no install required, no new runtime dependency, robust to a degraded
// node_modules tree.
//
// Where this sits in the supply-chain picture:
//   - Dependabot                         → vulnerabilities + lifecycle (reactive, GitHub-native)
//   - buildx `sbom: true` on GHCR images → per-container SBOM attestations at release time
//   - THIS script                        → monorepo-wide inventory + the REDUCTION / EFFICIENCY
//                                          view (version fan-out) nothing else produces
//
// The reduction view is the part Dependabot does not give you: which
// packages are resolved at multiple versions, how much of that is
// multi-MAJOR skew (real bloat + risk) vs. patch drift (cheap to align),
// and which duplicates are already governed by a pnpm-workspace override.
//
// Usage:
//   node scripts/sbom/generate-platform-sbom.mjs
//   node scripts/sbom/generate-platform-sbom.mjs --root <repoRoot> --out <dir> --git-ref <sha>

import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── args ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { root: process.cwd(), out: null, gitRef: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") out.root = argv[++i];
    else if (argv[i] === "--out") out.out = argv[++i];
    else if (argv[i] === "--git-ref") out.gitRef = argv[++i];
  }
  out.root = resolve(out.root);
  out.out = out.out ? resolve(out.out) : join(out.root, "sbom");
  out.gitRef = out.gitRef ?? process.env.GITHUB_SHA ?? process.env.GIT_COMMIT ?? "unknown";
  return out;
}

// ── lockfile parsing (line-based; mirrors pnpm-lock-parser.ts shape) ────
function topLevelSection(lines, header) {
  const start = lines.indexOf(header);
  if (start < 0) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[A-Za-z]/.test(lines[i])) { end = i; break; } // next col-0 key
  }
  return lines.slice(start + 1, end);
}

function unquote(s) {
  return s.replace(/^['"]|['"]$/g, "");
}

// `@scope/name@1.2.3` → {name:'@scope/name', version:'1.2.3'}; strips any
// trailing pnpm peer suffix `(react@19)` defensively.
function splitNameVersion(key) {
  const base = key.split("(")[0];
  const at = base.lastIndexOf("@");
  if (at <= 0) return null;
  const version = base.slice(at + 1);
  if (!version || version.includes("/")) return null; // e.g. `foo@github:...`
  return { name: base.slice(0, at), version };
}

// importers: per-workspace DIRECT declarations (prod / dev / optional),
// each with its resolved version so we can tell first-party divergence
// (our own specifiers resolve to different versions) from transitive
// duplication (our specifiers agree; a dependency pulls another version).
function importerResolvedVersion(raw, specifier) {
  const v = raw.trim().replace(/^['"]|['"]$/g, "");
  if (v.startsWith("link:") || v.startsWith("workspace:")) return null; // first-party workspace link
  return v.split("(")[0]; // strip peer suffix
}

function parseImporters(lines) {
  const section = topLevelSection(lines, "importers:");
  const importers = {};
  let cur = null, kind = null, name = null, spec = null;
  for (const line of section) {
    const imp = line.match(/^ {2}(\S.*):$/);
    if (imp) { cur = imp[1]; importers[cur] = { dependencies: [], devDependencies: [], optionalDependencies: [] }; kind = null; name = null; spec = null; continue; }
    const k = line.match(/^ {4}(dependencies|devDependencies|optionalDependencies):$/);
    if (k) { kind = k[1]; name = null; spec = null; continue; }
    const nm = line.match(/^ {6}(\S.*):$/);
    if (nm && kind) { name = unquote(nm[1]); spec = null; continue; }
    const sp = line.match(/^ {8}specifier: (.+)$/);
    if (sp && name) { spec = unquote(sp[1].trim()); continue; }
    const ver = line.match(/^ {8}version: (.+)$/);
    if (ver && cur && kind && name) {
      importers[cur][kind].push({ name, specifier: spec, version: importerResolvedVersion(ver[1], spec) });
      name = null; spec = null;
    }
  }
  return importers;
}

// packages: the deduplicated resolved set (clean name@version keys)
function parsePackages(lines) {
  const section = topLevelSection(lines, "packages:");
  const pkgs = [];
  for (const line of section) {
    const m = line.match(/^ {2}(\S.*):$/); // 2-space key only (attrs are 4-space)
    if (!m) continue;
    const key = unquote(m[1]);
    if (!key.includes("@")) continue;
    const nv = splitNameVersion(key);
    if (nv) pkgs.push(nv);
  }
  return pkgs;
}

// pnpm-workspace.yaml overrides → set of governed package names, so the
// analysis never re-recommends a dedupe the team has already pinned.
function parseOverrideTargets(workspaceYaml) {
  const targets = new Set();
  const block = topLevelSection(workspaceYaml.replace(/\r\n/g, "\n").split("\n"), "overrides:");
  for (const line of block) {
    const m = line.match(/^ {2}(\S.*?):\s*\S/);
    if (!m) continue;
    let key = unquote(m[1]);
    if (key.includes(">")) key = key.slice(key.lastIndexOf(">") + 1); // nested override target
    key = key.replace(/@[<>=^~].*$/, "").replace(/@\d.*$/, ""); // strip version qualifier
    if (key) targets.add(key.trim());
  }
  return targets;
}

// published runtime images (from publish-image.yml build matrix)
function parseImageNames(workflowText) {
  const names = [];
  const re = /^\s*- name: (dpf-[\w-]+)$/gm;
  let m;
  while ((m = re.exec(workflowText))) names.push(m[1]);
  return [...new Set(names)];
}

// ── CycloneDX assembly (matches cyclonedx-generator.ts conventions) ─────
function npmPurl(name, version) {
  const encoded = name.startsWith("@") ? `%40${name.slice(1)}` : name;
  return `pkg:npm/${encoded}@${version}`;
}

function npmComponentType(name) {
  return name === "next" || name.startsWith("@dpf/") ? "framework" : "library";
}

function buildCycloneDx({ packages, images, gitRef, generatedAt, rootName, rootVersion }) {
  const components = [
    ...packages.map((p) => ({
      "bom-ref": npmPurl(p.name, p.version),
      type: npmComponentType(p.name),
      name: p.name,
      version: p.version,
      purl: npmPurl(p.name, p.version),
    })),
    ...images.map((img) => ({
      "bom-ref": `container:${img}`,
      type: "container",
      name: img,
      properties: [{ name: "dpf:sbomSource", value: "buildx-attestation (release-time)" }],
    })),
  ];
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: generatedAt.toISOString(),
      component: { type: "application", name: rootName, version: rootVersion, "bom-ref": rootName },
      properties: [
        { name: "dpf:gitRef", value: gitRef },
        { name: "dpf:scope", value: "platform-monorepo" },
        { name: "dpf:source", value: "pnpm-lock.yaml" },
      ],
    },
    components,
    dependencies: components.map((c) => ({ ref: c["bom-ref"] })),
  };
}

// ── reduction / efficiency analysis ─────────────────────────────────────
function cmpVersion(a, b) {
  const pa = a.split(".").map((x) => parseInt(x, 10));
  const pb = b.split(".").map((x) => parseInt(x, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (!Number.isNaN(d) && d !== 0) return d;
  }
  return a.localeCompare(b);
}
const major = (v) => {
  const n = parseInt(v.split(".")[0], 10);
  return Number.isNaN(n) ? v.split(".")[0] : n;
};

function analyze({ packages, importers, overrideTargets }) {
  const byName = new Map();
  for (const p of packages) {
    if (!byName.has(p.name)) byName.set(p.name, new Set());
    byName.get(p.name).add(p.version);
  }

  // for each directly-declared name: which workspaces declare it, and the
  // set of versions OUR OWN declarations resolve to (divergence detector)
  const directInWorkspaces = new Map();
  const directResolved = new Map();
  const directProd = new Set();
  const directDev = new Set();
  for (const [ws, imp] of Object.entries(importers)) {
    const record = (d) => {
      if (!directInWorkspaces.has(d.name)) directInWorkspaces.set(d.name, new Set());
      directInWorkspaces.get(d.name).add(ws);
      if (d.version) {
        if (!directResolved.has(d.name)) directResolved.set(d.name, new Set());
        directResolved.get(d.name).add(d.version);
      }
    };
    for (const d of imp.dependencies) { directProd.add(d.name); record(d); }
    for (const d of imp.optionalDependencies) { directProd.add(d.name); record(d); }
    for (const d of imp.devDependencies) { directDev.add(d.name); record(d); }
  }

  const duplicates = [...byName.entries()]
    .map(([name, set]) => {
      const versions = [...set].sort(cmpVersion);
      const majors = [...new Set(versions.map(major))];
      const ws = directInWorkspaces.get(name);
      const ourVersions = directResolved.get(name);
      return {
        name,
        versions,
        versionCount: versions.length,
        majorCount: majors.length,
        majors,
        overrideGoverned: overrideTargets.has(name),
        direct: Boolean(ws),
        directInWorkspaces: ws ? [...ws].sort() : [],
        // our own declarations resolve to >1 version → genuinely ours to align
        firstPartyDivergent: Boolean(ourVersions && ourVersions.size > 1),
        ourVersions: ourVersions ? [...ourVersions].sort(cmpVersion) : [],
      };
    })
    .filter((d) => d.versionCount > 1)
    .sort((a, b) => b.versionCount - a.versionCount || a.name.localeCompare(b.name));

  const excessInstances = duplicates.reduce((n, d) => n + (d.versionCount - 1), 0);
  const multiMajor = duplicates.filter((d) => d.majorCount > 1);
  // Tier 1: our own specifiers disagree — controllable now, no upstream wait.
  const firstPartyDivergent = duplicates.filter((d) => d.firstPartyDivergent);
  // Tier 2: same-major drift, not already pinned — zero-risk `pnpm dedupe`.
  const dedupeCandidates = duplicates.filter((d) => d.majorCount === 1 && !d.overrideGoverned);
  // declared by us but our specifiers already agree → extra versions are transitive.
  const directButTransitive = duplicates.filter((d) => d.direct && !d.firstPartyDivergent);

  return {
    totals: {
      resolvedComponents: packages.length,
      uniqueNames: byName.size,
      duplicatedNames: duplicates.length,
      excessInstances,
      multiMajorNames: multiMajor.length,
      firstPartyDivergentNames: firstPartyDivergent.length,
      directButTransitiveNames: directButTransitive.length,
      dedupeCandidateNames: dedupeCandidates.length,
      directProdNames: directProd.size,
      directDevNames: directDev.size,
      workspaces: Object.keys(importers).length,
    },
    duplicates,
    multiMajor,
    firstPartyDivergent,
    directButTransitive,
    dedupeCandidates,
  };
}

// ── markdown report ─────────────────────────────────────────────────────
function renderMarkdown({ analysis, images, gitRef, generatedAt }) {
  const t = analysis.totals;
  const L = [];
  L.push("# DPF Platform SBOM — Dependency Reduction & Efficiency Analysis");
  L.push("");
  L.push(`_Generated ${generatedAt.toISOString().slice(0, 10)} from \`pnpm-lock.yaml\` (gitRef \`${gitRef}\`) via \`scripts/sbom/generate-platform-sbom.mjs\`._`);
  L.push("");
  L.push("> **Scope demarcation.** Dependabot owns vulnerabilities + lifecycle; the");
  L.push("> release-time buildx attestation owns per-container SBOMs. This report owns");
  L.push("> the **reduction / efficiency** view — version fan-out across the monorepo —");
  L.push("> which neither of the other two produces.");
  L.push("");
  L.push("## Inventory");
  L.push("");
  L.push("| Metric | Count |");
  L.push("| --- | ---: |");
  L.push(`| Resolved npm components | ${t.resolvedComponents} |`);
  L.push(`| Unique package names | ${t.uniqueNames} |`);
  L.push(`| Workspaces | ${t.workspaces} |`);
  L.push(`| Direct prod dependency names | ${t.directProdNames} |`);
  L.push(`| Direct dev dependency names | ${t.directDevNames} |`);
  L.push(`| Published container images | ${images.length} |`);
  L.push("");
  L.push("## Reduction signal: version fan-out");
  L.push("");
  L.push(`- **${t.duplicatedNames}** package names resolve to **more than one version**.`);
  L.push(`- **${t.excessInstances}** redundant package instances could in principle be collapsed (sum of versions − 1 per name).`);
  L.push(`- **${t.multiMajorNames}** of those span **multiple major versions** — the high-value targets (real duplicate code, larger trees, version-skew risk), as opposed to cheap patch drift.`);
  L.push(`- **${t.firstPartyDivergentNames}** are **first-party divergent** — *our own* workspace declarations resolve to different versions. Fully controllable now, no upstream wait.`);
  L.push(`- **${t.dedupeCandidateNames}** are **same-major drift** — an UPPER BOUND on \`pnpm dedupe\` (it only collapses the subset whose consumer ranges overlap; run \`pnpm dedupe --check\` for the real count).`);
  L.push(`- **${t.directButTransitiveNames}** are declared by us but **our specifiers already agree** — the extra versions are transitive, so an override risks breaking the consumer that needs the other version.`);
  L.push("");
  L.push("### Tier 1 — first-party divergence (we control these now)");
  L.push("");
  L.push("Our own workspace declarations resolve to more than one version. Aligning the declared specifiers collapses the fan-out with no upstream dependency. Dependabot does not catch these — it bumps one package at a time, not cross-workspace consistency, and is explicitly configured *not* to move majors for typescript/react/expo.");
  L.push("");
  L.push("| Package | Our declared versions | All resolved | Majors | Declared in |");
  L.push("| --- | --- | --- | --- | --- |");
  for (const d of analysis.firstPartyDivergent.slice(0, 40)) {
    L.push(`| \`${d.name}\` | **${d.ourVersions.join(", ")}** | ${d.versions.join(", ")} | ${d.majors.join(", ")} | ${d.directInWorkspaces.join(", ")} |`);
  }
  L.push("");
  L.push(`### Tier 2 — same-major duplicates (${t.dedupeCandidateNames} names — UPPER BOUND on dedupe)`);
  L.push("");
  L.push("Same major, multiple minor/patch versions, not already pinned. This is an UPPER BOUND — `pnpm dedupe` only collapses the subset whose consumer ranges actually overlap; the rest are pinned to distinct sub-ranges by their consumers and are NOT safely collapsible. `pnpm dedupe --check` gives the true count.");
  L.push("");
  L.push("| Package | Versions |");
  L.push("| --- | --- |");
  for (const d of analysis.dedupeCandidates.slice(0, 30)) {
    L.push(`| \`${d.name}\` | ${d.versions.join(", ")} |`);
  }
  L.push("");
  L.push("### Tier 3 — multi-major duplicates (investigate; many are transitive/peer-locked)");
  L.push("");
  L.push("| Package | Majors | Versions | Already pinned? |");
  L.push("| --- | --- | --- | --- |");
  for (const d of analysis.multiMajor.slice(0, 40)) {
    L.push(`| \`${d.name}\` | ${d.majors.join(", ")} | ${d.versions.join(", ")} | ${d.overrideGoverned ? "✅ override" : "—"} |`);
  }
  L.push("");
  L.push("### Widest fan-out (most versions of one name)");
  L.push("");
  L.push("| Package | # versions | Versions | Already pinned? |");
  L.push("| --- | ---: | --- | --- |");
  for (const d of analysis.duplicates.slice(0, 30)) {
    L.push(`| \`${d.name}\` | ${d.versionCount} | ${d.versions.join(", ")} | ${d.overrideGoverned ? "✅ override" : "—"} |`);
  }
  L.push("");
  L.push("## Published container images");
  L.push("");
  L.push("Full per-container SBOMs ship as buildx attestations at release time (see `.github/workflows/publish-image.yml`, `sbom: true`):");
  L.push("");
  for (const img of images) L.push(`- \`${img}\``);
  L.push("");
  return L.join("\n");
}

// ── reusable entry point (imported by check-sbom-drift.mjs) ─────────────
export function generatePlatformSbom({ root, gitRef, generatedAt }) {
  const lockText = readFileSync(join(root, "pnpm-lock.yaml"), "utf8").replace(/\r\n/g, "\n");
  const lines = lockText.split("\n");
  const workspaceYaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");

  let rootName = "dpf-platform";
  let rootVersion = "0.0.0";
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    rootName = pkg.name ?? rootName;
    rootVersion = pkg.version ?? rootVersion;
  } catch { /* root package.json optional */ }

  let images = [];
  try {
    images = parseImageNames(readFileSync(join(root, ".github/workflows/publish-image.yml"), "utf8"));
  } catch { /* workflow optional */ }

  const importers = parseImporters(lines);
  const packages = parsePackages(lines);
  const overrideTargets = parseOverrideTargets(workspaceYaml);

  const cyclonedx = buildCycloneDx({ packages, images, gitRef, generatedAt, rootName, rootVersion });
  const analysis = analyze({ packages, importers, overrideTargets });
  const documentDigest = createHash("sha256").update(JSON.stringify(cyclonedx)).digest("hex");

  return { cyclonedx, analysis, documentDigest, images, gitRef, generatedAt };
}

// Direct (first-party-declared) dependencies across all workspaces, keyed by
// name. These are the packages we *deliberately acquire* — the unit the New
// Dependency Gate governs (transitives ride in via these and are covered by the
// OSV scan + reduction guard).
export function listDirectDependencies(root) {
  const lockText = readFileSync(join(root, "pnpm-lock.yaml"), "utf8").replace(/\r\n/g, "\n");
  const importers = parseImporters(lockText.split("\n"));
  const byName = new Map();
  for (const [ws, imp] of Object.entries(importers)) {
    for (const kind of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const d of imp[kind]) {
        if (!byName.has(d.name)) byName.set(d.name, { workspaces: new Set(), kinds: new Set(), versions: new Set() });
        byName.get(d.name).workspaces.add(ws);
        byName.get(d.name).kinds.add(kind === "dependencies" ? "prod" : kind === "devDependencies" ? "dev" : "optional");
        if (d.version) byName.get(d.name).versions.add(d.version);
      }
    }
  }
  return byName;
}

// ── CLI ─────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date();
  const { cyclonedx, analysis, documentDigest, images } = generatePlatformSbom({
    root: args.root,
    gitRef: args.gitRef,
    generatedAt,
  });
  const markdown = renderMarkdown({ analysis, images, gitRef: args.gitRef, generatedAt });

  mkdirSync(args.out, { recursive: true });
  const sbomPath = join(args.out, "dpf-platform-sbom.cdx.json");
  const analysisJsonPath = join(args.out, "dpf-platform-sbom-analysis.json");
  const analysisMdPath = join(args.out, "dpf-platform-sbom-analysis.md");

  writeFileSync(sbomPath, JSON.stringify(cyclonedx, null, 2));
  writeFileSync(analysisJsonPath, JSON.stringify({ generatedAt: generatedAt.toISOString(), gitRef: args.gitRef, documentDigest, ...analysis }, null, 2));
  writeFileSync(analysisMdPath, markdown);

  const t = analysis.totals;
  process.stdout.write(
    [
      `SBOM written: ${sbomPath}`,
      `  components=${t.resolvedComponents} uniqueNames=${t.uniqueNames} images=${images.length} digest=${documentDigest.slice(0, 12)}`,
      `Analysis:     ${analysisMdPath}`,
      `  duplicatedNames=${t.duplicatedNames} excessInstances=${t.excessInstances} multiMajor=${t.multiMajorNames}`,
      "",
    ].join("\n"),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
