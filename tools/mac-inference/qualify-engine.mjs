#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir, platform, arch } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPackage, hashFile, sha256 } from './package.mjs';
import { readMcpConnection } from '../../scripts/host-resource-runner.mjs';
import { mcpCall } from '../../scripts/lib/mcp-client.mjs';
import { superviseLeaseRun,admittedLeaseTtlMs } from '../../scripts/lib/lease-supervisor.mjs';

const exec = promisify(execFile);
let a = {};
function argumentsFromCLI() { return parseArgs({ options: Object.fromEntries(
  ['package','sdk','out','lease-id','owner-session','model','model-ref','model-digest','oci-manifest','mmproj','baseline-engine','baseline-engine-sha256','dmr-root'].map(k=>[k,{type:'string'}])) }).values; }
const report = { schemaVersion:1, status:'incomplete', runtimeFilesChanged:false, providerConfigurationChanged:false,
  physicalOlderMacCoverage:'unrun', platformWorkflowIntegration:'unrun', results:[], failures:[] };
let child, workspace, lease, deadline, connection;
const abort = new AbortController();
const pause = ms => new Promise(r=>setTimeout(r,ms));
function fail(message) { throw new Error(message); }
export function validLeaseExpiry(value, now=Date.now()) {
  const expiry=typeof value==='string'?Date.parse(value):NaN;
  return Number.isFinite(expiry) && expiry>now+15000;
}
export function modelLayerBinding(raw, digest, ggufHash, bytes, projector) {
  if(!/^sha256:[a-f0-9]{64}$/.test(digest) || 'sha256:'+sha256(raw)!==digest) fail('OCI manifest digest mismatch');
  const manifest=JSON.parse(raw.toString());
  if(manifest.schemaVersion!==2 || !Array.isArray(manifest.layers)) fail('Unsupported OCI model manifest');
  const layers=manifest.layers.filter(x=>x.mediaType==='application/vnd.docker.ai.gguf.v3');
  if(layers.length!==1 || layers[0].digest!=='sha256:'+ggufHash || layers[0].size!==bytes) fail('GGUF does not match baseline OCI layer');
  const projectors=manifest.layers.filter(x=>x.mediaType==='application/vnd.docker.ai.mmproj');
  if(projectors.length>1 || (projectors.length===1 && (!projector
    || projectors[0].digest!=='sha256:'+projector.sha256 || projectors[0].size!==projector.bytes))
    || (projectors.length===0 && projector)) fail('Projector does not match baseline OCI layer');
  return {manifestDigest:digest,ggufLayerDigest:layers[0].digest,projectorLayerDigest:projectors[0]?.digest??null};
}
export async function unloadWithRestorationObligation(report, unload) {
  // The command can take effect before its acknowledgement is lost.
  report.baselineUnloadedForQualification=true;
  report.baselineUnloadAcknowledged=false;
  await unload();
  report.baselineUnloadAcknowledged=true;
}
async function ownedLease() {
  const r = await mcpCall('list_nonprod_environment_leases', {}, connection);
  if (r?.success !== true) fail('Lease ownership unavailable');
  const matches=(r.data?.leases??[]).filter(x=>x.leaseId===a['lease-id']);
  const v=matches[0];
  if (matches.length!==1 || v.status!=='active' || v.environmentKey!=='local-integration-ci'
    || v.ownerSessionId!==a['owner-session'] || v.branchName!=='codex/mac-metal-engine-package'
    || !validLeaseExpiry(v.expiresAt)) fail('Exact active qualification lease not proven');
  lease=v;
  return v;
}
async function json(url, body, timeout=240000, cancellation=abort.signal) {
  if (Date.now()>=deadline) fail('Qualification deadline reached');
  const signal=AbortSignal.any([cancellation,AbortSignal.timeout(Math.max(1,Math.min(timeout,deadline-Date.now())))]);
  const r=await fetch(url,{method:body===undefined?'GET':'POST',
    ...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)}),signal});
  if (!r.ok) fail('Diagnostic HTTP '+r.status+' at '+new URL(url).pathname);
  return r.json();
}
function metric(response, elapsedMs) {
  const usage=response.usage??{}; const t=response.timings??{};
  const number=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
  return {elapsedMs,promptTokens:number(usage.prompt_tokens),outputTokens:number(usage.completion_tokens),
    cachedTokens:number(usage.prompt_tokens_details?.cached_tokens??t.cache_n),
    prefillMs:number(t.prompt_ms),decodeMs:number(t.predicted_ms),finishReason:response.choices?.[0]?.finish_reason??null};
}
async function complete(base, messages, tools, recovery=false) {
  await ownedLease();
  const body={model:a['model-ref'],messages,max_tokens:256,temperature:0,seed:476,
    chat_template_kwargs:{enable_thinking:false,preserve_thinking:true},
    ...(tools?{tools,tool_choice:{type:'function',function:{name:'record_result'}}}:{})};
  const start=performance.now();
  const response=await json(base+'/v1/chat/completions',body,recovery?30000:240000,
    recovery?new AbortController().signal:abort.signal);
  return {response,metric:metric(response,performance.now()-start)};
}
async function testEndpoint(label, base, context) {
  console.log(JSON.stringify({phase:label+'-model-checks'}));
  const arithmetic=await complete(base,[{role:'user',content:'What is 19 + 23? Return only the integer.'}]);
  const message=arithmetic.response.choices?.[0]?.message;
  report.results.push({engine:label,case:'arithmetic',correct:message?.content?.trim()==='42'
    && arithmetic.metric.finishReason==='stop',...arithmetic.metric});
  const tools=[{type:'function',function:{name:'record_result',description:'Return a calculated integer.',
    parameters:{type:'object',properties:{value:{type:'integer'}},required:['value'],additionalProperties:false}}}];
  const tool=await complete(base,[{role:'user',content:'Call record_result with value equal to 19 + 23.'}],tools);
  let correct=false;
  try { const calls=tool.response.choices[0].message.tool_calls;
    correct=calls.length===1 && calls[0].function.name==='record_result'
      && JSON.parse(calls[0].function.arguments).value===42 && tool.metric.finishReason==='tool_calls';
  } catch { /* absent or malformed tool output is a failed observation */ }
  report.results.push({engine:label,case:'tool-call-format',correct,...tool.metric});
  const messages=[{role:'system',content:context},{role:'user',content:'Return only the benchmark marker.'}];
  const cold=await complete(base,messages);
  const coldMessage=cold.response.choices?.[0]?.message;
  report.results.push({engine:label,case:'long-cold',correct:coldMessage?.content?.trim()==='MATCH731'
    && cold.metric.finishReason==='stop',...cold.metric});
  if (!coldMessage || typeof coldMessage.content!=='string') fail('Cold completion missing');
  // Preserve the actual assistant message in memory so the next prefix is faithful.
  const warm=await complete(base,[...messages,coldMessage,{role:'user',content:'Repeat only the same benchmark marker.'}]);
  report.results.push({engine:label,case:'long-warm',correct:warm.response.choices?.[0]?.message?.content?.trim()==='MATCH731'
    && warm.metric.finishReason==='stop',...warm.metric});
}
async function runnersIdle(root) {
  const until=Math.min(deadline,Date.now()+120000);
  while (Date.now()<until) {
    await ownedLease();
    const rows=await json(root+'/engines/ps',undefined,3000);
    if (!Array.isArray(rows)) fail('Runner activity capture unavailable');
    const state=runnerActivity(rows);
    if (state.idle) {
      (report.drainCaptures??=[]).push({runners:rows.length,loadingFieldObserved:state.loadingFieldObserved,
        inUseFieldObserved:rows.every(x=>typeof x.in_use==='boolean'),
        activityContract:'Docker Model Runner v1.2.8: bool fields use omitempty'});
      return rows;
    }
    await pause(3000);
  }
  fail('Existing runner did not become idle; no candidate model launched');
}
// Docker Model Runner v1.2.8 scheduling/api.go:82-84 declares both activity
// booleans with omitempty. Omitted means false only on an identified status row.
export function runnerActivity(rows) {
  const identified=x=>typeof x.backend_name==='string'&&x.backend_name.length>0
    &&typeof x.model_name==='string'&&x.model_name.length>0&&typeof x.mode==='string'&&x.mode.length>0;
  if (!Array.isArray(rows) || rows.some(x=>!x
    || (x.in_use===undefined?!identified(x):typeof x.in_use!=='boolean')
    || (x.loading!==undefined && typeof x.loading!=='boolean'))) fail('Runner activity capture unavailable');
  return {idle:rows.every(x=>!x.in_use && x.loading!==true),
    loadingFieldObserved:rows.every(x=>typeof x.loading==='boolean')};
}
export async function restoreAfterQualification({unloaded, restored, stop, restore}) {
  await stop();
  if (unloaded && !restored) await restore();
}
export async function stopOwnedChild(process, graceMs=5000) {
  if (!process) return;
  const ended=()=>process.exitCode!==null || process.signalCode!==null;
  if (ended()) return;
  if (!process.pid) fail('Candidate process ownership unavailable');
  const exit=new Promise(r=>process.once('exit',r));
  process.kill('SIGTERM');
  await Promise.race([exit,pause(graceMs)]);
  if (!ended()) {
    process.kill('SIGKILL');
    await Promise.race([exit,pause(graceMs)]);
  }
  if (!ended()) fail('Candidate shutdown not confirmed');
}
async function stopCandidate() { await stopOwnedChild(child); }
export const MATCHED_ENGINE_SETTINGS=Object.freeze({context:131072,slots:4,kvUnified:true,
  gpuLayers:999,threads:9,batch:512,microBatch:512,flashAttention:'on',cacheK:'f16',cacheV:'f16',mmap:false});
