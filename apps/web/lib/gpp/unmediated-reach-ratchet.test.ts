// GPP C-9 (observe) — unmediated reach ratchet. Phase 1, T3.
// Acceptance AC-RATCHET-REACH: fails when a new direct executeTool call site is
// added outside the reference monitor; passes on main at merge.
import { describe, expect, it } from "vitest";

import { readWebSourceFiles } from "./source-files";
import {
  countByFile,
  findUnmediatedExecuteSites,
  KNOWN_UNMEDIATED_EXECUTE_SITES,
  MEDIATION_BOUNDARY_FILES,
} from "./unmediated-execute-sites";

const live = countByFile(findUnmediatedExecuteSites(readWebSourceFiles()));
const known = KNOWN_UNMEDIATED_EXECUTE_SITES;

describe("GPP C-9 unmediated reach — live tree against the shrink-only list", () => {
  it("no new path around the monitor: no unlisted file and no count above its listed value", () => {
    const grown = Object.entries(live)
      .filter(([path, count]) => count > (known[path] ?? 0))
      .map(([path, count]) => `${path}: ${count} live > ${known[path] ?? 0} listed`);
    expect(grown, "Route the call through governedExecuteTool instead of adding a direct executeTool path").toEqual([]);
  });

  it("the list only shrinks: a listed count above the live count must be lowered", () => {
    const stale = Object.entries(known)
      .filter(([path, count]) => count > (live[path] ?? 0))
      .map(([path, count]) => `${path}: listed ${count} > ${live[path] ?? 0} live`);
    expect(stale, "A direct site was removed: shrink KNOWN_UNMEDIATED_EXECUTE_SITES").toEqual([]);
  });

  // PR-H: binding-enforcement.ts refuses every promotion while any dynamic site
  // exists, so the dynamic set is pinned exactly. Shrink it as sites move behind
  // the monitor; it must never grow.
  it("dynamic sites (which block every binding promotion) are exactly the two proposal-approval paths", () => {
    const dynamic = findUnmediatedExecuteSites(readWebSourceFiles())
      .filter((site) => site.toolName === "dynamic")
      .map((site) => site.path)
      .sort();
    expect(dynamic).toEqual(["app/api/admin/ops/execute-proposal/route.ts", "lib/actions/proposals.ts"]);
  });

  it("the mediation boundary files exist and are excluded from the count", () => {
    const paths = new Set(readWebSourceFiles().map((file) => file.path));
    for (const boundary of MEDIATION_BOUNDARY_FILES) {
      expect(paths.has(boundary), boundary).toBe(true);
      expect(live[boundary]).toBeUndefined();
    }
  });
});

describe("counter self-test on a synthetic tree", () => {
  const tree = [
    { path: "lib/a.ts", content: 'await executeTool("create_portal_pr", {}, uid);' },
    { path: "lib/b.ts", content: 'const r = await executeTool(\n  "saveBuildEvidence",\n  { buildId },\n);' },
    { path: "lib/c.ts", content: "await executeTool(proposal.actionType, args, uid);" },
    { path: "lib/d.ts", content: '// executeTool("not_counted")\n * executeTool("doc comment")' },
    { path: "lib/e.test.ts", content: 'await executeTool("in_a_test", {}, uid);' },
    { path: "lib/mcp-governed-execute.ts", content: 'await executeTool(toolName, args, uid);' },
    { path: "lib/f.ts", content: 'await governedExecuteTool("governed_ok", {}, uid);' },
  ];

  it("counts real call sites and names their tools, literal or dynamic", () => {
    const sites = findUnmediatedExecuteSites(tree);
    expect(sites.map((s) => `${s.path}:${s.toolName}`)).toEqual([
      "lib/a.ts:create_portal_pr",
      "lib/b.ts:saveBuildEvidence",
      "lib/c.ts:dynamic",
    ]);
  });

  it("goes red when one extra call site is added", () => {
    const base = countByFile(findUnmediatedExecuteSites(tree));
    const withExtra = countByFile(
      findUnmediatedExecuteSites([...tree, { path: "lib/a.ts", content: 'await executeTool("deploy_feature", {}, uid);' }]),
    );
    const grown = Object.entries(withExtra).filter(([path, count]) => count > (base[path] ?? 0));
    expect(grown).toEqual([["lib/a.ts", 2]]);
  });
});
