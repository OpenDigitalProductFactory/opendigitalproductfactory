import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const wrapper = fileURLToPath(new URL('./lib/run-in-windows-job.ps1', import.meta.url));
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
