import path from "node:path";

export const DEFAULT_ORG_NAME = "Digital Product Factory Scratch";
export const DEFAULT_PASSWORD = "ScratchPassw0rd!";
export const DEFAULT_PORTAL_URL = "http://localhost:3000";
export const DEFAULT_TIMEOUT_MS = 120_000;

export function buildDefaultEmail(now = new Date()) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `scratch-admin+${stamp}@dpf.local`;
}

export function parseWalkthroughArgs(argv, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? new Date();
  const config = {
    portalUrl: DEFAULT_PORTAL_URL,
    evidencePath: path.resolve(cwd, "scratch-first-run-evidence"),
    orgName: DEFAULT_ORG_NAME,
    email: buildDefaultEmail(now),
    password: DEFAULT_PASSWORD,
    headed: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--portal-url":
        config.portalUrl = normalizeUrl(readValue(argv, ++index, arg));
        break;
      case "--evidence-path":
        config.evidencePath = path.resolve(cwd, readValue(argv, ++index, arg));
        break;
      case "--org-name":
        config.orgName = readValue(argv, ++index, arg);
        break;
      case "--email":
        config.email = readValue(argv, ++index, arg);
        break;
      case "--password":
        config.password = readValue(argv, ++index, arg);
        break;
      case "--headed":
        config.headed = true;
        break;
      case "--timeout-ms": {
        const value = Number.parseInt(readValue(argv, ++index, arg), 10);
        if (!Number.isSafeInteger(value) || value < 1) {
          throw new Error("--timeout-ms must be a positive integer.");
        }
        config.timeoutMs = value;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  config.portalUrl = normalizeUrl(config.portalUrl);
  return config;
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function normalizeUrl(value) {
  return value.replace(/\/+$/, "");
}
