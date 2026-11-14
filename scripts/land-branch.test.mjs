// Self-test for the landing orchestrator and the obligation banner (BI-4CE4F52F).
//
// What matters here is NOT that the happy path works — it is that the two
// mechanisms which replace remembered prose actually carry their payload:
//
//   1. gate:context must surface the GENERATE COMMAND for a stale derived
//      artifact, not just its path. Without the command, a reader still has to
//      know the repo, which is the gap that made the old pointer useless.
//   2. `land` must refuse to invent a PR-body attestation. A tool that silently
//      wrote "Seed-Fit-Decision: global-default" would be worse than the manual
//      process it replaces.
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildGateContext } from "./lib/gate-context.mjs";
import { STEPS, bodyRequiredTrailers, missingBodyAttestations, parseContext, syncAction, parseGateStatus, gateFailureSite, recordedPassAction, publish, localCiGateAction } from "./land-branch.mjs";
import { parseArgs as gateLocalArgs } from "./gate-local.mjs";
import { obligationLines } from "./pregate-preflight.mjs";

test("a stale derived artifact carries the command that regenerates it", () => {
  // agent_registry.json is a source of the capability-completeness measure.
  const context = buildGateContext({
    changedFiles: ["packages/db/data/agent_registry.json"],
    repoRoot: process.cwd(),
  });
  const entry = (context.derivedArtifacts ?? []).find((d) => d.id === "capability-completeness");
  assert.ok(entry, "expected the capability-completeness group to be affected");
  assert.ok(Array.isArray(entry.generate) && entry.generate.length > 0,
    "generate command must be surfaced, not just the artifact paths");
  assert.match(entry.generate.join(" "), /measure-capability-completeness/);
  // The paths are still there — this adds to the contract, it does not replace it.
  assert.ok(entry.artifacts.some((a) => a.endsWith(".generated.json")));
});

test("the obligation banner names the attestation AND where it goes", () => {
  const context = buildGateContext({
    changedFiles: ["packages/db/data/agent_registry.json"],
    repoRoot: process.cwd(),
  });
  const seedFit = (context.trailers ?? []).find((t) => /Seed-Fit/.test(t.trailer ?? ""));
  assert.ok(seedFit, "a canonical seed change must require Seed-Fit-Decision");
  // The distinction that is easy to get wrong and expensive to miss: this gate
  // reads the push-event body, so the same text in a commit trailer does not
  // satisfy it.
  assert.match(seedFit.note ?? "", /PR BODY/i);
});

test("the banner renders without throwing, and stays silent when there is nothing to say", () => {
  const lines = obligationLines(process.cwd());
  assert.ok(Array.isArray(lines));
  // A refusal banner that throws would mask the guard failure it explains.
  assert.doesNotThrow(() => obligationLines("/nonexistent-path-for-this-test"));
  assert.deepEqual(obligationLines("/nonexistent-path-for-this-test"), []);
});

test("land refuses to invent a PR-body attestation", () => {
  const context = {
    trailers: [
      { trailer: "Seed-Fit-Decision:", level: "required", because: "seed changed",
        note: "this one goes in the PR BODY" },
      { trailer: "Data-Impact:", level: "required", because: "schema changed", note: "" },
    ],
  };
  assert.deepEqual(bodyRequiredTrailers(context).map((t) => t.trailer), ["Seed-Fit-Decision:"]);
  // Absent from the body → named as missing, never synthesised.
  assert.deepEqual(missingBodyAttestations(context, "some body"), ["Seed-Fit-Decision: (seed changed)"]);
  // Present → satisfied. Only PR-BODY ones are policed here; commit trailers are
  // judged by the gates that read the commit.
  assert.deepEqual(missingBodyAttestations(context, "Seed-Fit-Decision: global-default"), []);
});

test("the landing sequence gates BEFORE it pushes or opens anything", () => {
  // Ordering is the safety property: a PR that exists before its gate passed
  // contradicts "PR creation means ready to merge".
  const i = (s) => STEPS.indexOf(s);
  assert.ok(i("local-gates") < i("commit"), "local gates run against the working tree, pre-commit");
  assert.ok(i("gate") < i("push"), "the gate decides before anything leaves the machine");
  assert.ok(i("push") < i("pull-request"), "push precedes the PR");
  assert.ok(i("pull-request") < i("auto-merge"));
  assert.equal(i("preconditions"), 0, "branch and readiness are checked first");
});

