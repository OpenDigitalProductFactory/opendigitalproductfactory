#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const WEB_ROOT = resolve(REPO_ROOT, "apps/web");
const BASELINE_PATH = resolve(SCRIPT_DIR, "provider-local-connector-lifecycle-baseline.json");
const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 96 * 1024 * 1024;
const MUTATIONS = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const CONNECTION_STATES = new Set(["unconfigured", "connected", "error", "degraded"]);
const CANONICAL_STORE = "apps/web/lib/integrations/kernel/credential-store.ts";
const KERNEL_PREFIX = "apps/web/lib/integrations/kernel/";
const PROOF_PREFIXES = [
  "apps/web/components/integrations/EmailPostmarkConnectPanel",
  "apps/web/components/integrations/Microsoft365CommunicationsConnectPanel",
  "apps/web/lib/integrations/connectors/microsoft365-communications",
  "apps/web/lib/integrations/connectors/email-postmark",
  "apps/web/lib/integrate/microsoft365-communications/",
  "apps/web/lib/marketing/channels/email-postmark/",
  "apps/web/app/api/integrations/email-postmark/",
];

function normalized(path) { return path.replaceAll("\\", "/"); }
function isTestOrGenerated(file) {
  return /(?:^|\/)(?:__tests__|generated)(?:\/|$)/.test(file)
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)
    || /\.generated\.[cm]?[jt]sx?$/.test(file)
    || /(?:^|\/)doc-index\.generated\.json$/.test(file);
}
function propertyName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
  return null;
}
function lineOf(sourceFile, node) { return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1; }
function isLowLevelTokenPrimitive(file) {
  return /(?:^|\/)(?:token-client|oauth-token|refresh-token-client)\.ts$/.test(file)
    || file === "apps/web/lib/integrate/oauth/refresh-token.ts";
}
function isProviderIntegrationSurface(file) {
  return file.includes("/integrate/") || file.includes("/integrations/") || file.includes("/marketing/channels/");
}
function declarationName(node) {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  return null;
}

export function scanSource(source, file) {
  file = normalized(file);
  if (isTestOrGenerated(file)) return [];
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const violations = [];
  const credentialDelegates = new Set(["integrationCredential"]);
  const add = (kind, node) => violations.push({ file, kind, line: lineOf(sourceFile, node) });
  const collectAliases = (node) => {
    if (ts.isVariableDeclaration(node)) {
      if (ts.isIdentifier(node.name) && node.initializer && propertyName(node.initializer) === "integrationCredential") {
        credentialDelegates.add(node.name.text);
      }
      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const sourceName = element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : ts.isIdentifier(element.name) ? element.name.text : null;
          if (sourceName === "integrationCredential" && ts.isIdentifier(element.name)) credentialDelegates.add(element.name.text);
        }
      }
    }
    ts.forEachChild(node, collectAliases);
  };
  collectAliases(sourceFile);
  const visit = (node) => {
    if (file !== CANONICAL_STORE && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) {
      const method = propertyName(node);
      const delegate = propertyName(node.expression);
      const identifierDelegate = ts.isIdentifier(node.expression) ? node.expression.text : delegate;
      if (MUTATIONS.has(method) && identifierDelegate && credentialDelegates.has(identifierDelegate)) add("integration-credential-mutation", node);
    }
    if (file !== CANONICAL_STORE && ts.isTaggedTemplateExpression(node)) {
      const tag = propertyName(node.tag);
      const sql = node.template.getText(sourceFile);
      if (/^\$executeRaw(?:Unsafe)?$/.test(tag ?? "") && /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:["'`]?\w+["'`]?\s*\.\s*)?["'`]?IntegrationCredential\b/i.test(sql)) add("integration-credential-raw-sql", node);
    }
    if (file !== CANONICAL_STORE && ts.isCallExpression(node)) {
      const method = propertyName(node.expression);
      const arg = node.arguments[0];
      if (/^\$executeRawUnsafe$/.test(method ?? "") && arg && ts.isStringLiteralLike(arg)
        && /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:["'`]?\w+["'`]?\s*\.\s*)?["'`]?IntegrationCredential\b/i.test(arg.text)) add("integration-credential-raw-sql", node);
    }
    if (isProviderIntegrationSurface(file) && !file.startsWith(KERNEL_PREFIX) && ts.isUnionTypeNode(node)) {
      const states = new Set(node.types.filter(ts.isLiteralTypeNode).map((type) => type.literal).filter(ts.isStringLiteralLike).map((literal) => literal.text).filter((state) => CONNECTION_STATES.has(state)));
      if (states.size >= 2) add("provider-connection-state", node);
    }
    if (isProviderIntegrationSurface(file) && !file.startsWith(KERNEL_PREFIX) && !isLowLevelTokenPrimitive(file)) {
      const name = declarationName(node);
      if (name && /refresh/i.test(name) && /(?:token|credential|session)/i.test(name)) add("provider-refresh-orchestration", node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

async function productionFiles(root) {
  const files = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.[cm]?tsx?$/.test(entry.name)) {
        const file = normalized(relative(REPO_ROOT, path));
        if (!isTestOrGenerated(file)) files.push({ path, file });
      }
      if (files.length > MAX_FILES) throw new Error(`connector lifecycle guard exceeded ${MAX_FILES} production files`);
    }
  }
  await walk(root);
  return files;
}

export async function scanRepository() {
  const violations = [];
  let totalBytes = 0;
  for (const { path, file } of await productionFiles(WEB_ROOT)) {
    const source = await readFile(path, "utf8");
    const bytes = Buffer.byteLength(source);
    if (bytes > MAX_FILE_BYTES) throw new Error(`${file} exceeds the ${MAX_FILE_BYTES}-byte guard read cap`);
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`connector lifecycle guard exceeded the ${MAX_TOTAL_BYTES}-byte total read cap`);
    violations.push(...scanSource(source, file));
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind) || a.line - b.line);
}

function debtKey({ file, kind }) { return `${file}::${kind}`; }

export async function main() {
  const baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
  if (baseline.version !== 1 || !Array.isArray(baseline.entries)) throw new Error("invalid connector lifecycle baseline");
  const baselineKeys = baseline.entries.map(debtKey);
  if (new Set(baselineKeys).size !== baselineKeys.length || baselineKeys.some((key, index) => index > 0 && baselineKeys[index - 1].localeCompare(key) >= 0)) {
    throw new Error("connector lifecycle baseline entries must be unique and sorted by exact file+kind key");
  }
  const prohibitedProofDebt = baseline.entries.filter(({ file }) => PROOF_PREFIXES.some((prefix) => file.startsWith(prefix)));
  if (prohibitedProofDebt.length) throw new Error(`Microsoft/Postmark paths may not be baselined:\n${prohibitedProofDebt.map(debtKey).join("\n")}`);
  const actual = await scanRepository();
  const current = new Map(actual.map((entry) => [debtKey(entry), entry]));
  const expected = new Set(baselineKeys);
  const additions = [...current].filter(([key]) => !expected.has(key)).map(([, entry]) => entry);
  const stale = [...expected].filter((key) => !current.has(key));
  if (additions.length || stale.length) {
    const lines = ["Provider-local connector lifecycle ownership changed:"];
    for (const item of additions) lines.push(`NEW ${item.file}:${item.line} [${item.kind}]`);
    for (const key of stale) lines.push(`STALE ${key}`);
    throw new Error(lines.join("\n"));
  }
  console.log(`✓ Connector lifecycle ownership is centralized (${baseline.entries.length} exact pre-existing debt entries).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
