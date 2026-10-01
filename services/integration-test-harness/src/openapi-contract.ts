// Owned OpenAPI contract runtime for the integration-test harness.
//
// Replaces Stoplight Prism (plan 2026-09-08 M4; design
// docs/superpowers/specs/2026-09-25-harness-owned-contract-validator-design.md).
// The harness needs three things from a vendor's openapi.yaml, and only these:
//   1. validate an incoming request (path, query and header parameters, body);
//   2. answer with the spec's example for the operation's first 2xx response;
//   3. validate that example against its declared schema.
//
// The schema validator covers a closed OpenAPI 3.0 subset. A spec that uses
// anything outside it fails when it LOADS, naming the keyword and location, so
// a newly pinned vendor spec can never be validated silently and partially.

import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

import type { LoadedVendorDefinition } from "./types.js";

export interface ContractRequestInput {
  method: "GET" | "POST";
  pathname: string;
  searchParams: URLSearchParams;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ContractResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface VendorContract {
  mock(input: ContractRequestInput): Promise<ContractResponse>;
}

export interface ContractDiagnostic {
  message: string;
  code?: string;
  path?: string[];
}

export class ContractValidationError extends Error {
  readonly details: ContractDiagnostic[];

  constructor(message: string, details: ContractDiagnostic[] = []) {
    super(message);
    this.name = "ContractValidationError";
    this.details = details;
  }
}

/** Thrown at load time when a spec uses OpenAPI the harness does not support. */
export class UnsupportedContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedContractError";
  }
}

// ── Schema subset ────────────────────────────────────────────────────────────

type SchemaType = "string" | "integer" | "number" | "boolean" | "object" | "array";

export interface Schema {
  type?: SchemaType;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: unknown[];
  nullable?: boolean;
  $ref?: string;
}

const SCHEMA_TYPES = new Set<SchemaType>(["string", "integer", "number", "boolean", "object", "array"]);
// Keywords that carry validation meaning and are enforced below.
const VALIDATING_KEYWORDS = new Set(["type", "properties", "required", "items", "enum", "nullable", "$ref"]);
// Annotation-only keywords: allowed, never validated.
const ANNOTATION_KEYWORDS = new Set(["description", "title", "example", "default", "format"]);

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;
const SUPPORTED_METHODS = new Set(["get", "post"]);
const PARAMETER_LOCATIONS = new Set(["path", "query", "header"]);
const REQUEST_CONTENT_TYPES = new Set(["application/json", "application/x-www-form-urlencoded"]);

type Components = Record<string, Schema>;

/** Resolve a local component $ref ("#/components/schemas/Name"). */
function resolveRef(ref: string, components: Components, where: string): Schema {
  const match = /^#\/components\/schemas\/([^/]+)$/.exec(ref);
  if (!match) {
    throw new UnsupportedContractError(`${where}: only local "#/components/schemas/<Name>" $refs are supported, got "${ref}"`);
  }
  const target = components[match[1]!];
  if (!target) throw new UnsupportedContractError(`${where}: $ref "${ref}" does not resolve`);
  return target;
}

