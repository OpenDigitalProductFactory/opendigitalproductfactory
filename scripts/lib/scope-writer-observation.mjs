import { createServer, request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { chmod, chown, lstat, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { dockerSocketGet } from './docker-socket.mjs';

export const SCOPE_WRITER_OBSERVER_SOCKET = '/run/dpf-actuator/scope-observer.sock';
const cohortPath = '/v1/scope-writer/cohort';
const retirementPath = '/v1/scope-writer/retirement';
const projectServicesPath = '/v1/runtime/project-services';
const projectContainersPath = '/v1/runtime/project-containers';
const portalImagePath = '/v1/runtime/portal-image';
const sandboxPath = '/v1/runtime/sandbox';
const reassessmentPath = '/v1/runtime/reassessment-proof';
const ciCapacityPath = '/v1/runtime/ci-capacity';
const serviceLogsPath = '/v1/runtime/service-logs';
const fencePreviewsPath = '/v1/runtime/fence-ended-previews';
const reconcileSubstratePath = '/v1/runtime/reconcile-substrate';
const sweepPromotersPath = '/v1/runtime/sweep-promoters';
const doctoolsPath = '/v1/runtime/doctools/';
const doctoolsHealthPath = '/v1/runtime/doctools-health';
const runtimeSessionPath = '/v1/runtime/workroom-session';
const runtimeStreamProtocol = 'dpf-workroom-stream';
const frameLimit = 256 * 1024;
const pendingStreamLimit = 1024 * 1024;
const responseLimit = 8192;
const serviceLogResponseLimit = 180 * 1024;
export const ACTUATOR_SERVICE_LOG_NAMES = Object.freeze(['portal', 'sandbox', 'postgres', 'portal-init', 'browser-use']);
const unavailable = () => new Error('scope_writer_observation_unavailable');

export function hasPrivateActuatorMount(mountinfo) {
  return mountinfo.toString().split('\n').some(line => line.split(' ')[4] === dirname(SCOPE_WRITER_OBSERVER_SOCKET));
}

export function usesPrivateActuator() {
  return readFile('/proc/self/mountinfo').then(hasPrivateActuatorMount, () => false);
}

/** @typedef {{kind: 'render'} | {kind: 'convert', from?: string, to: string}} DoctoolsOperation */

/** @returns {DoctoolsOperation | null} */
function parseDoctoolsPath(path) {
  if (path === `${doctoolsPath}render`) return { kind: 'render' };
  if (!path?.startsWith(doctoolsPath)) return null;
  const convert = /^convert\/([a-z0-9]{0,16})\/([a-z0-9]{1,16})$/.exec(path.slice(doctoolsPath.length));
  return convert ? { kind: 'convert', ...(convert[1] ? { from: convert[1] } : {}), to: convert[2] } : null;
}

async function readBoundedStream(stream, bytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > bytes) throw unavailable();
    chunks.push(chunk);
  }
  if (!stream.complete || total !== bytes) throw unavailable();
  return Buffer.concat(chunks, total);
}

/** Serve the fixed local operations. The Unix directory belongs to the actuator.
 * The observer derives scope from host-owned state, never from the request. */
