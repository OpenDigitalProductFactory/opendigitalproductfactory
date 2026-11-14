// Guidance snapshot (BI-1B165D02; design
// docs/superpowers/specs/2026-10-27-production-authority-development-companion-design.md §4.1–4.3,
// DI-5B370FD391FD).
//
// The production authority publishes, for each attested development companion of
// its estate, the organization-specific doctrine the companion decides under: its
// active WWWD profile and the approved, promoted material that profile resolves.
// The corpus that ships in every image (kernel, profession corpus, user guide) is
// not carried.
//
// Signing follows the OPA bundle model: a JWS over a manifest of content hashes,
// so the signature covers the content without re-encoding it. Freshness follows
// TUF: an explicit expiry and a version that must advance past the one held.
//
// This module is pure: shape, manifest hashes and the signing input. Signing and
// verifying with the installation key live beside that key, in
// apps/web/lib/federation/guidance-snapshot.ts.

import { createHash } from "node:crypto";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { isRecord } from "@dpf/validators";

export const GUIDANCE_SNAPSHOT_RECORD_TYPE = "guidance-snapshot";
export const GUIDANCE_SNAPSHOT_ACTIVITIES = ["dpf.guidance-snapshot.published"] as const;
export type GuidanceSnapshotActivity = (typeof GUIDANCE_SNAPSHOT_ACTIVITIES)[number];

/** Design §4.3: a companion uses its last valid snapshot for fourteen days. */
export const GUIDANCE_SNAPSHOT_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

/** Bounds a snapshot's material so one record cannot exhaust a receiver. */
export const GUIDANCE_SNAPSHOT_MAX_MATERIALS = 2000;

const DID_RE = /^did_[a-f0-9]{64}$/;
const SHA256_RE = /^sha256:[a-f0-9]{64}$/;
const DIRECTIONS = new Set(["support", "oppose", "neutral"]);
const FRESHNESS = new Set(["current", "stale", "superseded", "contradicted"]);
const GRADES = new Set(["A", "B", "C", "D"]);

export interface GuidanceProfileV1 {
  profileId: string;
  name: string;
  /** Where the authority's resolver continues when this profile has no applicable
   *  material; the profiles on that chain ship in every image. */
  fallbackProfileId: string | null;
  autonomyPolicy: Record<string, unknown> | null;
  defaultResolver: Record<string, unknown> | null;
}

/** One approved, promoted perspective material row as the authority's resolver uses it. */
export interface GuidanceMaterialV1 {
  materialId: string;
  sourceType: string;
  sourceRef: Record<string, unknown>;
  summary: string;
  domainClass: string;
  direction: "support" | "oppose" | "neutral";
  domains: string[];
  freshness: "current" | "stale" | "superseded" | "contradicted";
  evidenceGrade: "A" | "B" | "C" | "D";
  confidenceWeight: number;
  lastValidatedAt: string | null;
}

export interface GuidanceWwwdV1 {
  profile: GuidanceProfileV1;
  materials: GuidanceMaterialV1[];
}

export interface GuidanceSnapshotMetaV1 {
  authorityInstallationDid: string;
  /** The authority's Ed25519 key, SPKI DER base64. Its fingerprint is the authority DID. */
  authoritySigningPublicKey: string;
  companionInstallationDid: string;
  /** Advances on every issue; a receiver refuses anything not above what it holds. */
  version: number;
  issuedAt: string;
  expiresAt: string;
}

