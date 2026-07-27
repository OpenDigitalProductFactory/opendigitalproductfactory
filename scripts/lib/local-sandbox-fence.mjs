import { randomUUID } from "node:crypto";
import {
  closeSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);

function readFence(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLocalSandboxFence({
  path,
  ownerSessionId,
  branch,
  pid = process.pid,
  now = () => new Date(),
  processAlive = isProcessAlive,
  token = randomUUID(),
}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const timestamp = now().toISOString();
    const record = {
      schema: "dpf-local-sandbox-fence/v1",
      token,
      pid,
      ownerSessionId,
      branch,
      acquiredAt: timestamp,
      heartbeatAt: timestamp,
    };
    try {
      const fd = openSync(path, "wx");
      try {
        writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`);
      } finally {
        closeSync(fd);
      }
      return { status: "acquired", record };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }

    const active = readFence(path);
    if (active && processAlive(active.pid)) {
      return { status: "conflict", active };
    }

    const orphanPath = `${path}.orphan-${process.pid}-${Date.now()}`;
    try {
      renameSync(path, orphanPath);
      unlinkSync(orphanPath);
    } catch (error) {
      if (!["ENOENT", "EACCES", "EPERM"].includes(error?.code)) throw error;
    }
  }
  return { status: "conflict", active: readFence(path) };
}

export function heartbeatLocalSandboxFence({ path, token, now = () => new Date() }) {
  const record = readFence(path);
  if (!record || record.token !== token) return { status: "lost" };
  const updated = { ...record, heartbeatAt: now().toISOString() };
  writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`);
  return { status: "renewed", record: updated };
}

export function releaseLocalSandboxFence({ path, token }) {
  const record = readFence(path);
  if (!record) return { status: "absent" };
  if (record.token !== token) return { status: "not-owner", active: record };
  unlinkSync(path);
  return { status: "released" };
}

function cli() {
  const [command, path, tokenOrOwner, branchOrPid] = process.argv.slice(2);
  let result;
  if (command === "acquire") {
    result = acquireLocalSandboxFence({
      path,
      ownerSessionId: tokenOrOwner,
      branch: branchOrPid,
      pid: Number(process.env.DPF_LOCAL_FENCE_PID || process.ppid),
    });
  } else if (command === "heartbeat") {
    result = heartbeatLocalSandboxFence({ path, token: tokenOrOwner });
  } else if (command === "release") {
    result = releaseLocalSandboxFence({ path, token: tokenOrOwner });
  } else {
    throw new Error("usage: local-sandbox-fence.mjs acquire PATH OWNER BRANCH | heartbeat PATH TOKEN | release PATH TOKEN");
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] === THIS_FILE) {
  try {
    cli();
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}
