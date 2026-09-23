import { EXIT_BUILDER_RESOURCE_EXHAUSTED } from "./sandbox-freshness.mjs";

function gibibytes(bytes) {
  const gib = bytes / (1024 ** 3);
  if (!Number.isInteger(gib) || gib <= 0) {
    throw new Error("builder memory must be a positive whole number of GiB");
  }
  return `${gib}g`;
}

export function buildxCreateArgs(builder, configPath) {
  return [
    "buildx", "create",
    "--name", builder.name,
    "--driver", "docker-container",
    "--driver-opt", `memory=${gibibytes(builder.memoryBytes)}`,
    "--driver-opt", `cpu-quota=${builder.cpuQuota}`,
    "--driver-opt", `cpu-period=${builder.cpuPeriod}`,
    "--driver-opt", "default-load=true",
    "--buildkitd-config", configPath,
    "--bootstrap",
  ];
}

export function buildxBuildArgs({ builder, tag, context = "." }) {
  return [
    "buildx", "build", "--builder", builder.name,
    "--target", "build", "--tag", tag, "--load", context,
  ];
}

export function validateBuilderInspection(builder, inspection) {
  const failures = [];
  if (inspection?.driver !== "docker-container") failures.push("driver");
  if (inspection?.container !== builder.container) failures.push("container");
  if (inspection?.memoryBytes !== builder.memoryBytes) failures.push("memory");
  if (inspection?.cpuQuota !== builder.cpuQuota) failures.push("cpu-quota");
  if (inspection?.cpuPeriod !== builder.cpuPeriod) failures.push("cpu-period");
  return { ok: failures.length === 0, failures };
}

export function databaseUrlFromContainerEnvironment(lines, {
  host = "127.0.0.1",
  port = 5432,
} = {}) {
  const values = Object.fromEntries(
    String(lines || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf("=");
        return separator > 0
          ? [line.slice(0, separator), line.slice(separator + 1)]
          : [line, ""];
      }),
  );
  const user = values.POSTGRES_USER || "dpf";
  const password = values.POSTGRES_PASSWORD;
  const database = values.POSTGRES_DB || "dpf";
  if (!password) throw new Error("live PostgreSQL password is unavailable");
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    + `@${host}:${port}/${encodeURIComponent(database)}`;
}

export function postgresContainerProbeArgs({ container, environment }) {
  if (!container) {
    throw new Error("live PostgreSQL container identity is unavailable");
  }
  const values = Object.fromEntries(
    String(environment || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf("=");
        return separator > 0
          ? [line.slice(0, separator), line.slice(separator + 1)]
          : [line, ""];
      }),
  );
  const user = values.POSTGRES_USER || "dpf";
  const database = values.POSTGRES_DB || "dpf";
  return [
    "exec", container,
    "psql", "-U", user, "-d", database, "-tAc", "SELECT 1",
  ];
}

/**
 * How many parallel workers the build reported spawning, when it said so.
 *
 * Next prints this line before the phase that gets killed, and it is the number
 * that has to fit the builder's memory cap. Recording it turns "out of memory"
 * into an arithmetic problem somebody can act on (BI-5A1FBCA6).
 */
export function observedBuildWorkers(output) {
  const match = /using (\d+) workers/i.exec(output || "");
  return match ? Number(match[1]) : null;
}

/** The build step the host killed, when the output names one. */
export function killedBuildStep(output) {
  const line = String(output || "")
    .split(/\r?\n/)
    .find((entry) => /killed with SIGKILL/i.test(entry));
  if (!line) return null;
  const named = line.slice(line.lastIndexOf(":") + 1).trim();
  return named || null;
}

export function classifyBoundedBuildExit({ exitCode, output }) {
  if (
    exitCode !== 0
    && /ResourceExhausted|cannot allocate memory|SIGKILL.*next build/i.test(output || "")
  ) {
    // BI-5A1FBCA6: the BUILDER hit its own memory cap. The status stays the
    // shared one so an already-deployed portal keeps accepting the evidence
    // write, but the exit code and the recorded detail now say which of the
    // three failures wearing that name actually happened. `failures` has always
    // carried `builder:resource-exhausted`; nothing downstream read it, and the
    // summary an operator sees named the control plane instead.
    return {
      status: "blocked_control_plane_starvation",
      exitCode: EXIT_BUILDER_RESOURCE_EXHAUSTED,
      failures: ["builder:resource-exhausted"],
      observedWorkers: observedBuildWorkers(output),
      killedStep: killedBuildStep(output),
    };
  }
  return {
    status: exitCode === 0 ? "healthy" : "failed",
    exitCode,
    failures: [],
  };
}
