import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open as openPackagedFile, readFile as readPackagedFile, readlink as readKernelLink, realpath as resolvePackagedPath, stat as statPackagedFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isEntryModule } from "../../../../scripts/lib/entry-module.mjs";
const sha256 = value => createHash("sha256").update(value).digest("hex");
const refuse = detail => { throw new Error(`scope_writer_probe_${detail}`); };
const packaged = (root, path) => join(root, path.replace(/^apps\/web\//, "apps/web-src/"));

/** Read-only packaged-byte observation; not workflow or retirement proof.
 * Injection is for source tests only. The executable always inspects /app. */
export async function inspectScopeEpochWriters({ root = "/app", readFile = readPackagedFile,
  loadContract = path => import(pathToFileURL(path).href) } = {}) {
  try {
    const path = packaged(root, "apps/web/lib/work-capsules/scope-epoch-contract.ts");
    const contract = await loadContract(path);
    if (contract.SCOPE_EPOCH_WRITER_CONTRACT_VERSION !== 1 || !Array.isArray(contract.SCOPE_EPOCH_WRITER_PATHS)
      || !contract.SCOPE_EPOCH_WRITER_PATHS.length || new Set(contract.SCOPE_EPOCH_WRITER_PATHS).size !== contract.SCOPE_EPOCH_WRITER_PATHS.length
      || typeof contract.validateScopeEpochWriterContract !== "function") refuse("contract_invalid");
    const [version, content, contractBytes] = await Promise.all([readFile(join(root, ".dpf-image-version")),
      readFile(join(root, ".dpf-source-content-hash")), readFile(path)]);
    const sourceSha = version.toString("utf8").trim(), sourceContentHash = content.toString("utf8").trim();
    if (!/^[a-f0-9]{40}$/.test(sourceSha) || !/^[a-f0-9]{64}$/.test(sourceContentHash)) refuse("identity_invalid");
    const writers = {};
    for (const owner of contract.SCOPE_EPOCH_WRITER_PATHS) {
      if (typeof owner !== "string" || !/^(apps\/web\/|scripts\/)[a-zA-Z0-9_./-]+\.(ts|mjs)$/.test(owner)
        || owner.split("/").some(part => part === ".." || part === ".")) refuse("contract_invalid");
      writers[owner] = sha256(await readFile(packaged(root, owner)));
    }
    return contract.validateScopeEpochWriterContract({ schemaVersion: 1, version: 1, sourceSha, sourceContentHash,
      contractSha256: sha256(contractBytes), writers });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("scope_writer_probe_")) throw error;
    refuse("evidence_unavailable");
  }
}

/** Measure the emitted standalone files that dispatch the Workroom tool.
 * The resolved image and hardened launch recipe protect their late loads. */
export async function inspectServedScopeWriter({ root = "/app", open = openPackagedFile,
  realpath = resolvePackagedPath, stat = statPackagedFile } = {}) {
  try {
    const imageRoot = await realpath(root);
    if (imageRoot !== root) refuse("served_bundle_unproven");
    const web = join(imageRoot, "apps/web");
    async function readEmitted(path, maxBytes) {
      // These three paths must live at the canonical standalone locations.
      // Reject symlinks into development sources and shared volumes.
      if (await realpath(path) !== path) refuse("served_bundle_unproven");
      // One descriptor for the check and the read: the final component may not
      // be a symlink, and the size, type and bytes all come from that same open
      // file, so nothing can be swapped between checking and reading it.
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size < 1 || info.size > maxBytes) refuse("served_bundle_unproven");
        const bytes = Buffer.alloc(info.size);
        const { bytesRead } = await handle.read(bytes, 0, info.size, 0);
        const { bytesRead: beyond } = await handle.read(Buffer.alloc(1), 0, 1, info.size);
        if (bytesRead !== info.size || beyond !== 0) refuse("served_bundle_unproven");
        return bytes;
      } finally { await handle.close(); }
    }
    const serverDir = join(web, ".next/server");
    const routePath = "app/api/mcp/v1/route.js";
    const manifest = await readEmitted(join(serverDir, "app-paths-manifest.json"), 1024 * 1024);
    if (JSON.parse(manifest.toString("utf8"))?.["/api/mcp/v1/route"] !== routePath) refuse("served_bundle_unproven");
    const traces = [join(web, ".next/next-server.js.nft.json"), join(serverDir, `${routePath}.nft.json`)];
    const [server, route, ...traceBytes] = await Promise.all([
      readEmitted(join(web, "server.js"), 1024 * 1024),
      readEmitted(join(serverDir, routePath), 16 * 1024 * 1024),
      ...traces.map(path => readEmitted(path, 4 * 1024 * 1024)),
    ]);
    const dependencies = new Set();
    for (const [index, bytes] of traceBytes.entries()) {
      const trace = JSON.parse(bytes.toString("utf8"));
      if (trace?.version !== 1 || !Array.isArray(trace.files) || trace.files.length > 50_000) refuse("served_bundle_unproven");
      for (const name of trace.files) {
        if (typeof name !== "string" || name.length === 0 || name.length > 4096 || isAbsolute(name)) refuse("served_bundle_unproven");
        const declared = resolve(dirname(traces[index]), name);
        if (!declared.startsWith(`${imageRoot}/`)) refuse("served_bundle_unproven");
        dependencies.add(declared);
      }
    }
    const ordered = [...dependencies].sort(), closure = createHash("sha256");
    for (const bytes of traceBytes) closure.update(sha256(bytes));
    for (let offset = 0; offset < ordered.length; offset += 32) {
      const batch = await Promise.all(ordered.slice(offset, offset + 32).map(async declared => {
        const target = await realpath(declared);
        if (!target.startsWith(`${imageRoot}/`)) refuse("served_bundle_unproven");
        const info = await stat(target);
        if (!info.isFile() && !(declared !== target && info.isDirectory())) refuse("served_bundle_unproven");
        return [relative(imageRoot, declared), relative(imageRoot, target)];
      }));
      closure.update(JSON.stringify(batch));
    }
    return { schemaVersion: 1, serverSha256: sha256(server), routeSha256: sha256(route), manifestSha256: sha256(manifest),
      closureSha256: closure.digest("hex") };
  } catch { return refuse("served_bundle_unproven"); }
}

