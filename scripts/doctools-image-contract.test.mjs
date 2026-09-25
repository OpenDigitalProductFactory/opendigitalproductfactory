// dpf-doctools image contract (BI-15D69168, slice S1 of BI-815D40C6).
//
// No PR check builds release images, so these shape assertions are what stands
// between an edit and a release that ships the engine unsmoked, unbudgeted,
// unhardened, or wired into compose. The behaviour itself is proven by
// tools/doctools/smoke.sh against the built image (publish-image.yml runs it on
// every release, per architecture, before the push).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");
const workflow = read(".github/workflows/publish-image.yml");

function jobBlock(jobName, nextJobName) {
  const start = workflow.indexOf(`\n  ${jobName}:`);
  assert.notEqual(start, -1, `missing workflow job: ${jobName}`);
  const next = nextJobName ? workflow.indexOf(`\n  ${nextJobName}:`, start + 1) : workflow.length;
  assert.notEqual(next, -1, `missing workflow job after ${jobName}: ${nextJobName}`);
  return workflow.slice(start, next);
}

test("dpf-doctools is published beside dpf-promoter in every image matrix", () => {
  const build = jobBlock("build", "merge");
  assert.match(build, /- name: dpf-doctools\s*\n\s*context: \.\s*\n\s*file: Dockerfile\.doctools\s*\n\s*target: ""/);
  for (const [job, next] of [["merge", "verify"], ["promote-latest", null]]) {
    assert.match(jobBlock(job, next), /\n\s*- dpf-doctools\s*\n/, `${job} matrix must list dpf-doctools`);
  }
});

test("the release build smoke-tests and size-checks dpf-doctools before pushing it", () => {
  const build = jobBlock("build", "merge");
  const push = build.indexOf("- name: Build and push by digest");
  const load = build.indexOf("- name: Build dpf-doctools for the smoke test");
  const smoke = build.indexOf("run: bash tools/doctools/smoke.sh dpf-doctools:smoke");
  const budget = build.indexOf("run: bash tools/doctools/size-budget.sh dpf-doctools:smoke");
  for (const [name, index] of [["load build", load], ["smoke", smoke], ["size budget", budget]]) {
    assert.notEqual(index, -1, `missing dpf-doctools ${name} step`);
    assert.ok(index < push, `the dpf-doctools ${name} step must run before the push`);
  }
  const gated = build.slice(load, push).match(/if: matrix\.image\.name == 'dpf-doctools'/g) ?? [];
  assert.equal(gated.length, 3, "all three dpf-doctools steps must be gated to the dpf-doctools matrix cell");
  assert.match(build.slice(load, smoke), /load: true/);
});

test("the merge job records every published manifest digest", () => {
  const merge = jobBlock("merge", "verify");
  assert.match(merge, /- name: Record the published manifest digest/);
  assert.match(merge, /name: release-digest-\$\{\{ matrix\.image \}\}/);
});

test("no compose file or portal build stage references the engine (AC-ODC-003)", () => {
  const composeFiles = readdirSync(".").filter((f) => /^docker-compose.*\.ya?ml$/.test(f));
  assert.ok(composeFiles.length > 0);
  for (const file of composeFiles) {
    assert.doesNotMatch(read(file), /doctools/, `${file} must not reference dpf-doctools (PR #5290)`);
  }
  assert.doesNotMatch(read("Dockerfile"), /doctools|libreoffice/i);
});

test("Dockerfile.doctools is digest-pinned, non-root and enters through dpf-convert", () => {
  const dockerfile = read("Dockerfile.doctools");
  assert.match(dockerfile, /^FROM debian:[a-z]+-slim@sha256:[0-9a-f]{64}$/m);
  const user = dockerfile.match(/^USER (\S+)$/m);
  assert.ok(user, "the image must declare a runtime USER");
  assert.doesNotMatch(user[1], /^(0|root)(:|$)/);
  assert.match(dockerfile, /^ENTRYPOINT \["\/usr\/local\/bin\/dpf-convert"\]$/m);
  assert.doesNotMatch(dockerfile, /default-jre|openjdk|libreoffice-base\b/);

  const ignore = read("Dockerfile.doctools.dockerignore");
  for (const [, source] of dockerfile.matchAll(/^COPY (?:--\S+ )*(\S+) /gm)) {
    assert.ok(existsSync(source), `COPY source ${source} must exist`);
    assert.match(ignore, new RegExp(`^!${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"),
      `${source} must be admitted by Dockerfile.doctools.dockerignore`);
  }
});

test("the baked profile keeps macros and linked content off", () => {
  const xcu = read("tools/doctools/registrymodifications.xcu");
  const prop = (name) => xcu.match(new RegExp(`oor:name="${name}" oor:op="fuse"><value>([^<]*)</value>`))?.[1];
  assert.equal(prop("MacroSecurityLevel"), "3", "macro security must be very high");
  assert.equal(prop("DisableMacrosExecution"), "true");
  assert.equal(prop("DisableActiveContent"), "true");
  assert.equal(prop("DisableOLEAutomation"), "true");
  assert.match(xcu, /oor:name="SecureURL" oor:op="fuse"><value\/>/, "no trusted macro locations");
});

test("dpf-convert keeps its fixed exit codes and size cap", () => {
  const script = read("tools/doctools/dpf-convert");
  assert.match(script, /readonly EXIT_OK=0 EXIT_BAD_ARGS=2 EXIT_FAILED=3 EXIT_TOO_LARGE=4 EXIT_TIMEOUT=124/);
  assert.match(script, /DPF_CONVERT_MAX_BYTES/);
  assert.match(script, /mktemp -d \/tmp\//, "each run needs its own profile and workspace under /tmp");
  const smoke = read("tools/doctools/smoke.sh");
  assert.match(smoke, /--network none --read-only/);
  assert.match(smoke, /MARKER=absent/);
});
