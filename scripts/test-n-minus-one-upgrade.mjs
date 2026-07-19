import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { signTransitionPayload } from "./lib/transition-signing.mjs";

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

export function normalizePromoterReadiness(value, { owner, digest }) {
  const failures = Array.isArray(value?.failures) ? value.failures : ["readiness_failures_invalid"];
  const ok = value?.result === "ready" && failures.length === 0 && value?.quiescenceBegan === false;
  return { ...value, failures, ok, owner, digest };
}

export function assertPromotionSourceIdentity(envFileContent, candidateSource) {
  const entry = envFileContent.split(/\r?\n/).find((line) => line.startsWith("DPF_HOST_INSTALL_PATH="));
  if (entry?.slice("DPF_HOST_INSTALL_PATH=".length) !== candidateSource) {
    throw new Error("promotion source diverges from Compose host install identity");
  }
}

export function assertRecreatedPortalProvenance(container, image, { project }) {
  if (container?.Config?.Labels?.["com.docker.compose.project"] !== project || container?.Config?.Labels?.["com.docker.compose.service"] !== "portal") {
    throw new Error("recreated portal does not belong to the isolated promotion project");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(container?.Image ?? "") || container.Image !== image?.Id) {
    throw new Error("recreated portal image provenance does not match the promoted candidate");
  }
}

export async function fetchAndCheckoutCandidate({ repositoryDir, candidateSha, eventKind, candidateRef, run = execFile }) {
  if (!SHA.test(candidateSha)) throw new Error("candidate checkout requires an exact 40-character SHA");
  const localCandidateRef = "refs/dpf/candidate";
  const isPullRequest = eventKind === "pull_request";
  if (isPullRequest && !/^refs\/pull\/\d+\/merge$/.test(candidateRef ?? "")) throw new Error("pull request candidate requires an explicit merge ref");
  if (!isPullRequest && candidateRef !== candidateSha && candidateRef !== "main" && candidateRef !== "refs/heads/main") throw new Error("non-PR candidate requires the exact SHA or main ref");
  await run("git", ["fetch", "--no-tags", "origin", `+${candidateRef}:${localCandidateRef}`], { cwd: repositoryDir });
  const { stdout } = await run("git", ["rev-parse", localCandidateRef], { cwd: repositoryDir });
  const resolvedSha = stdout.trim();
  if (resolvedSha !== candidateSha) throw new Error("fetched candidate ref does not match the event candidate SHA");
  await run("git", ["checkout", "--detach", localCandidateRef], { cwd: repositoryDir });
  const { stdout: checkedOut } = await run("git", ["rev-parse", "HEAD"], { cwd: repositoryDir });
  if (checkedOut.trim() !== candidateSha) throw new Error("detached candidate checkout does not match the event candidate SHA");
  return { candidateRef: localCandidateRef, sourceRef: candidateRef, resolvedSha };
}

export async function cloneAndCheckoutBaseline({ remote, repositoryDir, baseSha, run = execFile }) {
  if (!SHA.test(baseSha)) throw new Error("baseline checkout requires an exact 40-character SHA");
  await run("git", ["clone", "--no-checkout", remote, repositoryDir]);
  await run("git", ["checkout", "--detach", baseSha], { cwd: repositoryDir });
}