test("drift is merged forward before anything is derived from the tree", () => {
  assert.ok(STEPS.indexOf("sync") < STEPS.indexOf("context"),
    "context and regeneration must see the merged tree, or the gate re-runs on a stale one");
  assert.equal(syncAction({ base: "main", behind: 0 }), "current");
  assert.equal(syncAction({ base: "main", behind: 7 }), "merge");
  // Unknowable drift is a refusal, never read as "current".
  assert.equal(syncAction({ base: "main", behind: null }), "unknown");
  assert.equal(syncAction({ base: "main", behind: Number.NaN }), "unknown");
  assert.equal(syncAction({ base: "release", behind: 3 }), "unsupported-base");
});

test("gate:context output below the floor is unreadable, not empty", () => {
  const ok = { changedFileCount: 2, trailers: [], derivedArtifacts: [] };
  assert.deepEqual(parseContext(`> dpf@ gate:context\n${JSON.stringify(ok)}`), ok);
  // Parses, but lacks the fields: a contract change must not read as "no obligations".
  assert.equal(parseContext(JSON.stringify({ changedFileCount: 2 })), null);
  assert.equal(parseContext("ELIFECYCLE  Command failed"), null);
  assert.equal(parseContext("{ not json"), null);
});

test("a `--` forwarded by pnpm does not swallow the flag after it", () => {
  // pnpm 10 passes `pnpm gate:local -- --message-file m` through as
  // ["--", "--message-file", "m"]; util.parseArgs would read that as positionals.
  assert.equal(gateLocalArgs(["--", "--message-file", "m"]).messageFile, "m");
  assert.equal(gateLocalArgs(["--message-file", "m"]).messageFile, "m");
});

test("a refusal before the lease is not reported as a verdict on this SHA", () => {
  // Observed on this branch's first landing: preflight refused, the record was
  // still bound to an older SHA, and the old message sent the reader to it.
  const stale = parseGateStatus(JSON.stringify({ verdict: "STALE", headSha: "b", boundSha: "a" }));
  assert.equal(gateFailureSite(stale, "b"), "preflight");
  const bound = parseGateStatus(JSON.stringify({ verdict: "FAIL", headSha: "b", boundSha: "b" }));
  assert.equal(gateFailureSite(bound, "b"), "verdict");
  assert.equal(gateFailureSite(parseGateStatus("ELIFECYCLE"), "b"), "unknown");
  assert.equal(parseGateStatus(JSON.stringify({ verdict: "PASS" })), null, "below the floor");
});

test("a PASS already recorded for HEAD is landed, not merged forward and re-gated", () => {
  // Observed on PR #6029: gate:wait hit its deadline, the durable resumer later
  // recorded PASS on HEAD, and re-running land would have merged main, minted a
  // new SHA and queued another gate — the merge queue re-tests against main anyway.
  const pass = (boundSha, extra = {}) => parseGateStatus(JSON.stringify(
    { verdict: "PASS", headSha: "head", boundSha, ...extra }));
  const decide = (status, more = {}) =>
    recordedPassAction({ status, headSha: "head", dirty: false, mergeable: "MERGEABLE", ...more }).action;

  // PASS + current: straight to push and PR. No PR yet, or GitHub not done computing, is not a conflict.
  assert.equal(decide(pass("head")), "land-recorded-pass");
  assert.equal(decide(pass("head"), { mergeable: null }), "land-recorded-pass");
  assert.equal(decide(pass("head"), { mergeable: "UNKNOWN" }), "land-recorded-pass");
  // PASS + conflicting: the queue cannot test what does not merge, so merge forward.
  assert.equal(decide(pass("head"), { mergeable: "CONFLICTING" }), "gate");
  // No PASS: the gate has not decided, or decided against.
  assert.equal(decide(parseGateStatus(JSON.stringify({ verdict: "FAIL", headSha: "head", boundSha: "head" }))), "gate");
  assert.equal(decide(parseGateStatus("ELIFECYCLE")), "gate", "unreadable status is never a PASS");
  // A PASS bound to an older SHA says nothing about these bytes.
  assert.equal(decide(pass("older")), "gate");
  assert.equal(decide(pass("")), "gate");
  // Nor does a PASS cover uncommitted changes, or a test stub cover anything.
  assert.equal(decide(pass("head"), { dirty: true }), "gate");
  assert.equal(decide(pass("head", { testStub: true })), "gate");
});

