import { test } from "node:test";
import assert from "node:assert/strict";

import { INCLUDE_WORKING_TREE_ENV } from "./lib/git-changed-files.mjs";
import { LOCAL_GATES, buildGateEnv, parseArgs, runLocalGates } from "./gate-local.mjs";

test("buildGateEnv scrubs git redirects, includes the working tree by default, and feeds the planned message as PR_BODY", () => {
  const env = buildGateEnv({ base: { PATH: "/bin", GIT_DIR: "/x/.git", PR_BODY: "existing" }, messageFile: "m.txt", readFile: () => "feat: x\n\nDocs-Impact-Decision: none needed" });
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env[INCLUDE_WORKING_TREE_ENV], "1");
  assert.match(env.PR_BODY, /^existing\n\nfeat: x/);
  const committed = buildGateEnv({ base: { PATH: "/bin" }, committed: true });
  assert.equal(committed[INCLUDE_WORKING_TREE_ENV], undefined);
});

test("parseArgs reads the message file, committed mode and an --only subset", () => {
  assert.deepEqual(parseArgs(["--message-file", "m.txt", "--committed", "--only", "ux-fit,prose-lint"]), { messageFile: "m.txt", committed: true, only: ["ux-fit", "prose-lint"] });
});

test("runLocalGates separates a failing gate from one the host could not start", () => {
  const lines = [];
  const spawn = (cmd, args) => {
    if (args.join(" ").includes("docs-impact")) return { status: 1, stdout: "", stderr: "[docs-impact-gate] FAILED — x\n   at y" };
    if (args.join(" ").includes("seed-fit")) return { status: null, error: new Error("ENOMEM") };
    return { status: 0, stdout: "ok", stderr: "" };
  };
  const results = runLocalGates({ gates: LOCAL_GATES.filter((g) => ["ux-fit", "docs-impact", "seed-fit"].includes(g.id)), env: {}, spawn, log: (l) => lines.push(l) });
  assert.deepEqual(results.map((r) => [r.id, r.status]), [["ux-fit", "passed"], ["docs-impact", "failed"], ["seed-fit", "runner_failed"]]);
  assert.ok(lines.some((l) => l.includes("✗ docs-impact")));
  assert.ok(lines.some((l) => l.includes("FAILED — x")) && !lines.some((l) => l.includes("at y")));
});