const rootOptions = ["nodev", "nosuid", "noexec"];
const systemMounts = new Set([
  "/dev", "/dev/pts", "/dev/mqueue", "/dev/shm", "/sys", "/sys/fs/cgroup", "/proc",
  "/proc/acpi", "/proc/asound", "/proc/bus", "/proc/fs", "/proc/interrupts",
  "/proc/irq", "/proc/kcore", "/proc/keys", "/proc/latency_stats", "/proc/scsi",
  "/proc/sys", "/proc/sysrq-trigger", "/proc/timer_list", "/sys/firmware",
  "/sys/devices/virtual/powercap",
]);
const readOnlyInputs = new Set([
  "/run/dpf-actuator", "/dpf-state", "/host-dpf", "/host-worktrees", "/evidence", "/workspace",
  "/etc/dpf/pki/root_ca.crt", "/run/secrets/dpf-edge-action-signing-password",
  "/run/secrets/dpf-edge-action-signing-private.pem", "/run/secrets/dpf-edge-mtls-proxy-secret",
]);
const dataMounts = new Set([
  "/etc/hostname", "/etc/hosts", "/etc/resolv.conf", "/sandbox-workspace",
  "/var/lib/dpf/maps", "/var/lib/dpf/uploads", "/backups", "/dpf-federation",
]);
const systemSharedObject = /^\/(?:app|lib|usr\/lib|usr\/local\/lib)\//;

/** Inspect this process's generation and existing kernel protections.
 * @param {{ readFile?: (path: string) => Promise<Buffer|string>,
 *   readlink?: (path: string) => Promise<string>, pid?: number,
 *   realpath?: (path: string) => Promise<string>, nativeObjects?: () => unknown,
 *   execPath?: string, argv?: string[], env?: Record<string, string|undefined> }} [options]
 */
