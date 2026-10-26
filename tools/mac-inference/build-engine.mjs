#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, writeFile, lstat, cp, rm, realpath, access } from 'node:fs/promises';
import { tmpdir, homedir, arch, platform } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_LOCK as lock, hashFile, enumerateFiles, fileRecord, contained, verifyPackage } from './package.mjs';

const { values: args } = parseArgs({ options: {
  archive: { type: 'string' }, cmake: { type: 'string' }, sdk: { type: 'string' },
  out: { type: 'string' }, jobs: { type: 'string', default: '4' }, 'keep-build': { type: 'boolean', default: false }
} });
function run(command, argv, cwd, capture = false) {
  return execFileSync(command, argv, { cwd, timeout: 20 * 60 * 1000,
    stdio: capture ? 'pipe' : 'inherit', encoding: capture ? 'utf8' : undefined,
    env: { ...process.env, ZERO_AR_DATE: '1' } });
}
async function unusedOutput(value) {
  if (!value) throw new Error('--out is required');
  const path = resolve(value); const parent = await realpath(dirname(path));
  const actual = join(parent, basename(path));
  for (const forbidden of [homedir(), '/Applications', '/System', '/usr', '/bin', '/sbin', '/Library', join(homedir(), '.docker')]) {
    if (actual === forbidden || (forbidden !== homedir() && contained(forbidden, actual))) throw new Error('Protected output path');
  }
  for (let p = parent; ; p = dirname(p)) {
    try { await access(join(p,'.git')); throw new Error('Output must be outside a Git checkout'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (p === dirname(p)) break;
  }
  try { await lstat(actual); throw new Error('Output already exists; no replacement is permitted'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return actual;
}
async function main() {
  if (platform() !== 'darwin' || arch() !== 'arm64') throw new Error('Build requires an Apple Silicon Mac');
  if (!args.archive || !args.cmake || !args.sdk) throw new Error('--archive, --cmake and --sdk are required');
  const jobs = Number(args.jobs);
  if (!Number.isSafeInteger(jobs) || jobs < 1 || jobs > 12) throw new Error('--jobs must be 1..12');
  const out = await unusedOutput(args.out);
  const archive = await realpath(args.archive);
  if (await hashFile(archive) !== lock.source.archiveSha256) throw new Error('Source archive SHA256 mismatch');
  const patch = fileURLToPath(new URL('./metal-language.patch', import.meta.url));
  if (await hashFile(patch) !== lock.patchSha256) throw new Error('Patch SHA256 mismatch');
  const sdk = await realpath(args.sdk);
  const sdkSettings = JSON.parse(await readFile(join(sdk,'SDKSettings.json'),'utf8'));
  const sdkVersion = sdkSettings.Version;
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(sdkVersion)) throw new Error('Invalid selected SDK');
  const expectedRoot = 'llama.cpp-' + lock.source.commit;
  for (const path of run('tar',['-tzf',archive],undefined,true).trim().split('\n')) {
    const parts = path.replace(/\/$/,'').split('/');
    if (parts[0] !== expectedRoot || parts.some(p => p === '..') || path.startsWith('/')) throw new Error('Unsafe source archive path');
  }
  const workspace = await mkdtemp(join(tmpdir(),'dpf-mac-engine-'));
  let createdOutput = false;
  try {
    run('tar',['-xzf',archive,'-C',workspace]);
    const source = join(workspace,expectedRoot); const build = join(workspace,'build');
    const metal = join(source,'ggml/src/ggml-metal/ggml-metal-device.m');
    if (await hashFile(metal) !== lock.source.metalSourceSha256) throw new Error('Pinned Metal source SHA256 mismatch');
    run('git',['apply','--check',patch],source); run('git',['apply',patch],source);
    const flags = ['-DCMAKE_BUILD_TYPE=Release','-DCMAKE_OSX_ARCHITECTURES=arm64',
      '-DCMAKE_OSX_DEPLOYMENT_TARGET='+lock.minimumMacOS,'-DCMAKE_OSX_SYSROOT='+sdk,
      '-DGGML_NATIVE=OFF','-DGGML_METAL=ON','-DGGML_METAL_EMBED_LIBRARY=ON',
      '-DLLAMA_BUILD_TESTS=OFF','-DLLAMA_BUILD_EXAMPLES=OFF','-DLLAMA_BUILD_APP=OFF',
      '-DLLAMA_BUILD_TOOLS=ON','-DLLAMA_BUILD_SERVER=ON','-DLLAMA_BUILD_UI=OFF','-DLLAMA_USE_PREBUILT_UI=OFF',
      '-DLLAMA_OPENSSL=OFF','-DLLAMA_CURL=OFF','-DLLAMA_BUILD_NUMBER='+lock.buildNumber,
      '-DLLAMA_BUILD_COMMIT=72874f5-dpf-metal4.1'];
    run(args.cmake,['-S',source,'-B',build,...flags]);
    run(args.cmake,['--build',build,'--target','llama-server','llama-bench','--parallel',String(jobs)]);
    await mkdir(out); createdOutput = true; await mkdir(join(out,'bin'));
    for (const entry of await readdir(join(build,'bin'))) {
      if (entry === 'llama-server' || entry === 'llama-bench' || /^lib.+\.dylib$/.test(entry)) {
        await cp(join(build,'bin',entry),join(out,'bin',entry),{verbatimSymlinks:true});
      }
    }
    await cp(join(source,'LICENSE'),join(out,'LICENSE'));
    await mkdir(join(out,'licenses'),{recursive:true});
    for (const path of await readdir(join(source,'vendor'),{recursive:true})) {
      if (!/^(LICENSE|COPYING|NOTICE)(\.|$)/i.test(basename(path))) continue;
      const src = join(source,'vendor',path);
      if (!(await lstat(src)).isFile()) continue;
      const dst = join(out,'licenses','vendor',path);
      await mkdir(dirname(dst),{recursive:true}); await cp(src,dst);
    }
    // Relocate only this staged package; never modify a Docker-managed file.
    for (const entry of await readdir(join(out,'bin'))) {
      const path = join(out,'bin',entry);
      if (!(await lstat(path)).isFile()) continue;
      const deps = run('otool',['-L',path],undefined,true).split('\n').slice(1);
      for (const line of deps) {
        const dep = line.trim().split(' (')[0];
        if (dep.startsWith(workspace+'/')) run('install_name_tool',['-change',dep,'@rpath/'+basename(dep),path]);
      }
      const commands = run('otool',['-l',path],undefined,true);
      const rpaths = [...commands.matchAll(/cmd LC_RPATH\n\s+cmdsize \d+\n\s+path (\S+) /g)].map(m=>m[1]);
      for (const rp of rpaths) if (rp.startsWith(workspace+'/')) run('install_name_tool',['-delete_rpath',rp,path]);
      if (!rpaths.includes('@loader_path')) run('install_name_tool',['-add_rpath','@loader_path',path]);
      run('codesign',['--force','--sign','-','--timestamp=none',path]);
    }
    const files = [];
    for (const path of await enumerateFiles(out)) files.push(await fileRecord(out,path));
    const manifest = { schemaVersion:1, packageName:'dpf-llama-macos-arm64',version:lock.packageVersion,
      source:lock.source,patchSha256:lock.patchSha256,
      build:{os:'darwin',architecture:'arm64',sdk:sdkVersion,minimumMacOS:lock.minimumMacOS,
        compiler:run('xcrun',['clang','--version'],undefined,true).split('\n')[0],
        cmake:run(args.cmake,['--version'],undefined,true).split('\n')[0],
        flags:flags.map(x=>x.startsWith('-DCMAKE_OSX_SYSROOT=')?'-DCMAKE_OSX_SYSROOT=<selected-sdk>':x),
        signature:'local-adhoc',artifactTrust:'candidate-not-distribution-approved'},
      qualification:{status:'unqualified'},files };
    await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    const verification = await verifyPackage(out);
    const artifact = out+'.tar.gz';
    try { await access(artifact); throw new Error('Archive output already exists'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    run('tar',['-czf',artifact,'-C',dirname(out),basename(out)]);
    console.log(JSON.stringify({packagePath:out,archivePath:artifact,archiveSha256:await hashFile(artifact),
      manifestSha256:verification.manifestSha256,fileCount:verification.fileCount,
      qualification:verification.qualification,retainedBuild:args['keep-build']?workspace:null}));
  } catch(error) {
    if (createdOutput) await rm(out,{recursive:true,force:true});
    throw error;
  } finally { if (!args['keep-build']) await rm(workspace,{recursive:true,force:true}); }
}
main().catch(error=>{ console.error(error.message);process.exitCode=1; });
