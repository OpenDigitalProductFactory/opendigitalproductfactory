import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { currentSchemaVersion, getInstallStateSchema } from "./install-state-schema-registry.mjs";

const MAX_VALIDATION_ERRORS = 20;

function errorCollector() {
  return {
    items: [],
    truncated: false,
    add(message) {
      if (this.items.length < MAX_VALIDATION_ERRORS) this.items.push(message);
      else this.truncated = true;
    },
    get full() { return this.items.length >= MAX_VALIDATION_ERRORS; },
  };
}

function isRfc3339DateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = match.map(Number);
  if (hour > 23 || minute > 59 || second > 60 || (offsetHour !== undefined && (offsetHour > 23 || offsetMinute > 59))) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function isType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  return typeof value === type;
}

function visit(schema, value, path, errors) {
  if (errors.full) { errors.truncated = true; return; }
  if (schema.const !== undefined && !Object.is(value, schema.const)) errors.add(`${path}: const`);
  if (schema.enum && !schema.enum.some((entry) => Object.is(entry, value))) errors.add(`${path}: enum`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => isType(value, type))) { errors.add(`${path}: type`); return; }
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) errors.add(`${path}: minimum`);
  if (typeof value === "string") {
    if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) errors.add(`${path}: pattern`);
    if (schema.format === "date-time" && !isRfc3339DateTime(value)) errors.add(`${path}: date-time format`);
  }
  if (Array.isArray(value)) {
    if (schema.uniqueItems && new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length) errors.add(`${path}: uniqueItems`);
    if (schema.items) {
      let index = 0;
      for (; index < value.length && !errors.full; index += 1) visit(schema.items, value[index], `${path}[${index}]`, errors);
      if (index < value.length) errors.truncated = true;
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.add(`${path}.${key}: required`);
    const properties = schema.properties ?? {};
    for (const [key, entry] of Object.entries(value)) {
      if (errors.full) { errors.truncated = true; break; }
      if (properties[key]) visit(properties[key], entry, `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.add(`${path}.${key}: additionalProperties`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") visit(schema.additionalProperties, entry, `${path}.${key}`, errors);
    }
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((candidate) => { const nested = errorCollector(); visit(candidate, value, path, nested); return nested.items.length === 0; }).length;
    if (matches !== 1) errors.add(`${path}: oneOf`);
  }
}

export async function validateInstallState(value, schemaPath) {
  const schema = schemaPath
    ? JSON.parse(await readFile(schemaPath, "utf8"))
    : getInstallStateSchema(value?.schemaVersion);
  if (!Number.isInteger(value?.schemaVersion)) return { valid: false, errors: ["$.schemaVersion: required integer"] };
  if (value.schemaVersion > currentSchemaVersion) return { valid: false, errors: ["$: install_state_newer_than_runtime"] };
  if (!schema) return { valid: false, errors: ["$.schemaVersion: unsupported"] };
  const errors = errorCollector();
  visit(schema, value, "$", errors);
  if (errors.truncated) errors.items.push("$: validation_errors_truncated");
  return { valid: errors.items.length === 0, errors: errors.items };
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
