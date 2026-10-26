import { test } from 'node:test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, open, rename, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyPackage, ENGINE_LOCK, vendorNoticePaths, embeddedMitNotice } from './package.mjs';

const hash = x => createHash('sha256').update(x).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dpf-engine-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'bin'));
  const files = [];
  for (const [path, content] of [['bin/llama-server', Buffer.from('cffaedfe0c000001736572766572', 'hex')], ['bin/llama-bench', Buffer.from('cffaedfe0c00000162656e6368', 'hex')], ['LICENSE', 'MIT fixture'],...ENGINE_LOCK.requiredRuntimeLibraries.map(path=>[path,Buffer.from('cffaedfe0c0000016c696272617279','hex')])]) {
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
  assert.equal(result.fileCount, 3+ENGINE_LOCK.requiredRuntimeLibraries.length);
  assert.equal(result.requiredRuntimeLibrariesVerified,ENGINE_LOCK.requiredRuntimeLibraries.length); assert.equal(result.qualification.status, 'unqualified');
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

const {readPackageManifest}=await import('./package.mjs');
test('manifest validation reads the opened file when its pathname is replaced',async t=>{
  const f=await fixture(t),path=join(f.root,'manifest.json');
  const original=await readFile(path);
  const outside=join(f.root,'replacement.json');
  await writeFile(outside,'untrusted replacement');
  const bytes=await readPackageManifest(path,async(...args)=>{
    const handle=await open(...args);
    await rename(path,join(f.root,'original.json'));
    await symlink(outside,path);
    return handle;
  });
  assert.deepEqual(bytes,original);
});
test('manifest reader refuses a symlink before reading its target',async t=>{
  const f=await fixture(t),path=join(f.root,'manifest.json');
  await rename(path,join(f.root,'original.json'));
  await symlink('original.json',path);
  await assert.rejects(readPackageManifest(path),/ELOOP|symbolic/i);
});
test('manifest reads remain bounded when an opened file grows after its size check',async t=>{
  const f=await fixture(t),path=join(f.root,'manifest.json');
  await assert.rejects(readPackageManifest(path,async(...args)=>{
    const handle=await open(...args);
    return {stat:async()=>{
      const before=await handle.stat();
      await appendFile(path,Buffer.alloc(1024*1024));
      return before;
    },read:handle.read.bind(handle),close:handle.close.bind(handle)};
  }),/manifest.*large|manifest file/i);
});

// Qualification must accept the observed Docker schema without inventing a
// loading observation, and must keep the Docker engine recoverable on failure.
const {runnerActivity,restoreAfterQualification,stopOwnedChild,validLeaseExpiry,modelLayerBinding,unloadWithRestorationObligation,nativeEngineArguments,performanceComparison,runOwnedNative,guardedLeaseAction,authorityAwareSignal,validateBaselineReport,MATCHED_ENGINE_SETTINGS,recordAuthorityFence,validateOwnedLease,parseQualificationOptions}=await import('./qualify-engine.mjs');
const {validatedModelDigest}=await import('./qualify-engine.mjs');
test('model report identity uses only the validated expected digest',()=>{
  const expected='sha256:'+'a'.repeat(64);
  assert.equal(validatedModelDigest(expected,expected),expected);
  assert.throws(()=>validatedModelDigest(expected,'sha256:'+'b'.repeat(64)),/digest/i);
  assert.throws(()=>validatedModelDigest('arbitrary report content','arbitrary report content'),/digest/i);
  assert.throws(()=>validatedModelDigest(expected,{toString:()=>expected}),/digest/i);
});
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
  for(const [flag,value] of [['--ctx-size','131072'],['--parallel','4'],['--batch-size','512'],['--ubatch-size','512'],['--threads','9'],['--threads-batch','9'],['--cache-type-k','f16'],['--cache-type-v','f16'],['--flash-attn','on'],['--verbosity','4'],['--mmproj','/projector.gguf']]) assert.equal(args[args.indexOf(flag)+1],value);
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

test('Docker omitempty activity booleans decode only on an identified status row',()=>{
  const row={backend_name:'llama.cpp',model_name:'model',mode:'completion',last_used:'2026-10-26T02:35:08Z'};
  assert.equal(runnerActivity([row]).idle,true);
  assert.equal(runnerActivity([{...row,in_use:true}]).idle,false);
  assert.equal(runnerActivity([{...row,loading:true}]).idle,false);
  assert.throws(()=>runnerActivity([{...row,in_use:'false'}]),/capture unavailable/);
  assert.throws(()=>runnerActivity([{}]),/capture unavailable/);
});

test('cancelled native helper closes its owned child before returning',async()=>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),150);
  try {
    await assert.rejects(runOwnedNative(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{timeout:2000,graceMs:25},controller.signal),/owned process closed/);
  } finally {clearTimeout(timer);}
});
test('already-fenced native helper never launches',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(runOwnedNative('/does-not-exist',[],{},controller.signal),/before launch/);
});

for(const restore of [false,true]) test('fencing during ownership read prevents '+(restore?'restoration dispatch':'engine launch'),async()=>{
  let acknowledge,lost=false,acted=false;
  const result=guardedLeaseAction({read:()=>new Promise(r=>{acknowledge=r;}),restore,
    isAuthorityLost:()=>lost,signal:new AbortController().signal,act:()=>{acted=true;}});
  lost=true;acknowledge();
  await assert.rejects(result,/fenced after authority read/);
  assert.equal(acted,false);
});
test('user cancellation still permits restoration while authority remains valid',async()=>{
  const controller=new AbortController();controller.abort();let acted=false;
  await guardedLeaseAction({read:async()=>{},restore:true,isAuthorityLost:()=>false,
    signal:controller.signal,act:()=>{acted=true;}});
  assert.equal(acted,true);
});

