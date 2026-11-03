import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { callerGateDirectory, createGateFixtureTls, gateArtifactStamps, isolatedGateFixtureEnvironment, makeTempWorktree, startGateFixtureMcp } from "./fixtures/gate-worktree.mjs";
import { exitCodeForVerdict } from "./lib/pregate-status.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nativeHelper = join(root, "scripts/lib/windows-console-cancellation.test-support.ps1");
const json = path => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } };
const sha256 = path => createHash("sha256").update(readFileSync(path)).digest("hex");
async function until(predicate, describe, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = predicate(); if (value) return value; await delay(50); }
  throw new Error("Fixture timed out: " + describe);
}
// Trust startup re-execs Node to load the fixture CA. A loaded host preflight
// passed 20s with the child still not ready. The helper keeps its driver at
// 120s and its launcher at 150s, both above this wait plus Ctrl+C settlement.
const CANCEL_READY_TIMEOUT_MS = 60_000;

function assertNaturalJobClosure(drain) {
  assert.equal(drain?.outcome, "naturally-empty", JSON.stringify(drain));
  assert.equal(drain.finalActiveCount, 0);
  assert.deepEqual(drain.finalMembers, []);
  assert.equal(drain.failure, null);
  assert.equal(drain.budgetMs, 10000);
  assert.ok(drain.elapsedMs >= 0 && drain.elapsedMs < drain.budgetMs);
  assert.ok(drain.snapshots.length > 0);
  assert.ok(Number.isFinite(Date.parse(drain.observedAt)));
}
function pnpmBatch() {
  const resolved = spawnSync("where.exe", ["pnpm.cmd"], { encoding: "utf8" });
  assert.equal(resolved.status, 0, resolved.stderr);
  const path = resolved.stdout.split(/\r?\n/).find(value => value.trim());
  assert.ok(path && existsSync(path));
  return path.trim(); // Deliberately retain the batch path, not host-command-invocation's Node rewrite.
}

function writeHarmlessCommand(path, cancel, ready, heartbeat, tree, fails) {
  const lines = [
    'import { readFileSync, writeFileSync, appendFileSync } from "node:fs";',
    'import {getCACertificates} from "node:tls";',
    'const context = JSON.parse(process.env.DPF_GATE_EXECUTION_CONTEXT);',
    'writeFileSync(' + JSON.stringify(ready) + ', JSON.stringify({ pid:process.pid, context, startupExtraRootCount:getCACertificates("extra").length }));',
  ];
  if (cancel) {
    lines.push('setInterval(() => appendFileSync(' + JSON.stringify(heartbeat) + ', "x"), 50);');
  } else {
    lines.push(
      'const artifact = ' + (fails ? 'null;' : '{kind:"delegated",identity:"fixture-only-no-canonical-publication"};'),
      'const metadata = { candidateSha:context.sha,candidateRef:context.branch,runLeaseId:context.leaseId,',
      'baseSha:context.sha,integrationCommitSha:context.sha,synthesizedTreeSha:' + JSON.stringify(tree) + ',',
      'evidencePlan:{digest:"e".repeat(64),policyVersion:"fixture-only"},toolchainFingerprint:"f".repeat(64),',
      'productionArtifact:artifact,commands:[{command:"actual harmless console fixture command"}],',
      'execution:{status:' + JSON.stringify(fails ? "failed" : "passed") + ',exitCode:' + (fails ? 9 : 0) + ',completedCommandCount:1},completedAt:new Date().toISOString()};',
      'writeFileSync(context.metadataFile,JSON.stringify(metadata));',
      'writeFileSync(context.artifactFile,JSON.stringify(artifact));',
      'process.exit(' + (fails ? 9 : 0) + ');',
    );
  }
  writeFileSync(path, lines.join("\n") + "\n");
}

