import { parseArgs as utilParseArgs } from "node:util";
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
  const schema = {
    "portal-url": { type: "string" },
    "evidence-path": { type: "string" },
    "org-name": { type: "string" },
    email: { type: "string" },
    password: { type: "string" },
    headed: { type: "boolean" },
    "timeout-ms": { type: "string" },
  };
  // strict: false plus the token checks below keep the old messages, in argument order.
  const { values, tokens } = utilParseArgs({ args: argv, options: schema, strict: false, allowPositionals: true, tokens: true });
  for (const token of tokens) {
    if (token.kind !== "option" || !Object.hasOwn(schema, token.name)) {
      throw new Error(`Unknown argument: ${token.rawName ?? token.value ?? "--"}`);
    }
    if (schema[token.name].type === "string" && (!token.value || token.value.startsWith("--"))) {
      throw new Error(`${token.rawName} requires a value.`);
    }
  }

  const config = {
    portalUrl: values["portal-url"] ?? DEFAULT_PORTAL_URL,
    evidencePath: path.resolve(cwd, values["evidence-path"] ?? "scratch-first-run-evidence"),
    orgName: values["org-name"] ?? DEFAULT_ORG_NAME,
    email: values.email ?? buildDefaultEmail(now),
    password: values.password ?? DEFAULT_PASSWORD,
    headed: values.headed === true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  if (values["timeout-ms"] !== undefined) {
    const value = Number.parseInt(values["timeout-ms"], 10);
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error("--timeout-ms must be a positive integer.");
    }
    config.timeoutMs = value;
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
