import { test } from 'node:test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyPackage, ENGINE_LOCK } from './package.mjs';

const hash = x => createHash('sha256').update(x).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dpf-engine-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'bin'));
  const files = [];
  for (const [path, content] of [['bin/llama-server', Buffer.from('cffaedfe0c000001736572766572', 'hex')], ['bin/llama-bench', Buffer.from('cffaedfe0c00000162656e6368', 'hex')], ['LICENSE', 'MIT fixture']]) {
    await writeFile(join(root, path), content, { mode: path.startsWith('bin/') ? 0o755 : 0o644 });
    files.push({ path, type: 'file', sizeBytes: Buffer.byteLength(content), sha256: hash(content) });
  }
  const manifest = { schemaVersion: 1, packageName: 'dpf-llama-macos-arm64', version: ENGINE_LOCK.packageVersion,
    source: ENGINE_LOCK.source, patchSha256: ENGINE_LOCK.patchSha256,
    build: { os: 'darwin', architecture: 'arm64', sdk: '26.5', minimumMacOS: '13.3', compiler: 'fixture', flags: ['-DGGML_NATIVE=OFF'] },
    qualification: { status: 'unqualified' }, files };
  const save = () => writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  await save();
  return { root, manifest, save };
}
test('verifies a complete candidate without declaring model qualification', async t => {
  const f = await fixture(t); const result = await verifyPackage(f.root);
  assert.equal(result.fileCount, 3); assert.equal(result.qualification.status, 'unqualified');
});
test('rejects changed executable bytes', async t => {
  const f = await fixture(t); await writeFile(join(f.root, 'bin/llama-server'), 'tampered');
  await assert.rejects(verifyPackage(f.root), /hash|size/i);
});
test('rejects an undeclared payload file', async t => {
  const f = await fixture(t); await writeFile(join(f.root, 'untracked'), 'payload');
  await assert.rejects(verifyPackage(f.root), /unlisted|undeclared/i);
});
test('rejects manifest traversal before reading an outside file', async t => {
  const f = await fixture(t); f.manifest.files[0].path = '../outside'; await f.save();
  await assert.rejects(verifyPackage(f.root), /path/i);
});
test('rejects a library symlink escaping the package', async t => {
  const f = await fixture(t); await symlink('../../outside', join(f.root, 'bin/libbad.dylib'));
  f.manifest.files.push({ path: 'bin/libbad.dylib', type: 'symlink', target: '../../outside' }); await f.save();
  await assert.rejects(verifyPackage(f.root), /symlink|escape/i);
});
test('rejects a manifest file-type lie', async t => {
  const f = await fixture(t); f.manifest.files[0] = { path: 'bin/llama-server', type: 'symlink', target: 'llama-bench' }; await f.save();
  await assert.rejects(verifyPackage(f.root), /type|symlink/i);
});
test('rejects unknown schema and unaudited source identities', async t => {
  const f = await fixture(t); f.manifest.schemaVersion = 2; await f.save();
  await assert.rejects(verifyPackage(f.root), /schema/i);
  f.manifest.schemaVersion = 1; f.manifest.source = { ...f.manifest.source, commit: 'f'.repeat(40) }; await f.save();
  await assert.rejects(verifyPackage(f.root), /source/i);
});
test('refuses a package with a missing required binary', async t => {
  const f = await fixture(t); f.manifest.files = f.manifest.files.filter(x => x.path !== 'bin/llama-server'); await rm(join(f.root,'bin/llama-server')); await f.save();
  await assert.rejects(verifyPackage(f.root), /required|llama-server/i);
});
test('rejects a symlinked parent directory before reading its payload', async t => {
  const f = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'dpf-engine-outside-'));
  t.after(() => rm(outside,{recursive:true,force:true}));
  await writeFile(join(outside,'llama-server'), Buffer.from('cffaedfe0c000001736572766572','hex'),{mode:0o755});
  await writeFile(join(outside,'llama-bench'), Buffer.from('cffaedfe0c00000162656e6368','hex'),{mode:0o755});
  await rm(join(f.root,'bin'),{recursive:true});
  await symlink(outside,join(f.root,'bin'));
  await assert.rejects(verifyPackage(f.root), /escape/i);
});
test('refuses a manifest that declares its own model qualification', async t => {
  const f = await fixture(t); f.manifest.qualification.status='qualified'; await f.save();
  await assert.rejects(verifyPackage(f.root), /qualification/i);
});

