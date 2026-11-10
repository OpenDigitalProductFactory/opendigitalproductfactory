const SURFACES = ["portal", "mcp", "docker", "postgres"];

export const EXIT_CONTROL_PLANE_STARVATION = 5;
export const DEFAULT_BUILD_WATCHDOG_FAILURE_LIMITS = Object.freeze({
  portal: 3,
  mcp: 3,
  docker: 2,
  postgres: 2,
});

export function classifyControlPlaneSample(probes) {
  const failures = SURFACES.flatMap((surface) => {
    const probe = probes?.[surface];
    return probe?.healthy === true
      ? []
      : [`${surface}:${probe?.reason || "unhealthy"}`];
  });
  return { healthy: failures.length === 0, failures };
}

export async function monitorControlPlane({
  sample,
  isComplete,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  intervalMs = 5_000,
  consecutiveFailureLimit,
  onSample = () => {},
}) {
  const samples = [];
  const consecutiveFailureLimits = Object.fromEntries(
    SURFACES.map((surface) => [
      surface,
      consecutiveFailureLimit ?? DEFAULT_BUILD_WATCHDOG_FAILURE_LIMITS[surface],
    ]),
  );
  const consecutiveFailures = Object.fromEntries(
    SURFACES.map((surface) => [surface, 0]),
  );
  while (true) {
    const probes = await sample();
    const classification = classifyControlPlaneSample(probes);
    for (const surface of SURFACES) {
      consecutiveFailures[surface] = probes?.[surface]?.healthy === true
        ? 0
        : consecutiveFailures[surface] + 1;
    }
    const observed = {
      observedAt: new Date().toISOString(),
      probes,
      ...classification,
      consecutiveFailures: { ...consecutiveFailures },
      consecutiveFailureLimits: { ...consecutiveFailureLimits },
    };
    samples.push(observed);
    await onSample(observed);
    const breachedSurfaces = SURFACES.filter(
      (surface) => (
        consecutiveFailures[surface] >= consecutiveFailureLimits[surface]
      ),
    );
    if (breachedSurfaces.length > 0) {
      return {
        status: "blocked_control_plane_starvation",
        samples,
        failures: breachedSurfaces.map((surface) => (
          `${surface}:${probes?.[surface]?.reason || "unhealthy"}`
        )),
      };
    }
    if (isComplete()) {
      return { status: "healthy", samples, failures: [] };
    }
    await wait(intervalMs);
  }
}

export async function establishHealthyControlPlane({
  sample,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  intervalMs = 5_000,
  attempts = 2,
}) {
  const samples = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const probes = await sample();
    const classification = classifyControlPlaneSample(probes);
    samples.push({
      observedAt: new Date().toISOString(),
      probes,
      ...classification,
    });
    if (classification.healthy) {
      return { status: "healthy", samples, failures: [] };
    }
    if (attempt + 1 < attempts) await wait(intervalMs);
  }
  return {
    status: "blocked_control_plane_starvation",
    samples,
    failures: samples.at(-1)?.failures || ["control-plane:unhealthy"],
  };
}

export function terminateProcessTreeCommand(pid, platform = process.platform) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("process tree root must be a positive integer PID");
  }
  return platform === "win32"
    ? { command: "taskkill.exe", args: ["/PID", String(pid), "/T", "/F"] }
    : { command: "kill", args: ["-TERM", `-${pid}`] };
}