export function createScopeWriterObserver({ observe, observeServices, observeCiCapacity, readRetirement, fencePreviews,
  reconcileSubstrate, readServiceLogs, observeProjectContainers, observePortalImage, observeSandbox, sweepPromoters,
  doctools, openRuntimeSession, readReassessmentProof }) {
  const operations = new Map([
    [`GET ${cohortPath}`, observe], [`GET ${projectServicesPath}`, observeServices],
    [`GET ${ciCapacityPath}`, observeCiCapacity],
    [`GET ${retirementPath}`, readRetirement], [`POST ${fencePreviewsPath}`, fencePreviews],
    [`POST ${reconcileSubstratePath}`, reconcileSubstrate],
    [`GET ${projectContainersPath}`, observeProjectContainers], [`POST ${sweepPromotersPath}`, sweepPromoters],
    [`GET ${portalImagePath}`, observePortalImage],
    [`GET ${sandboxPath}`, observeSandbox],
    [`GET ${reassessmentPath}`, readReassessmentProof],
    [`GET ${doctoolsHealthPath}`, doctools?.health],
  ]);
  let doctoolsInFlight = 0;
  const server = createServer({ headersTimeout: 2_000, requestTimeout: 2_000, maxHeaderSize: 1024 }, async (req, res) => {
    res.setHeader('Connection', 'close');
    const document = req.method === 'POST' ? parseDoctoolsPath(req.url) : null;
    if (document && doctools) {
      const length = Number(req.headers['content-length']);
      if (req.headers['transfer-encoding'] !== undefined || req.headers['content-type'] !== 'application/octet-stream'
        || !Number.isSafeInteger(length) || length < 1 || length > doctools.limit(document)) return res.writeHead(413).end();
      if (doctoolsInFlight >= 2) return res.writeHead(503).end();
      doctoolsInFlight++;
      const deadline = setTimeout(() => req.destroy(), 10_000);
      try {
        const input = await readBoundedStream(req, length);
        clearTimeout(deadline);
        if (res.destroyed) return;
        const result = await doctools.run(document, input);
        if (res.destroyed) return;
        res.setTimeout(10_000, () => res.destroy());
        const sent = new Promise(resolve => { res.once('finish', resolve); res.once('close', resolve); });
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': result.stdoutBytes.length,
          'X-DPF-Exit-Code': String(result.exitCode), 'X-DPF-Output-Limit': result.outputLimitExceeded ? '1' : '0',
          'X-DPF-Stderr': Buffer.from(result.stderr).subarray(-1_024).toString('base64') }).end(result.stdoutBytes);
        await sent;
      } catch { if (!res.destroyed) res.writeHead(503).end(); }
      finally { clearTimeout(deadline); doctoolsInFlight--; }
      return;
    }
    const requestedLog = req.method === 'GET' && req.url?.startsWith(`${serviceLogsPath}?`)
      ? /^service=([a-z-]+)&tail=([1-9][0-9]{0,2})(&timestamps=1)?$/.exec(req.url.slice(serviceLogsPath.length + 1)) : null;
    const log = requestedLog && readServiceLogs && ACTUATOR_SERVICE_LOG_NAMES.includes(requestedLog[1]) && Number(requestedLog[2]) <= 500
      ? () => requestedLog[3] ? readServiceLogs(requestedLog[1], Number(requestedLog[2]), true)
        : readServiceLogs(requestedLog[1], Number(requestedLog[2])) : null;
    const call = log ?? operations.get(`${req.method} ${req.url}`);
    if (!call || req.headers['transfer-encoding'] !== undefined
      || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = JSON.stringify(await call());
      const limit = log || req.url === projectContainersPath ? serviceLogResponseLimit : responseLimit;
      if (!body || Buffer.byteLength(body) > limit) throw unavailable();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }).end(body);
    } catch { res.writeHead(503).end(); }
  });
  bindRuntimeSessionStreams(server, openRuntimeSession);
  server.maxConnections = 8;
  return server;
}

function readFrames(socket, head, receive) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  const read = chunk => {
    pending += decoder.write(chunk);
    try {
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        if (Buffer.byteLength(pending.slice(0, end)) > frameLimit) throw unavailable();
        const frame = JSON.parse(pending.slice(0, end));
        pending = pending.slice(end + 1);
        if (!Array.isArray(frame) || frame.length !== 2 || typeof frame[0] !== 'string') throw unavailable();
        receive(frame);
      }
      if (Buffer.byteLength(pending) > frameLimit) throw unavailable();
    } catch { socket.destroy(); }
  };
  socket.on('data', read);
  if (head.length) read(head);
}

function writeFrame(socket, frame) {
  const bytes = `${JSON.stringify(frame)}\n`;
  const length = Buffer.byteLength(bytes);
  if (length > frameLimit || socket.writableLength + length > pendingStreamLimit) throw unavailable();
  socket.write(bytes);
}

function writeStreamBytes(socket, direction, data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  for (let offset = 0; offset < bytes.length; offset += 65536) {
    writeFrame(socket, [direction, bytes.subarray(offset, offset + 65536).toString('base64')]);
  }
}

function streamBytes(payload) {
  if (typeof payload !== 'string' || payload.length > 87384 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(payload)) throw unavailable();
  return Buffer.from(payload, 'base64');
}