test("publish pushes exactly once, and a refused push is reported, never retried", () => {
  // Plan 2026-10-02 item 9: every `git push` can claim a new gate lease, so a
  // second push "just to read the refusal" can overwrite a recorded PASS.
  const calls = [];
  const exec = (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    return { ok: cmd !== "git", status: cmd === "git" ? 1 : 0, out: "" };
  };
  const refusal = publish({ branch: "b", base: "main", title: "t", body: "", dry: false, log: () => {}, runner: exec });
  assert.equal(refusal?.step, "push");
  assert.deepEqual(calls, ["git push -u origin b"], "one push, and nothing after a refusal");

  calls.length = 0;
  const scenario = publicationScenario({ branch: "b" });
  const okExec = (cmd, args, options) => {
    calls.push([cmd, ...args].join(" "));
    return scenario.runner(cmd, args, options);
  };
  assert.equal(publish({ branch: "b", base: "main", title: "t", body: "x", dry: false, log: () => {}, runner: okExec }), null);
  assert.equal(calls.filter((c) => c.startsWith("git push")).length, 1);
});

// Real command shapes and API fields, with every external action intercepted.
const PUBLISH_HEAD = 'a'.repeat(40);
function publicationScenario(options = {}) {
  const branch = options.branch ?? 'codex/publication-test';
  const calls = [], messages = [];
  let created = false, enabled = false;
  const pr = { number: 7051, state: 'OPEN', headRefName: branch, baseRefName: 'main',
    headRefOid: options.observedHead ?? PUBLISH_HEAD, isCrossRepository: false };
  const runner = (command, args) => {
    calls.push([command, ...args]);
    const ok = out => ({ ok: true, status: 0, out });
    if (command === 'git') return ok(args[0] === 'rev-parse' ? PUBLISH_HEAD : args[0] === 'remote' ? 'https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git' : '');
    if (command === process.execPath) return options.policyRefused
      ? { ok: false, status: 1, out: 'stale-receipt' } : ok('fresh-receipt');
    if (args[0] === 'repo') return ok('OpenDigitalProductFactory/opendigitalproductfactory');
    if (args[0] === 'pr' && args[1] === 'view') return ok(args.includes('.number') ? '7008' : '');
    if (args[0] === 'pr' && args[1] === 'list') {
      if (options.listFailed) return { ok: false, status: 1, out: 'unavailable' };
      return ok(JSON.stringify(options.ambiguous ? [pr, { ...pr, number: 7052 }]
        : options.historicalOnly && !created ? [] : [pr]));
    }
    if (args[0] === 'pr' && args[1] === 'create') {
      created = true; return ok('https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/7051');
    }
    if (args[0] === 'pr' && args[1] === 'merge') {
      enabled = true;
      return options.enableRefused ? { ok: false, status: 1, out: 'request refused' } : ok('');
    }
    if (args[0] === 'api') {
      if (options.observationFailed) return ok(JSON.stringify({ errors: [{ message: 'unavailable' }], data: null }));
      const state = enabled ? options.after ?? 'queued' : options.before ?? 'unconfirmed';
      const row = { ...pr, state: state === 'merged' ? 'MERGED' : 'OPEN',
        autoMergeRequest: state === 'auto' ? { mergeMethod: 'SQUASH' } : null,
        mergeQueueEntry: state === 'queued' ? { id: 'MQE-test', state: 'AWAITING_CHECKS', position: 1 } : null };
      if (state === 'partial') delete row.autoMergeRequest;
      return ok(JSON.stringify({ data: { repository: { pullRequest: row } } }));
    }
    throw new Error('Unexpected intercepted command: ' + command + ' ' + args.join(' '));
  };
  return { branch, calls, messages, runner, log: value => messages.push(value),
    publish() { return publish({ branch, base: 'main', title: 'fix: publication', body: 'reviewed body', dry: false, log: this.log, runner }); } };
}

test('historical merged PR is excluded; a new current OPEN PR is created and explicitly targeted', () => {
  const fixture = publicationScenario({ historicalOnly: true });
  assert.equal(fixture.publish(), null);
  assert(fixture.calls.some(call => call[0] === 'gh' && call[1] === 'pr' && call[2] === 'create'));
  assert(!fixture.calls.some(call => call.includes('.number')), 'never reuse historical implicit pr view');
  const selection = fixture.calls.find(call => call[1] === 'pr' && call[2] === 'list');
  assert(selection.includes('--state') && selection.includes('open') && selection.includes(fixture.branch));
  const request = fixture.calls.find(call => call[1] === 'pr' && call[2] === 'merge');
  assert(request.includes('7051'), 'enqueue the exact observed current PR');
});

