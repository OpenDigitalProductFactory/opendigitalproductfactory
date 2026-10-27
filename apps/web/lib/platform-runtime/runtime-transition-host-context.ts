import { parseReleaseInstallContext } from "@/lib/self-upgrade/release-target";
import type { PromoterParams } from "@/lib/self-upgrade/promoter";
import type { SelfUpgradeHostIdentity } from "@/lib/self-upgrade/config";
import { resolveHostIdentity } from "../../../../scripts/installer/resolve-host-identity.mjs";

export function runtimeTransitionHostPlatform(host: Record<string, unknown>): string {
  const platform = new Map([["win32", "windows"], ["darwin", "macos"], ["linux", "linux"]]).get(host.platform as string);
  if (!platform) throw new Error("runtime_transition_host_platform_unverifiable");
  return platform;
}

type Context = Pick<PromoterParams, "hostInstallPath" | "composeFiles" | "composeProject" | "composeEnvFileHostPath" | "hostIdentity"> & { stateDirHostPath: string };
const normalizedPath = (path: string) => path.replaceAll("\\", "/").replace(/\/$/, "");

/** Both new execution and signed restart recovery use the install's carrier.
 * The portal container's OS and source-only Compose defaults are not that carrier. */
export function runtimeTransitionHostContext(host?: Record<string, unknown>, env: Record<string, string | undefined> = process.env): Context {
  const hostInstallPath = env.DPF_HOST_INSTALL_PATH;
  const stateDirHostPath = env.DPF_STATE_DIR_HOST;
  if (!hostInstallPath || !stateDirHostPath) throw new Error("runtime_transition_host_configuration_missing");
  const isRelease = host?.installMode === "consumer" || host?.installMode === "customer";
  const release = isRelease ? parseReleaseInstallContext({ state: host, markerMode: null, env }) : null;
  if (isRelease && (!release || normalizedPath(release.installPath) !== normalizedPath(hostInstallPath))) throw new Error("runtime_transition_install_identity_mismatch");
  return {
    hostInstallPath, stateDirHostPath,
    composeFiles: release?.composeFiles ?? (env.DPF_SELF_UPGRADE_COMPOSE_FILES || "docker-compose.yml").split(/\s+/).filter(Boolean),
    composeProject: typeof host?.composeProjectName === "string" ? host.composeProjectName : env.COMPOSE_PROJECT_NAME || "dpf",
    ...(release ? {
      composeEnvFileHostPath: `${hostInstallPath.replace(/[\\/]$/, "")}/.env`,
      hostIdentity: resolveHostIdentity({ state: host, env }) as SelfUpgradeHostIdentity,
    } : {}),
  };
}