export function buildPromoterPromotionDockerArgs({ candidateDigest, source, state, backups, secret, composeEnvFile, targetSha, project, envelope, signature }) {
  const composeEnvContainerPath = "/run/dpf/n-minus-one.env";
  return ["run", "--rm", "--add-host", "host.docker.internal:host-gateway",
    "-v", "/var/run/docker.sock:/var/run/docker.sock:rw", "-v", `${source}:/host-source:ro`,
    "-v", `${state}:/dpf-state:rw`, "-v", `${backups}:/backups:rw`, "-v", `${secret}:/run/secrets/dpf-runtime-transition:ro`,
    "-v", `${composeEnvFile}:${composeEnvContainerPath}:ro`,
    "-e", "DPF_PROMOTER_STATE_DIR=/dpf-state", "-e", "DPF_RUNTIME_TRANSITION_SECRET_FILE=/run/secrets/dpf-runtime-transition",
    "-e", `DPF_INSTALL_STATE_MIGRATION_ENVELOPE=${Buffer.from(JSON.stringify(envelope)).toString("base64url")}`,
    "-e", `DPF_INSTALL_STATE_MIGRATION_SIGNATURE=${signature}`, "-e", `DPF_SELF_UPGRADE_RUN_ID=${envelope.runId}`,
    "-e", `DPF_PROMOTER_DIGEST=${candidateDigest}`, "-e", "PROMOTE_SOURCE=/host-source", "-e", `PROMOTE_TARGET_SHA=${targetSha}`,
    "-e", `PROMOTE_COMPOSE_PROJECT=${project}`, "-e", `PROMOTE_COMPOSE_ENV_FILE=${composeEnvContainerPath}`, "-e", "PROMOTE_BACKUP_PATH=/backups/recovery",
    "-e", "PROMOTE_HEALTH_URL=http://host.docker.internal:3000/api/health", candidateDigest, "--self-upgrade"];
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

export async function cleanupHarness(workspace, composeDown = cleanupNMinusOneBaseline) {
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

export async function cleanupNMinusOneBaseline(workspace, run = execFile) {
  const { source, state, project } = workspace;
  const env = workspace.harnessEnvironment ?? { ...process.env, COMPOSE_PROJECT_NAME: project, DPF_STATE_DIR_HOST: state, DPF_STATE_DIR: state };
  await run("node", [join(source, "scripts", "dpf-compose.mjs"), ...(workspace.harnessEnvFile ? ["--env-file", workspace.harnessEnvFile] : []), "--project-name", project, "down", "--volumes", "--remove-orphans"], { cwd: source, env: { ...env, DPF_ALLOW_DESTRUCTIVE_COMPOSE: "1" } });
}

async function ensureNMinusOneHostEnvironment(workspace, project) {
  if (workspace.harnessEnvironment && workspace.harnessEnvFile) return workspace.harnessEnvironment;
  const authSecret = `dpf_n1_${randomBytes(32).toString("base64url")}`;
  const credentialKey = randomBytes(32).toString("hex");
  const env = {
    ...process.env,
    COMPOSE_PROJECT_NAME: project,
    DPF_STATE_DIR_HOST: workspace.state,
    DPF_STATE_DIR: workspace.state,
    DPF_BACKUPS_HOST_PATH: workspace.backups,
    DPF_HOST_INSTALL_PATH: workspace.source,
    DPF_N1_HARNESS: "1",
    AUTH_SECRET: authSecret,
    CREDENTIAL_ENCRYPTION_KEY: credentialKey,
  };
  const envFile = join(workspace.root, "n-minus-one.env");
  await writeFile(envFile, [
    `COMPOSE_PROJECT_NAME=${project}`,
    `DPF_STATE_DIR_HOST=${workspace.state}`,
    `DPF_STATE_DIR=${workspace.state}`,
    `DPF_BACKUPS_HOST_PATH=${workspace.backups}`,
    `DPF_HOST_INSTALL_PATH=${workspace.source}`,
    "DPF_N1_HARNESS=1",
    `AUTH_SECRET=${authSecret}`,
    `CREDENTIAL_ENCRYPTION_KEY=${credentialKey}`,
    "",
  ].join("\n"), { mode: 0o600 });
  workspace.harnessEnvironment = env;
  workspace.harnessEnvFile = envFile;
  return env;
}

export async function prepareNMinusOneBaseline({ workspace, project, portalUrl }, deps = {}) {
  assertSafeHarnessConfig({ ...workspace, project });
  const run = deps.run ?? execFile;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)));
  const statePath = join(workspace.state, "install-state.json");
  await access(statePath).then(() => { throw new Error("N-1 baseline state must be absent before startup"); }, () => {});
  const observedLegacyBytes = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(`${JSON.stringify({ schemaVersion: 1, installerVersion: "n-minus-one", platform: "linux", arch: "amd64", installPath: workspace.source, stateDir: workspace.state, composeProjectName: project })}\n`),
  ]);
  const env = await ensureNMinusOneHostEnvironment(workspace, project);
  await run("node", [join(workspace.source, "scripts", "dpf-compose.mjs"), "--env-file", workspace.harnessEnvFile, "--project-name", project, "up", "-d", "--build", "postgres", "portal"], { cwd: workspace.source, env });
  let lastStatus = 0;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetchImpl(`${portalUrl}/api/health`);
      lastStatus = response.status;
      if (response.ok) {
        const tempPath = join(workspace.state, `.install-state.json.n1-${process.pid}-${randomBytes(6).toString("hex")}`);
        let handle;
        try {
          handle = await open(tempPath, "wx", 0o600);
          await handle.writeFile(observedLegacyBytes);
          await handle.sync();
          await handle.close(); handle = undefined;
          await rename(tempPath, statePath);
        } finally {
          if (handle) await handle.close().catch(() => {});
          await rm(tempPath, { force: true }).catch(() => {});
        }
        return { healthy: true, project, portalUrl, sourceV1Hash: createHash("sha256").update(observedLegacyBytes).digest("hex") };
      }
    } catch { lastStatus = 0; }
    await sleep(2_000);
  }
  throw new Error(`N-1 baseline portal failed health check (last status ${lastStatus || "unreachable"})`);
}