test('actual queue entry with null autoMergeRequest is success without another enable', () => {
  const fixture = publicationScenario({ before: 'queued' });
  assert.equal(fixture.publish(), null);
  assert(!fixture.calls.some(call => call[1] === 'pr' && call[2] === 'merge'));
  assert.match(fixture.messages.join('\n'), /queued/i);
  assert.doesNotMatch(fixture.messages.join('\n'), /enable it by hand|did NOT take/);
});

test('actual merged result is distinguished from a queue request', () => {
  const fixture = publicationScenario({ after: 'merged' });
  assert.equal(fixture.publish(), null);
  assert.match(fixture.messages.join('\n'), /merged/i);
});

test('auto-merge requested is observed without inventing queue membership', () => {
  const fixture = publicationScenario({ before: 'auto' });
  assert.equal(fixture.publish(), null);
  assert(!fixture.calls.some(call => call[1] === 'pr' && call[2] === 'merge'));
  assert.match(fixture.messages.join('\n'), /requested/i);
});

for (const [name, options] of [
  ['failed current-PR read', { listFailed: true }],
  ['ambiguous current PR', { ambiguous: true }],
  ['wrong current source', { observedHead: 'b'.repeat(40) }],
  ['failed GraphQL read', { observationFailed: true }],
  ['partial API observation', { before: 'partial' }],
]) test(name + ' refuses instead of claiming publication or enabling', () => {
  const fixture = publicationScenario(options);
  assert(fixture.publish(), 'unproven state must return a refusal');
  assert(!fixture.calls.some(call => call[1] === 'pr' && call[2] === 'merge'));
});

test('a refused enqueue is attempted once and reported as refused', () => {
  const fixture = publicationScenario({ enableRefused: true });
  assert.equal(fixture.publish()?.step, 'auto-merge');
  assert.equal(fixture.calls.filter(call => call[1] === 'pr' && call[2] === 'merge').length, 1);
});

test('successful enable with no confirmed queue or auto-merge remains unconfirmed', () => {
  const fixture = publicationScenario({ after: 'unconfirmed' });
  assert.equal(fixture.publish()?.step, 'auto-merge');
  assert.equal(fixture.calls.filter(call => call[1] === 'pr' && call[2] === 'merge').length, 1);
  assert.doesNotMatch(fixture.messages.join('\n'), /enable it by hand/);
});

test('post-push resume preserves the qualified target and never pushes, gates or reviews again', async () => {
  const landing = await import('./land-branch.mjs');
  assert.equal(typeof landing.resumePublished, 'function');
  const fixture = publicationScenario({ historicalOnly: true });
  const status = { verdict: 'PASS', headSha: PUBLISH_HEAD, boundSha: PUBLISH_HEAD,
    boundBranch: fixture.branch, evidenceId: 'canonical-real-evidence', testStub: false };
  assert.equal(landing.resumePublished({ branch: fixture.branch, base: 'main', title: 'fix: publication', body: 'body',
    headSha: PUBLISH_HEAD, expectedHeadSha: PUBLISH_HEAD, remoteHeadSha: PUBLISH_HEAD, dirty: false, status,
    context: buildGateContext({ changedFiles: [], repoRoot: process.cwd() }), dry: false,
    log: fixture.log, runner: fixture.runner }), null);
  assert(!fixture.calls.some(call => call[0] === 'git' && ['push', 'merge', 'commit'].includes(call[1])));
  assert(!fixture.calls.some(call => call.some(arg => /^(gate:wait|pregate|review_semantic_change)$/.test(arg))));
  assert(fixture.calls.some(call => call[0] === process.execPath && call.some(arg => arg.endsWith('semantic-review-gate.mjs'))),
    'validate the existing semantic receipt under current policy, without a new review');
});

