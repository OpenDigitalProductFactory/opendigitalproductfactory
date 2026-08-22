import { readFile, stat } from "node:fs/promises";

export type InstallHostKind = "source" | "consumer" | "unknown";

export type InstallHostProfile = {
  kind: InstallHostKind;
  installMode: string | null;
  sourceCapable: boolean;
  releaseImage: boolean;
  reason:
    | "git-source-present"
    | "consumer-release-install"
    | "contradictory-install-evidence"
    | "insufficient-install-evidence";
};

export type InstallHostEvidence = {
  installMode: string | null;
  hasGitSource: boolean;
  imageTag: string | null;
};

const CONSUMER_MODES = new Set(["consumer", "customer"]);
const SOURCE_MODES = new Set(["customizer", "contributor"]);

function normalized(value: string | null | undefined): string | null {
  const result = value?.trim().toLocaleLowerCase("en-US") ?? "";
  return result || null;
}

function hostPath(root: string, entry: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${entry}`;
}

export function classifyInstallHost(evidence: InstallHostEvidence): InstallHostProfile {
  const installMode = normalized(evidence.installMode);
  const releaseImage = Boolean(normalized(evidence.imageTag));
  const consumerMarker = installMode !== null && CONSUMER_MODES.has(installMode);
  const sourceMarker = installMode !== null && SOURCE_MODES.has(installMode);

  if (evidence.hasGitSource && consumerMarker) {
    return { kind: "unknown", installMode, sourceCapable: false, releaseImage, reason: "contradictory-install-evidence" };
  }
  if (evidence.hasGitSource) {
    return { kind: "source", installMode, sourceCapable: true, releaseImage, reason: "git-source-present" };
  }
  if (sourceMarker) {
    return { kind: "unknown", installMode, sourceCapable: false, releaseImage, reason: "contradictory-install-evidence" };
  }
  if (consumerMarker || releaseImage) {
    return { kind: "consumer", installMode, sourceCapable: false, releaseImage, reason: "consumer-release-install" };
  }
  return { kind: "unknown", installMode, sourceCapable: false, releaseImage, reason: "insufficient-install-evidence" };
}

type HostProfileEnv = Record<string, string | undefined>;

export async function readInstallHostProfile(options: {
  hostRoot?: string;
  env?: HostProfileEnv;
  readText?: (path: string) => Promise<string>;
  pathExists?: (path: string) => Promise<boolean>;
} = {}): Promise<InstallHostProfile> {
  const hostRoot = options.hostRoot ?? process.env.DPF_HOST_INSTALL_PATH_IN_CONTAINER ?? "/host-dpf";
  const env = options.env ?? process.env;
  const readText = options.readText ?? ((path: string) => readFile(path, "utf8"));
  const pathExists = options.pathExists ?? (async (path: string) => {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  });

  let installMode: string | null = null;
  try {
    installMode = normalized(await readText(hostPath(hostRoot, ".install-mode")));
  } catch {
    installMode = null;
  }

  return classifyInstallHost({
    installMode,
    hasGitSource: await pathExists(hostPath(hostRoot, ".git")),
    imageTag: normalized(env.DPF_IMAGE_TAG),
  });
}
