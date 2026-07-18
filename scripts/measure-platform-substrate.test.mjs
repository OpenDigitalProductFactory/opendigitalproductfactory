import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runSubstrateMeasurement } from "./measure-platform-substrate.mjs";
import { validateCapabilityServiceBindings, validateSubstrateManifest } from "./lib/platform-substrate-measurements.mjs";

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "substrate-cli-"));
  try {
    const files = {
      "docker-compose.yml": "services:\n  portal:\n    image: portal\n",
      "docker-compose.macos.yml": "services:\n",
      "docker-compose.linux.yml": "services:\n",
      "packages/db/data/providers-registry.json": "[]\n",
      "packages/db/data/platform-runtime-capabilities.json": `${JSON.stringify({version:1,capabilities:[capability("runtime:core")]})}\n`,
      "packages/db/prisma/schema.prisma": "model User { id String @id }\n",
      "packages/db/src/seed.ts": "export const seed = true;\n",
      "scripts/check-module-size.mjs": "const SOFT_CEILING = 800;\n",
    };
    const service = { service:"portal", class:"universal-core", capability:"runtime:core", boundaryReason:"Portal.", defaultRequired:true, profiles:[], ports:[], volumes:[], dependsOn:[], canonicalDataOwner:"none", backupPolicy:"excluded-stateless", healthSemantics:"consumer-observed", hostPlatforms:["windows"], targetClassification:"universal-core" };
    files["scripts/platform-substrate-manifest.json"] = `${JSON.stringify({version:2,services:[service],externalRuntimes:[]}, null, 2)}\n`;
    for (const [name, value] of Object.entries(files)) { const path=join(root,name); await mkdir(dirname(path),{recursive:true}); await writeFile(path,value); }
    return await run(root);
  } finally { await rm(root,{recursive:true,force:true}); }
}

test("--update writes a deterministic canonical baseline and --json checks it", async () => fixture(async (repoRoot) => {
  const baselinePath=join(repoRoot,"baseline.json");
  const updated=await runSubstrateMeasurement({repoRoot,baselinePath,update:true,generatedAt:"2026-07-17T00:00:00Z",gitSha:"abc"});
  assert.equal(updated.exitCode,0);
  const first=await readFile(baselinePath,"utf8");
  assert.match(first,/"direction": "non-increasing"/);
  const checked=await runSubstrateMeasurement({repoRoot,baselinePath,json:true,generatedAt:"later",gitSha:"def"});
  assert.equal(checked.exitCode,0);
  assert.equal(JSON.parse(checked.stdout).comparison.passed,true);
  await runSubstrateMeasurement({repoRoot,baselinePath,update:true,generatedAt:"2026-07-17T00:00:00Z",gitSha:"abc"});
  assert.equal(await readFile(baselinePath,"utf8"),first);
}));

const capability = (capabilityId) => ({ capabilityId, manifest: { runtime: {} } });
const service = (serviceName, capabilityId) => ({ service: serviceName, capability: capabilityId });

test("capability service joins fail closed", () => {
  assert.deepEqual(validateCapabilityServiceBindings({
    services: [service("portal", "runtime:core")], capabilities: [],
  }), ["missing_capability:runtime:core"]);
  assert.deepEqual(validateCapabilityServiceBindings({
    services: [service("unknown", "runtime:core")],
    capabilities: [capability("runtime:core")], composeServiceNames: ["portal"],
  }), ["unknown_service_binding:unknown"]);
  assert.deepEqual(validateCapabilityServiceBindings({
    services: [service("portal", "runtime:core"), service("portal", "runtime:build")],
    capabilities: [capability("runtime:core"), capability("runtime:build")],
  }), ["duplicate_service_binding:portal"]);
  assert.deepEqual(validateCapabilityServiceBindings({
    services: [service("portal", "core")], capabilities: [capability("runtime:core")],
  }), ["missing_capability:core"]);
});

test("host overlay services participate in exhaustive manifest validation", () => {
  const portal = { service:"portal", class:"universal-core", capability:"runtime:core", boundaryReason:"Portal.", defaultRequired:true, profiles:[], ports:[], volumes:[], dependsOn:[], canonicalDataOwner:"none", backupPolicy:"excluded-stateless", healthSemantics:"consumer-observed", hostPlatforms:["windows","macos","linux"], targetClassification:"universal-core" };
  const ollama = { service:"ollama", class:"capability-activated", capability:"runtime:external-ai", boundaryReason:"Linux inference.", defaultRequired:false, profiles:["runtime-external-ai"], ports:["11434:11434"], volumes:["ollama_data:/root/.ollama"], dependsOn:[], canonicalDataOwner:"none", backupPolicy:"excluded-rebuildable", healthSemantics:"compose-healthcheck", hostPlatforms:["linux"], targetClassification:"capability-activated" };
  const errors = validateSubstrateManifest(
    { version:2, services:[portal, ollama], externalRuntimes:[] },
    {
      composeText:"services:\n  portal:\n    image: portal\n",
      overlayComposeTexts:["services:\n  ollama:\n    profiles: [\"runtime-external-ai\"]\n    ports: [\"11434:11434\"]\n    volumes: [\"ollama_data:/root/.ollama\"]\n"],
      providers:[],
      capabilities:[capability("runtime:core"), capability("runtime:external-ai")],
    },
  );
  assert.deepEqual(errors, []);
});