/** Walk a schema once at load time and refuse anything outside the subset. */
export function assertSupportedSchema(schema: unknown, components: Components, where: string, seen = new Set<unknown>()): void {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new UnsupportedContractError(`${where}: schema must be an object`);
  }
  if (seen.has(schema)) return;
  seen.add(schema);
  const s = schema as Record<string, unknown>;
  for (const key of Object.keys(s)) {
    if (!VALIDATING_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) {
      throw new UnsupportedContractError(`${where}: unsupported schema keyword "${key}"`);
    }
  }
  if (s.$ref !== undefined) {
    if (typeof s.$ref !== "string") throw new UnsupportedContractError(`${where}: $ref must be a string`);
    if (Object.keys(s).some((k) => VALIDATING_KEYWORDS.has(k) && k !== "$ref")) {
      throw new UnsupportedContractError(`${where}: $ref cannot be combined with other validating keywords`);
    }
    assertSupportedSchema(resolveRef(s.$ref, components, where), components, `${where} → ${s.$ref}`, seen);
    return;
  }
  if (s.type !== undefined && !SCHEMA_TYPES.has(s.type as SchemaType)) {
    throw new UnsupportedContractError(`${where}: unsupported type "${String(s.type)}"`);
  }
  if (s.enum !== undefined && !Array.isArray(s.enum)) throw new UnsupportedContractError(`${where}: enum must be an array`);
  if (s.required !== undefined && !(Array.isArray(s.required) && s.required.every((r) => typeof r === "string"))) {
    throw new UnsupportedContractError(`${where}: required must be an array of strings`);
  }
  if (s.properties !== undefined) {
    if (typeof s.properties !== "object" || s.properties === null) {
      throw new UnsupportedContractError(`${where}: properties must be an object`);
    }
    for (const [name, child] of Object.entries(s.properties)) {
      assertSupportedSchema(child, components, `${where}.properties.${name}`, seen);
    }
  }
  if (s.items !== undefined) assertSupportedSchema(s.items, components, `${where}.items`, seen);
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Validate a value against a (load-checked) schema; returns every diagnostic. */
export function validateSchema(value: unknown, schema: Schema, components: Components, path: string[] = []): ContractDiagnostic[] {
  if (schema.$ref) return validateSchema(value, resolveRef(schema.$ref, components, path.join(".")), components, path);

  if (value === null) {
    return schema.nullable || schema.type === undefined
      ? []
      : [{ code: "type", path, message: `expected ${schema.type}, received null` }];
  }

  const out: ContractDiagnostic[] = [];
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") out.push({ code: "type", path, message: `expected string, received ${typeOf(value)}` });
      break;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) out.push({ code: "type", path, message: `expected integer, received ${typeOf(value)}` });
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) out.push({ code: "type", path, message: `expected number, received ${typeOf(value)}` });
      break;
    case "boolean":
      if (typeof value !== "boolean") out.push({ code: "type", path, message: `expected boolean, received ${typeOf(value)}` });
      break;
    case "array":
      if (!Array.isArray(value)) out.push({ code: "type", path, message: `expected array, received ${typeOf(value)}` });
      break;
    case "object":
      if (typeOf(value) !== "object") out.push({ code: "type", path, message: `expected object, received ${typeOf(value)}` });
      break;
  }
  if (out.length) return out;

  if (schema.enum && !schema.enum.some((allowed) => allowed === value)) {
    out.push({ code: "enum", path, message: `must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}` });
  }

  if (typeOf(value) === "object") {
    const record = value as Record<string, unknown>;
    for (const name of schema.required ?? []) {
      if (!(name in record) || record[name] === undefined) {
        out.push({ code: "required", path: [...path, name], message: `missing required property "${name}"` });
      }
    }
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      if (record[name] !== undefined) out.push(...validateSchema(record[name], child, components, [...path, name]));
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => out.push(...validateSchema(item, schema.items!, components, [...path, String(index)])));
  }
  return out;
}

// ── Operations ───────────────────────────────────────────────────────────────

interface Parameter {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  schema: Schema;
}

