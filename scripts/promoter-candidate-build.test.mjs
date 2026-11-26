// Self-test for the candidate promoter build (BI-224F56F1, DI-B3171A8F09DC).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildCandidate, parseCandidateRequest, safeContextEntry } from "./promoter-candidate-build.mjs";

const sha = "a".repeat(40);
const imageId = `sha256:${"b".repeat(64)}`;

function workspace(sources) {
  const root = mkdtempSync(join(tmpdir(), "candidate-ws-"));
  mkdirSync(join(root, "apps/web/lib/self-upgrade"), { recursive: true });
  writeFileSync(join(root, "apps/web/lib/self-upgrade/promoter-build-context.ts"),
    `export const PROMOTER_BUILD_CONTEXT_SOURCES: readonly string[] = [\n${sources.map((s) => `  "${s}",`).join("\n")}\n] as const;\n`);
  writeFileSync(join(root, "promoter-contract.json"), "{}\n");
  writeFileSync(join(root, "Dockerfile.promoter"), "FROM scratch\n");
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts/promote.sh"), "#!/bin/sh\n");
  return root;
}

test("accepts only a full target SHA", () => {
  assert.deepEqual(parseCandidateRequest(JSON.stringify({ targetSha: sha })), { targetSha: sha });
  for (const raw of ["", "{}", JSON.stringify({ targetSha: "abc" }), JSON.stringify({ targetSha: sha, image: "x" })]) {
    assert.throws(() => parseCandidateRequest(raw), /candidate_request_invalid/);
  }
});

test("refuses context entries that leave the workspace", () => {
  assert.equal(safeContextEntry("scripts/promote.sh"), true);
  for (const entry of ["/etc/passwd", "../outside", "scripts/../../x", "", "scripts//x"]) assert.equal(safeContextEntry(entry), false);
});

test("stages only the declared context, builds the target tag and reports its image ID", async () => {
  const root = workspace(["promoter-contract.json", "scripts/promote.sh"]);
  const calls = [];
  const docker = async (args) => {
    calls.push(args);
    if (args[0] === "buildx") {
      const context = args.at(-1);
      assert.ok(existsSync(join(context, "scripts/promote.sh")));
      assert.ok(existsSync(join(context, "Dockerfile.promoter")));
      assert.ok(!existsSync(join(context, "apps")), "the workspace tree is never staged");
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    return { exitCode: 0, stdout: `${imageId}\n`, stderr: "" };
  };
  try {
    assert.deepEqual(await buildCandidate({ targetSha: sha }, { root, docker }), { ok: true, image: `dpf-promoter:${sha}`, imageId });
    assert.deepEqual(calls[0].slice(0, 3), ["buildx", "build", "--load"]);
    assert.ok(calls[0].includes(`DPF_PROMOTER_SOURCE_SHA=${sha}`));
    assert.ok(!existsSync(calls[0].at(-1)), "the staged context is removed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("refuses a traversing context list without building", async () => {
  const root = workspace(["../../etc/passwd"]);
  let built = false;
  try {
    assert.deepEqual(await buildCandidate({ targetSha: sha }, { root, docker: async () => { built = true; return { exitCode: 0, stdout: "", stderr: "" }; } }),
      { ok: false, reason: "context-invalid" });
    assert.equal(built, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports a failed build instead of an image", async () => {
  const root = workspace(["scripts/promote.sh"]);
  try {
    const result = await buildCandidate({ targetSha: sha }, { root, retryDelayMs: 0,
      docker: async (args) => args[0] === "buildx" ? { exitCode: 1, stdout: "", stderr: "ERROR: failed to solve" } : { exitCode: 0, stdout: imageId, stderr: "" } });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "build-failed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
