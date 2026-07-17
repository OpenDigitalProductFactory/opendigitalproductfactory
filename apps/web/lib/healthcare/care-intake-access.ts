import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const CARE_INTAKE_GRANT_OPERATIONS = ["view", "save", "submit"] as const;
export type CareIntakeGrantOperation =
  (typeof CARE_INTAKE_GRANT_OPERATIONS)[number];

export type CareIntakeResumeClaims = {
  organizationId: string;
  patientProfileId: string;
  grantId: string;
};

export type CareIntakeGrantView = {
  grantId: string;
  packetId: string;
  patientProfileId: string;
  tokenDigest: string;
  permittedOperations: string[];
  expiresAt: Date;
  revokedAt: Date | null;
};

const INVALID_TOKEN = "Invalid care intake resume token";
const ACCESS_DENIED = "Care intake access denied";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function validClaims(value: unknown): value is CareIntakeResumeClaims {
  if (!value || typeof value !== "object") return false;
  const claims = value as Record<string, unknown>;
  return (
    typeof claims.organizationId === "string"
    && ID_PATTERN.test(claims.organizationId)
    && typeof claims.patientProfileId === "string"
    && ID_PATTERN.test(claims.patientProfileId)
    && typeof claims.grantId === "string"
    && ID_PATTERN.test(claims.grantId)
  );
}

export function digestCareIntakeResumeToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createCareIntakeResumeToken(
  claims: CareIntakeResumeClaims,
): { token: string; digest: string } {
  if (!validClaims(claims)) throw new Error(INVALID_TOKEN);
  const envelope = Buffer.from(JSON.stringify(claims), "utf8").toString(
    "base64url",
  );
  const secret = randomBytes(32).toString("base64url");
  const token = `${envelope}.${secret}`;
  return { token, digest: digestCareIntakeResumeToken(token) };
}

export function parseCareIntakeResumeToken(
  token: string,
): CareIntakeResumeClaims {
  if (token.length > 1024) throw new Error(INVALID_TOKEN);
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !SECRET_PATTERN.test(parts[1]!)) {
    throw new Error(INVALID_TOKEN);
  }
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    );
    if (!validClaims(decoded)) throw new Error(INVALID_TOKEN);
    return decoded;
  } catch {
    throw new Error(INVALID_TOKEN);
  }
}

function equalDigest(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) {
    return left === right;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function assertCareIntakeGrant(
  grant: CareIntakeGrantView,
  request: {
    digest: string;
    grantId: string;
    packetRowId: string;
    patientProfileId: string;
    operation: CareIntakeGrantOperation;
    at: Date;
  },
): void {
  const allowed =
    equalDigest(grant.tokenDigest, request.digest)
    && grant.grantId === request.grantId
    && grant.packetId === request.packetRowId
    && grant.patientProfileId === request.patientProfileId
    && grant.permittedOperations.includes(request.operation)
    && grant.revokedAt === null
    && grant.expiresAt.getTime() > request.at.getTime();
  if (!allowed) throw new Error(ACCESS_DENIED);
}