function assertSuccessEvidence(evidence, candidateSha, digest, mode, baselineSourceV1Hash) {
  if (!evidence.healthy || evidence.version !== candidateSha) throw new Error("candidate portal health/version evidence mismatch");
  if (evidence.promoterDigest !== digest || evidence.promoterSourceSha !== candidateSha) throw new Error("candidate promoter digest/source label mismatch");
  if (evidence.readiness?.digest !== digest || evidence.persistenceDigest !== digest) throw new Error("candidate digest diverged across readiness and persistence");
  if (!/^[a-f0-9]{64}$/.test(evidence.sourceV1Hash ?? "") || !/^[a-f0-9]{64}$/.test(evidence.migratedV2Hash ?? "") || evidence.sourceV1Hash === evidence.migratedV2Hash) throw new Error("independent v1/v2 byte evidence missing");
  if (evidence.sourceSchemaVersion !== 1 || evidence.migratedSchemaVersion !== 2) throw new Error("install-state schema transition evidence missing");
  if (!Array.isArray(evidence.recoveryArtifacts) || evidence.recoveryArtifacts.length !== 1 || evidence.recoveryArtifacts[0].sha256 !== evidence.sourceV1Hash) throw new Error("exactly one governed recovery artifact is required");
  if (!/^[a-f0-9]{64}$/.test(baselineSourceV1Hash ?? "") || evidence.sourceV1Hash !== baselineSourceV1Hash || evidence.recoveryArtifacts[0].sha256 !== baselineSourceV1Hash) throw new Error("completed recovery evidence does not match the observed baseline v1 bytes");
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
    await d.requestUpgrade({ ...options, ...prepared, readiness });
    evidence.upgradeRequested = true;
    const completed = await d.poll({ ...options, ...prepared });
    evidence.readiness = readiness;
    assertSuccessEvidence({ ...completed, readiness }, options.candidateSha, prepared.candidateDigest, mode, prepared.baselineSourceV1Hash);
    Object.assign(evidence, completed, { result: "passed", completedAt: new Date().toISOString() });
    return await d.writeEvidence(evidence);
  } finally {
    await d.cleanup();
  }
}

