#!/usr/bin/env node
import { open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { gitTextOrNull } from "./lib/git.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateBudget } from "./lib/baseline-budget.mjs";
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
  return gitTextOrNull(["rev-parse","HEAD"],{cwd:repoRoot}) ?? "unknown";
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


/**
 * Carry per-metric budgets across a baseline rewrite (BI-24A1264B).
 *
 * The platform already owns the instrument for frozen debt — owner + expiry,
 * enforced by check-no-expired-baseline-budgets.mjs, which exists because "a
 * baseline with no owner and no expiry converts debt we intend to burn down
 * into debt we have legitimized forever, silently". This file was exempt from
 * it as a "generated measurement snapshot", which is true of its informational
 * rows and false of its ratchets: a `non-increasing` metric becomes owned debt
 * the moment it is RAISED.
 *
 * The rule is deliberately asymmetric, because the expansion/contraction cycle
 * should be cheap to run in one direction only:
 *   RAISED    -> requires owner + expiry + the contraction obligation that owns
 *                folding it back in. Expansion is never anonymous.
 *   UNCHANGED -> carries its existing budget forward untouched.
 *   LOWERED   -> drops the budget. The debt was discharged by the contraction;
 *                leaving a marker would invite re-freezing at the new floor.
 *
 * It measures whether a RAISE is still justified. It never asserts that lower
 * is always better — a ratchet resting at its natural floor carries nothing.
 */
export function reconcileMetricBudgets({priorMetrics={},metrics,budget={},today}) {
  const failures=[];
  const out={};
  for (const [name,row] of Object.entries(metrics)) {
    const prior=priorMetrics[name];
    const carried=prior?.owner||prior?.expiry||prior?.contraction
      ? {owner:prior.owner,expiry:prior.expiry,contraction:prior.contraction}
      : null;
    const raised=row.direction==="non-increasing" && typeof prior?.value==="number" && row.value>prior.value;
    if (!raised) {
      const lowered=typeof prior?.value==="number" && row.value<prior.value;
      out[name]=lowered||!carried ? {...row} : {...row,...carried};
      continue;
    }
    const supplied={owner:budget.owner,expiry:budget.expiry};
    const problems=validateBudget(supplied,{label:name,...(today?{today}:{})});
    if (problems.length) {
      failures.push(
        `${name}: ${prior.value} -> ${row.value} is a RAISE of a non-increasing ratchet. ` +
        `Supply --owner <team> --expiry <YYYY-MM-DD> --contraction <BI-…>; ` +
        problems.map((p)=>p.replace(`${name}: `,"")).join(" "),
      );
      out[name]={...row};
      continue;
    }
    if (typeof budget.contraction!=="string" || !budget.contraction.trim()) {
      failures.push(
        `${name}: ${prior.value} -> ${row.value} is a RAISE with no contraction obligation. ` +
        `Pass --contraction <BI-…/EP-…> naming the work that folds it back in; an expansion nobody owns ` +
        `reducing is the freeze this gate exists to stop.`,
      );
      out[name]={...row};
      continue;
    }
    out[name]={...row,owner:budget.owner,expiry:budget.expiry,contraction:budget.contraction.trim()};
  }
  return {metrics:out,failures};
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
      // BI-24A1264B: a RAISED non-increasing ratchet is owned debt from the
      // moment it moves, so --update refuses to record one anonymously. See
      // reconcileMetricBudgets for the asymmetry and why it points this way.
      let priorMetrics={};
      try { priorMetrics=(await json(paths.baselinePath,"substrate baseline")).metrics ?? {}; } catch { priorMetrics={}; }
      const reconciled=reconcileMetricBudgets({
        priorMetrics,
        metrics,
        budget:{owner:options.owner,expiry:options.expiry,contraction:options.contraction},
      });
      if (reconciled.failures.length) throw new Error(`Refusing to raise a substrate ratchet without a budget:\n${reconciled.failures.map((f)=>`- ${f}`).join("\n")}`);
      const payload={version:1,manifestVersion:manifest.version,...provenance,metrics:reconciled.metrics};
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
    else if(argv[i]==="--owner" && argv[i+1]) options.owner=argv[++i];
    else if(argv[i]==="--expiry" && argv[i+1]) options.expiry=argv[++i];
    else if(argv[i]==="--contraction" && argv[i+1]) options.contraction=argv[++i];
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
