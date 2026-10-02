// Deployment country declaration (BI-06EA3167, design
// docs/superpowers/specs/2026-10-01-deployment-country-declaration-design.md).
//
// An install whose operator opts in tells the organization it federates under
// which country it runs in — the ISO 3166-1 alpha-2 code and nothing else — so
// that organization's market footprint can count self-installed deployments.
// Never coordinates, never an address. Turning the setting off sends a
// `withdrawn` record. Follows the operational-posture contract pattern: a
// versioned type, an allow-list, a denylist checked on receive, and a digest.

import { createHash } from "node:crypto";

import countries from "../data/countries.json" with { type: "json" };
import type { ProjectionContractSpec } from "./projection-serialization";
import { isRecord } from "@dpf/validators";

export const DEPLOYMENT_DECLARATION_ACTIVITIES = ["dpf.deployment-declaration.reported"] as const;
export type DeploymentDeclarationActivity = (typeof DEPLOYMENT_DECLARATION_ACTIVITIES)[number];

export const DEPLOYMENT_DECLARATION_RECORD_TYPE = "deployment-declaration";

export interface DeploymentDeclarationV1 {
  specVersion: "dpf.deployment-declaration/1";
  /** The declaring install — canonical for its own declaration. */
  originInstallationId: string;
  /** Advances on every change so an older delivery never overwrites a newer one. */
  originVersion: number;
  state: "declared" | "withdrawn";
  /** ISO 3166-1 alpha-2; null only when withdrawn. */
  countryCode: string | null;
  declaredAt: string;
  payloadDigest: string;
}

const ISO_ALPHA2 = new Set((countries as Array<{ iso2: string }>).map((country) => country.iso2));

export function isIsoCountryCode(value: unknown): value is string {
  return typeof value === "string" && ISO_ALPHA2.has(value);
}

// Location detail finer than a country must never cross. Checked on receive as a
// double-check of the sender's projection; anything else unknown is tolerated so
// a newer peer's additive field does not 422 an older receiver.
const FORBIDDEN_DECLARATION_FIELDS = new Set([
  "lat",
  "lon",
  "lng",
  "latitude",
  "longitude",
  "coordinates",
  "geometry",
  "address",
  "addressLine1",
  "addressLine2",
  "street",
  "city",
  "postalCode",
  "zip",
  "region",
  "ipAddress",
  "hostname",
]);

export const DEPLOYMENT_DECLARATION_FIELDS = [
  "specVersion",
  "originInstallationId",
  "originVersion",
  "state",
  "countryCode",
  "declaredAt",
  "payloadDigest",
];

export const DEPLOYMENT_DECLARATION_PROJECTION_TEMPLATE: ProjectionContractSpec = {
  includeSlices: ["declaration"],
  excludeSlices: ["address", "coordinates", "estateItems", "hostDetails", "localBacklog"],
  fieldAllowList: { declaration: DEPLOYMENT_DECLARATION_FIELDS },
  retentionClass: "short",
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Canonical content digest over the allow-listed fields; the digest itself is excluded. */
export function computeDeploymentDeclarationDigest(
  value: Omit<DeploymentDeclarationV1, "payloadDigest"> | DeploymentDeclarationV1,
): string {
  const record = value as unknown as Record<string, unknown>;
  const content: Record<string, unknown> = {};
  for (const field of DEPLOYMENT_DECLARATION_FIELDS) {
    if (field !== "payloadDigest" && field in record) content[field] = record[field];
  }
  return `sha256:${createHash("sha256").update(stableJson(content)).digest("hex")}`;
}

export function validateDeploymentDeclarationV1(value: unknown): string[] {
  if (!isRecord(value)) return ["declaration:invalid"];
  const violations: string[] = [];
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_DECLARATION_FIELDS.has(key)) violations.push(`field:not-allowed:${key}`);
  }
  if (value.specVersion !== "dpf.deployment-declaration/1") violations.push("specVersion:unsupported");
  if (typeof value.originInstallationId !== "string" || !value.originInstallationId || value.originInstallationId.length > 160) {
    violations.push("originInstallationId:invalid");
  }
  if (!Number.isSafeInteger(value.originVersion) || Number(value.originVersion) < 1) violations.push("originVersion:invalid");
  if (value.state !== "declared" && value.state !== "withdrawn") violations.push("state:unsupported");
  if (value.state === "declared" ? !isIsoCountryCode(value.countryCode) : value.countryCode !== null) {
    violations.push("countryCode:invalid");
  }
  if (typeof value.declaredAt !== "string" || Number.isNaN(Date.parse(value.declaredAt))) violations.push("declaredAt:invalid");
  if (typeof value.payloadDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.payloadDigest)) {
    violations.push("payloadDigest:invalid");
  } else if (computeDeploymentDeclarationDigest(value as unknown as DeploymentDeclarationV1) !== value.payloadDigest) {
    violations.push("payloadDigest:mismatch");
  }
  return violations;
}