function bindRuntimeSessionStreams(server, open) {
  let sessions = 0;
  server.on('upgrade', (req, socket, head) => {
    if (!open || req.url !== runtimeSessionPath || req.method !== 'POST' || req.headers.upgrade !== runtimeStreamProtocol
      || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')
      || req.headers['transfer-encoding'] || sessions >= 4) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    sessions++;
    let requested = false, process;
    const handshake = setTimeout(() => socket.destroy(), 15_000);
    const lifetime = setTimeout(() => socket.destroy(), 24 * 60 * 60_000);
    socket.on('error', () => socket.destroy());
    socket.once('end', () => socket.destroy());
    socket.once('close', () => { sessions--; clearTimeout(handshake); clearTimeout(lifetime); process?.kill(); });
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: ${runtimeStreamProtocol}\r\n\r\n`);
    readFrames(socket, head, ([kind, payload]) => {
      if (!requested && kind === 'open') {
        requested = true;
        void Promise.resolve().then(() => open(payload)).then(child => {
          if (socket.destroyed) { child.kill(); return; }
          process = child;
          const send = (kind, bytes) => { try { writeStreamBytes(socket, kind, bytes); } catch { socket.destroy(); } };
          child.onData(bytes => send('stdout', bytes));
          child.onStderr(bytes => send('stderr', bytes));
          child.onClose(code => {
            try { writeFrame(socket, ['exit', code]); socket.end(); } catch { socket.destroy(); }
          });
          clearTimeout(handshake);
          writeFrame(socket, ['ready', null]);
        }).catch(() => socket.destroy());
        return;
      }
      if (process && kind === 'stdin') { process.write(streamBytes(payload)); return; }
      if (process && kind === 'end' && payload === null) { process.end(); return; }
      socket.destroy();
    });
  });
}

/** The transport sends an owner request and STDIO only. The actuator chooses
 * and launches the provider recipe before accepting the client's first input. */
export function openActuatorRuntimeSession(owner, { socketPath = SCOPE_WRITER_OBSERVER_SOCKET } = {}) {
  const events = new EventEmitter();
  const pending = [];
  let buffered = 0, socket, closed = false, ready = false;
  const stop = (code = null) => {
    if (closed) return;
    closed = true;
    socket?.destroy();
    pending.length = 0;
    clearTimeout(handshake);
    events.emit('close', code);
  };
  const handshake = setTimeout(() => stop(), 16_000);
  const send = (kind, bytes) => {
    if (closed) return;
    if (!ready) {
      buffered += bytes?.length ?? 1;
      if (buffered > pendingStreamLimit) { stop(); return; }
      pending.push([kind, bytes]);
      return;
    }
    try {
      if (kind === 'stdin') writeStreamBytes(socket, kind, bytes);
      else writeFrame(socket, [kind, null]);
    } catch { stop(); }
  };
  void verifyActuatorSocket(socketPath).then(() => {
    if (closed) return;
    const req = request({ socketPath, method: 'POST', path: runtimeSessionPath, agent: false,
      headers: { Connection: 'Upgrade', Upgrade: runtimeStreamProtocol } });
    req.on('response', res => { res.resume(); stop(); });
    req.on('error', () => stop());
    req.on('upgrade', (res, connection, head) => {
      socket = connection;
      if (closed || res.headers.upgrade !== runtimeStreamProtocol) { socket.destroy(); stop(); return; }
      socket.once('close', () => stop());
      socket.on('error', () => stop());
      try { writeFrame(socket, ['open', owner]); } catch { stop(); return; }
      readFrames(socket, head, ([kind, payload]) => {
        if (kind === 'ready' && !ready && payload === null) {
          ready = true;
          clearTimeout(handshake);
          for (const [kind, bytes] of pending) send(kind, bytes);
          pending.length = 0;
        } else if (ready && (kind === 'stdout' || kind === 'stderr')) events.emit(kind, streamBytes(payload));
        else if (ready && kind === 'exit' && (payload === null || Number.isInteger(payload))) stop(payload);
        else throw unavailable();
      });
    });
    req.end();
  }).catch(() => stop());
  return {
    write: line => send('stdin', Buffer.from(line, 'utf8')), onData: listener => { events.on('stdout', listener); },
    onStderr: listener => { events.on('stderr', listener); }, onClose: listener => { events.on('close', listener); },
    end: () => send('end', null), kill: () => stop(),
  };
}

/** Bind a new inode in the actuator-owned directory before publishing its
 * stable name. A restart does not need to trust or clean up an older socket. */
export async function publishActuatorSocket(server, { socketPath = SCOPE_WRITER_OBSERVER_SOCKET, uid = 0, gid = 1000 } = {}) {
  const root = dirname(socketPath), directory = await lstat(root);
  if (!directory.isDirectory() || directory.uid !== uid || (directory.mode & 0o022) !== 0) throw unavailable();
  const unpublished = join(root, `.${randomBytes(6).toString('hex')}.sock`);
  try {
    server.listen(unpublished);
    await once(server, 'listening');
    await chown(unpublished, uid, gid);
    await chmod(unpublished, 0o660);
    await rename(unpublished, socketPath);
  } catch (error) {
    server.close();
    throw error;
  }
}

async function verifyActuatorSocket(socketPath) {
  if (socketPath === SCOPE_WRITER_OBSERVER_SOCKET) {
    try {
      const [directory, socket] = await Promise.all([lstat(dirname(socketPath)), lstat(socketPath)]);
      if (!directory.isDirectory() || directory.uid !== 0 || (directory.mode & 0o022) !== 0
        || !socket.isSocket() || socket.uid !== 0 || socket.gid !== 1000 || (socket.mode & 0o777) !== 0o660) {
        throw unavailable();
      }
    } catch { throw unavailable(); }
  }
}

/** Close the connection on refused, stalled, oversized or malformed output. */
async function requestActuator(path, socketPath, { method = 'GET', timeoutMs = 2_500, maxBytes = responseLimit } = {}) {
  await verifyActuatorSocket(socketPath);
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, method, path, agent: false, signal: AbortSignal.timeout(timeoutMs) }, res => {
      const fail = () => { reject(unavailable()); res.destroy(); };
      if (res.statusCode !== 200 || res.headers['content-type'] !== 'application/json') return fail();
      const chunks = [];
      let size = 0;
      res.on('error', fail);
      res.on('aborted', fail);
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) return fail();
        chunks.push(chunk);
      });
      res.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
          resolve(value);
        } catch { fail(); }
      });
    });
    req.on('error', () => reject(unavailable()));
    req.end();
  });
}

export function readScopeWriterObservation({ socketPath = SCOPE_WRITER_OBSERVER_SOCKET } = {}) {
  return requestActuator(cohortPath, socketPath);
}

export function readScopeWriterRetirement({ socketPath = SCOPE_WRITER_OBSERVER_SOCKET } = {}) {
  return requestActuator(retirementPath, socketPath);
}

export function readActuatorProjectServices({ socketPath = SCOPE_WRITER_OBSERVER_SOCKET } = {}) {
  return requestActuator(projectServicesPath, socketPath);
}

export function readActuatorCiCapacity({ socketPath = SCOPE_WRITER_OBSERVER_SOCKET } = {}) {
  return requestActuator(ciCapacityPath, socketPath, { timeoutMs: 12_000 });
}

export async function readActuatorServiceLogs(service, lines, { socketPath = SCOPE_WRITER_OBSERVER_SOCKET, timestamps = false } = {}) {
  if (!ACTUATOR_SERVICE_LOG_NAMES.includes(service) || !Number.isInteger(lines) || lines < 1 || lines > 500) throw unavailable();
  return requestActuator(`${serviceLogsPath}?service=${service}&tail=${lines}${timestamps ? '&timestamps=1' : ''}`, socketPath,
    { timeoutMs: 15_000, maxBytes: serviceLogResponseLimit });
}

export function reconcileEndedPreviewRuntimes({ socketPath = SCOPE_WRITER_OBSERVER_SOCKET } = {}) {
  return requestActuator(fencePreviewsPath, socketPath, { method: 'POST', timeoutMs: 30_000 });
}

export function reconcileActuatorSubstrate({ socketPath = SCOPE_WRITER_OBSERVER_SOCKET } = {}) {
  return requestActuator(reconcileSubstratePath, socketPath, { method: 'POST', timeoutMs: 60_000 });
}

export function reconcileActuatorPromoters({ socketPath = SCOPE_WRITER_OBSERVER_SOCKET } = {}) {
  return requestActuator(sweepPromotersPath, socketPath, { method: 'POST', timeoutMs: 45_000 });
}

export function readActuatorProjectContainers({ socketPath = SCOPE_WRITER_OBSERVER_SOCKET } = {}) {
  return requestActuator(projectContainersPath, socketPath, { timeoutMs: 6_000, maxBytes: serviceLogResponseLimit });
}

export function readActuatorPortalImage({ socketPath = SCOPE_WRITER_OBSERVER_SOCKET } = {}) {
  return requestActuator(portalImagePath, socketPath, { timeoutMs: 6_000 });
}

export function readActuatorSandbox({ socketPath = SCOPE_WRITER_OBSERVER_SOCKET } = {}) {
  return requestActuator(sandboxPath, socketPath, { timeoutMs: 12_000 });
}

export function readActuatorReassessmentProof({ socketPath = SCOPE_WRITER_OBSERVER_SOCKET } = {}) {
  return requestActuator(reassessmentPath, socketPath, { timeoutMs: 20_000 });
}

export function readActuatorDoctoolsHealth({ socketPath = SCOPE_WRITER_OBSERVER_SOCKET } = {}) {
  return requestActuator(doctoolsHealthPath, socketPath, { timeoutMs: 12_000 });
}

/** Document input and output stay binary across the private socket. */
export async function runActuatorDoctools(operation, input, { socketPath = SCOPE_WRITER_OBSERVER_SOCKET, timeoutMs, maxOutputBytes }) {
  const path = operation.kind === 'render' ? `${doctoolsPath}render` : `${doctoolsPath}convert/${operation.from ?? ''}/${operation.to}`;
  if (!parseDoctoolsPath(path) || !Buffer.isBuffer(input)) throw unavailable();
  await verifyActuatorSocket(socketPath);
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, method: 'POST', path, agent: false, signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': input.length } }, async res => {
      try {
        if (res.statusCode === 413) {
          res.resume();
          resolve({ stdoutBytes: Buffer.alloc(0), stdout: '', stderr: 'document input exceeded its limit', exitCode: 4, outputLimitExceeded: false });
          return;
        }
        const length = Number(res.headers['content-length']);
        const code = Number(res.headers['x-dpf-exit-code']);
        const limit = res.headers['x-dpf-output-limit'];
        const stderr = res.headers['x-dpf-stderr'];
        if (res.statusCode !== 200 || res.headers['content-type'] !== 'application/octet-stream'
          || !Number.isSafeInteger(length) || length < 0 || length > maxOutputBytes || !Number.isInteger(code) || code < 0 || code > 255
          || (limit !== '0' && limit !== '1') || typeof stderr !== 'string' || stderr.length > 1_368) throw unavailable();
        const stdoutBytes = await readBoundedStream(res, length);
        resolve({ stdoutBytes, stdout: '', stderr: Buffer.from(stderr, 'base64').toString('utf8'), exitCode: code, outputLimitExceeded: limit === '1' });
      } catch { res.destroy(); reject(unavailable()); }
    });
    req.on('error', () => reject(unavailable()));
    req.end(input);
  });
}

async function ownProjectContainers(project, get) {
  if (typeof project !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(project)) throw unavailable();
  const filters = new URLSearchParams({ all: '1', filters: JSON.stringify({ label: [`com.docker.compose.project=${project}`] }) });
  const containers = await get(`/containers/json?${filters}`);
  if (!Array.isArray(containers) || containers.length > 256) throw unavailable();
  return containers.filter(item => item?.Labels?.['com.docker.compose.project'] === project
    && item.Labels['com.docker.compose.oneoff']?.toLowerCase() !== 'true'
    && /^[a-z0-9][a-z0-9_-]{0,99}$/.test(item.Labels['com.docker.compose.service'] ?? ''));
}

export async function observeActuatorPortalImage(project, get = dockerSocketGet) {
  const portals = (await ownProjectContainers(project, get)).filter(item => item.Labels['com.docker.compose.service'] === 'portal');
  const portal = portals[0];
  if (portals.length !== 1 || portal.State !== 'running' || !/^[a-f0-9]{64}$/.test(portal.Id ?? '')
    || !/^sha256:[a-f0-9]{64}$/.test(portal.ImageID ?? '')) throw unavailable();
  return { image: portal.ImageID, containerId: portal.Id };
}

const sandboxEnvironment = new Set(['APP_URL', 'AUTH_TRUST_HOST', 'DATABASE_URL', 'DPF_BUILD_WORKTREE_ISOLATION', 'DPF_ENVIRONMENT',
  'DPF_JEST_MAX_WORKERS', 'DPF_SANDBOX_TEST_SCOPE', 'DPF_TTS_URL', 'NODE_ENV', 'NODE_VERSION', 'PATH', 'SHELL', 'TTS_PROVIDER',
  'VITEST_MAX_WORKERS', 'YARN_VERSION']);
const noDockerDevices = value => value == null || (Array.isArray(value) && value.length === 0);

/** Resolve only the isolated Compose sandbox. The actuator may additionally
 * bind the full ID to its signed installation cohort for qualified callers. */
export async function observeActuatorSandbox(project, get = dockerSocketGet, expectedId) {
  const service = 'com.docker.compose.service', owner = 'com.docker.compose.project';
  const ids = (await ownProjectContainers(project, get)).filter(item => item.Labels[service] === 'sandbox');
  const containerId = ids[0]?.Id;
  if (ids.length !== 1 || !/^[a-f0-9]{64}$/.test(containerId ?? '') || (expectedId && expectedId !== containerId)) throw unavailable();
  const inspected = await get(`/containers/${containerId}/json`);
  const { Id, Image, Name, Config, HostConfig, NetworkSettings, Mounts, State } = inspected ?? {};
  const network = `${project}_sandbox-runtime`, volume = `${project}_sandbox_workspace`;
  if (Id !== containerId || Name !== `/${project}-sandbox-1` || !/^sha256:[a-f0-9]{64}$/.test(Image ?? '')
    || Config?.Labels?.[owner] !== project || Config?.Labels?.[service] !== 'sandbox'
    || Config?.Labels?.['com.docker.compose.oneoff']?.toLowerCase() === 'true'
    || HostConfig?.Privileged !== false || HostConfig.NetworkMode !== network || HostConfig.PidMode !== ''
    || HostConfig.IpcMode !== 'private' || HostConfig.CgroupnsMode !== 'private' || (HostConfig.UsernsMode ?? '') !== ''
    || !['CapAdd', 'Devices', 'DeviceRequests', 'DeviceCgroupRules', 'GroupAdd', 'VolumesFrom'].every(key => noDockerDevices(HostConfig[key]))
    || Object.keys(NetworkSettings?.Networks ?? {}).length !== 1
    || !/^[a-f0-9]{64}$/.test(NetworkSettings.Networks[network]?.NetworkID ?? '')
    || !Array.isArray(Mounts) || Mounts.length !== 1 || Mounts[0].Type !== 'volume' || Mounts[0].Name !== volume
    || Mounts[0].Destination !== '/workspace' || Mounts[0].RW !== true || Mounts[0].Propagation !== ''
    || typeof State?.Running !== 'boolean' || !Array.isArray(Config.Env) || Config.Env.length > sandboxEnvironment.size) throw unavailable();
  const environment = new Map();
  for (const assignment of Config.Env) {
    if (typeof assignment !== 'string' || assignment.length > 2048) throw unavailable();
    const delimiter = assignment.indexOf('=');
    const key = assignment.slice(0, delimiter);
    if (delimiter < 1 || !sandboxEnvironment.has(key) || environment.has(key)) throw unavailable();
    environment.set(key, assignment.slice(delimiter + 1));
  }
  if (environment.get('DPF_ENVIRONMENT') !== 'sandbox'
    || environment.get('DATABASE_URL') !== 'postgresql://dpf:dpf_sandbox@sandbox-postgres:5432/dpf') throw unavailable();
  const workspace = await get(`/volumes/${volume}`);
  if (workspace?.Name !== volume || workspace.Driver !== 'local' || Object.keys(workspace.Options ?? {}).length !== 0
    || workspace.Labels?.[owner] !== project || workspace.Labels?.['com.docker.compose.volume'] !== 'sandbox_workspace') throw unavailable();
  return { containerId, name: Name.slice(1), image: Image, running: State.Running };
}

export async function observeActuatorProjectContainers(project, get = dockerSocketGet) {
  const containers = (await ownProjectContainers(project, get)).map(item => {
    const name = Array.isArray(item.Names) ? item.Names[0] : null;
    if (!/^[a-f0-9]{64}$/.test(item.Id ?? '') || !/^\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name ?? '')
      || typeof item.Status !== 'string' || item.Status.length > 200 || !/^[a-z]{1,32}$/.test(item.State ?? '')) throw unavailable();
    return { ID: item.Id, Name: name.slice(1), Service: item.Labels['com.docker.compose.service'], State: item.State, Status: item.Status };
  });
  return { containers };
}

/** Only the installation binding selects the project. Daemon metadata is
 * projected on the actuator side before it crosses the socket. */
export async function observeActuatorProjectServices(project, get = dockerSocketGet) {
  const services = new Map();
  for (const item of await ownProjectContainers(project, get)) {
    const service = item.Labels['com.docker.compose.service'];
    if (typeof item.State !== 'string' || typeof item.Status !== 'string' || services.has(service)) throw unavailable();
    const status = item.Status.toLowerCase();
    services.set(service, { composePresent: true, healthy: item.State.toLowerCase() === 'running'
      && !status.includes('unhealthy') && !status.includes('health: starting') });
  }
  return Object.fromEntries(services);
}
