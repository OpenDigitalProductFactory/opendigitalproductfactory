import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFile = promisify(execFileCallback);
const SHA = /^[0-9a-f]{40}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/i;
const PROJECT = /^dpf-n1-[a-z0-9][a-z0-9_-]*$/i;
export const PROMOTER_READINESS_PROTOCOL_FLOOR_SHA = "21969d012ad8ab382d47a2c59ffc955530796bd2";

export function buildPromoterReadinessDockerArgs({ candidateDigest, source, state, backups, secret, targetSha, project }) {
  return ["run", "--rm", "--read-only",
    "-v", `${source}:/host-source:ro`, "-v", `${state}:/dpf-state:ro`, "-v", `${backups}:/backups:ro`,
    "-v", `${secret}:/run/secrets/dpf-runtime-transition:ro`,
    "-e", "DPF_PROMOTER_STATE_DIR=/dpf-state", "-e", "DPF_HOST_PLATFORM=linux", "-e", "DPF_HOST_ARCH=amd64",
    "-e", "DPF_HOST_IDENTITY_PROVENANCE=explicit", "-e", "DPF_PROMOTER_DOCKER_PREFLIGHT=ready",
    "-e", "DPF_RUNTIME_TRANSITION_SECRET_FILE=/run/secrets/dpf-runtime-transition", "-e", `DPF_PROMOTER_DIGEST=${candidateDigest}`,
    "-e", "PROMOTE_SOURCE=/host-source", "-e", `PROMOTE_TARGET_SHA=${targetSha}`, "-e", `PROMOTE_COMPOSE_PROJECT=${project}`,
    "-e", "PROMOTE_BACKUP_PATH=/backups/recovery", "-e", "PROMOTE_HEALTH_URL=http://host.docker.internal:3000/api/health",
    candidateDigest, "--readiness", "--json"];
}

export async function classifyUpgradeProtocolFloor(baseSha, isAncestor) {
  if (!SHA.test(baseSha)) throw new Error("protocol floor classification requires an exact base SHA");
  return await isAncestor(PROMOTER_READINESS_PROTOCOL_FLOOR_SHA, baseSha) ? "post-floor" : "legacy-bootstrap";
}