test('resume rejects dirty, mismatched, stale, test-stub and unbound targets before publication', async () => {
  const landing = await import('./land-branch.mjs');
  assert.equal(typeof landing.resumePublished, 'function');
  for (const changes of [{ dirty: true }, { expectedHeadSha: 'b'.repeat(40) }, { remoteHeadSha: null },
    { status: { verdict: 'STALE' } }, { status: { verdict: 'PASS', boundSha: PUBLISH_HEAD, testStub: true } },
    { status: { verdict: 'PASS', boundSha: PUBLISH_HEAD, boundBranch: 'foreign', evidenceId: 'x' } }]) {
    const fixture = publicationScenario();
    const refusal = landing.resumePublished({ branch: fixture.branch, base: 'main', title: 't', body: 'b',
      headSha: PUBLISH_HEAD, expectedHeadSha: PUBLISH_HEAD, remoteHeadSha: PUBLISH_HEAD, dirty: false,
      status: { verdict: 'PASS', headSha: PUBLISH_HEAD, boundSha: PUBLISH_HEAD,
        boundBranch: fixture.branch, testStub: false, evidenceId: 'canonical-real-evidence' },
      context: buildGateContext({ changedFiles: [], repoRoot: process.cwd() }), dry: false,
      log: fixture.log, runner: fixture.runner, ...changes });
    assert(refusal); assert.equal(fixture.calls.length, 0);
  }
});

test('resume stops at existing semantic policy refusal without recording or replaying review', async () => {
  const landing = await import('./land-branch.mjs');
  assert.equal(typeof landing.resumePublished, 'function');
  const fixture = publicationScenario({ policyRefused: true });
  const refusal = landing.resumePublished({ branch: fixture.branch, base: 'main', title: 't', body: 'b',
    headSha: PUBLISH_HEAD, expectedHeadSha: PUBLISH_HEAD, remoteHeadSha: PUBLISH_HEAD, dirty: false,
    status: { verdict: 'PASS', headSha: PUBLISH_HEAD, boundSha: PUBLISH_HEAD,
      boundBranch: fixture.branch, testStub: false, evidenceId: 'canonical-real-evidence' },
    context: buildGateContext({ changedFiles: [], repoRoot: process.cwd() }), dry: false,
    log: fixture.log, runner: fixture.runner });
  assert.equal(refusal?.step, 'semantic-review');
  assert(!fixture.calls.some(call => call[0] === 'gh'));
});

function resumeWorktreeScenario(options = {}) {
  const publication = publicationScenario({ historicalOnly: true });
  const target = '/governed/unchanged-finance-topic';
  const reads = [];
  const runner = (command, args, settings) => {
    assert.equal(settings.cwd, target, 'every child reads the candidate, not the helper checkout');
    reads.push([command, ...args]);
    const key = [command, ...args].join(' ');
    if (key === options.failCommand) return { ok: false, status: 1, out: options.misleadingOutput ?? '' };
    const ok = out => ({ ok: true, status: 0, out });
    if (key === 'git branch --show-current') return ok(publication.branch);
    if (key === 'git rev-parse HEAD') return ok(PUBLISH_HEAD);
    if (key === 'git status --porcelain') return ok(options.dirty ? ' M source.ts' : '');
    if (args[0] === 'ls-remote') return ok(options.remote ?? `${PUBLISH_HEAD}\trefs/heads/${publication.branch}\n`);
    if (args.includes('pregate:status')) return ok(JSON.stringify({ verdict: 'PASS', headSha: PUBLISH_HEAD,
      boundSha: PUBLISH_HEAD, boundBranch: publication.branch, evidenceId: 'real-qualified-evidence', testStub: false }));
    if (args.includes('gate:context')) return ok(JSON.stringify(buildGateContext({ changedFiles: [], repoRoot: process.cwd() })));
    return publication.runner(command, args, settings);
  };
  return { publication, target, reads, runner };
}

test('cross-checkout resume orchestration uses only target reads and explicitly binds the queue mutation', async () => {
  const { resumeFromWorktree } = await import('./land-branch.mjs');
  const scenario = resumeWorktreeScenario();
  assert.equal(resumeFromWorktree({ ...scenario, base: 'main', title: 'fix: resume', body: 'reviewed body',
    expectedHeadSha: PUBLISH_HEAD, dry: false, log: scenario.publication.log,
    readinessProbe: target => { assert.equal(target, scenario.target); return { status: 'compile-ready' }; } }), null);
  const enable = scenario.reads.find(call => call[1] === 'pr' && call[2] === 'merge');
  assert.deepEqual(enable.slice(-2), ['--match-head-commit', PUBLISH_HEAD]);
  assert(!scenario.reads.some(call => call[0] === 'git' && ['push', 'merge', 'commit'].includes(call[1])));
  assert(!scenario.reads.some(call => call.some(arg => ['gate:wait', 'gate:local', 'pregate'].includes(arg))));
});