export interface GuidanceSnapshotV1 {
  specVersion: "dpf.guidance-snapshot/1";
  meta: GuidanceSnapshotMetaV1;
  wwwd: GuidanceWwwdV1;
  /** Content hashes by part; the signature covers these and the meta. */
  manifest: Record<string, string>;
  /** Compact JWS (EdDSA) over {@link guidanceSnapshotSigningPayload}. */
  signature: string;
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

/** The manifest of content hashes for a snapshot's carried parts. */
export function computeGuidanceSnapshotManifest(wwwd: GuidanceWwwdV1): Record<string, string> {
  return {
    "wwwd/profile": sha256(wwwd.profile),
    "wwwd/materials": sha256(wwwd.materials),
  };
}

/** Content digest over everything an issue would carry, timing excluded: unchanged content, same digest. */
export function guidanceSnapshotContentDigest(wwwd: GuidanceWwwdV1): string {
  return sha256(computeGuidanceSnapshotManifest(wwwd));
}

/** The exact bytes the JWS signs: the meta and the manifest, canonically serialized. */
export function guidanceSnapshotSigningPayload(snapshot: Pick<GuidanceSnapshotV1, "meta" | "manifest">): string {
  return canonicalJson({ meta: snapshot.meta, manifest: snapshot.manifest });
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function materialViolations(value: unknown, index: number): string[] {
  const at = `wwwd.materials[${index}]`;
  if (!isRecord(value)) return [`${at}:invalid`];
  const out: string[] = [];
  if (!boundedString(value.materialId, 200)) out.push(`${at}.materialId:invalid`);
  if (!boundedString(value.sourceType, 120)) out.push(`${at}.sourceType:invalid`);
  if (!isRecord(value.sourceRef)) out.push(`${at}.sourceRef:invalid`);
  if (typeof value.summary !== "string" || value.summary.length > 8000) out.push(`${at}.summary:invalid`);
  if (!boundedString(value.domainClass, 80)) out.push(`${at}.domainClass:invalid`);
  if (!DIRECTIONS.has(String(value.direction))) out.push(`${at}.direction:invalid`);
  if (!Array.isArray(value.domains) || value.domains.some((domain) => typeof domain !== "string")) {
    out.push(`${at}.domains:invalid`);
  }
  if (!FRESHNESS.has(String(value.freshness))) out.push(`${at}.freshness:invalid`);
  if (!GRADES.has(String(value.evidenceGrade))) out.push(`${at}.evidenceGrade:invalid`);
  if (typeof value.confidenceWeight !== "number" || !Number.isFinite(value.confidenceWeight)
    || value.confidenceWeight < 0 || value.confidenceWeight > 1) {
    out.push(`${at}.confidenceWeight:invalid`);
  }
  if (value.lastValidatedAt !== null && !isIso(value.lastValidatedAt)) out.push(`${at}.lastValidatedAt:invalid`);
  return out;
}

/**
 * Shape and content-hash check. A changed part shows as a manifest mismatch; the
 * signature over the manifest is checked by the caller that holds the key.
 */
export function validateGuidanceSnapshotV1(value: unknown): string[] {
  if (!isRecord(value)) return ["snapshot:invalid"];
  const violations: string[] = [];
  if (value.specVersion !== "dpf.guidance-snapshot/1") violations.push("specVersion:unsupported");

  const meta = value.meta;
  if (!isRecord(meta)) {
    violations.push("meta:invalid");
  } else {
    if (typeof meta.authorityInstallationDid !== "string" || !DID_RE.test(meta.authorityInstallationDid)) {
      violations.push("meta.authorityInstallationDid:invalid");
    }
    if (!boundedString(meta.authoritySigningPublicKey, 200)) violations.push("meta.authoritySigningPublicKey:invalid");
    if (typeof meta.companionInstallationDid !== "string" || !DID_RE.test(meta.companionInstallationDid)) {
      violations.push("meta.companionInstallationDid:invalid");
    }
    if (!Number.isSafeInteger(meta.version) || Number(meta.version) < 1) violations.push("meta.version:invalid");
    if (!isIso(meta.issuedAt)) violations.push("meta.issuedAt:invalid");
    if (!isIso(meta.expiresAt)) violations.push("meta.expiresAt:invalid");
    else if (isIso(meta.issuedAt) && Date.parse(meta.expiresAt) <= Date.parse(meta.issuedAt)) {
      violations.push("meta.expiresAt:not-after-issuedAt");
    }
  }

  const wwwd = value.wwwd;
  let contentValid = false;
  if (!isRecord(wwwd) || !isRecord(wwwd.profile) || !Array.isArray(wwwd.materials)) {
    violations.push("wwwd:invalid");
  } else {
    const profile = wwwd.profile;
    if (!boundedString(profile.profileId, 200)) violations.push("wwwd.profile.profileId:invalid");
    if (typeof profile.name !== "string" || profile.name.length > 400) violations.push("wwwd.profile.name:invalid");
    if (profile.fallbackProfileId !== null && !boundedString(profile.fallbackProfileId, 200)) {
      violations.push("wwwd.profile.fallbackProfileId:invalid");
    }
    if (profile.autonomyPolicy !== null && !isRecord(profile.autonomyPolicy)) violations.push("wwwd.profile.autonomyPolicy:invalid");
    if (profile.defaultResolver !== null && !isRecord(profile.defaultResolver)) violations.push("wwwd.profile.defaultResolver:invalid");
    if (wwwd.materials.length > GUIDANCE_SNAPSHOT_MAX_MATERIALS) violations.push("wwwd.materials:too-many");
    else wwwd.materials.forEach((material, index) => violations.push(...materialViolations(material, index)));
    contentValid = violations.length === 0;
  }

  const manifest = value.manifest;
  if (!isRecord(manifest) || Object.values(manifest).some((hash) => typeof hash !== "string" || !SHA256_RE.test(hash))) {
    violations.push("manifest:invalid");
  } else if (contentValid) {
    const expected = computeGuidanceSnapshotManifest(wwwd as unknown as GuidanceWwwdV1);
    for (const [part, hash] of Object.entries(expected)) {
      if (manifest[part] !== hash) violations.push(`manifest:mismatch:${part}`);
    }
    for (const part of Object.keys(manifest)) {
      if (!(part in expected)) violations.push(`manifest:unknown-part:${part}`);
    }
  }

  if (typeof value.signature !== "string" || value.signature.split(".").length !== 3) violations.push("signature:invalid");
  return violations;
}

export type GuidanceFreshnessJudgement =
  | { fresh: true }
  | { fresh: false; reason: "expired" | "version-not-advancing" };

/** TUF freshness: unexpired, and a version above the one held (null when none is held). */
export function judgeGuidanceSnapshotFreshness(input: {
  snapshot: Pick<GuidanceSnapshotV1, "meta">;
  heldVersion: number | null;
  now: Date;
}): GuidanceFreshnessJudgement {
  if (Date.parse(input.snapshot.meta.expiresAt) <= input.now.getTime()) return { fresh: false, reason: "expired" };
  if (input.heldVersion !== null && input.snapshot.meta.version <= input.heldVersion) {
    return { fresh: false, reason: "version-not-advancing" };
  }
  return { fresh: true };
}
