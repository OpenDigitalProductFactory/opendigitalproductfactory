// Governed platform-service restart (BI-01EA3EBE).
//
// The admin_restart_service tool shipped as `docker compose restart <service>`,
// but the portal runtime image carries no docker-compose.yml — so every
// invocation failed with "no configuration file provided" while the docker CLI,
// compose plugin, and socket were all present. Kernel decision
// (label-resolve-restart, margin 1.07): resolve the target container by the
// compose labels Docker stamps on every compose-managed container, scoped to
// the portal's OWN compose project (self-inspected via $(hostname), which is
// the container id inside a compose container), then plain `docker restart`.
// No compose file needed; multi-project hosts (contributor worktree sandboxes)
// can't be cross-hit because of the project scope.

// Postgres is the only restartable data service (BET-5).
export const RESTARTABLE_SERVICES = ["portal", "sandbox", "postgres"] as const;
export type RestartableService = (typeof RESTARTABLE_SERVICES)[number];

/** Narrow exec surface (promisified child_process.exec) so tests inject a mock. */
export type ShellExec = (
  command: string,
  options: { timeout: number },
) => Promise<{ stdout: string }>;

/** Private-actuator route; injected by tests. */
export type RestartActuatorPort = {
  available(): Promise<boolean>;
  restart(service: string): Promise<{ service: string; container: string }>;
};

const privateActuatorRestart: RestartActuatorPort = {
  available: async () => {
    const { usesPrivateActuator } = await import("../../../../scripts/lib/scope-writer-observation.mjs");
    return usesPrivateActuator();
  },
  restart: async (service) => {
    const { restartActuatorService } = await import("../../../../scripts/lib/scope-writer-observation.mjs");
    const result: unknown = await restartActuatorService(service);
    const container = (result as { container?: unknown } | null)?.container;
    if (typeof container !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(container)) {
      throw new Error("actuator_restart_unverified");
    }
    return { service, container };
  },
};

export type RestartResult = {
  success: boolean;
  message: string;
  /** Container that was restarted (name), when successful. */
  container?: string;
  error?: string;
};

/** The compose project this portal instance belongs to, or null when not
 *  running under compose (e.g. unit tests, bare node). */
export async function resolveOwnComposeProject(exec: ShellExec): Promise<string | null> {
  try {
    const { stdout } = await exec(
      `docker inspect "$(hostname)" --format '{{ index .Config.Labels "com.docker.compose.project" }}'`,
      { timeout: 10_000 },
    );
    const project = stdout.trim();
    return project.length > 0 ? project : null;
  } catch {
    return null;
  }
}

/**
 * Restart one allowlisted platform service by compose-label resolution.
 * `docker ps -a` (not `ps`) so a crashed/exited container can be brought back
 * with the same call — that's the case the health alert is usually about.
 */
export async function restartPlatformService(
  service: string,
  exec: ShellExec,
  actuator: RestartActuatorPort = privateActuatorRestart,
): Promise<RestartResult> {
  if (!(RESTARTABLE_SERVICES as readonly string[]).includes(service)) {
    return {
      success: false,
      message: `Unknown service "${service}".`,
      error: `Invalid service. Allowed: ${RESTARTABLE_SERVICES.join(", ")}`,
    };
  }

  // The immutable portal has no Docker socket. When the private actuator is
  // mounted it alone resolves and restarts the owned container; a refusal is
  // final and never falls back to shell Docker (BI-224F56F1).
  if (await actuator.available()) {
    try {
      const { container } = await actuator.restart(service);
      return { success: true, message: `Restarted ${service} (${container}).`, container };
    } catch {
      return {
        success: false,
        message: `The platform could not confirm a restart of ${service}.`,
        error: "actuator_restart_unavailable",
      };
    }
  }

  const project = await resolveOwnComposeProject(exec);
  const projectFilter = project
    ? ` --filter "label=com.docker.compose.project=${project}"`
    : "";

  let candidates: Array<{ id: string; name: string }>;
  try {
    const { stdout } = await exec(
      `docker ps -a${projectFilter} --filter "label=com.docker.compose.service=${service}" --format '{{.ID}}\t{{.Names}}'`,
      { timeout: 15_000 },
    );
    candidates = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [id, name] = line.split("\t");
        return { id: id ?? "", name: name ?? id ?? "" };
      })
      .filter((c) => c.id);
  } catch (err) {
    const msg = (err as Error).message?.slice(0, 500) ?? "container lookup failed";
    return { success: false, message: `Could not look up ${service}: ${msg}`, error: msg };
  }

  if (candidates.length === 0) {
    return {
      success: false,
      message: `No container found for service "${service}"${project ? ` in project "${project}"` : ""}.`,
      error: "container_not_found",
    };
  }
  if (candidates.length > 1) {
    const names = candidates.map((c) => c.name).join(", ");
    return {
      success: false,
      message: `Multiple containers match service "${service}" (${names}) and no compose-project scope could be resolved — refusing an ambiguous restart.`,
      error: "ambiguous_container",
    };
  }

  const target = candidates[0];
  try {
    await exec(`docker restart ${target.id}`, { timeout: 60_000 });
    return {
      success: true,
      message: `Restarted ${service} (${target.name}).`,
      container: target.name,
    };
  } catch (err) {
    const msg = (err as Error).message?.slice(0, 500) ?? "restart failed";
    return { success: false, message: `Failed to restart ${service}: ${msg}`, error: msg };
  }
}
