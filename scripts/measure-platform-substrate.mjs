#!/usr/bin/env node
import { open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildStaticRatchetMetrics,
  collectRepositoryMeasurements,
  compareRatchetMetrics,
  stableSerialize,
  validateSubstrateManifest,
} from "./lib/platform-substrate-measurements.mjs";

const scriptRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaults = (repoRoot) => ({
  manifestPath: resolve(repoRoot,"scripts/platform-substrate-manifest.json"),
  composePath: resolve(repoRoot,"docker-compose.yml"),
  macosComposePath: resolve(repoRoot,"docker-compose.macos.yml"),
  linuxComposePath: resolve(repoRoot,"docker-compose.linux.yml"),
  providersPath: resolve(repoRoot,"packages/db/data/providers-registry.json"),
  baselinePath: resolve(repoRoot,"scripts/platform-substrate-baseline.json"),
  capabilitiesPath: resolve(repoRoot,"packages/db/data/platform-runtime-capabilities.json"),
});

async function json(path,label) {
  let text; try { text=await readFile(path,"utf8"); } catch (error) { throw new Error(`${label} unavailable at ${path}: ${error.message}`); }
  try { return JSON.parse(text); } catch (error) { throw new Error(`${label} is invalid JSON at ${path}: ${error.message}`); }
}

function sha(repoRoot) {
  const result=spawnSync("git",["rev-parse","HEAD"],{cwd:repoRoot,encoding:"utf8"});
  return result.status===0 ? result.stdout.trim() : "unknown";
}

export async function atomicWriteFile(targetPath, content, injectedIo={}) {
  const io={open,rename,rm,...injectedIo};
  const tempPath=join(dirname(targetPath),`.${targetPath.split(/[\\/]/).at(-1)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle=await io.open(tempPath,"wx");
    await handle.writeFile(content,"utf8");
    await handle.sync();
    await handle.close();
    handle=undefined;
    // Same-directory rename is the atomic replacement primitive. Node maps this
    // to the host's replacement rename semantics, including Windows MoveFileEx.
    await io.rename(tempPath,targetPath);
  } catch(error) {
    if(handle) await handle.close().catch(()=>{});
    await io.rm(tempPath,{force:true}).catch(()=>{});
    throw error;
  }
}

export async function runSubstrateMeasurement(options={}) {
  const repoRoot=resolve(options.repoRoot ?? scriptRoot);
  const paths={...defaults(repoRoot),...Object.fromEntries(Object.entries(options).filter(([key])=>key.endsWith("Path")))};
  try {
    const [manifest,composeText,macosComposeText,linuxComposeText,providers,capabilitySeed]=await Promise.all([
      json(paths.manifestPath,"substrate manifest"),
      readFile(paths.composePath,"utf8"),
      readFile(paths.macosComposePath,"utf8"),
      readFile(paths.linuxComposePath,"utf8"),
      json(paths.providersPath,"provider inventory"),
      json(paths.capabilitiesPath,"runtime capability seed"),
    ]);
    const errors=validateSubstrateManifest(manifest,{composeText,overlayComposeTexts:[macosComposeText,linuxComposeText],providers,capabilities:capabilitySeed.capabilities});
    if (errors.length) throw new Error(`Invalid substrate manifest:\n${errors.map((e)=>`- ${e}`).join("\n")}`);
    const provenance={generatedAt:options.generatedAt ?? new Date().toISOString(),gitSha:options.gitSha ?? sha(repoRoot)};
    const measurements=await collectRepositoryMeasurements({repoRoot,manifest,...provenance});
    const metrics=buildStaticRatchetMetrics(measurements);
    if (options.update) {
      const payload={version:1,manifestVersion:manifest.version,...provenance,metrics};
      await atomicWriteFile(paths.baselinePath,stableSerialize(payload),options.io);
      return {exitCode:0,stdout:options.json?stableSerialize(payload):`Updated substrate baseline: ${paths.baselinePath}\n`,stderr:""};
    }
    const baseline=await json(paths.baselinePath,"substrate baseline");
    if (baseline.version!==1 || baseline.manifestVersion!==manifest.version) throw new Error("Substrate baseline version or manifest version is incompatible");
    const comparison=compareRatchetMetrics({baseline:baseline.metrics,current:metrics});
    const payload={metrics,comparison};
    const advisories=comparison.advisories.map((a)=>`Advisory: ${a.metric} decreased from ${a.baseline} to ${a.current}; refresh the stale baseline.`).join("\n");
    if (!comparison.passed) {
      const regressions=comparison.regressions.map((r)=>`${r.metric}: ${r.baseline} -> ${r.current}`).join("\n");
      return {exitCode:1,stdout:options.json?stableSerialize(payload):"",stderr:`Substrate complexity regression:\n${regressions}\n`};
    }
    return {exitCode:0,stdout:options.json?stableSerialize(payload):`Substrate complexity guard passed.${advisories?`\n${advisories}`:""}\n`,stderr:""};
  } catch (error) { return {exitCode:1,stdout:"",stderr:`${error.message}\n`}; }
}

function parseArgs(argv) {
  const options={};
  const keys={"--repo-root":"repoRoot","--manifest":"manifestPath","--compose":"composePath","--providers":"providersPath","--capabilities":"capabilitiesPath","--baseline":"baselinePath"};
  for(let i=0;i<argv.length;i++) {
    if(argv[i]==="--json") options.json=true;
    else if(argv[i]==="--update") options.update=true;
    else if(keys[argv[i]] && argv[i+1]) options[keys[argv[i]]]=resolve(argv[++i]);
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  return options;
}

export async function main(argv=process.argv.slice(2)) {
  let result;
  try { result=await runSubstrateMeasurement(parseArgs(argv)); } catch(error) { result={exitCode:1,stdout:"",stderr:`${error.message}\n`}; }
  if(result.stdout) process.stdout.write(result.stdout);
  if(result.stderr) process.stderr.write(result.stderr);
  return result.exitCode;
}

if(import.meta.url===pathToFileURL(process.argv[1]??"").href) process.exitCode=await main();