export async function attestScopeWriterProcess({ readFile = readPackagedFile, readlink = readKernelLink,
  realpath = resolvePackagedPath, nativeObjects = () => process.report.getReport().sharedObjects,
  pid = process.pid, execPath = process.execPath, argv = process.execArgv, env = process.env } = {}) {
  try {
    if (execPath !== "/usr/local/bin/node" || argv.length !== 1 || argv[0] !== "--disable-sigusr1"
      || env.PATH !== "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
      || (env.DPF_MANAGED_SCRIPT_DIR !== undefined && env.DPF_MANAGED_SCRIPT_DIR !== "/app/scripts")
      || Object.keys(env).some(name => /^(?:NODE_OPTIONS$|NODE_PATH$|NODE_CHANNEL_FD$|LD_|DYLD_|BASH_ENV$|ENV$|DPF_APP_DIR$)/.test(name))) {
      refuse("process_unproven");
    }
    const [status, mountinfo, stat, executable] = await Promise.all([
      readFile("/proc/self/status"), readFile("/proc/self/mountinfo"), readFile("/proc/self/stat"), readlink("/proc/self/exe"),
    ]);
    if (executable !== execPath) refuse("process_unproven");
    const fields = new Map(status.toString().split("\n").flatMap(line => {
      const split = line.indexOf(":");
      return split < 0 ? [] : [[line.slice(0, split), line.slice(split + 1).trim()]];
    }));
    for (const key of ["Uid", "Gid"]) {
      if (!/^1000\s+1000\s+1000\s+1000$/.test(fields.get(key) ?? "")) refuse("process_unproven");
    }
    if (!["", "1000"].includes(fields.get("Groups")) || fields.get("TracerPid") !== "0"
      || fields.get("NoNewPrivs") !== "1" || fields.get("Seccomp") !== "2"
      || !/^[1-9][0-9]*$/.test(fields.get("Seccomp_filters") ?? "")
      || ["Inh", "Prm", "Eff", "Bnd", "Amb"].some(key => !/^0{16}$/.test(fields.get(`Cap${key}`) ?? ""))) refuse("process_unproven");
    const targets = new Set();
    for (const line of mountinfo.toString().trim().split("\n")) {
      const [mount, filesystem] = line.split(" - ");
      const [, , , , target, opts] = mount.split(" ");
      if (!target || !opts || !filesystem || targets.has(target)) refuse("process_unproven");
      targets.add(target);
      const options = opts.split(",");
      if (target === "/" || readOnlyInputs.has(target)) {
        if (!options.includes("ro")) refuse("process_unproven");
      } else if (target === "/tmp") {
        if (!filesystem.startsWith("tmpfs ") || rootOptions.some(option => !options.includes(option))) refuse("process_unproven");
      } else if (!systemMounts.has(target) && !dataMounts.has(target)) refuse("process_unproven");
    }
    if (["/", "/tmp", "/run/dpf-actuator", "/proc"].some(target => !targets.has(target))) refuse("process_unproven");
    // Process reports contain other diagnostic data. Read only the shared
    // object paths here and never return or serialize the report.
    const loaded = nativeObjects();
    if (!Array.isArray(loaded) || loaded.length === 0 || loaded.length > 256) refuse("process_unproven");
    for (const path of loaded) {
      if (path === "linux-vdso.so.1" || path === "linux-gate.so.1") continue;
      if (typeof path !== "string" || !systemSharedObject.test(path)
        || !systemSharedObject.test(await realpath(path))) refuse("process_unproven");
    }
    const processStat = stat.toString(), endOfName = processStat.lastIndexOf(") ");
    const startTicks = processStat.slice(endOfName + 2).trim().split(/\s+/)[19];
    if (!processStat.startsWith(`${pid} (`) || endOfName < 0 || !/^[1-9][0-9]*$/.test(startTicks ?? "")) refuse("process_unproven");
    return { pid, startTicks };
  } catch { return refuse("process_unproven"); }
}

async function runScopeWriterProbe() {
  try {
    const args = process.argv.slice(2);
    const proof = args.length === 0 ? await inspectScopeEpochWriters()
      : args.length === 1 && args[0] === "--served" ? await inspectServedScopeWriter() : refuse("arguments_invalid");
    process.stdout.write(`${JSON.stringify(proof)}\n`);
  } catch { process.stderr.write("scope_writer_probe_unavailable\n"); process.exitCode = 78; }
}
if (typeof import.meta.url === "string" && isEntryModule(import.meta.url)) void runScopeWriterProbe();