export async function githubJson(url, { token = process.env.GITHUB_TOKEN, fetchImpl = fetch, paginate = false } = {}) {
  if (!token) throw new Error("GITHUB_TOKEN is required; acceptance must fail, never skip");
  const values = [];
  let next = url;
  do {
    const response = await fetchImpl(next, { headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" } });
    if (!response.ok) throw new Error(`GitHub API ${response.status} for ${next}`);
    const value = await response.json();
    if (!paginate) return value;
    values.push(...(Array.isArray(value) ? value : value.check_runs ?? []));
    next = parseNext(response.headers.get("link"));
  } while (next);
  return values;
}

function parseNext(link) {
  if (!link) return null;
  return link.split(",").map((part) => part.trim()).find((part) => /rel="next"/.test(part))?.match(/^<([^>]+)>/)?.[1] ?? null;
}

export async function verifyBaseRevision({ repository, prNumber, baseSha, requiredChecks, api }) {
  if (!repository || !SHA.test(baseSha)) throw new Error("repository and exact 40-character base SHA are required");
  const call = api ?? ((path) => githubJson(`https://api.github.com/repos/${repository}${path}`, { paginate: path.includes("/check-runs") }));
  if (Number(prNumber) > 0) {
    const pr = await call(`/pulls/${prNumber}`);
    if (pr.base?.ref !== "main" || pr.base?.sha !== baseSha) throw new Error("base SHA is not the exact PR base on main");
  }
  const membership = await call(`/compare/${baseSha}...main`);
  if (!["identical", "ahead"].includes(membership.status)) throw new Error("base SHA is not a member of main history");
  const checksResponse = await call(`/commits/${baseSha}/check-runs?per_page=100`);
  const checks = Array.isArray(checksResponse) ? checksResponse : checksResponse.check_runs ?? [];
  for (const name of requiredChecks) {
    const matches = checks.filter((check) => check.name === name);
    if (!matches.some((check) => check.conclusion === "success")) throw new Error(`required check ${name} has no successful run`);
  }
  return { baseSha, checks: requiredChecks };
}

export async function createHarnessWorkspace(prefix = "dpf-n1-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const workspace = { root, source: join(root, "source"), state: join(root, "state"), backups: join(root, "backups"), evidence: join(root, "evidence") };
  await Promise.all(Object.values(workspace).slice(1).map((path) => mkdir(path, { recursive: true })));
  return workspace;
}

function inside(parent, child) {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export function assertSafeHarnessConfig({ root, source, state, backups, project }) {
  if (!PROJECT.test(project) || project.toLowerCase() === "dpf") throw new Error("harness project must be a unique non-dpf dpf-n1-* project");
  let resolvedRoot;
  try {
    resolvedRoot = resolveReal(root);
  } catch {
    throw new Error("harness root must resolve before cleanup");
  }
  const temp = resolveReal(tmpdir());
  const home = resolveReal(homedir());
  if (!inside(temp, resolvedRoot) || resolvedRoot === home || resolvedRoot === resolve(resolvedRoot, "/")) throw new Error("harness root must be an mktemp-owned temporary directory");
  for (const [name, path] of Object.entries({ source, state, backups })) {
    let resolvedPath;
    try { resolvedPath = resolveReal(path); } catch { throw new Error(`${name} path must resolve before cleanup`); }
    if (!inside(resolvedRoot, resolvedPath)) throw new Error(`${name} path escapes harness root`);
  }
  return true;
}

function resolveReal(path) {
  // realpathSync is deliberately loaded lazily to keep the async setup API simple.
  return process.getBuiltinModule("node:fs").realpathSync(path);
}

export async function cleanupHarness(workspace, composeDown = defaultComposeDown) {
  assertSafeHarnessConfig(workspace);
  await composeDown(workspace);
  await rm(workspace.root, { recursive: true, force: true });
}

export async function cleanupProject(project, run = execFile) {
  if (!PROJECT.test(project) || project.toLowerCase() === "dpf") throw new Error("cleanup project must be a unique non-dpf dpf-n1-* project");
  const { stdout } = await run("docker", ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`]);
  const ids = stdout.trim().split(/\s+/).filter(Boolean);
  if (ids.length) await run("docker", ["rm", "-f", ...ids]);
  const volumeResult = await run("docker", ["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`]);
  const volumes = volumeResult.stdout.trim().split(/\s+/).filter(Boolean);
  if (volumes.some((volume) => !volume.startsWith(`${project}_`))) throw new Error("cleanup discovered a non-project-prefixed volume");
  if (volumes.length) await run("docker", ["volume", "rm", ...volumes]);
}

export function installCleanupHandlers(emitter, cleanup) {
  let promise;
  const runOnce = () => {
    promise ??= Promise.resolve().then(cleanup);
    return promise;
  };
  emitter.once("beforeExit", runOnce);
  emitter.once("SIGINT", runOnce);
  emitter.once("SIGTERM", runOnce);
  return runOnce;
}

async function defaultComposeDown({ source, state, project }) {
  await execFile("node", [join(source, "scripts", "dpf-compose.mjs"), "--project-name", project, "down", "--volumes", "--remove-orphans"], { cwd: source, env: { ...process.env, COMPOSE_PROJECT_NAME: project, DPF_STATE_DIR_HOST: state, DPF_STATE_DIR: "/dpf-state", DPF_ALLOW_DESTRUCTIVE_COMPOSE: "1" } });
}

export async function prepareNMinusOneBaseline({ workspace, project, portalUrl }, deps = {}) {
  assertSafeHarnessConfig({ ...workspace, project });
  const run = deps.run ?? execFile;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)));
  const env = {
    ...process.env,
    COMPOSE_PROJECT_NAME: project,
    DPF_STATE_DIR_HOST: workspace.state,
    DPF_STATE_DIR: "/dpf-state",
    DPF_HOST_INSTALL_PATH: workspace.source,
  };
  await run("node", [join(workspace.source, "scripts", "dpf-compose.mjs"), "--project-name", project, "up", "-d", "--build", "postgres", "portal"], { cwd: workspace.source, env });
  let lastStatus = 0;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetchImpl(`${portalUrl}/api/health`);
      lastStatus = response.status;
      if (response.ok) return { healthy: true, project, portalUrl };
    } catch { lastStatus = 0; }
    await sleep(2_000);
  }
  throw new Error(`N-1 baseline portal failed health check (last status ${lastStatus || "unreachable"})`);
}

