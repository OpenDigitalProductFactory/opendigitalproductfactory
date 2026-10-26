import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
const config = `sha256:${"a".repeat(64)}`, sourceSha = "b".repeat(40);
const info = () => ({ schemaVersion: 1, sourceSha, sourceContentHash: "c".repeat(64), contractSha256: "d".repeat(64),
  owners: Object.fromEntries(["transport", "approval", "worker", "writer"].map(owner => [owner, { version: 2, sourceSha256: "e".repeat(64) }])) });
async function execute(change = "positive", fallback = false) {
  const dir = await mkdtemp(join(tmpdir(), "dpf-reassessment-promote-"));
  try {
    const script = await readFile(new URL("./promote.sh", import.meta.url), "utf8");
    const guard = script.split("# reassessment-compatibility-begin\n")[1]?.split("# reassessment-compatibility-end")[0];
    assert.ok(guard, "the actual promoter must contain its mandatory compatibility guard");
    const report = info();
    if (change === "old-version") Object.values(report.owners).forEach(owner => { owner.version = 1; });
    if (change === "mixed-version") report.owners.writer.version = 1;
    if (change === "missing-owner") delete report.owners.approval;
    if (change === "source") report.sourceSha = "f".repeat(40);
    if (change === "source-hash") report.sourceContentHash = "unknown";
    if (change === "too-large") report.sourceContentHash = "c".repeat(20_000);
    if (change === "owner-hash") report.owners.worker.sourceSha256 = "unknown";
    const log = join(dir, "docker.jsonl"), overlay = join(dir, "pinned.yml");
    await writeFile(join(dir, "docker"), `#!${process.execPath}
const fs=require('node:fs'), args=process.argv.slice(2), previous=fs.existsSync(process.env.R4_TEST_LOG)?fs.readFileSync(process.env.R4_TEST_LOG,'utf8').trim().split('\\n'):[];
fs.appendFileSync(process.env.R4_TEST_LOG,JSON.stringify(args)+'\\n');
if(process.env.R4_TEST_CHANGE==='unavailable')process.exit(1);
if(args[0]==='image')process.stdout.write(process.env.R4_TEST_CHANGE==='drift'&&previous.length===2?'sha256:'+'f'.repeat(64):process.env.R4_TEST_CONFIG);
else if(args[0]==='run')process.stdout.write(process.env.R4_TEST_REPORT);
`);
    await chmod(join(dir, "docker"), 0o755);
    const bash = `set -euo pipefail\ntimeout(){ shift 3; "$@"; }\n${guard}\n_assert_reassessment_image "dpf-portal" "$1" "$2"\n`;
    const result = spawnSync("bash", ["-c", bash, "test", fallback ? "" : sourceSha, overlay], { encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, R4_TEST_LOG: log, R4_TEST_CHANGE: change,
        R4_TEST_CONFIG: config, R4_TEST_REPORT: JSON.stringify(report) } });
    const calls = await readFile(log, "utf8").then(value => value.trim().split("\n").map(JSON.parse), () => []);
    return { status: result.status, stderr: result.stderr, stdout: result.stdout, calls,
      overlay: await readFile(overlay, "utf8").catch(() => null) };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
test("actual promoter verifies exact bytes and pins the existing compose actuator", async () => {
  const result = await execute();
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), config);
  assert.equal(result.calls[1].includes(config), true); assert.equal(result.calls[1].includes("dpf-portal"), false);
  assert.equal(result.calls[1].includes("none"), true); assert.equal(result.calls[1].includes("-v"), false);
  assert.match(result.overlay, new RegExp(`image: "${config}"`)); assert.match(result.overlay, /pull_policy: never/);
});
for (const change of ["old-version", "mixed-version", "missing-owner", "source", "source-hash", "owner-hash", "too-large", "drift", "unavailable"]) {
  test(`${change} refuses before a compose override or swap`, async () => {
    const result = await execute(change);
    assert.notEqual(result.status, 0); assert.equal(result.overlay, null);
  });
}
test("fallback has no four-owner compatibility waiver", async () => {
  assert.equal((await execute("positive", true)).status, 0);
  assert.notEqual((await execute("old-version", true)).status, 0);
});
test("candidate and restored baseline are checked at their actual swap sites", async () => {
  const source = await readFile(new URL("./promote.sh", import.meta.url), "utf8");
  const final = source.lastIndexOf('_assert_reassessment_image "$_reassessment_candidate_digest"');
  const up = source.indexOf('emit_step docker-up');
  const fallback = source.indexOf('_assert_reassessment_image "${_reassessment_baseline_config:-}"');
  assert.ok(final > source.indexOf('emit_step migrate') && final < up);
  assert.ok(fallback > source.indexOf('release identity commit failed; restoring the prior portal tag'));
  assert.match(source.slice(fallback), /--no-build --no-deps --force-recreate portal/);
});
