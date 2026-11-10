import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { activeLifecycleFiles, assertHostStateWiring, auditLifecycleSurfaces, destructivePreludes, findDestroyWithoutDump, formatAuditFailure, legacyExceptions, promoterCopyInputs } from "./lifecycle-surface-policy.mjs";
import { classifySensitivePath } from "./self-upgrade-sensitive-paths.mjs";
import { readPromoterBuildContextSources } from "./lib/promoter-build-context-sources.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("active lifecycle surfaces contain no retired runtime operations", async () => {
  const result = await auditLifecycleSurfaces(root);
  assert.deepEqual(result.violations, [], formatAuditFailure(result, root));
  assert.deepEqual(result.stale, [], formatAuditFailure(result, root));
  assert.equal(result.remediationCount, 0, `expected zero remediation entries, found ${result.remediationCount}`);
});

test("lifecycle inventory is exact and contains no duplicates", () => {
  assert.equal(new Set(activeLifecycleFiles).size, activeLifecycleFiles.length);
  assert.equal(new Set(legacyExceptions.map((entry) => entry.id)).size, legacyExceptions.length);
  for (const entry of legacyExceptions) {
    assert.ok(entry.reason && entry.supportedSourceFloor && entry.removalMilestone);
  }
});

test("promoter COPY inputs are derived from its Dockerfile", async () => {
  // Dockerfile.promoter copies `scripts/` as a directory so a candidate stays
  // buildable by an already-deployed N-1 portal whose staged context predates a
  // newly added file (BI-A04D61B9). The Dockerfile therefore names the
  // directory; the staged closure names the files.
  const dockerfile = await readFile(resolve(root, "Dockerfile.promoter"), "utf8");
  const inputs = promoterCopyInputs(dockerfile);
  assert.ok(inputs.includes("scripts/"), "the script closure must arrive as one directory COPY");
  assert.equal(new Set(inputs).size, inputs.length);

  const staged = await readPromoterBuildContextSources(root);
  assert.ok(staged.includes("scripts/promote.sh"));
  assert.ok(staged.includes("scripts/installer/install-state.schema.json"));
  assert.equal(new Set(staged).size, staged.length);
});

// CodeQL js/redos alert #372 (high): the COPY matcher used `[^ ]+` for flag
// bodies, which excludes only a literal SPACE — so it could also consume tabs,
// exactly like the adjacent `\s+`. A single `(?:--[^ ]+\s+)` iteration could
// therefore match what two iterations match, the classic ambiguity behind
// exponential backtracking. The fix makes the two classes disjoint (`\S+` vs
// horizontal whitespace) so no input can be split between them.
//
// Honesty note: no input was found that actually detonates the old pattern in
// V8 (crafted "--\t"/"!\t--" runs up to n=60 all returned in <1ms), so this is
// the removal of a LATENT ambiguity, not a patch for a demonstrated hang. The
// timing assertion below is therefore a cheap canary against a future edit
// reintroducing catastrophic backtracking — it is NOT proof the old code was
// exploitable, and it passed before the fix too. The tests that carry real
// weight here are the behavioural ones: the risk in this change is breaking
// promoter COPY parsing, not the regex being slow.
test("promoterCopyInputs stays linear on a crafted COPY line (canary)", () => {
  const crafted = `COPY ${"--\t".repeat(60)}`;
  const started = process.hrtime.bigint();
  promoterCopyInputs(crafted);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 1000, `regex took ${elapsedMs.toFixed(0)}ms — catastrophic backtracking (js/redos #372)`);
});

test("promoterCopyInputs still parses flagged and tab-separated COPY forms", () => {
  assert.deepEqual(promoterCopyInputs("COPY scripts/a.sh /app/a.sh"), ["scripts/a.sh"]);
  assert.deepEqual(
    promoterCopyInputs("COPY --chown=node:node --chmod=755 scripts/b.sh /app/b.sh"),
    ["scripts/b.sh"],
    "flag prefixes must still be skipped rather than captured",
  );
  assert.deepEqual(promoterCopyInputs("COPY\tscripts/c.sh\t/app/c.sh"), ["scripts/c.sh"], "tab separators stay supported");
  assert.deepEqual(promoterCopyInputs("COPY --from=build /out /app"), [], "--from stages are still excluded");
  assert.deepEqual(
    promoterCopyInputs("COPY a.sh /app/a.sh\nRUN echo hi\nCOPY b.sh /app/b.sh"),
    ["a.sh", "b.sh"],
    "matching must stay line-anchored",
  );
});

test("compose wires the resolved host state into portal and promoter", async () => {
  const compose = await readFile(resolve(root, "docker-compose.yml"), "utf8");
  assert.deepEqual(assertHostStateWiring(compose), []);
});

test("upgrade-sensitive lifecycle entrypoints are owned by the N-1 classifier", () => {
  const runtimeEntrypoints = activeLifecycleFiles.filter((path) => /^(?:install-dpf|uninstall-dpf|dpf-reinstall|scripts\/(?:fresh-install|setup|verify-install|installer\/))/.test(path));
  assert.deepEqual(runtimeEntrypoints.filter((path) => !classifySensitivePath(path)), []);
});

test("a lifecycle script that destroys the database must call the pre-destructive dump first (BI-F9939341)", () => {
  const file = "dpf-reinstall.ps1";
  const dumpsFirst = [
    "function Invoke-PreDestructivePostgresDump { param($InstallDir) }",
    "$x = Invoke-PreDestructivePostgresDump -InstallDir $DPF_DIR -Trigger 'dpf-reinstall'",
    "docker compose down -v --remove-orphans 2>$null",
  ].join("\n");
  assert.deepEqual(findDestroyWithoutDump(file, dumpsFirst), []);

  const onlyDefined = [
    "function Invoke-PreDestructivePostgresDump { param($InstallDir) }",
    "docker compose down -v --remove-orphans 2>$null",
  ].join("\n");
  assert.deepEqual(findDestroyWithoutDump(file, onlyDefined).map((v) => v.rule), ["reinstall-dumps-first"]);

  const dumpsAfter = [
    "docker compose down -v --remove-orphans 2>$null",
    "$x = Invoke-PreDestructivePostgresDump -InstallDir $DPF_DIR -Trigger 'dpf-reinstall'",
  ].join("\n");
  assert.equal(findDestroyWithoutDump(file, dumpsAfter).length, 1);

  // Every destructive script the policy names is still in the audited inventory.
  for (const rule of destructivePreludes) assert.ok(activeLifecycleFiles.includes(rule.file), rule.file);
});