function assertSuccessEvidence(evidence, candidateSha, digest, mode) {
  if (!evidence.healthy || evidence.version !== candidateSha) throw new Error("candidate portal health/version evidence mismatch");
  if (evidence.promoterDigest !== digest || evidence.promoterSourceSha !== candidateSha) throw new Error("candidate promoter digest/source label mismatch");
  if (evidence.readiness?.digest !== digest || evidence.persistenceDigest !== digest) throw new Error("candidate digest diverged across readiness and persistence");
  if (!/^[a-f0-9]{64}$/.test(evidence.sourceV1Hash ?? "") || !/^[a-f0-9]{64}$/.test(evidence.migratedV2Hash ?? "") || evidence.sourceV1Hash === evidence.migratedV2Hash) throw new Error("independent v1/v2 byte evidence missing");
  if (evidence.sourceSchemaVersion !== 1 || evidence.migratedSchemaVersion !== 2) throw new Error("install-state schema transition evidence missing");
  if (!Array.isArray(evidence.recoveryArtifacts) || evidence.recoveryArtifacts.length !== 1 || evidence.recoveryArtifacts[0].sha256 !== evidence.sourceV1Hash) throw new Error("exactly one governed recovery artifact is required");
  if (mode === "post-floor" && evidence.readiness?.owner !== "portal") throw new Error("post-floor baseline must report portal-owned readiness");
}

export async function runNMinusOneUpgrade(options, deps) {
  const d = deps ?? createRuntimeDependencies(options);
  const evidence = { baselineSha: options.baseSha, candidateSha: options.candidateSha, project: options.project, upgradeRequested: false, startedAt: new Date().toISOString() };
  try {
    await d.verifyBase(options);
    const prepared = await d.prepare(options);
    evidence.candidateDigest = prepared.candidateDigest;
    const mode = prepared.mode ?? await classifyUpgradeProtocolFloor(options.baseSha, d.isAncestor);
    evidence.mode = mode;
    if (!DIGEST.test(prepared.candidateDigest)) throw new Error("candidate image did not resolve to an immutable digest");
    const readiness = await d.readiness({ ...options, ...prepared });
    evidence.readiness = readiness;
    if (mode === "legacy-bootstrap" && readiness.ok) {
      throw new Error("pre-floor legacy-bootstrap installs require installer/reinstall remediation");
    }
    if (!readiness.ok) {
      if (!options.injectReadinessFailure || readiness.quiescenceBegan) throw new Error("candidate readiness failed before acceptance upgrade");
      evidence.baselineHealthy = await d.baselineHealth(options);
      if (!evidence.baselineHealthy) throw new Error("baseline became unhealthy after readiness refusal");
      evidence.result = "expected-readiness-refusal";
      return await d.writeEvidence(evidence);
    }
    await d.requestUpgrade({ ...options, ...prepared });
    evidence.upgradeRequested = true;
    const completed = await d.poll({ ...options, ...prepared });
    evidence.readiness = readiness;
    assertSuccessEvidence({ ...completed, readiness }, options.candidateSha, prepared.candidateDigest, mode);
    Object.assign(evidence, completed, { result: "passed", completedAt: new Date().toISOString() });
    return await d.writeEvidence(evidence);
  } finally {
    await d.cleanup();
  }
}