test("defaultRequired must match current Compose profile activation", async () => fixture(async (repoRoot) => {
  const manifestPath = join(repoRoot, "scripts/platform-substrate-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.services[0].defaultRequired = false;
  await writeFile(manifestPath, JSON.stringify(manifest));
  const result = await runSubstrateMeasurement({ repoRoot, baselinePath: join(repoRoot, "baseline.json"), update: true });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /defaultRequired does not match Compose profile activation/);
}));

test("check fails closed for a missing baseline", async () => fixture(async (repoRoot) => {
  const result=await runSubstrateMeasurement({repoRoot,baselinePath:join(repoRoot,"missing.json")});
  assert.equal(result.exitCode,1); assert.match(result.stderr,/baseline/i);
}));

test("invalid manifest never overwrites an existing baseline", async () => fixture(async (repoRoot) => {
  const baselinePath=join(repoRoot,"baseline.json"); await writeFile(baselinePath,"preserve\n");
  await writeFile(join(repoRoot,"scripts/platform-substrate-manifest.json"),"{}\n");
  const result=await runSubstrateMeasurement({repoRoot,baselinePath,update:true});
  assert.equal(result.exitCode,1); assert.equal(await readFile(baselinePath,"utf8"),"preserve\n");
}));

test("failed atomic replacement preserves the prior baseline and cleans its sibling temp", async () => fixture(async (repoRoot) => {
  const baselinePath=join(repoRoot,"baseline.json");
  await writeFile(baselinePath,"prior baseline\n");
  const result=await runSubstrateMeasurement({
    repoRoot,baselinePath,update:true,
    io:{ rename:async () => { throw new Error("injected rename interruption"); } },
  });
  assert.equal(result.exitCode,1);
  assert.match(result.stderr,/injected rename interruption/);
  assert.equal(await readFile(baselinePath,"utf8"),"prior baseline\n");
  assert.deepEqual((await readdir(repoRoot)).filter((name)=>name.includes("baseline.json.") && name.endsWith(".tmp")),[]);
}));

test("regression exits nonzero while decreases are advisories", async () => fixture(async (repoRoot) => {
  const baselinePath=join(repoRoot,"baseline.json"); await runSubstrateMeasurement({repoRoot,baselinePath,update:true});
  const baseline=JSON.parse(await readFile(baselinePath,"utf8")); baseline.metrics.serviceCount.value=0; await writeFile(baselinePath,JSON.stringify(baseline));
  const failed=await runSubstrateMeasurement({repoRoot,baselinePath}); assert.equal(failed.exitCode,1); assert.match(failed.stderr,/serviceCount/);
  baseline.metrics.serviceCount.value=2; await writeFile(baselinePath,JSON.stringify(baseline));
  const advised=await runSubstrateMeasurement({repoRoot,baselinePath,json:true}); assert.equal(advised.exitCode,0); assert.equal(JSON.parse(advised.stdout).comparison.advisories[0].metric,"serviceCount");
}));

function invokeCli(repoRoot, baselinePath, extraArgs=[]) {
  const args=[
    "scripts/measure-platform-substrate.mjs",
    "--repo-root",repoRoot,
    "--manifest",join(repoRoot,"scripts/platform-substrate-manifest.json"),
    "--compose",join(repoRoot,"docker-compose.yml"),
    "--providers",join(repoRoot,"packages/db/data/providers-registry.json"),
    "--baseline",baselinePath,
    ...extraArgs,
  ];
  return spawnSync(process.execPath,args,{cwd:new URL("..",import.meta.url),encoding:"utf8"});
}

test("actual CLI entrypoint parses injected paths and enforces update/check/json exit semantics", async () => fixture(async (repoRoot) => {
  const baselinePath=join(repoRoot,"injected-baseline.json");
  const missing=invokeCli(repoRoot,baselinePath);
  assert.equal(missing.status,1); assert.match(missing.stderr,/baseline/i);

  const update=invokeCli(repoRoot,baselinePath,["--update"]);
  assert.equal(update.status,0); assert.match(update.stdout,/Updated substrate baseline/);
  const checked=invokeCli(repoRoot,baselinePath,["--json"]);
  assert.equal(checked.status,0); assert.equal(JSON.parse(checked.stdout).comparison.passed,true);

  const baseline=JSON.parse(await readFile(baselinePath,"utf8"));
  baseline.metrics.serviceCount.value=0;
  await writeFile(baselinePath,JSON.stringify(baseline));
  const regression=invokeCli(repoRoot,baselinePath);
  assert.equal(regression.status,1); assert.match(regression.stderr,/serviceCount/);

  const preserved=await readFile(baselinePath,"utf8");
  await writeFile(join(repoRoot,"scripts/platform-substrate-manifest.json"),"{}\n");
  const invalid=invokeCli(repoRoot,baselinePath,["--update"]);
  assert.equal(invalid.status,1); assert.match(invalid.stderr,/manifest/i);
  assert.equal(await readFile(baselinePath,"utf8"),preserved);
}));
