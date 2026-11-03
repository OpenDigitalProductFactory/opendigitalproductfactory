import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url));

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "dpf-preflight-effective-env-"));
  t.after(() => {
    assert.ok(resolve(cwd).startsWith(`${resolve(tmpdir())}${sep}`));
    rmSync(cwd, { recursive: true, force: true });
  });
  mkdirSync(join(cwd, "lib"));
  writeFileSync(join(cwd, "pregate-preflight.mjs"), readFileSync(join(root, "scripts/pregate-preflight.mjs")));
  const module = (path, text) => writeFileSync(join(cwd, path), text);
  module("lib/git.mjs", `export const runGit = () => ({ok:true,stdout:'same-branch'});`);
  module("lib/pull-request-body.mjs", `import {readFileSync} from 'node:fs';
    export const readPullRequestBody = ({cwd}) => ({included:true,body:readFileSync(cwd+'/body','utf8')});`);
  module("ci-change-scope.mjs", `export const classifyChangedFiles = () => ({docsOnly:false});`);
  module("lib/stale-root-clone.mjs", `export const checkStaleRootClone = () => ({ok:true});`);
  module("lib/entry-module.mjs", `export const isEntryModule = () => true;`);
  module("lib/ensure-compile-ready.mjs", `export const ensureCompileReady = () => ({ok:true});
    export const getChangedFilesAgainstMain = () => [];`);
  module("lib/gate-context.mjs", `export const buildGateContext = () => ({});`);
  module("derived-artifacts-gate.mjs", `export const mergedBaseDerivedVerdict = () => ({status:"current",entries:[]});`);
  module("lib/pregate-preflight.mjs", `import {appendFileSync} from 'node:fs';
    export const PREFLIGHT_SKIP_ENV = 'DPF_FIXTURE_SKIP_PREFLIGHT';
    const entry = {id:'body-policy',name:'Body policy',commands:[['fixture',[]]]};
    export const planPreflight = () => ({entries:[entry],skippedByScope:[]});
    export const createDefaultExecute = env => async () => {
      appendFileSync('executions','guard\\n');
      return {exitCode:env.PR_BODY==='valid'?0:1,output:'body policy result'};
    };
    export const runPreflight = async ({execute}) => {
      const result=await execute('fixture',[]);
      return {ok:result.exitCode===0,skipped:false,entries:[{...entry,status:result.exitCode===0?'passed':'failed',output:result.output}]};
    };`);
  const receipt = pathToFileURL(join(root, "scripts/lib/pregate-preflight-receipt.mjs")).href;
  module("lib/pregate-preflight-receipt.mjs", `import {createHash} from 'node:crypto';
    import {runWithGuardReceipt as realRun} from ${JSON.stringify(receipt)};
    export const guardReceiptDirectory = () => 'receipts';
    export const identifyGuardExecution = ({env=process.env}) => ({head:'same',tree:'same',base:'same',policy:'fixture',
      environment:createHash('sha256').update(env.PR_BODY??'').digest('hex')});
    export const runWithGuardReceipt = options => realRun({...options,
      lockOptions:{processIdentity:()=> 'fixture-owner',processAlive:()=>true}});`);
  const count = () => existsSync(join(cwd, "executions"))
    ? readFileSync(join(cwd, "executions"), "utf8").trim().split("\n").length : 0;
  const run = body => {
    writeFileSync(join(cwd, "body"), body);
    return spawnSync(process.execPath, [join(cwd, "pregate-preflight.mjs")], {
      cwd, env: { ...process.env, PR_BODY: "unchanged inherited body" },
      encoding: "utf8", timeout: 10_000, windowsHide: true,
    });
  };
  return { run, count };
}

test("unchanged fetched body reuses a successful preflight without rerunning its guard", t => {
  const f = fixture(t);
  const first = f.run("valid");
  assert.equal(first.status, 0, first.stderr);
  const second = f.run("valid");
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /REUSED/);
  assert.equal(f.count(), 1);
});

test("changed fetched body cannot reuse a prior PASS with unchanged inherited environment", t => {
  const f = fixture(t);
  const first = f.run("valid");
  assert.equal(first.status, 0, first.stderr);
  const changed = f.run("invalid");
  assert.equal(changed.status, 1, `changed effective body must execute and fail, not reuse PASS:\n${changed.stdout}\n${changed.stderr}`);
  assert.doesNotMatch(changed.stdout, /REUSED/);
  assert.equal(f.count(), 2);
});