function createRuntimeDependencies(options) {
  let workspace;
  let cleanupOnce;
  const portalUrl = options.portalUrl ?? "http://127.0.0.1:3000";
  return {
    isAncestor: async (floor, base) => {
      const result = await execFile("git", ["merge-base", "--is-ancestor", floor, base], { cwd: process.cwd() }).then(() => true, (error) => {
        if (error?.code === 1) return false;
        throw error;
      });
      return result;
    },
    verifyBase: (args) => verifyBaseRevision({ ...args, prNumber: options.prNumber, requiredChecks: options.requiredChecks }),
    prepare: async () => {
      workspace = await createHarnessWorkspace();
      workspace.project = options.project;
      assertSafeHarnessConfig(workspace);
      cleanupOnce = installCleanupHandlers(process, () => cleanupHarness(workspace));
      await execFile("git", ["clone", "--no-checkout", `https://github.com/${options.repository}.git`, workspace.source]);
      await execFile("git", ["checkout", "--detach", options.baseSha], { cwd: workspace.source });
      const transitionSecret = join(workspace.root, "transition.secret");
      await writeFile(transitionSecret, randomBytes(32).toString("hex"));
      await writeFile(join(workspace.state, "install-state.json"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${JSON.stringify({ schemaVersion: 1, installerVersion: "n-minus-one", platform: "linux", arch: "amd64", installPath: workspace.source, stateDir: workspace.state, composeProjectName: options.project })}\n`)]));
      await prepareNMinusOneBaseline({ workspace, project: options.project, portalUrl });
      const contractDigest = createHash("sha256").update(await readFile(join(process.cwd(), "promoter-contract.json"))).digest("hex");
      const image = `${options.project}-promoter:${options.candidateSha}`;
      await execFile("docker", ["build", "--build-arg", `DPF_PROMOTER_SOURCE_SHA=${options.candidateSha}`, "--build-arg", `DPF_PROMOTER_CONTRACT_DIGEST=sha256:${contractDigest}`, "-f", "Dockerfile.promoter", "-t", image, "."], { cwd: process.cwd() });
      const { stdout } = await execFile("docker", ["image", "inspect", image, "--format", "{{json .}}"]);
      const inspected = JSON.parse(stdout);
      const candidateDigest = inspected.Id;
      const labels = inspected.Config?.Labels ?? {};
      if (labels["org.opencontainers.image.revision"] !== options.candidateSha || labels["org.opendpf.promoter.contract-digest"] !== `sha256:${contractDigest}`) throw new Error("candidate image labels do not bind source SHA and contract digest");
      return { candidateDigest, contractDigest: `sha256:${contractDigest}`, workspace, transitionSecret, candidateSource: process.cwd() };
    },
    readiness: async ({ candidateDigest, candidateSource, transitionSecret }) => {
      if (options.injectReadinessFailure) return { ok: false, owner: options.bridgeMode ? "bridge" : "portal", digest: candidateDigest, quiescenceBegan: false };
      const args = buildPromoterReadinessDockerArgs({ candidateDigest, source: candidateSource, state: workspace.state, backups: workspace.backups, secret: transitionSecret, targetSha: options.candidateSha, project: options.project });
      const { stdout } = await execFile("docker", args);
      return { ...JSON.parse(stdout), owner: options.bridgeMode ? "bridge" : "portal", digest: candidateDigest, quiescenceBegan: false };
    },
    requestUpgrade: async ({ candidateDigest }) => requestJson(`${portalUrl}/api/ops/self-upgrade`, { targetSha: options.candidateSha, promoterImage: candidateDigest }),
    baselineHealth: async () => (await fetch(`${portalUrl}/api/health`)).ok,
    poll: () => pollEvidence(portalUrl, options),
    writeEvidence: async (value) => { await mkdir(options.evidenceDir, { recursive: true }); await writeFile(join(options.evidenceDir, "n-minus-one-evidence.json"), `${JSON.stringify(value, null, 2)}\n`); return value; },
    cleanup: async () => { if (cleanupOnce) await cleanupOnce(); },
  };
}

async function requestJson(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`upgrade request failed: ${response.status}`);
  return response.json();
}

async function pollEvidence(portalUrl, options) {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${portalUrl}/api/ops/self-upgrade/evidence`);
    if (response.ok) { const value = await response.json(); if (value.version === options.candidateSha && value.healthy) return value; }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
  }
  throw new Error("bounded polling timed out waiting for candidate evidence");
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--inject-readiness-failure" || key === "--bridge-mode") values[key.slice(2).replaceAll("-", "_")] = true;
    else if (key.startsWith("--")) values[key.slice(2).replaceAll("-", "_")] = argv[++index];
  }
  const rawPrNumber = values.pr_number ?? process.env.GITHUB_EVENT_PULL_REQUEST_NUMBER ?? "";
  const parsedPrNumber = /^\d+$/.test(rawPrNumber) ? Number(rawPrNumber) : 0;
  return {
    baseSha: values.base_sha, candidateSha: values.candidate_sha, repository: values.repository,
    project: values.project, evidenceDir: values.evidence_dir, prNumber: parsedPrNumber,
    requiredChecks: (values.required_checks ?? "Production Build,Unit Tests").split(",").map((v) => v.trim()),
    injectReadinessFailure: Boolean(values.inject_readiness_failure), bridgeMode: Boolean(values.bridge_mode),
    timeoutMs: Number(values.timeout_ms ?? 1_200_000), portalUrl: values.portal_url,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  const cleanupIndex = process.argv.indexOf("--cleanup-project");
  if (cleanupIndex !== -1) {
    await cleanupProject(process.argv[cleanupIndex + 1]);
    process.stdout.write("safe cleanup complete\n");
    process.exit(0);
  }
  for (const [name, value] of Object.entries({ baseSha: options.baseSha, candidateSha: options.candidateSha })) if (!SHA.test(value ?? "")) throw new Error(`${name} must be a 40-character SHA`);
  if (!options.evidenceDir || !options.repository) throw new Error("--repository and --evidence-dir are required");
  await access(options.evidenceDir, constants.W_OK).catch(async () => mkdir(options.evidenceDir, { recursive: true }));
  const result = await runNMinusOneUpgrade(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