export function nativeEngineArguments({model,modelRef,port,mmproj}) {
  const s=MATCHED_ENGINE_SETTINGS;
  return ['--model',resolve(model),'--alias',modelRef,'--host','127.0.0.1','--port',String(port),
    '--ctx-size',String(s.context),'--parallel',String(s.slots),'--kv-unified',
    '--n-gpu-layers',String(s.gpuLayers),'--threads',String(s.threads),
    '--threads-batch',String(s.threads),'--batch-size',String(s.batch),'--ubatch-size',String(s.microBatch),
    '--flash-attn',s.flashAttention,'--cache-type-k',s.cacheK,'--cache-type-v',s.cacheV,'--no-mmap','--jinja',
    ...(mmproj?['--mmproj',resolve(mmproj)]:[])];
}
async function startOwnedEngine(binary,label) {
  await ownedLease();
  const port=lease.ports?.[0];let startup='';
  if(!Number.isInteger(port)||port<1024||port>65535) fail('Qualification lease did not reserve a usable native port');
  child=spawn(binary,nativeEngineArguments({model:a.model,modelRef:a['model-ref'],port,mmproj:a.mmproj}),
    {stdio:['ignore','pipe','pipe']});
  child.on('error',()=>abort.abort());
  for(const stream of [child.stdout,child.stderr]) stream.on('data',b=>{startup=(startup+b.toString()).slice(-65536);});
  const endpoint='http://127.0.0.1:'+port;const readyUntil=Math.min(deadline,Date.now()+120000);
  let ready=false;
  while(Date.now()<readyUntil&&!ready) {
    if(abort.signal.aborted) fail('Qualification cancelled during startup');
    if(child.exitCode!==null || child.signalCode!==null) fail('Owned '+label+' engine exited during startup');
    try {const r=await fetch(endpoint+'/health',{signal:AbortSignal.timeout(1000)});ready=r.ok;} catch {}
    if(!ready) await pause(1000);
  }
  if(!ready) fail('Owned '+label+' readiness timed out');
  const props=await json(endpoint+'/props',undefined,3000);
  if(props.default_generation_settings?.n_ctx!==MATCHED_ENGINE_SETTINGS.context
    || props.total_slots!==MATCHED_ENGINE_SETTINGS.slots
    || resolve(props.model_path??'')!==resolve(a.model)) fail('Effective context/slots/model differ from controlled arguments');
  (report.runtimeConfiguration??=[]).push({engine:label,settings:MATCHED_ENGINE_SETTINGS,
    effectiveContext:props.default_generation_settings.n_ctx,effectiveSlots:props.total_slots,
    launchMode:'isolated-owned-process',liveDockerServiceSettingsChanged:false});
  (report.nativeStartupEvidence??=[]).push({engine:label,lines:startup.split('\n')
    .filter(x=>/has tensor|tensor API|n_ctx_slot|n_slots|n_ubatch/.test(x)).slice(0,20)});
  return endpoint;
}
export function performanceComparison(before,after,configurationCount) {
  const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
  const matchedPromptTokens=Number.isSafeInteger(before.promptTokens)&&before.promptTokens>0
    &&before.promptTokens===after.promptTokens;
  const coldPrefixCacheMatched=Number.isSafeInteger(before.cachedTokens)&&before.cachedTokens>=0
    &&before.cachedTokens===after.cachedTokens;
  const timingKnown=positive(before.prefillMs)&&positive(after.prefillMs);
  return {matchedPromptTokens,coldPrefixCacheMatched,
    observedColdPrefillRatio:timingKnown?before.prefillMs/after.prefillMs:null,
    comparable:configurationCount===2&&matchedPromptTokens&&coldPrefixCacheMatched&&timingKnown,
    scope:'Same immutable model/projector, explicit shared native engine arguments and verified effective context/slots; one cold sample per engine, not live service or fleet performance'};
}
async function main() {
  for (const key of ['package','sdk','out','lease-id','owner-session','model','model-ref','model-digest','oci-manifest','baseline-engine','baseline-engine-sha256','dmr-root']) {
    if (!a[key]) fail('--'+key+' is required');
  }
  if(platform()!=='darwin'||arch()!=='arm64') fail('Native qualification requires an Apple Silicon Mac');
  const root=new URL(a['dmr-root']);
  if (!['127.0.0.1','localhost','[::1]'].includes(root.hostname)||root.username||root.password
    ||!['http:','https:'].includes(root.protocol)||root.pathname!=='/'||root.search||root.hash) fail('DMR root must be a loopback management root');
  connection=readMcpConnection(); if (!connection) fail('Governed lease connection unavailable');
  lease=await ownedLease();deadline=Date.now()+9*60000;
  const supervision=await superviseLeaseRun({
    ttlMs:admittedLeaseTtlMs(lease.expiresAt,120000),expiresAt:lease.expiresAt,
    run:()=>performQualification(root),
    renew:async()=>{
      const r=await mcpCall('renew_nonprod_environment_lease',{
        leaseId:lease.leaseId,ownerSessionId:a['owner-session'],ttlMinutes:2},connection);
      if(r?.success===true) {
        const v=r.data?.lease;
        if(v?.leaseId!==lease.leaseId || v.ownerSessionId!==a['owner-session']
          || v.status!=='active' || !validLeaseExpiry(v.expiresAt))
          return {success:false,error:'qualification_lease_renewal_unproven'};
        lease=v;
      }
      return r;
    },
    terminate:async()=>{abort.abort();await stopCandidate();},
    // Cleanup/restoration and the native release remain visible to the owning agent.
    release:async()=>{},
    onEvent:event=>{if(event.type!=='released') (report.leaseEvents??=[]).push(event);},
  });
  if(supervision.status==='fenced') fail('Qualification fenced: '+supervision.reason);
}
async function performQualification(root) {
  const verified=await verifyPackage(a.package);
  report.package={version:verified.version,manifestSha256:verified.manifestSha256,fileCount:verified.fileCount};
  report.leaseId=lease.leaseId;report.startedAt=new Date().toISOString();
  const management=root.href.replace(/\/$/,'');
  await runnersIdle(management);
  workspace=await mkdtemp(join(tmpdir(),'dpf-metal-qualification-'));
  const probe=join(workspace,'tensor-probe');
  await exec('xcrun',['clang','-isysroot',a.sdk,'-target','arm64-apple-macos13.3','-fobjc-arc',
    fileURLToPath(new URL('./metal-language-probe.m',import.meta.url)),'-framework','Foundation','-framework','Metal','-o',probe],{timeout:30000});
  report.tensorControls=JSON.parse((await exec(probe,[],{timeout:30000})).stdout);
  const control=report.tensorControls.controls;
  if (!control.find(x=>x.mode==='tensor')?.pipelineOK||!control.find(x=>x.mode==='fallback')?.fallbackUnchanged) fail('Tensor/fallback control failed');
  const version=await exec(join(a.package,'bin/llama-server'),['--version'],{timeout:30000,maxBuffer:1024*1024});
  report.engineVersion=(version.stdout+version.stderr).split('\n').filter(x=>/version:|build =|built with/.test(x));
  if (!report.engineVersion.some(x=>x.includes('72874f5-dpf-metal4.1'))) fail('Candidate build identity missing');
  const devices=await exec(join(a.package,'bin/llama-server'),['--list-devices'],{timeout:60000,maxBuffer:1024*1024});
  const deviceLog=devices.stdout+devices.stderr;
  report.nativeDeviceEvidence=deviceLog.split('\n').filter(x=>/GPU name|has tensor|tensor API|error compiling source/.test(x));
  if(!/has tensor\s*=\s*true/.test(deviceLog)||/tensor API is not supported/.test(deviceLog)) fail('Built engine did not establish tensor support on this M5');
  if(!/^[a-f0-9]{64}$/.test(a['baseline-engine-sha256'])
    || await hashFile(a['baseline-engine'])!==a['baseline-engine-sha256']) fail('Docker-distributed baseline binary identity changed');
  if(a['baseline-engine-sha256']===await hashFile(join(a.package,'bin/llama-server'))) fail('Baseline and candidate must be different binaries');
  report.baselineEngine={sha256:a['baseline-engine-sha256'],mode:'Docker-distributed binary in isolated controlled process',
    serviceWorkflowQualification:'unrun'};
  const card=await json(management+'/models/'+a['model-ref'].split('/').map(encodeURIComponent).join('/'),undefined,3000);
  if(card.id!==a['model-digest']) fail('Selected model digest changed');
  const projector=a.mmproj?{sha256:await hashFile(a.mmproj),bytes:(await stat(a.mmproj)).size}:undefined;
  report.model={ociDigest:card.id,ggufSha256:await hashFile(a.model),bytes:(await stat(a.model)).size};
  report.model.binding=modelLayerBinding(await readFile(a['oci-manifest']),card.id,
    report.model.ggufSha256,report.model.bytes,projector);
  await runnersIdle(management);
  await unloadWithRestorationObligation(report,()=>exec('docker',['model','unload',a['model-ref']],{timeout:30000}));
  const baseline=await startOwnedEngine(a['baseline-engine'],'docker-baseline');
  let lines=2500;
  const makeContext=n=>'DPF_MAC_ENGINE_QUALIFICATION_V1\n'+Array.from({length:n},(_,i)=>'Record '+String(i).padStart(4,'0')+' is archived.').join('\n')+'\nThe benchmark marker is MATCH731.';
  const initial=await json(baseline+'/tokenize',{model:a['model-ref'],content:makeContext(lines)},30000);
  if(!Array.isArray(initial.tokens)||initial.tokens.length===0) fail('Exact tokenizer count unavailable');
  lines=Math.max(1,Math.min(6000,Math.floor(lines*32000/initial.tokens.length)));
  const context=makeContext(lines);
  await testEndpoint('docker-baseline',baseline,context);
  await stopCandidate();
  const candidate=await startOwnedEngine(join(a.package,'bin/llama-server'),'corrected-candidate');
  await testEndpoint('corrected-candidate',candidate,context);
  await stopCandidate();
  // Restore the same Docker model with a bounded synthetic completion before releasing the window.
  await restoreDockerBaseline();
  const cold=label=>report.results.find(x=>x.engine===label&&x.case==='long-cold');
  const warm=label=>report.results.find(x=>x.engine===label&&x.case==='long-warm');
  const before=cold('docker-baseline'),after=cold('corrected-candidate');
  report.performance=performanceComparison(before,after,report.runtimeConfiguration.length);
  const correct=report.results.length===8&&report.results.every(x=>x.correct);
  const cache=warm('docker-baseline')?.cachedTokens>0&&warm('corrected-candidate')?.cachedTokens>0;
  report.status=correct&&cache&&report.baselineRestored&&report.performance.matchedPromptTokens?'model-smoke-qualified':'qualification-failed';
  if(!correct) report.failures.push('One or more task-completion controls failed');
  if(!cache) report.failures.push('Warm-prefix reuse not established on both engines');
}
async function restoreDockerBaseline() {
  await ownedLease();
  const baseline=a['dmr-root'].replace(/\/$/,'')+'/engines/llama.cpp';
  const restore=await complete(baseline,[{role:'user',content:'Reply with OK.'}],undefined,true);
  report.baselineRestored=restore.metric.finishReason==='stop';
  if(!report.baselineRestored) fail('Docker model restoration not confirmed');
}
async function run() {
  a=argumentsFromCLI();
  for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{abort.abort();void stopCandidate();});
  try { await main(); } catch(error) { report.failures.push(error.message); }
  finally {
    try {
      // Reserve a separate, bounded recovery interval while the same lease is active.
      if(lease) deadline=Math.min(Date.now()+45000,Date.parse(lease.expiresAt)-15000);
      await restoreAfterQualification({unloaded:report.baselineUnloadedForQualification,
        restored:report.baselineRestored,stop:stopCandidate,restore:restoreDockerBaseline});
    } catch(error) {report.failures.push('Restoration: '+error.message);report.baselineRestored=false;}
    if(workspace) await rm(workspace,{recursive:true,force:true});
    report.finishedAt=new Date().toISOString();
    if(report.failures.length && report.status==='model-smoke-qualified') report.status='qualification-failed';
    if(a.out) await writeFile(a.out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({status:report.status,results:report.results,failures:report.failures,performance:report.performance,output:a.out}));
    if(report.status!=='model-smoke-qualified') process.exitCode=1;
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) await run();