for (const scenario of ["success", "cancellation", "failure", "trust-cancellation", "delayed-release-cancellation", "over-budget-release-cancellation"]) {
  const overBudgetRelease = scenario === "over-budget-release-cancellation";
  const delayedRelease = scenario === "delayed-release-cancellation" || overBudgetRelease;
  const cancel = scenario.endsWith("cancellation"), fails = scenario === "failure", needsTrust = scenario === "trust-cancellation";
  test("real Windows pnpm.cmd " + (overBudgetRelease ? "over-budget release cancellation stays unverified" : delayedRelease ? "delayed release cancellation settles before cleanup" : needsTrust ? "trusted startup cancellation preserves native settlement" : cancel ? "cancellation persists native non-success" : fails ? "actual child failure stays failed" : "normal completion reaches the native writer"),
    { skip: process.platform !== "win32", timeout: 240_000 }, async t => {
    const evidence = mkdtempSync(join(tmpdir(), "dpf-console-acceptance-"));
    const tls = needsTrust ? createGateFixtureTls(evidence) : null;
    const worktree = makeTempWorktree({ pregateScript: join(root, "scripts/pregate.mjs") });
    const originalStamps = gateArtifactStamps(callerGateDirectory(root));
    const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: worktree, encoding: "utf8" }).stdout.trim();
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: worktree, encoding: "utf8" }).stdout.trim();
    const tree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: worktree, encoding: "utf8" }).stdout.trim();
    const stateFile = join(worktree, ".git/dpf-local-ci-gate.json");
    const ready = join(evidence, "command-ready.json");
    const heartbeat = join(evidence, "owned-heartbeat.txt");
    const command = join(evidence, "harmless-command.mjs");
    writeHarmlessCommand(command, cancel, ready, heartbeat, tree, fails);
    const leaseId = "NPEL-CONSOLE-FIXTURE";
    const mcp = await startGateFixtureMcp(async call => {
      // Renew returns this same grant, and the supervisor fences at its expiry.
      // The grant has to outlive the 150s launcher budget.
      const lease = { leaseId, expiresAt: new Date(Date.now() + 300_000).toISOString() };
      if (call.name === "claim_nonprod_environment_lease") return { success: true, entityId: leaseId,
        data: { lease, gateKey: "c".repeat(64), admission: { status: "admitted", slotKey: "slot-0", waitAgeMs: 0 } } };
      if (call.name === "renew_nonprod_environment_lease") return { success: true, entityId: leaseId, data: { lease } };
      if (call.name === "record_local_integration_result") return { success: true, entityId: "FIXTURE-ONLY-CONSOLE-RESULT" };
      if (call.name === "get_quiescence_status") return { success: true, data: { level: "normal" } };
      if (call.name === "list_nonprod_environment_leases") return { success: true, data: { leases: [], queued: [] } };
      if (call.name === "release_nonprod_environment_lease") {
        assert.equal(call.args.leaseId, leaseId);
        const prior = mcp.calls.filter(value => value.name === call.name).length > 1;
        call.fixtureDisposition = prior ? "already-released" : "released";
        if (delayedRelease) {
          call.ackHeldAt = new Date().toISOString();
          try {
            const snapshot = await until(() => json(join(evidence, "driver-result.json")), "early driver closure snapshot", 30000);
            call.earlyLiveIdentities = snapshot.liveBeforeHarnessCleanup;
            // Keep ACK pending across the old first destructive cleanup boundary.
            if (overBudgetRelease) await until(() => json(join(evidence, "launcher-result.json")), "bounded launcher settlement outcome", 30000);
            else await delay(250);
            call.acknowledgedAt = new Date().toISOString();
          } catch (error) { call.ackFailure = error.message; throw error; }
        }
        return { success: true, data: { disposition: call.fixtureDisposition } };
      }
      throw new Error("Unexpected fixture MCP tool: " + call.name);
    }, { tls });
    const pnpm = pnpmBatch();
    const env = isolatedGateFixtureEnvironment(evidence, {
      DPF_MCP_URL: mcp.url,
      ...(tls ? { DPF_MCP_CA_FILE: tls.cert } : {}),
      DPF_LOCAL_CI_COMMAND: '"' + process.execPath + '" "' + command + '"',
    }, { ...process.env, CI: "true", GITHUB_ACTIONS: "true", DPF_PREGATE_ALLOW_CAPTURE: "1", DPF_SOURCE_ROOT: "must-not-inherit", DPF_MCP_CLIENT_SECRET: "must-not-inherit" });
    assert.equal(env.CI, undefined); assert.equal(env.DPF_SOURCE_ROOT, undefined);
    const configuration = join(evidence, "configuration.json");
    writeFileSync(configuration, JSON.stringify({ worktree, evidenceDirectory: evidence, pnpm,
      arguments: ["run", "pregate", "--", "--branch", branch, "--worktree", worktree, "--no-push", "--mcp-url", mcp.url,
        "--owner-provider", "codex", "--owner-session-id", "console-acceptance-fixture", "--expires-minutes", "1"] }));
    const sentinelPath = join(evidence, "outside-sentinel.txt");
    const sentinelScript = join(evidence, "sentinel.mjs");
    writeFileSync(sentinelScript, 'import {appendFileSync} from "node:fs"; setInterval(()=>appendFileSync(' + JSON.stringify(sentinelPath) + ',"x"),50);');
    const sentinel = spawn(process.execPath, [sentinelScript], { env, windowsHide: true, stdio: "ignore" });
    const sentinelClosed = once(sentinel, "close");
    const driver = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", nativeHelper, "-Configuration", configuration],
      { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [driver.stdout, driver.stderr]) stream.on("data", chunk => { output = (output + chunk).slice(-32768); });
    const closed = once(driver, "close");
    let runnerFailure = null, pnpmVersion = null;
    try {
      assert.doesNotMatch(pnpm, /["%!^&|<>\r\n]/);
      const version = spawnSync(env.ComSpec || env.COMSPEC, ["/d", "/s", "/c", '""' + pnpm + '" --version"'],
        { env, encoding: "utf8", timeout: 10000, windowsHide: true, windowsVerbatimArguments: true });
      assert.equal(version.status, 0, version.stderr); pnpmVersion = version.stdout.trim();
      await until(() => existsSync(sentinelPath), "outside sentinel ready");
      if (cancel) {
        await until(() => {
          const state = json(stateFile);
          return state?.status === "running" && state.leaseId === leaseId && json(ready) && existsSync(heartbeat);
        }, "real admission, running marker and harmless child ready", CANCEL_READY_TIMEOUT_MS);
        if (needsTrust) {
          assert.equal(env.NODE_EXTRA_CA_CERTS, undefined, "the original launcher must require startup re-exec");
          assert.equal(json(ready).startupExtraRootCount, 1, "the real trusted child must load the isolated CA at startup");
        }
        writeFileSync(join(evidence, "cancel.request"), "owned console only\n");
      }
      const [exitCode] = await closed;
      const result = json(join(evidence, "driver-result.json"));
      if (overBudgetRelease) {
        const launcher = json(join(evidence, "launcher-result.json"));
        assert.notEqual(exitCode, 0, output + JSON.stringify(launcher));
        assert.equal(launcher?.jobDrain?.outcome, "timed-out", JSON.stringify(launcher));
        assert.equal(launcher.emergencyCleanup, true);
        assert.ok(launcher.jobDrain.finalActiveCount > 0);
        assert.ok(launcher.jobDrain.elapsedMs >= launcher.jobDrain.budgetMs);
        assert.ok(result.liveBeforeHarnessCleanup.length > 0);
        assert.equal(json(join(evidence, "driver-cleanup.json"))?.emergencyCleanup, false);
        assert.equal(mcp.calls.filter(call => call.name === "release_nonprod_environment_lease").length, 1);
        assert.equal(mcp.calls.filter(call => call.name === "record_local_integration_result").length, 0);
        assert.equal(json(stateFile)?.gatePassed, false, "unsettled native result must not become a pass");
        assert.equal(json(stateFile)?.evidenceRecordId, "");
        const before = readFileSync(sentinelPath, "utf8").length; await delay(150);
        assert.ok(readFileSync(sentinelPath, "utf8").length > before, "outside console sentinel was interrupted");
        return;
      }
      assert.equal(exitCode, 0, output + JSON.stringify(result));
      assert.equal(result?.failure, null, JSON.stringify(result));
      if (delayedRelease) {
        assert.ok(result.liveBeforeHarnessCleanup.length > 0, "regression must cross the early closure window");
        const release = mcp.calls.find(call => call.name === "release_nonprod_environment_lease");
        assert.deepEqual(release.earlyLiveIdentities, result.liveBeforeHarnessCleanup);
        assert.ok(release.acknowledgedAt);
      }
      assert.equal(json(join(evidence, "driver-cleanup.json"))?.emergencyCleanup, false);
      const launcher = json(join(evidence, "launcher-result.json"));
      assert.equal(launcher?.emergencyCleanup, false, JSON.stringify(launcher));
      assertNaturalJobClosure(launcher?.jobDrain);
      const state = json(stateFile);
      assert.ok(state, "native marker missing: " + JSON.stringify(result));
      assert.equal(state.sha, head);
      assert.ok(mcp.calls.some(call => call.name === "claim_nonprod_environment_lease"));
      assert.equal(mcp.calls.filter(call => call.name === "release_nonprod_environment_lease").length, 1, "native owner must release the fixture lease exactly once");
      if (cancel) {
        assert.equal(result.sent, true);
        assert.ok(result.controlWitnessCount > 0, "owned console witness did not receive Ctrl-C");
        assert.equal(state.gatePassed, false);
        assert.equal(state.status, "blocked_child_signal_death", "the inner owner must persist the observed cancellation");
        const events = state.leaseEvents ?? [];
        assert.ok(events.some(event => event.type === "signal" && event.signal === "SIGINT"),
          "the gate owner did not record the real console signal");
        const recorded = mcp.calls.filter(call => call.name === "record_local_integration_result");
        assert.equal(recorded.length, 1, "the inner owner must call the fixture result writer exactly once");
        assert.equal(recorded[0].args.status, state.status);
        assert.equal(recorded[0].args.evidence.gatePassed, false);
        assert.equal(recorded[0].args.leaseId, leaseId);
        assert.match(recorded[0].args.summary, /gate owner received SIGINT/);
        assert.doesNotMatch(recorded[0].args.summary, /out of memory|box is quieter/i);
        assert.equal(state.evidenceRecordId, "FIXTURE-ONLY-CONSOLE-RESULT");
        assert.equal(mcp.calls.some(call => call.name === "record_local_integration_result" && call.args.status === "passed"), false);
        const stopped = readFileSync(heartbeat, "utf8"); await delay(150);
        assert.equal(readFileSync(heartbeat, "utf8"), stopped, "owned child kept writing");
      } else if (fails) {
        assert.equal(result.sent, false); assert.equal(state.gatePassed, false);
        assert.equal(state.status, "failed"); assert.equal(state.childExitCode, 9);
        assert.ok(Number.isInteger(result.exitCode) && result.exitCode !== 0);
        const checkpoint = json(json(ready).context.path);
        assert.equal(checkpoint.exitCode, 9); assert.equal(checkpoint.metadata.execution.status, "failed");
        assert.equal(checkpoint.canonicalEvidenceId, null);
        const record = mcp.calls.find(call => call.name === "record_local_integration_result");
        assert.equal(record.args.status, "failed"); assert.equal(record.args.evidence.gatePassed, false);
        assert.doesNotMatch(record.args.summary, /gate owner received/);
      } else {
        assert.equal(result.exitCode, 0);
        assert.equal(result.sent, false);
        assert.equal(state.gatePassed, true, JSON.stringify(state));
        assert.equal(state.evidenceRecordId, "FIXTURE-ONLY-CONSOLE-RESULT");
        const context = json(ready).context;
        assert.equal(json(context.path)?.canonicalEvidenceId, null);
      }
      const status = spawnSync(process.execPath, [join(root, "scripts/pregate-status.mjs"), "--json"], { cwd: worktree, env, encoding: "utf8" });
      writeFileSync(join(evidence, "native-status.json"), status.stdout);
      const projected = JSON.parse(status.stdout);
      const expectedVerdict = cancel ? "INCONCLUSIVE" : fails ? "FAIL" : "PASS";
      assert.equal(projected.verdict, expectedVerdict, status.stdout);
      assert.equal(status.status, exitCodeForVerdict(expectedVerdict));
      assert.equal(projected.headSha, head); assert.equal(projected.boundSha, head);
      assert.equal(projected.headBranch, branch); assert.equal(projected.boundBranch, branch);
      assert.equal(projected.gateStatus, state.status);
      const before = readFileSync(sentinelPath, "utf8").length; await delay(150);
      assert.ok(readFileSync(sentinelPath, "utf8").length > before, "outside console sentinel was interrupted");
    } catch (error) { runnerFailure = error.message; throw error; }
    finally {
      if (driver.exitCode === null) {
        writeFileSync(join(evidence, "abort.request"), "owned Job cleanup required\n");
        await closed; // Launcher has a native deadline and drains its owned Job before closing.
      }
      sentinel.kill(); await sentinelClosed;
      await mcp.close();
      writeFileSync(join(evidence, "test-observation.json"), JSON.stringify({ kind: "source-local-fixture-not-canonical", scenario, cancel,
        sourceRoot: root, sourceHead: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(),
        helperSha256: sha256(nativeHelper), fixtureHead: head, fixtureTree: tree, worktree, envKeys: Object.keys(env), pnpm,
        pnpmVersion, pnpmBatchSha256: sha256(pnpm),
        sourceFiles: Object.fromEntries(["scripts/pregate.mjs", "scripts/lib/mcp-host-trust.mjs", "scripts/lib/foreground-gate-process.mjs", "scripts/gate-worktree.mjs", "scripts/lib/run-in-windows-job.ps1", "scripts/lib/gate-execution-checkpoint.mjs"].map(path => [path, { source: sha256(join(root, path)), fixture: sha256(join(worktree, path)) }])),
        calls: mcp.calls, state: json(stateFile), runnerFailure, output }, null, 2));
      t.diagnostic("Fixture evidence retained: " + evidence);
      assert.deepEqual(gateArtifactStamps(callerGateDirectory(root)), originalStamps, "caller gate artifacts changed");
    }
  });
}

