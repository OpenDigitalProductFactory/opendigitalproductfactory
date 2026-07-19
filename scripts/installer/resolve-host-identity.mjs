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

  // Installer-owned state identity. `.env` DPF_HOST_* and install-state platform/arch are
  // written by the same installer at the same moment, so a canonical pair here carries the
  // same authority as the explicit env — and it is the ONLY evidence an N-1 caller (a portal
  // built before the readiness contract) can hand the promoter. Refusing it wedges the
  // install: the upgrade that teaches the caller to send the env IS the blocked upgrade.
  // Container `process.platform` / daemon OS remains off limits.
  if (PLATFORMS.has(state.platform) && canonicalArch) {
    const [platform, capabilityHostPlatform] = PLATFORMS.get(state.platform);
    const pathEvidence = [env.DPF_HOST_INSTALL_PATH, env.DPF_STATE_DIR_HOST].filter((value) => typeof value === "string" && value.length > 0);
    const windowsPaths = [installDrive, stateDrive].filter(Boolean).length;
    if (pathEvidence.length > 0 && (platform === "win32" ? windowsPaths !== pathEvidence.length : windowsPaths > 0)) throw new Error("host_identity_contradictory");
    return { platform, arch: canonicalArch, capabilityHostPlatform, provenance: "install-state" };
  }

  if (state.platform === "unsupported" && installDrive && stateDrive && canonicalArch) {
    if (drive(state.installPath) !== installDrive || drive(state.stateDir) !== stateDrive) throw new Error("host_identity_contradictory");
    return { platform: "win32", arch: canonicalArch, capabilityHostPlatform: "windows", provenance: "legacy-windows-paths" };
  }
  throw new Error("host_identity_unverifiable");
}
