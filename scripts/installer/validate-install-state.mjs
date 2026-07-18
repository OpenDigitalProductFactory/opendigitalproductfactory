import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { currentSchemaVersion, getInstallStateSchema } from "./install-state-schema-registry.mjs";

function isType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  return typeof value === type;
}

function visit(schema, value, path, errors) {
  if (schema.const !== undefined && !Object.is(value, schema.const)) errors.push(`${path}: const`);
  if (schema.enum && !schema.enum.some((entry) => Object.is(entry, value))) errors.push(`${path}: enum`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => isType(value, type))) { errors.push(`${path}: type`); return; }
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: minimum`);
  if (typeof value === "string") {
    if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) errors.push(`${path}: pattern`);
    if (schema.format === "date-time" && !Number.isFinite(Date.parse(value))) errors.push(`${path}: date-time format`);
  }
  if (Array.isArray(value)) {
    if (schema.uniqueItems && new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length) errors.push(`${path}: uniqueItems`);
    if (schema.items) value.forEach((entry, index) => visit(schema.items, entry, `${path}[${index}]`, errors));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required`);
    const properties = schema.properties ?? {};
    for (const [key, entry] of Object.entries(value)) {
      if (properties[key]) visit(properties[key], entry, `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: additionalProperties`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") visit(schema.additionalProperties, entry, `${path}.${key}`, errors);
    }
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((candidate) => { const nested = []; visit(candidate, value, path, nested); return nested.length === 0; }).length;
    if (matches !== 1) errors.push(`${path}: oneOf`);
  }
}

export async function validateInstallState(value, schemaPath) {
  const schema = schemaPath
    ? JSON.parse(await readFile(schemaPath, "utf8"))
    : getInstallStateSchema(value?.schemaVersion);
  if (!Number.isInteger(value?.schemaVersion)) return { valid: false, errors: ["$.schemaVersion: required integer"] };
  if (value.schemaVersion > currentSchemaVersion) return { valid: false, errors: ["$: install_state_newer_than_runtime"] };
  if (!schema) return { valid: false, errors: ["$.schemaVersion: unsupported"] };
  const errors = [];
  visit(schema, value, "$", errors);
  return { valid: errors.length === 0, errors };
}

export async function parseAndValidateInstallStateBytes(bytes) {
  try {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const normalized = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
      ? buffer.subarray(3)
      : buffer;
    const value = JSON.parse(normalized.toString("utf8"));
    const result = await validateInstallState(value);
    return { ...result, value: result.valid ? value : undefined, schemaVersion: value?.schemaVersion };
  } catch {
    return { valid: false, errors: ["$: malformed_json"], value: undefined, schemaVersion: undefined };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const statePath = process.argv[2];
  if (!statePath) {
    console.error("usage: node validate-install-state.mjs <install-state.json>");
    process.exitCode = 64;
  } else {
    try {
      const result = await parseAndValidateInstallStateBytes(await readFile(statePath));
      if (!result.valid) {
        console.error(`install-state invalid: ${result.errors.join(", ")}`);
        process.exitCode = 1;
      } else {
        console.log(`install-state valid: ${statePath}`);
      }
    } catch (error) {
      console.error(`install-state invalid: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
