const PLATFORMS = new Map([
  ["win32", ["win32", "windows"]],
  ["windows", ["win32", "windows"]],
  ["darwin", ["darwin", "macos"]],
  ["macos", ["darwin", "macos"]],
  ["linux", ["linux", "linux"]],
]);
const ARCHES = new Map([["x64", "amd64"], ["amd64", "amd64"], ["x86_64", "x86_64"], ["arm64", "arm64"]]);
const drive = (value) => typeof value === "string" && /^[A-Za-z]:[\\/]/.test(value) ? value[0].toUpperCase() : undefined;

export function resolveHostIdentity({ state, env = {} }) {
  const explicitPlatform = env.DPF_HOST_PLATFORM;
  const explicitArch = env.DPF_HOST_ARCH;
  if (explicitPlatform || explicitArch) {
    if (!explicitPlatform || !explicitArch || !PLATFORMS.has(explicitPlatform) || !ARCHES.has(explicitArch)) throw new Error("host_identity_unverifiable");
    const [platform, capabilityHostPlatform] = PLATFORMS.get(explicitPlatform);
    const arch = ARCHES.get(explicitArch);
    if ((state.platform && state.platform !== "unsupported" && state.platform !== platform) || (state.arch && ARCHES.get(state.arch) && ARCHES.get(state.arch) !== arch)) throw new Error("host_identity_contradictory");
    return { platform, arch, capabilityHostPlatform, provenance: "explicit" };
  }

  const installDrive = drive(env.DPF_HOST_INSTALL_PATH);
  const stateDrive = drive(env.DPF_STATE_DIR_HOST);
  const canonicalArch = ["amd64", "x86_64", "arm64"].includes(state.arch) ? state.arch : undefined;
  if (state.platform === "unsupported" && installDrive && stateDrive && canonicalArch) {
    if (drive(state.installPath) !== installDrive || drive(state.stateDir) !== stateDrive) throw new Error("host_identity_contradictory");
    return { platform: "win32", arch: canonicalArch, capabilityHostPlatform: "windows", provenance: "legacy-windows-paths" };
  }
  throw new Error("host_identity_unverifiable");
}