// Qualification must accept the observed Docker schema without inventing a
// loading observation, and must keep the Docker engine recoverable on failure.
const {runnerActivity,restoreAfterQualification,stopOwnedChild,validLeaseExpiry,modelLayerBinding,unloadWithRestorationObligation,nativeEngineArguments,performanceComparison}=await import('./qualify-engine.mjs');
test('observed Docker runner schema proves idle without claiming loading capture',()=>{
  assert.deepEqual(runnerActivity([{in_use:false}]),{idle:true,loadingFieldObserved:false});
  assert.equal(runnerActivity([{in_use:true}]).idle,false);
  assert.equal(runnerActivity([{in_use:false,loading:true}]).idle,false);
  assert.throws(()=>runnerActivity([{}]),/capture unavailable/);
});
test('qualification failure stops candidate before restoring unloaded Docker model',async()=>{
  const actions=[];
  await restoreAfterQualification({unloaded:true,restored:false,
    stop:async()=>actions.push('stop'),restore:async()=>actions.push('restore')});
  assert.deepEqual(actions,['stop','restore']);
});
test('qualification cleanup avoids loading a model that was never unloaded',async()=>{
  let restored=false;
  await restoreAfterQualification({unloaded:false,restored:false,
    stop:async()=>{},restore:async()=>{restored=true;}});
  assert.equal(restored,false);
});
test('unconfirmed candidate shutdown prevents competing Docker restoration',async()=>{
  let restored=false;
  await assert.rejects(restoreAfterQualification({unloaded:true,restored:false,
    stop:async()=>{throw Error('still running');},restore:async()=>{restored=true;}}),/still running/);
  assert.equal(restored,false);
});

test('signal-terminated owned candidate cleanup returns without waiting for a second exit',async()=>{
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  try {
    await stopOwnedChild(child,100);
    assert.equal(child.signalCode,'SIGTERM');
    await stopOwnedChild(child,100);
  } finally {if(child.exitCode===null&&child.signalCode===null) child.kill('SIGKILL');}
});

test('lease capture refuses missing, malformed and expired bounds',()=>{
  const now=Date.now();
  for(const value of [undefined,null,'not-a-date',new Date(now).toISOString()]) assert.equal(validLeaseExpiry(value,now),false);
  assert.equal(validLeaseExpiry(new Date(now+60000).toISOString(),now),true);
});
test('GGUF identity is bound to hashed baseline OCI layer rather than model alias',()=>{
  const raw=Buffer.from(JSON.stringify({schemaVersion:2,layers:[{mediaType:'application/vnd.docker.ai.gguf.v3',digest:'sha256:'+hash('correct-weights'),size:15}]}));
  const digest='sha256:'+hash(raw);
  assert.equal(modelLayerBinding(raw,digest,hash('correct-weights'),15).manifestDigest,digest);
  assert.throws(()=>modelLayerBinding(raw,digest,hash('different-weights-same-tokenizer'),15),/GGUF does not match/);
  assert.throws(()=>modelLayerBinding(raw,'sha256:'+'a'.repeat(64),hash('correct-weights'),15),/manifest digest mismatch/);
});
test('ambiguous unload acknowledgement still creates a restoration obligation',async()=>{
  const report={};let sideEffect=false;
  await assert.rejects(unloadWithRestorationObligation(report,async()=>{sideEffect=true;throw Error('acknowledgement lost');}),/acknowledgement lost/);
  assert.equal(sideEffect,true);
  assert.equal(report.baselineUnloadedForQualification,true);
  assert.equal(report.baselineUnloadAcknowledged,false);
});

test('both native engine versions receive identical material benchmark settings',()=>{
  const args=nativeEngineArguments({model:'/model.gguf',modelRef:'model',port:49231,mmproj:'/projector.gguf'});
  for(const [flag,value] of [['--ctx-size','131072'],['--parallel','4'],['--batch-size','512'],['--ubatch-size','512'],['--threads','9'],['--threads-batch','9'],['--cache-type-k','f16'],['--cache-type-v','f16'],['--flash-attn','on'],['--mmproj','/projector.gguf']]) assert.equal(args[args.indexOf(flag)+1],value);
  assert.ok(args.includes('--kv-unified'));assert.ok(args.includes('--no-mmap'));
});

test('missing or invalid prompt counts cannot qualify a timing comparison',()=>{
  for(const promptTokens of [null,undefined,0,-1,NaN,Infinity]) {
    const m={promptTokens,cachedTokens:0,prefillMs:100};
    assert.equal(performanceComparison(m,m,2).comparable,false);
  }
  const before={promptTokens:32000,cachedTokens:0,prefillMs:100};
  assert.equal(performanceComparison(before,{...before,prefillMs:50},2).comparable,true);
  assert.equal(performanceComparison(before,{...before,prefillMs:NaN},2).comparable,false);
});