for (const probe of ["empty", "short-lived", "persistent", "query-failure", "identity-failure", "identity-cleanup-failure", "exited-member", "missing-job", "driver-failure"]) {
  test("Windows owned Job drain " + probe, { skip: process.platform !== "win32", timeout: 30000 }, async t => {
    const evidence = mkdtempSync(join(tmpdir(), "dpf-job-drain-"));
    const configuration = join(evidence, "configuration.json");
    const child = join(evidence, "probe-child.mjs");
    const ready = join(evidence, "probe-child-ready.json"), release = join(evidence, "probe-exit.request");
    const heartbeat = join(evidence, "probe-heartbeat.txt");
    writeFileSync(child, [
      'import {appendFileSync,existsSync,writeFileSync} from "node:fs";',
      'writeFileSync(' + JSON.stringify(ready) + ',JSON.stringify({pid:process.pid}));',
      'const timer=setInterval(()=>{appendFileSync(' + JSON.stringify(heartbeat) + ',"x");',
      ...(["short-lived", "driver-failure", "exited-member"].includes(probe) ? ['if(existsSync(' + JSON.stringify(release) + ')){clearInterval(timer);setTimeout(()=>process.exit(0),100);}'] : []),
      '},25);',
    ].join("\n"));
    writeFileSync(configuration, JSON.stringify({ worktree: evidence, evidenceDirectory: evidence,
      jobProbe: { kind: probe, node: process.execPath, child } }));
    const launcher = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", nativeHelper, "-Configuration", configuration],
      { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [launcher.stdout, launcher.stderr]) stream.on("data", chunk => { output = (output + chunk).slice(-32768); });
    const closed = once(launcher, "close");
    try {
      const [exitCode] = await closed;
      const result = json(join(evidence, "launcher-result.json"));
      assert.ok(result, output);
      const drain = result.jobDrain;
      assert.ok(Date.parse(result.cleanupStartedAt) >= Date.parse(drain.observedAt), "cleanup preceded final Job observation");
      assert.ok(Number.isFinite(Date.parse(result.cleanupCompletedAt)));
      if (["empty", "short-lived", "driver-failure"].includes(probe)) {
        if (probe === "driver-failure") {
          assert.notEqual(exitCode, 0, "natural closure cannot erase the failed driver");
          assert.match(result.failure, /Private console driver exit 1/);
          const driverCleanup = json(join(evidence, "driver-cleanup.json"));
          assert.equal(driverCleanup?.outcome, "release-failed");
          assert.match(driverCleanup.failure, /Injected driver handle-release failure/);
          assert.equal(driverCleanup.emergencyCleanup, false);
        } else {
          assert.equal(exitCode, 0, output + JSON.stringify(result));
          assert.equal(result.failure, null);
        }
        assert.equal(result.emergencyCleanup, false);
        assertNaturalJobClosure(drain);
        if (probe === "empty") assert.equal(drain.initialActiveCount, 0);
        else {
          const identity = json(join(evidence, "probe-identity.json"));
          assert.ok(drain.initialActiveCount > 0);
          assert.ok(drain.initialMembers.includes(identity.identity), JSON.stringify(drain));
          assert.equal(identity.pid, json(ready).pid);
          assert.match(identity.identity, /^\d+:\d+$/);
          assert.equal(identity.consoleMember, false, "probe must cover a descendant absent from console membership");
        }
      } else {
        assert.notEqual(exitCode, 0, output + JSON.stringify(result));
        assert.equal(result.emergencyCleanup, probe !== "exited-member", JSON.stringify(result));
        assert.equal(drain.outcome, probe === "persistent" ? "timed-out" : "observation-failed");
        assert.ok(result.failure);
        if (probe === "persistent") {
          assert.ok(drain.finalActiveCount > 0);
          assert.ok(drain.elapsedMs >= drain.budgetMs);
          assert.ok(drain.finalMembers.includes(json(join(evidence, "probe-identity.json")).identity));
        } else {
          assert.ok(drain.failure, JSON.stringify(drain));
          if (probe === "exited-member") {
            const snapshot = drain.snapshots.at(-1);
            assert.equal(snapshot.failureOperation, "OpenProcess");
            assert.equal(snapshot.failureNativeError, 87);
            assert.equal(snapshot.failurePid, json(ready).pid);
            assert.equal(snapshot.probeExitedIdentity, json(join(evidence, "probe-identity.json")).identity);
            assert.equal(snapshot.cleanupFailure, null);
          }
          if (["query-failure", "identity-failure", "identity-cleanup-failure"].includes(probe)) {
            const snapshot = drain.snapshots.at(-1);
            assert.equal(snapshot.failureOperation, probe === "query-failure" ? "QueryInformationJobObject(membership)" : "GetProcessTimes");
            assert.equal(snapshot.failureNativeError, 6);
            assert.equal(drain.failureOperation, snapshot.failureOperation);
            assert.equal(drain.failureNativeError, snapshot.failureNativeError);
            if (probe === "identity-cleanup-failure") {
              assert.equal(snapshot.cleanupNativeError, 6);
              assert.ok(snapshot.cleanupFailure);
              assert.equal(drain.cleanupNativeError, 6);
            } else assert.equal(snapshot.cleanupFailure, null);
            if (probe.startsWith("identity-")) assert.ok(snapshot.failurePid > 0);
            else assert.equal(snapshot.failurePid, null);
          }
        }
      }
      if (probe !== "empty") {
        const stopped = readFileSync(heartbeat, "utf8"); await delay(100);
        assert.equal(readFileSync(heartbeat, "utf8"), stopped, "owned probe survived closure or emergency containment");
      }
    } finally {
      if (launcher.exitCode === null) { writeFileSync(join(evidence, "abort.request"), "bounded test teardown\n"); await closed; }
      t.diagnostic("Job-drain fixture retained: " + evidence);
    }
  });
}
