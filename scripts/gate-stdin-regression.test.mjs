import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateCommand, createProcessTreeTracker } from './gate-worktree.mjs';
const wrapper = fileURLToPath(new URL('./lib/run-in-windows-job.ps1', import.meta.url));
for (const commandSpec of [
  { kind: 'unsupported', value: [], label: 'invalid wrapper command' },
  { kind: 'argv', value: ['dpf-executable-that-does-not-exist'], label: 'missing gate executable' },
]) {
  test(`${commandSpec.label} is infrastructure, not a product failure`, {skip:process.platform !== 'win32', timeout:15000}, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dpf-wrapper-failure-'));
    const command = createGateCommand(commandSpec, {
      cwd: dir, env: process.env, allowStub: false, fullLogFile: join(dir, 'output.log'),
      checkpointContext: { path: join(dir, 'execution.json'), metadataFile: join(dir, 'metadata.json'), artifactFile: join(dir, 'artifact.json'),
        ownerSessionId: 'test-owner', provider: 'codex', leaseId: 'test-lease', gateKey: 'test-gate', branch: 'fix/test', sha: 'a'.repeat(40) },
    });
    const result = await command.run();
    assert.equal(result.status, 75, result.output);
    assert.match(result.infrastructureReason, /completion checkpoint/);
  });
}
function launch(script, env = {}) {
  const child = spawn('powershell.exe', ['-NoProfile', '-File', wrapper], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: {...process.env, ...env, DPF_GATE_EXECUTION_CONTEXT: '', DPF_WINDOWS_JOB_COMMAND: JSON.stringify({kind:'argv',value:[process.execPath,'-e',script]})},
  });
  let output='';
  child.stdout.on('data', d=>output+=d);
  child.stderr.on('data', d=>output+=d);
  return {child,closed:once(child,'close'),output:()=>output};
}
for (const scenario of [{exitCode:0}, {exitCode:2}, {exitCode:0, unknownCleanup:true}]) {
  const {exitCode, unknownCleanup} = scenario;
  test(`validated Windows completion exit ${exitCode} with ${unknownCleanup ? 'unproven' : 'owned'} cleanup`, {skip:process.platform !== 'win32', timeout:15000}, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dpf-wrapper-completed-'));
    const context = { path: join(dir, 'execution.json'), metadataFile: join(dir, 'metadata.json'), artifactFile: join(dir, 'artifact.json'),
      ownerSessionId: 'test-owner', provider: 'codex', leaseId: 'test-lease', gateKey: 'test-gate', branch: 'fix/test', sha: 'a'.repeat(40) };
    const artifact = exitCode === 0 ? { kind: 'delegated', identity: 'merge-queue' } : null;
    const metadata = { candidateSha: context.sha, candidateRef: context.branch, runLeaseId: context.leaseId,
      baseSha: 'b'.repeat(40), integrationCommitSha: 'c'.repeat(40), synthesizedTreeSha: 'd'.repeat(40),
      evidencePlan: { digest: 'e'.repeat(64), policyVersion: 'test-policy' }, toolchainFingerprint: 'f'.repeat(64),
      productionArtifact: artifact, commands: [{ command: 'synthetic test fixture' }],
      execution: { status: exitCode === 0 ? 'passed' : 'failed', exitCode, completedCommandCount: 1 } };
    const script = `const fs=require('node:fs'); const m=${JSON.stringify(metadata)}; m.completedAt=new Date().toISOString(); fs.writeFileSync(${JSON.stringify(context.metadataFile)},JSON.stringify(m)); fs.writeFileSync(${JSON.stringify(context.artifactFile)},${JSON.stringify(JSON.stringify(artifact))}); process.exit(${exitCode});`;
    const scriptPath = join(dir, 'command.cjs');
    writeFileSync(scriptPath, script);
    const command = createGateCommand({kind:'argv',value:[process.execPath,scriptPath],label:'executed fixture'}, {
      cwd: dir, env: process.env, allowStub: false, fullLogFile: join(dir, 'output.log'), checkpointContext: context,
      ...(unknownCleanup ? { trackerFactory: ({rootPid}) => {
        const tracker = createProcessTreeTracker({rootPid, supervisorPid: process.pid,
          listProcessRows: () => [{pid:rootPid,parentPid:process.pid,birthTime:'1000'}, {pid:rootPid+1,parentPid:rootPid,birthTime:null}],
          processAlive: () => true, terminate: () => assert.fail('unproven PID must never be killed'),
        });
        tracker.sample();
        return tracker;
      } } : {}),
    });
    const result = await command.run();
    assert.equal(result.status, unknownCleanup ? 75 : exitCode, result.output);
    assert.equal(result.infrastructureReason, unknownCleanup ? 'descendant cleanup could not be confirmed' : '', result.output);
  });
}
test('nested Git exits while the parent-watch pipe stays open', {skip:process.platform !== 'win32', timeout:15000}, async()=>{
  const f=launch("const r=require('node:child_process').spawnSync('git',['--version'],{stdio:'inherit'});process.exit(r.status ?? 1)");
  let timeout;
  try {
    const result=await Promise.race([f.closed,new Promise(resolve=>{timeout=setTimeout(()=>resolve(['hung']),5000)})]);
    assert.equal(result[0],0,f.output());
    assert.match(f.output(),/git version/);
  } finally {clearTimeout(timeout);f.child.stdin.end();if(f.child.exitCode===null)await f.closed;}
});
test('private parent pipe still stops the owned writer on loss', {skip:process.platform !== 'win32', timeout:15000}, async()=>{
  const marker=join(mkdtempSync(join(tmpdir(),'dpf-private-pipe-')),'writes');
  const f=launch("setInterval(()=>require('node:fs').appendFileSync(process.env.TEST_MARKER,'x'),50)",{TEST_MARKER:marker});
  try {
    const deadline=Date.now()+8000;
    while(!existsSync(marker)&&Date.now()<deadline)await delay(50);
    assert.ok(existsSync(marker),f.output());
    f.child.stdin.end();
    assert.equal((await f.closed)[0],75,f.output());
    const data=readFileSync(marker,'utf8');await delay(250);
    assert.equal(readFileSync(marker,'utf8'),data);
  } finally {f.child.stdin.end();if(f.child.exitCode===null)await f.closed;}
});