test('authority fence aborts an in-flight recovery request independently of user cancellation',async()=>{
  const authority=new AbortController();
  const recovery=new AbortController();
  const signal=authorityAwareSignal(recovery.signal,authority.signal,2000);
  const pending=new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('request aborted')),{once:true}));
  assert.equal(signal.aborted,false);
  authority.abort();
  await assert.rejects(pending,/request aborted/);
  assert.equal(signal.aborted,true);
});

function baselineFixture() {
  const current={workload:{version:'dpf-mac-model-controls.v1',contextLineCount:2900,specificationSha256:'spec',coldMessagesSha256:'messages'},package:{manifestSha256:'package'},model:{ociDigest:'model',ggufSha256:'weights',binding:{projectorLayerDigest:'projector'}},tensorControls:{device:'device'}};
  const previous=structuredClone({...current,schemaVersion:1,baselineRestored:true,
    baselineEngine:{sha256:'binary'},finishedAt:new Date().toISOString(),
    runtimeConfiguration:[{engine:'docker-baseline',settings:MATCHED_ENGINE_SETTINGS,effectiveContext:131072,effectiveSlots:4}],
    results:['arithmetic','tool-call-format','long-cold','long-warm'].map(c=>({engine:'docker-baseline',case:c,correct:true,promptTokens:32011,cachedTokens:c==='long-warm'?32000:0,prefillMs:100,finishReason:c==='tool-call-format'?'tool_calls':'stop'}))});
  return {previous,current};
}
test('reuse accepts only a restored, completed and matching recent baseline',()=>{
  const {previous,current}=baselineFixture();
  assert.equal(validateBaselineReport(previous,current,'binary').rows.length,4);
  for(const mutate of [p=>p.model.ggufSha256='other',p=>p.baselineRestored=false,p=>p.results[0].correct=false,p=>p.results[2].promptTokens=null,p=>p.results[3].cachedTokens=0,p=>p.runtimeConfiguration[0].settings.slots=2,p=>p.finishedAt='not-a-date',p=>delete p.workload,p=>p.workload.coldMessagesSha256='different-same-length',p=>p.results[2].prefillMs=Infinity,p=>p.results[3].cachedTokens=0.5,p=>p.results[0].finishReason='tool_calls']) {
    const copy=structuredClone(previous);mutate(copy);
    assert.throws(()=>validateBaselineReport(copy,current,'binary'));
  }
});
test('fence evidence survives a supervised run rejecting during cancellation',async()=>{
  const {superviseLeaseRun}=await import('../../scripts/lib/lease-supervisor.mjs');
  const target={};let rejectRun;
  const running=new Promise((resolve,reject)=>{rejectRun=reject;});
  await assert.rejects(superviseLeaseRun({ttlMs:300,expiresAt:new Date(Date.now()+30).toISOString(),safetyMarginMs:1,
    run:()=>running,renew:async()=>({success:false,error:'lease_lost'}),release:async()=>{},
    terminate:async()=>{recordAuthorityFence(target);rejectRun(Error('fenced request'));}}),/fenced request/);
  assert.match(target.backendEffectSettlement,/unknown after authority fence/);
});

test('qualification refuses unbound, queued and foreign reservations',()=>{
  const v={leaseId:'own',status:'active',phase:'running',slotManifestVersion:1,environmentKey:'local-integration-ci',ownerSessionId:'session',branchName:'codex/mac-metal-engine-package',expiresAt:new Date(Date.now()+60000).toISOString()};
  const expected={id:'own',owner:'session'};
  assert.equal(validateOwnedLease(v,expected).leaseId,'own');
  for(const change of [{phase:'admitted-unbound'},{status:'queued'},{ownerSessionId:'other'},{branchName:'other'},{expiresAt:'invalid'}]) assert.throws(()=>validateOwnedLease({...v,...change},expected),/not proven/);
});

test('first qualification accepts no baseline report; reuse is explicitly optional',()=>{
  const names=['package','sdk','out','lease-id','owner-session','model','model-ref','model-digest','oci-manifest','baseline-engine','baseline-engine-sha256','dmr-root'];
  const argv=names.flatMap(k=>['--'+k,'fixture']);
  assert.equal(parseQualificationOptions(argv)['baseline-report'],undefined);
  assert.equal(parseQualificationOptions([...argv,'--baseline-report','prior.json'])['baseline-report'],'prior.json');
});
test('rejects missing Metal runtime even when its manifest row is also removed',async t=>{
  const f=await fixture(t);
  f.manifest.files=f.manifest.files.filter(x=>x.path!=='bin/libggml-metal.dylib');
  await rm(join(f.root,'bin/libggml-metal.dylib'),{force:true});await f.save();
  await assert.rejects(verifyPackage(f.root),/Required package file missing.*libggml-metal/);
});

test('vendor notices include embedded headers as well as standalone licenses',async t=>{
  const root=await mkdtemp(join(tmpdir(),'dpf-notices-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'nlohmann'));
  await writeFile(join(root,'nlohmann/json.hpp'),'// SPDX-FileCopyrightText: 2013 - 2025 Niels Lohmann\n// SPDX-License-Identifier: MIT\n');
  await writeFile(join(root,'LICENSE'),'license');await writeFile(join(root,'build.sh'),'not a notice');
  assert.deepEqual(await vendorNoticePaths(root),['LICENSE','nlohmann/json.hpp']);
  const notice=embeddedMitNotice(await readFile(join(root,'nlohmann/json.hpp'),'utf8'),'MIT License\nPermission is hereby granted');
  assert.match(notice,/Niels Lohmann/);assert.match(notice,/Permission is hereby granted/);
  assert.throws(()=>embeddedMitNotice('missing copyright','MIT'),/unavailable/);
});
