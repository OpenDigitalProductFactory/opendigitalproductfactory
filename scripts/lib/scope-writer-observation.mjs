import { createServer, request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { chmod, chown, lstat, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { dockerSocketGet } from './docker-socket.mjs';

export const SCOPE_WRITER_OBSERVER_SOCKET = '/run/dpf-actuator/scope-observer.sock';
const cohortPath = '/v1/scope-writer/cohort';
const retirementPath = '/v1/scope-writer/retirement';
const projectServicesPath = '/v1/runtime/project-services';
const fencePreviewsPath = '/v1/runtime/fence-ended-previews';
const responseLimit = 8192;
const unavailable = () => new Error('scope_writer_observation_unavailable');

export function hasPrivateActuatorMount(mountinfo) {
  return mountinfo.toString().split('\n').some(line => line.split(' ')[4] === dirname(SCOPE_WRITER_OBSERVER_SOCKET));
}

/** Serve one read operation. The Unix directory belongs to the actuator.
 * The observer derives scope from host-owned state, never from the request. */
export function createScopeWriterObserver({ observe, observeServices, readRetirement, fencePreviews }) {
  const operations = new Map([
    [`GET ${cohortPath}`, observe], [`GET ${projectServicesPath}`, observeServices],
    [`GET ${retirementPath}`, readRetirement], [`POST ${fencePreviewsPath}`, fencePreviews],
  ]);
  const server = createServer({ headersTimeout: 2_000, requestTimeout: 2_000, maxHeaderSize: 1024 }, async (req, res) => {
    res.setHeader('Connection', 'close');
    const call = operations.get(`${req.method} ${req.url}`);
    if (!call || req.headers['transfer-encoding'] !== undefined
      || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = JSON.stringify(await call());
      if (!body || Buffer.byteLength(body) > responseLimit) throw unavailable();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }).end(body);
    } catch { res.writeHead(503).end(); }
  });
  server.maxConnections = 8;
  return server;
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

/** Close the connection on refused, stalled, oversized or malformed output. */
async function requestActuator(path, socketPath, { method = 'GET', timeoutMs = 2_500 } = {}) {
  if (socketPath === SCOPE_WRITER_OBSERVER_SOCKET) {
    try {
      const [directory, socket] = await Promise.all([lstat(dirname(socketPath)), lstat(socketPath)]);
      if (!directory.isDirectory() || directory.uid !== 0 || (directory.mode & 0o022) !== 0
        || !socket.isSocket() || socket.uid !== 0 || socket.gid !== 1000 || (socket.mode & 0o777) !== 0o660) {
        throw unavailable();
      }
    } catch { throw unavailable(); }
  }
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
        if (size > responseLimit) return fail();
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

export function reconcileEndedPreviewRuntimes({ socketPath = SCOPE_WRITER_OBSERVER_SOCKET } = {}) {
  return requestActuator(fencePreviewsPath, socketPath, { method: 'POST', timeoutMs: 30_000 });
}

/** Only the installation binding selects the project. Daemon metadata is
 * projected on the actuator side before it crosses the socket. */
export async function observeActuatorProjectServices(project, get = dockerSocketGet) {
  if (typeof project !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(project)) throw unavailable();
  const filters = new URLSearchParams({ all: '1', filters: JSON.stringify({ label: [`com.docker.compose.project=${project}`] }) });
  const containers = await get(`/containers/json?${filters}`);
  if (!Array.isArray(containers) || containers.length > 256) throw unavailable();
  const services = new Map();
  for (const item of containers) {
    const labels = item?.Labels;
    if (labels?.['com.docker.compose.project'] !== project || labels['com.docker.compose.oneoff'] === 'True') continue;
    const service = labels['com.docker.compose.service'];
    if (typeof service !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(service)) continue;
    if (typeof item.State !== 'string' || typeof item.Status !== 'string' || services.has(service)) throw unavailable();
    const status = item.Status.toLowerCase();
    services.set(service, { composePresent: true, healthy: item.State.toLowerCase() === 'running'
      && !status.includes('unhealthy') && !status.includes('health: starting') });
  }
  return Object.fromEntries(services);
}
