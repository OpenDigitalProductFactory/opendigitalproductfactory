import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "url";

const DEFAULT_PATHS = [
  fileURLToPath(new URL("../../apps/web/.env.local", import.meta.url)),
  fileURLToPath(new URL("../.env", import.meta.url)),
  fileURLToPath(new URL("../../.env", import.meta.url)),
];

let defaultEnvLoaded = false;

export function resolveDbEnvPaths(options?: {
  webEnvPath?: string;
  packageEnvPath?: string;
  rootEnvPath?: string;
}): string[] {
  return [
    options?.webEnvPath ?? DEFAULT_PATHS[0],
    options?.packageEnvPath ?? DEFAULT_PATHS[1],
    options?.rootEnvPath ?? DEFAULT_PATHS[2],
  ];
}

export function loadDbEnv(options?: {
  webEnvPath?: string;
  packageEnvPath?: string;
  rootEnvPath?: string;
  forceReload?: boolean;
}): string[] {
  if (
    defaultEnvLoaded &&
    !options?.forceReload &&
    !options?.webEnvPath &&
    !options?.packageEnvPath &&
    !options?.rootEnvPath
  ) {
    return resolveDbEnvPaths();
  }

  const loadedPaths: string[] = [];

  for (const envPath of resolveDbEnvPaths(options)) {
    const result = loadDotenv({
      path: envPath,
      override: false,
      quiet: true,
    });

    if (!result.error) {
      loadedPaths.push(envPath);
    }
  }

  if (
    !options?.forceReload &&
    !options?.webEnvPath &&
    !options?.packageEnvPath &&
    !options?.rootEnvPath
  ) {
    defaultEnvLoaded = true;
  }

  return loadedPaths;
}

export function resetDbEnvForTests(): void {
  defaultEnvLoaded = false;
}