function createRuntimeDependencies(options) {
  let workspace;
  let cleanupOnce;
  let promotionCompleted;
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
      await cloneAndCheckoutBaseline({ remote: `https://github.com/${options.repository}.git`, repositoryDir: workspace.source, baseSha: options.baseSha });
      const transitionSecret = join(workspace.root, "transition.secret");
      await writeFile(transitionSecret, randomBytes(32).toString("hex"));
      const baseline = await prepareNMinusOneBaseline({ workspace, project: options.project, portalUrl });
      await fetchAndCheckoutCandidate({ repositoryDir: workspace.source, candidateSha: options.candidateSha, eventKind: options.eventKind, candidateRef: options.candidateRef });
      const contractDigest = createHash("sha256").update(await readFile(join(process.cwd(), "promoter-contract.json"))).digest("hex");
      const image = `${options.project}-promoter:${options.candidateSha}`;
      await execFile("docker", ["build", "--build-arg", `DPF_PROMOTER_SOURCE_SHA=${options.candidateSha}`, "--build-arg", `DPF_PROMOTER_CONTRACT_DIGEST=sha256:${contractDigest}`, "-f", "Dockerfile.promoter", "-t", image, "."], { cwd: process.cwd() });
      const { stdout } = await execFile("docker", ["image", "inspect", image, "--format", "{{json .}}"]);
      const inspected = JSON.parse(stdout);
      const candidateDigest = inspected.Id;
      const labels = inspected.Config?.Labels ?? {};
      if (labels["org.opencontainers.image.revision"] !== options.candidateSha || labels["org.opendpf.promoter.contract-digest"] !== `sha256:${contractDigest}`) throw new Error("candidate image labels do not bind source SHA and contract digest");
      return { candidateDigest, contractDigest: `sha256:${contractDigest}`, workspace, transitionSecret, candidateSource: workspace.source, baselineSourceV1Hash: baseline.sourceV1Hash };
    },
    readiness: async ({ candidateDigest, candidateSource, transitionSecret }) => {
      if (options.injectReadinessFailure) return { ok: false, owner: options.bridgeMode ? "bridge" : "portal", digest: candidateDigest, quiescenceBegan: false };
      const args = buildPromoterReadinessDockerArgs({ candidateDigest, source: candidateSource, state: workspace.state, backups: workspace.backups, secret: transitionSecret, targetSha: options.candidateSha, project: options.project });
      const { stdout } = await execFile("docker", args);
      return normalizePromoterReadiness(JSON.parse(stdout), { owner: options.bridgeMode ? "bridge" : "portal", digest: candidateDigest });
    },
    requestUpgrade: async ({ candidateDigest, candidateSource, transitionSecret, readiness }) => {
      assertPromotionSourceIdentity(await readFile(workspace.harnessEnvFile, "utf8"), candidateSource);
      const secret = (await readFile(transitionSecret, "utf8")).trim();
      const envelope = {
        kind: "install-state-migration", version: 1, runId: `SUR-n1-${Date.now()}`, promoterDigest: candidateDigest,
        sourceHash: readiness.sourceHash, projectionHash: readiness.projectionHash,
        fromSchemaVersion: readiness.fromSchemaVersion, toSchemaVersion: readiness.toSchemaVersion,
        hostIdentity: { platform: "linux", arch: "amd64", provenance: "explicit", capabilityHostPlatform: "linux" },
        issuedAt: new Date(Date.now() - 1_000).toISOString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      };
      const signature = signTransitionPayload(envelope, secret);
      const args = buildPromoterPromotionDockerArgs({ candidateDigest, source: candidateSource, state: workspace.state, backups: workspace.backups, secret: transitionSecret, composeEnvFile: workspace.harnessEnvFile, targetSha: options.candidateSha, project: options.project, envelope, signature });
      const result = await execFile("docker", args, { cwd: candidateSource, maxBuffer: 20 * 1024 * 1024 });
      promotionCompleted = { envelope, signature, stdout: result.stdout, stderr: result.stderr };
      return { requested: true, runId: envelope.runId };
    },
    baselineHealth: async () => (await fetch(`${portalUrl}/api/health`)).ok,
    poll: async ({ candidateDigest, baselineSourceV1Hash }) => {
      if (!promotionCompleted) throw new Error("governed promoter did not complete");
      const { stdout: portalIds } = await execFile("docker", ["ps", "-q", "--filter", `label=com.docker.compose.project=${options.project}`, "--filter", "label=com.docker.compose.service=portal"]);
      const portalId = portalIds.trim();
      if (!portalId || portalId.includes("\n")) throw new Error("promotion did not recreate exactly one isolated portal");
      const { stdout: containerJson } = await execFile("docker", ["container", "inspect", portalId, "--format", "{{json .}}"]);
      const container = JSON.parse(containerJson);
      const { stdout: imageJson } = await execFile("docker", ["image", "inspect", container.Image, "--format", "{{json .}}"]);
      const image = JSON.parse(imageJson);
      assertRecreatedPortalProvenance(container, image, { project: options.project });
      const [health, versionResponse, stateBytes, recoveryBytes] = await Promise.all([
        fetch(`${portalUrl}/api/health`), fetch(`${portalUrl}/api/health/sha`),
        readFile(join(workspace.state, "install-state.json")), readFile(join(workspace.backups, "recovery", "install-state.json")),
      ]);
      const migrated = JSON.parse(stateBytes.toString("utf8"));
      const sourceV1Hash = createHash("sha256").update(recoveryBytes).digest("hex");
      if (sourceV1Hash !== baselineSourceV1Hash) throw new Error("governed recovery bytes diverged from baseline fixture");
      const observedVersion = (await versionResponse.text()).trim();
      if (!/^[a-f0-9]{7,64}(?:-dirty)?$/.test(observedVersion)) throw new Error("candidate portal returned an invalid version identity");
      return {
        healthy: health.ok, version: observedVersion, promoterDigest: candidateDigest,
        promoterSourceSha: options.candidateSha, persistenceDigest: candidateDigest,
        sourceV1Hash, migratedV2Hash: createHash("sha256").update(stateBytes).digest("hex"),
        sourceSchemaVersion: 1, migratedSchemaVersion: migrated.schemaVersion,
        recoveryArtifacts: [{ path: "recovery/install-state.json", sha256: sourceV1Hash }],
        promotionRunId: promotionCompleted.envelope.runId, portalImageId: image.Id,
      };
    },
    writeEvidence: async (value) => { await mkdir(options.evidenceDir, { recursive: true }); await writeFile(join(options.evidenceDir, "n-minus-one-evidence.json"), `${JSON.stringify(value, null, 2)}\n`); return value; },
    cleanup: async () => { if (cleanupOnce) await cleanupOnce(); },
  };
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
    eventKind: values.event_kind, candidateRef: values.candidate_ref,
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