interface Operation {
  method: string;
  template: string;
  segments: string[];
  parameters: Parameter[];
  requestBody: { required: boolean; content: Record<string, Schema | undefined> } | null;
  response: { status: number; contentType: string; example: unknown; schema: Schema | undefined };
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new UnsupportedContractError(`${where}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function readParameters(raw: unknown, components: Components, where: string): Parameter[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new UnsupportedContractError(`${where}.parameters: expected an array`);
  return raw.map((entry, index) => {
    const p = asRecord(entry, `${where}.parameters[${index}]`);
    const at = `${where}.parameters[${index}]`;
    if (p.$ref !== undefined) throw new UnsupportedContractError(`${at}: parameter $refs are not supported`);
    if (typeof p.name !== "string") throw new UnsupportedContractError(`${at}: name is required`);
    if (!PARAMETER_LOCATIONS.has(String(p.in))) throw new UnsupportedContractError(`${at}: unsupported location "${String(p.in)}"`);
    const schema = (p.schema ?? {}) as Schema;
    assertSupportedSchema(schema, components, `${at}.schema`);
    const resolved = schema.$ref ? resolveRef(schema.$ref, components, at) : schema;
    if (resolved.type === "object" || resolved.type === "array") {
      throw new UnsupportedContractError(`${at}: ${resolved.type} parameters are not supported`);
    }
    return { name: p.name, in: p.in as Parameter["in"], required: p.in === "path" || p.required === true, schema };
  });
}

function readOperation(template: string, method: string, pathItem: Record<string, unknown>, components: Components): Operation {
  const where = `paths.${template}.${method}`;
  const op = asRecord(pathItem[method], where);

  const byKey = new Map<string, Parameter>();
  for (const p of readParameters(pathItem.parameters, components, `paths.${template}`)) byKey.set(`${p.in}:${p.name}`, p);
  for (const p of readParameters(op.parameters, components, where)) byKey.set(`${p.in}:${p.name}`, p);

  let requestBody: Operation["requestBody"] = null;
  if (op.requestBody !== undefined) {
    const rb = asRecord(op.requestBody, `${where}.requestBody`);
    const content: Record<string, Schema | undefined> = {};
    for (const [type, media] of Object.entries(asRecord(rb.content, `${where}.requestBody.content`))) {
      if (!REQUEST_CONTENT_TYPES.has(type)) {
        throw new UnsupportedContractError(`${where}.requestBody: unsupported content type "${type}"`);
      }
      const schema = asRecord(media ?? {}, `${where}.requestBody.content.${type}`).schema as Schema | undefined;
      if (schema !== undefined) assertSupportedSchema(schema, components, `${where}.requestBody.content.${type}.schema`);
      content[type] = schema;
    }
    requestBody = { required: rb.required === true, content };
  }

  const responses = asRecord(op.responses, `${where}.responses`);
  const success = Object.keys(responses)
    .filter((code) => /^2\d\d$/.test(code))
    .sort()[0];
  if (!success) throw new UnsupportedContractError(`${where}: no 2xx response to serve`);
  const responseContent = asRecord(asRecord(responses[success], `${where}.responses.${success}`).content, `${where}.responses.${success}.content`);
  const contentType = "application/json" in responseContent ? "application/json" : Object.keys(responseContent)[0];
  if (!contentType) throw new UnsupportedContractError(`${where}.responses.${success}: no content`);
  const media = asRecord(responseContent[contentType], `${where}.responses.${success}.content.${contentType}`);
  if (media.examples !== undefined) {
    throw new UnsupportedContractError(`${where}.responses.${success}: use a single "example", not "examples"`);
  }
  if (!("example" in media)) {
    throw new UnsupportedContractError(`${where}.responses.${success}: an "example" is required; the harness serves examples, it never invents data`);
  }
  const schema = media.schema as Schema | undefined;
  if (schema !== undefined) assertSupportedSchema(schema, components, `${where}.responses.${success}.content.${contentType}.schema`);

  return {
    method,
    template,
    segments: template.split("/").filter(Boolean),
    parameters: [...byKey.values()],
    requestBody,
    response: { status: Number(success), contentType, example: media.example, schema },
  };
}

/** Parse and load-check an OpenAPI 3.0 document into servable operations. */
export function loadContractDocument(source: string, where = "openapi"): { operations: Operation[]; components: Components } {
  const doc = asRecord(parseYaml(source), where);
  if (typeof doc.openapi !== "string" || !doc.openapi.startsWith("3.0")) {
    throw new UnsupportedContractError(`${where}: only OpenAPI 3.0.x documents are supported`);
  }
  const components = (asRecord(doc.components ?? {}, `${where}.components`).schemas ?? {}) as Components;
  for (const [name, schema] of Object.entries(components)) {
    assertSupportedSchema(schema, components, `${where}.components.schemas.${name}`);
  }
  const operations: Operation[] = [];
  for (const [template, rawItem] of Object.entries(asRecord(doc.paths, `${where}.paths`))) {
    const pathItem = asRecord(rawItem, `${where}.paths.${template}`);
    for (const method of HTTP_METHODS) {
      if (pathItem[method] === undefined) continue;
      if (!SUPPORTED_METHODS.has(method)) {
        throw new UnsupportedContractError(`${where}.paths.${template}: method "${method}" is not supported`);
      }
      operations.push(readOperation(template, method, pathItem, components));
    }
  }
  return { operations, components };
}

function matchOperation(operations: Operation[], method: string, pathname: string): { op: Operation; pathParams: Record<string, string> } | null {
  const actual = pathname.split("/").filter(Boolean);
  for (const op of operations) {
    if (op.method !== method || op.segments.length !== actual.length) continue;
    const pathParams: Record<string, string> = {};
    const ok = op.segments.every((segment, i) => {
      if (segment.startsWith("{") && segment.endsWith("}")) {
        pathParams[segment.slice(1, -1)] = decodeURIComponent(actual[i]!);
        return true;
      }
      return segment === actual[i];
    });
    if (ok) return { op, pathParams };
  }
  return null;
}

/** Coerce a raw string parameter to its declared scalar type, as Prism did. */
function coerceParameter(raw: string, schema: Schema, components: Components): unknown {
  const resolved = schema.$ref ? resolveRef(schema.$ref, components, "parameter") : schema;
  switch (resolved.type) {
    case "integer":
    case "number": {
      const n = raw.trim() === "" ? Number.NaN : Number(raw);
      return Number.isNaN(n) ? raw : n;
    }
    case "boolean":
      return raw === "true" ? true : raw === "false" ? false : raw;
    default:
      return raw;
  }
}

function parseBody(raw: unknown, contentType: string): unknown {
  if (typeof raw !== "string") return raw;
  if (contentType === "application/x-www-form-urlencoded") return Object.fromEntries(new URLSearchParams(raw));
  try {
    return JSON.parse(raw);
  } catch {
    throw new ContractValidationError("Contract validation failed", [{ code: "body", path: ["body"], message: "request body is not valid JSON" }]);
  }
}

export function validateRequest(op: Operation, pathParams: Record<string, string>, input: ContractRequestInput, components: Components): ContractDiagnostic[] {
  const out: ContractDiagnostic[] = [];
  const headers = Object.fromEntries(Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));

  for (const p of op.parameters) {
    const raw = p.in === "path" ? pathParams[p.name] : p.in === "query" ? input.searchParams.get(p.name) ?? undefined : headers[p.name.toLowerCase()];
    if (raw === undefined) {
      if (p.required) out.push({ code: "required", path: [p.in, p.name], message: `missing required ${p.in} parameter "${p.name}"` });
      continue;
    }
    out.push(...validateSchema(coerceParameter(raw, p.schema, components), p.schema, components, [p.in, p.name]));
  }

  if (op.requestBody) {
    const empty = input.body === undefined || input.body === "";
    if (empty) {
      if (op.requestBody.required) out.push({ code: "required", path: ["body"], message: "request body is required" });
    } else {
      const declared = (headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      if (!(declared in op.requestBody.content)) {
        out.push({ code: "content-type", path: ["headers", "content-type"], message: `content type "${declared || "(none)"}" is not accepted; expected ${Object.keys(op.requestBody.content).join(" or ")}` });
      } else {
        const schema = op.requestBody.content[declared];
        if (schema) out.push(...validateSchema(parseBody(input.body, declared), schema, components, ["body"]));
      }
    }
  }
  return out;
}

export function createContractFromSource(source: string, where = "openapi"): VendorContract {
  const { operations, components } = loadContractDocument(source, where);
  return {
    async mock(input: ContractRequestInput): Promise<ContractResponse> {
      const matched = matchOperation(operations, input.method.toLowerCase(), input.pathname);
      if (!matched) {
        throw new ContractValidationError("Contract validation failed", [
          { code: "route", message: `no ${input.method} operation matches ${input.pathname}` },
        ]);
      }
      const { op, pathParams } = matched;
      const diagnostics = validateRequest(op, pathParams, input, components);
      if (op.response.schema) diagnostics.push(...validateSchema(op.response.example, op.response.schema, components, ["response"]));
      if (diagnostics.length > 0) throw new ContractValidationError("Contract validation failed", diagnostics);
      return {
        status: op.response.status,
        headers: { "content-type": op.response.contentType },
        body: structuredClone(op.response.example),
      };
    },
  };
}

export async function createVendorContract(vendor: LoadedVendorDefinition): Promise<VendorContract> {
  return createContractFromSource(await readFile(vendor.openapiPath, "utf8"), vendor.openapiPath);
}