for (const [name, options] of [
  ['failed cleanliness read', { failCommand: 'git status --porcelain' }],
  ['failed HEAD read with plausible output', { failCommand: 'git rev-parse HEAD', misleadingOutput: PUBLISH_HEAD }],
  ['failed branch read', { failCommand: 'git branch --show-current' }],
  ['dirty candidate', { dirty: true }],
  ['ambiguous remote', { remote: `${PUBLISH_HEAD} refs/heads/codex/current\n${PUBLISH_HEAD} refs/heads/codex/other` }],
  ['wrong remote', { remote: `${'b'.repeat(40)} refs/heads/codex/current` }],
  ['failed status read', { failCommand: 'pnpm -s pregate:status --json' }],
  ['failed context read', { failCommand: 'pnpm -s gate:context --json' }],
]) test('resume orchestration fails closed on ' + name, async () => {
  const { resumeFromWorktree } = await import('./land-branch.mjs');
  const scenario = resumeWorktreeScenario(options);
  const refusal = resumeFromWorktree({ ...scenario, base: 'main', title: 'fix: resume', body: 'b',
    expectedHeadSha: PUBLISH_HEAD, dry: false, log: scenario.publication.log,
    readinessProbe: () => ({ status: 'compile-ready' }) });
  assert(refusal);
  assert(!scenario.reads.some(call => call[0] === 'gh'), 'unqualified reads cannot reach publication');
});

test('resume dry-run observes qualification without any publication or semantic action', async () => {
  const { resumeFromWorktree } = await import('./land-branch.mjs');
  const scenario = resumeWorktreeScenario();
  assert.equal(resumeFromWorktree({ ...scenario, base: 'main', body: '', expectedHeadSha: PUBLISH_HEAD,
    dry: true, log: scenario.publication.log, readinessProbe: () => ({ status: 'compile-ready' }) }), null);
  assert(!scenario.reads.some(call => call[0] === 'gh' || call[0] === process.execPath));
});

test('PR creation preserves the reviewed body bytes using a private temporary body file', async () => {
  const { readFileSync, statSync, existsSync } = await import('node:fs');
  const scenario = publicationScenario({ historicalOnly: true });
  const body = 'Line one\n\nLiteral `code`, $(not-a-command), and ${notAnExpansion}.\n';
  let savedPath;
  const runner = (command, args, settings) => {
    if (command === 'gh' && args[0] === 'pr' && args[1] === 'create') {
      savedPath = args[args.indexOf('--body-file') + 1];
      assert.equal(readFileSync(savedPath, 'utf8'), body);
      if (process.platform !== 'win32') assert.equal(statSync(savedPath).mode & 0o777, 0o600);
      assert(!args.includes('--body'));
    }
    return scenario.runner(command, args, settings);
  };
  assert.equal(publish({ branch: scenario.branch, base: 'main', title: 'fix: body', body,
    dry: false, log: scenario.log, runner }), null);
  assert(savedPath && !existsSync(savedPath), 'only the helper-owned temporary body is cleaned');
});

test('unready target is refused before any Git or publication command', async () => {
  const { resumeFromWorktree } = await import('./land-branch.mjs');
  const scenario = resumeWorktreeScenario();
  assert(resumeFromWorktree({ ...scenario, base: 'main', expectedHeadSha: PUBLISH_HEAD,
    log: scenario.publication.log, readinessProbe: () => ({ status: 'source-only' }) }));
  assert.equal(scenario.reads.length, 0);
});

test('real CLI rejects incomplete resume identity before invoking target commands', async () => {
  const { spawnSync } = await import('node:child_process');
  for (const args of [['--worktree', '/does-not-exist'],
    ['--resume-publication', '--worktree', '/does-not-exist', '--expected-head', 'invalid']]) {
    const result = spawnSync(process.execPath, ['scripts/land-branch.mjs', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /require --resume-publication|exact qualified commit/);
    assert.doesNotMatch(result.stdout, /pushing|opening the current PR|resuming already-pushed/);
  }
});

test("land skips the local-CI slot only when push-exempt says the diff is exempt", () => {
  assert.equal(localCiGateAction({ exitStatus: 0 }), "skip-local-ci");
  // not exempt (runtime-bound file or stale artifact)
  assert.equal(localCiGateAction({ exitStatus: 1 }), "wait-local-ci");
  // admission error, unreadable merge-base, non-main base: fail closed
  assert.equal(localCiGateAction({ exitStatus: 2 }), "wait-local-ci");
  assert.equal(localCiGateAction({ exitStatus: null }), "wait-local-ci");
});
