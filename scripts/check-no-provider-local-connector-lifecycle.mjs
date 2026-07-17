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
const RAW_METHODS = new Set(["$executeRaw", "$executeRawUnsafe", "$queryRaw", "$queryRawUnsafe"]);
const CONNECTION_STATES = new Set(["unconfigured", "connected", "error", "degraded"]);
const CANONICAL_STORE = "apps/web/lib/integrations/kernel/credential-store.ts";
const KERNEL_PREFIX = "apps/web/lib/integrations/kernel/";
const PROVIDER_ROOT = /\/(?:integrate|integrations|providers|marketing\/channels)\//;
const PROVIDER_IMPORT = /(?:^|\/)(?:integrate|integrations|providers|marketing\/channels)(?:\/|$)/;
const PROOF_PREFIXES = [
  "apps/web/components/integrations/EmailPostmarkConnectPanel",
  "apps/web/components/integrations/Microsoft365CommunicationsConnectPanel",
  "apps/web/lib/integrations/connectors/microsoft365-communications",
  "apps/web/lib/integrations/connectors/email-postmark",
  "apps/web/lib/integrate/microsoft365-communications/",
  "apps/web/lib/marketing/channels/email-postmark/",
  "apps/web/app/api/integrations/email-postmark/",
];
const SQL_MUTATION = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE(?:\s+TABLE)?)\s+(?:["'`]?\w+["'`]?\s*\.\s*)?["'`]?IntegrationCredential\b/i;

function normalized(path) { return path.replaceAll("\\", "/"); }
function isTestOrGenerated(file) {
  return /(?:^|\/)(?:__tests__|generated)(?:\/|$)/.test(file)
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)
    || /\.generated\.[cm]?[jt]sx?$/.test(file);
}
function propertyName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
  return null;
}
function bindingPropertyName(element) {
  const property = element.propertyName;
  if (property && (ts.isIdentifier(property) || ts.isStringLiteralLike(property))) return property.text;
  if (property && ts.isComputedPropertyName(property) && ts.isStringLiteralLike(property.expression)) return property.expression.text;
  return ts.isIdentifier(element.name) ? element.name.text : null;
}
function staticPropertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isComputedPropertyName(node) && ts.isStringLiteralLike(node.expression)) return node.expression.text;
  return null;
}
function lineOf(sourceFile, node) { return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1; }
function isLowLevelTokenPrimitive(file) {
  return /(?:^|\/)(?:token-client|oauth-token|refresh-token-client)\.ts$/.test(file)
    || file === "apps/web/lib/integrate/oauth/refresh-token.ts";
}
function declarationName(node) {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  return null;
}
function identifierName(node) { return ts.isIdentifier(node) ? node.text : null; }
function relevantStateName(name) { return /(?:connection|connector|integration|setup|credential)/i.test(name); }
function relevantRefreshName(name) {
  return /(?:refresh|renew|rotate)/i.test(name) && /(?:oauth|token|credential|session|auth)/i.test(name);
}
function templateText(node) {
  if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((span) => ` ? ${span.literal.text}`).join("");
  return null;
}
function unwrapExpression(node) {
  while (node && (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)
    || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isPartiallyEmittedExpression(node))) node = node.expression;
  return node;
}

export function scanSource(source, file) {
  file = normalized(file);
  if (isTestOrGenerated(file)) return [];
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const nodes = [];
  const importsProvider = sourceFile.statements.some((statement) => ts.isImportDeclaration(statement)
    && ts.isStringLiteralLike(statement.moduleSpecifier) && PROVIDER_IMPORT.test(statement.moduleSpecifier.text));
  const providerSurface = PROVIDER_ROOT.test(file) || importsProvider;
  const credentialDelegates = new Set(["integrationCredential"]);
  const delegateCarriers = new Map();
  const mutationFunctions = new Set();
  const rawFunctions = new Set();
  const sqlValues = new Map();
  const stateAliases = new Map();
  const collect = (node) => { nodes.push(node); ts.forEachChild(node, collect); };
  collect(sourceFile);

  const delegateExpression = (expression) => {
    expression = unwrapExpression(expression);
    if (!expression) return false;
    if (ts.isIdentifier(expression)) return credentialDelegates.has(expression.text);
    if (propertyName(expression) === "integrationCredential") return true;
    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      const owner = unwrapExpression(expression.expression);
      const property = propertyName(expression);
      return ts.isIdentifier(owner) && property !== null && delegateCarriers.get(owner.text)?.has(property);
    }
    return false;
  };
  const resolveSql = (expression, seen = new Set()) => {
    expression = unwrapExpression(expression);
    if (!expression) return null;
    const literal = templateText(expression);
    if (literal !== null) return new Set([literal]);
    if (ts.isIdentifier(expression)) {
      if (seen.has(expression.text)) return null;
      seen.add(expression.text);
      return sqlValues.get(expression.text) ?? null;
    }
    if (ts.isTaggedTemplateExpression(expression) && propertyName(expression.tag) === "sql") {
      const sql = templateText(expression.template); return sql === null ? null : new Set([sql]);
    }
    if (ts.isCallExpression(expression) && propertyName(expression.expression) === "sql") return resolveSql(expression.arguments[0], seen);
    return null;
  };

  // Fixed point: later assignments and chained aliases are intentionally supported.
  let changed = true;
  while (changed) {
    changed = false;
    const add = (set, value) => { if (value && !set.has(value)) { set.add(value); changed = true; } };
    for (const node of nodes) {
      let target = null; let value = null;
      if (ts.isVariableDeclaration(node)) { target = node.name; value = node.initializer; }
      else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) { target = node.left; value = node.right; }
      if (!target || !value) continue;
      target = unwrapExpression(target);
      if (ts.isIdentifier(target)) {
        if (delegateExpression(value)) add(credentialDelegates, target.text);
        const unwrappedValue = unwrapExpression(value);
        if (unwrappedValue && ts.isObjectLiteralExpression(unwrappedValue)) {
          const properties = delegateCarriers.get(target.text) ?? new Set();
          for (const property of unwrappedValue.properties) {
            if (ts.isPropertyAssignment(property)) {
              const name = staticPropertyName(property.name);
              if (name && delegateExpression(property.initializer) && !properties.has(name)) { properties.add(name); changed = true; }
            } else if (ts.isShorthandPropertyAssignment(property) && credentialDelegates.has(property.name.text) && !properties.has(property.name.text)) {
              properties.add(property.name.text); changed = true;
            }
          }
          if (properties.size) delegateCarriers.set(target.text, properties);
        }
        if (unwrappedValue && ts.isIdentifier(unwrappedValue) && delegateCarriers.has(unwrappedValue.text)) {
          const prior = delegateCarriers.get(target.text) ?? new Set();
          const next = new Set([...prior, ...delegateCarriers.get(unwrappedValue.text)]);
          if (next.size !== prior.size) { delegateCarriers.set(target.text, next); changed = true; }
        }
        if (unwrappedValue && ts.isIdentifier(unwrappedValue) && mutationFunctions.has(unwrappedValue.text)) add(mutationFunctions, target.text);
        if (unwrappedValue && (ts.isPropertyAccessExpression(unwrappedValue) || ts.isElementAccessExpression(unwrappedValue)) && delegateExpression(unwrappedValue.expression) && MUTATIONS.has(propertyName(unwrappedValue))) add(mutationFunctions, target.text);
        if (unwrappedValue && ts.isIdentifier(unwrappedValue) && rawFunctions.has(unwrappedValue.text)) add(rawFunctions, target.text);
        if (unwrappedValue && (ts.isPropertyAccessExpression(unwrappedValue) || ts.isElementAccessExpression(unwrappedValue)) && RAW_METHODS.has(propertyName(unwrappedValue))) add(rawFunctions, target.text);
        const sql = resolveSql(value);
        if (sql !== null) {
          const prior = sqlValues.get(target.text) ?? new Set();
          if ([...sql].some((text) => !prior.has(text))) { sqlValues.set(target.text, new Set([...prior, ...sql])); changed = true; }
        }
      } else if (ts.isObjectBindingPattern(target)) {
        const carrier = ts.isIdentifier(unwrapExpression(value)) ? delegateCarriers.get(unwrapExpression(value).text) : null;
        for (const element of target.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const property = bindingPropertyName(element);
          if (property === "integrationCredential") add(credentialDelegates, element.name.text);
          if (property && carrier?.has(property)) add(credentialDelegates, element.name.text);
          if (delegateExpression(value) && MUTATIONS.has(property)) add(mutationFunctions, element.name.text);
          if (RAW_METHODS.has(property)) add(rawFunctions, element.name.text);
        }
      } else if (ts.isObjectLiteralExpression(target)) {
        const carrierValue = unwrapExpression(value);
        const carrier = ts.isIdentifier(carrierValue) ? delegateCarriers.get(carrierValue.text) : null;
        if (!carrier) continue;
        for (const property of target.properties) {
          if (ts.isShorthandPropertyAssignment(property) && carrier.has(property.name.text)) add(credentialDelegates, property.name.text);
          if (ts.isPropertyAssignment(property)) {
            const sourceProperty = staticPropertyName(property.name);
            const assigned = ts.isIdentifier(property.initializer)
              ? property.initializer
              : ts.isBinaryExpression(property.initializer) && property.initializer.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(property.initializer.left)
                ? property.initializer.left : null;
            if (sourceProperty && assigned && carrier.has(sourceProperty)) add(credentialDelegates, assigned.text);
          }
        }
      }
    }
  }

  const literalStates = (type, seen = new Set()) => {
    if (ts.isLiteralTypeNode(type) && ts.isStringLiteralLike(type.literal) && CONNECTION_STATES.has(type.literal.text)) return new Set([type.literal.text]);
    if (ts.isUnionTypeNode(type)) return new Set(type.types.flatMap((item) => [...literalStates(item, seen)]));
    if (ts.isTypeLiteralNode(type)) return new Set(type.members.filter(ts.isPropertySignature).filter((member) => member.type).flatMap((member) => [...literalStates(member.type, new Set(seen))]));
    if (ts.isIntersectionTypeNode(type)) return new Set(type.types.flatMap((item) => [...literalStates(item, new Set(seen))]));
    if (ts.isArrayTypeNode(type)) return literalStates(type.elementType, seen);
    if (ts.isTypeOperatorNode(type)) return literalStates(type.type, seen);
    if (ts.isIndexedAccessTypeNode(type)) return new Set([...literalStates(type.objectType, new Set(seen)), ...literalStates(type.indexType, new Set(seen))]);
    if (ts.isMappedTypeNode(type) && type.type) return literalStates(type.type, seen);
    if (ts.isConditionalTypeNode(type)) return new Set([...literalStates(type.trueType, new Set(seen)), ...literalStates(type.falseType, new Set(seen))]);
    if (ts.isTupleTypeNode(type)) return new Set(type.elements.flatMap((item) => [...literalStates(item, new Set(seen))]));
    if (ts.isParenthesizedTypeNode(type)) return literalStates(type.type, seen);
    if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && !seen.has(type.typeName.text)) {
      seen.add(type.typeName.text);
      return new Set([...(stateAliases.get(type.typeName.text) ?? []), ...type.typeArguments?.flatMap((item) => [...literalStates(item, new Set(seen))]) ?? []]);
    }
    if (ts.isTypeQueryNode(type) && ts.isIdentifier(type.exprName)) return stateAliases.get(type.exprName.text) ?? new Set();
    return new Set();
  };
  const valueStates = (expression, seen = new Set()) => {
    expression = unwrapExpression(expression);
    const literal = templateText(expression);
    if (literal !== null && CONNECTION_STATES.has(literal)) return new Set([literal]);
    if (expression && ts.isIdentifier(expression) && !seen.has(expression.text)) { seen.add(expression.text); return stateAliases.get(expression.text) ?? new Set(); }
    if (expression && ts.isObjectLiteralExpression(expression)) return new Set(expression.properties.filter(ts.isPropertyAssignment).flatMap((property) => [...valueStates(property.initializer, new Set(seen))]));
    if (expression && ts.isArrayLiteralExpression(expression)) return new Set(expression.elements.flatMap((element) => [...valueStates(element, new Set(seen))]));
    return new Set();
  };
  const heritageStates = (node) => new Set((node.heritageClauses ?? []).flatMap((clause) => clause.types.flatMap((heritage) => {
    const inherited = ts.isIdentifier(heritage.expression) ? stateAliases.get(heritage.expression.text) ?? new Set() : new Set();
    return [...inherited, ...(heritage.typeArguments ?? []).flatMap((type) => [...literalStates(type)])];
  })));
  if (providerSurface) {
    // Resolve local union aliases to a fixed point before reporting declarations.
    for (let pass = 0; pass < nodes.length; pass++) {
      let grew = false;
      for (const node of nodes) {
        let name = null; let states = new Set();
        if (ts.isTypeAliasDeclaration(node)) { name = node.name.text; states = literalStates(node.type, new Set([name])); }
        else if (ts.isInterfaceDeclaration(node)) { name = node.name.text; states = new Set([...node.members.filter(ts.isPropertySignature).filter((member) => member.type).flatMap((member) => [...literalStates(member.type)]), ...heritageStates(node)]); }
        else if (ts.isEnumDeclaration(node)) { name = node.name.text; states = new Set(node.members.map((member) => member.initializer).filter(Boolean).flatMap((value) => [...valueStates(value)])); }
        else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) { name = node.name.text; states = valueStates(node.initializer); }
        if (name) {
          const prior = stateAliases.get(name) ?? new Set();
          if ([...states].some((state) => !prior.has(state))) { stateAliases.set(name, new Set([...prior, ...states])); grew = true; }
        }
      }
      if (!grew) break;
    }
  }

  const violations = [];
  const add = (kind, node) => violations.push({ file, kind, line: lineOf(sourceFile, node) });
  for (const node of nodes) {
    if (file !== CANONICAL_STORE && ts.isCallExpression(node)) {
      const calleeName = identifierName(node.expression);
      const method = propertyName(node.expression);
      if ((calleeName && mutationFunctions.has(calleeName))
        || (method && MUTATIONS.has(method) && delegateExpression(node.expression.expression))) add("integration-credential-mutation", node);
      const isRaw = (calleeName && rawFunctions.has(calleeName)) || (method && RAW_METHODS.has(method));
      if (isRaw) {
        const sql = resolveSql(node.arguments[0]);
        if (sql === null) add("integration-credential-dynamic-raw-sql", node);
        else if ([...sql].some((text) => SQL_MUTATION.test(text))) add("integration-credential-raw-sql", node);
      }
    }
    if (file !== CANONICAL_STORE && ts.isTaggedTemplateExpression(node)) {
      const tagName = identifierName(node.tag);
      const method = propertyName(node.tag);
      if ((tagName && rawFunctions.has(tagName)) || (method && RAW_METHODS.has(method))) {
        const sql = templateText(node.template);
        if (sql === null) add("integration-credential-dynamic-raw-sql", node);
        else if (SQL_MUTATION.test(sql)) add("integration-credential-raw-sql", node);
      }
    }
    if (providerSurface && !file.startsWith(KERNEL_PREFIX)) {
      if (ts.isTypeAliasDeclaration(node) && relevantStateName(node.name.text) && (stateAliases.get(node.name.text)?.size ?? 0) >= 2) add("provider-connection-state", node);
      if (ts.isInterfaceDeclaration(node) && relevantStateName(node.name.text)) {
        const states = stateAliases.get(node.name.text) ?? new Set();
        if (states.size >= 2) add("provider-connection-state", node);
      }
      if (ts.isEnumDeclaration(node) && relevantStateName(node.name.text)) {
        const states = new Set(node.members.map((member) => member.initializer).filter(Boolean).map(templateText).filter((value) => CONNECTION_STATES.has(value)));
        if (states.size >= 2) add("provider-connection-state", node);
      }
      const initializer = ts.isVariableDeclaration(node) ? unwrapExpression(node.initializer) : null;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && relevantStateName(node.name.text) && initializer && ts.isObjectLiteralExpression(initializer)) {
        const states = new Set(initializer.properties.filter(ts.isPropertyAssignment).map((property) => templateText(property.initializer)).filter((value) => CONNECTION_STATES.has(value)));
        if (states.size >= 2) add("provider-connection-state", node);
      }
      if (!isLowLevelTokenPrimitive(file)) {
        const name = declarationName(node);
        if (name && relevantRefreshName(name)) add("provider-refresh-orchestration", node);
      }
    }
  }
  return violations.sort((a, b) => a.kind.localeCompare(b.kind) || a.line - b.line);
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
export function compareDebt(baseline, actual) {
  const actualCounts = new Map();
  for (const entry of actual) actualCounts.set(debtKey(entry), (actualCounts.get(debtKey(entry)) ?? 0) + 1);
  const baselineMap = new Map(baseline.map((entry) => [debtKey(entry), entry]));
  const growth = [];
  const improvements = [];
  for (const entry of baseline) {
    const count = actualCounts.get(debtKey(entry)) ?? 0;
    if (count > entry.count) growth.push({ ...entry, actual: count });
    else if (count < entry.count) improvements.push({ ...entry, actual: count });
  }
  for (const [key, count] of actualCounts) if (!baselineMap.has(key)) {
    const [file, kind] = key.split("::"); growth.push({ file, kind, count: 0, actual: count });
  }
  return { growth, improvements };
}

export async function main() {
  const baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
  if (baseline.version !== 2 || !Array.isArray(baseline.entries)) throw new Error("invalid connector lifecycle baseline");
  const baselineKeys = baseline.entries.map(debtKey);
  if (baseline.entries.some((entry) => !Number.isInteger(entry.count) || entry.count < 1)
    || new Set(baselineKeys).size !== baselineKeys.length
    || baselineKeys.some((key, index) => index > 0 && baselineKeys[index - 1].localeCompare(key) >= 0)) {
    throw new Error("connector lifecycle baseline entries must have positive counts and be unique/sorted by normalized file+kind key");
  }
  const prohibitedProofDebt = baseline.entries.filter(({ file }) => PROOF_PREFIXES.some((prefix) => file.startsWith(prefix)));
  if (prohibitedProofDebt.length) throw new Error(`Microsoft/Postmark paths may not be baselined:\n${prohibitedProofDebt.map(debtKey).join("\n")}`);
  const actual = await scanRepository();
  const { growth, improvements } = compareDebt(baseline.entries, actual);
  if (growth.length || improvements.length) {
    const lines = ["Provider-local connector lifecycle debt changed:"];
    for (const item of growth) lines.push(`GROWTH ${item.file} [${item.kind}] ${item.count} -> ${item.actual}`);
    for (const item of improvements) lines.push(`IMPROVEMENT/STALE ${item.file} [${item.kind}] ${item.count} -> ${item.actual}; tighten the baseline`);
    throw new Error(lines.join("\n"));
  }
  const total = baseline.entries.reduce((sum, entry) => sum + entry.count, 0);
  console.log(`✓ Connector lifecycle ownership is centralized (${total} occurrences across ${baseline.entries.length} exact debt keys).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
