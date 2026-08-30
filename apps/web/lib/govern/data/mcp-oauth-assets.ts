// Data-governance registration for the MCP OAuth 2.1 authorization server
// (BI-E4DFDCB0). Three new persistent models, registered so the live coverage
// gate (coverage.live.test.ts) accounts for every field and so their
// sensitivity, lifecycle and residency are governed rather than inherited by
// fallback.
//
// The shape of these assets is unusual in one respect worth stating: almost
// nothing here is data ABOUT a person. The only human identity stored is a
// foreign key to an existing install-local User — the human who consented —
// which is the same subject McpApiToken already references. Everything else is
// protocol state: token hashes, a PKCE challenge, an audience URI, redirect
// URIs and consented scope strings. That is why most fields resolve
// `not-applicable` rather than `governed`: they are credential and protocol
// mechanics, not attributes of a data subject.
//
// All three are `local-only` residency and hold or gate credentials, which is
// also why packages/db/src/table-classification.ts marks them "restricted"
// (never copied to a dev environment).

import type { DataAssetDefinition, DataFieldDefinition } from "./assets";
import type { ClassificationProvenance, DataAssetId } from "./taxonomy";

const PROVENANCE: ClassificationProvenance = {
  source: "manual",
  state: "confirmed",
  assertedBy: "data-steward",
  effectiveFrom: "2026-08-27",
};

const CLASSIFICATION = {
  state: "confirmed",
  source: "manual",
  effectiveFrom: "2026-08-27",
} as const;

/** Every field on these models is protocol or credential mechanics unless
 *  noted; this keeps the per-field reason honest without repeating boilerplate. */
function protocolField(
  assetId: DataAssetId,
  name: string,
  reason: string,
): DataFieldDefinition {
  return {
    id: `${assetId}#${name}`,
    physicalName: name,
    resolution: "not-applicable",
    resolutionReason: reason,
    provenance: PROVENANCE,
  };
}

function inheritedField(
  assetId: DataAssetId,
  name: string,
  reason: string,
): DataFieldDefinition {
  return {
    id: `${assetId}#${name}`,
    physicalName: name,
    resolution: "inherited",
    resolutionReason: reason,
    provenance: PROVENANCE,
  };
}

const CLIENT = "data:mcp-oauth-client" satisfies DataAssetId;
const CODE = "data:mcp-oauth-authorization-code" satisfies DataAssetId;
const REFRESH = "data:mcp-oauth-refresh-token" satisfies DataAssetId;

export const MCP_OAUTH_ASSETS: readonly DataAssetDefinition[] = [
  {
    id: CLIENT,
    physical: { prismaModel: "OAuthClient" },
    domain: "core-identity",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["configuration", "credential-secret"],
    sensitivity: "restricted",
    criticality: "high",
    // No data subject: a client is software, not a person. The owning human is
    // referenced by FK and governed on the User record.
    subjectLocators: [],
    lifecycleClass: "operational",
    purposeCapabilities: ["platform-operations"],
    residencyClass: "local-only",
    projectionClass: "structure",
    classification: CLASSIFICATION,
    fields: [
      protocolField(CLIENT, "id", "Surrogate row key."),
      protocolField(
        CLIENT,
        "oAuthClientId",
        "The public OAuth client_id this client presents — a generated opaque identifier, or the https URL of its Client ID Metadata Document. Identifies software, never a person.",
      ),
      protocolField(
        CLIENT,
        "clientName",
        "Display label shown on the consent screen. Operator-entered for a pre-registered or credentials client; self-asserted for a dynamic registration, which is why the consent screen marks those as self-asserted rather than trusting the name.",
      ),
      protocolField(
        CLIENT,
        "registrationKind",
        "Which of the spec's registration mechanisms produced this client (dcr | cimd | preregistered | credentials). Drives the token endpoint's grant checks and the consent screen's provenance warning.",
      ),
      protocolField(
        CLIENT,
        "clientSecretHash",
        "SHA-256 of a confidential client's secret, for constant-time lookup. Not reversible; not a data-subject attribute.",
      ),
      protocolField(
        CLIENT,
        "clientSecretEnc",
        "Encrypted copy of that secret so an operator can re-read it once, using the same credential-crypto envelope McpApiToken.secretEnc already uses. A headless client's secret must be recoverable; a short-lived access token need not be, and none is stored.",
      ),
      protocolField(
        CLIENT,
        "redirectUris",
        "Registered OAuth redirect URIs, validated on every authorization request. Software endpoints — typically a loopback listener on the operator's own machine.",
      ),
      inheritedField(
        CLIENT,
        "ownerUserId",
        "Foreign key to the install-local User whose authority a client_credentials client acts under. No attribute about that person is stored here, only the reference; their platformRole still caps every call. Governance inherited from the User record.",
      ),
      inheritedField(
        CLIENT,
        "agentId",
        "Optional foreign key to the Agent (coworker) identity the client acts as. Non-human identity; governance inherited from the Agent record.",
      ),
      protocolField(
        CLIENT,
        "allowedScopes",
        "Public scope strings capping what this client may be granted. Authorization policy, not data about a subject.",
      ),
      protocolField(
        CLIENT,
        "metadataJson",
        "Verbatim registration request or fetched Client ID Metadata Document, kept so an operator can audit what a client claimed about itself. Never contains a secret.",
      ),
      protocolField(CLIENT, "createdAt", "Row creation timestamp."),
      protocolField(
        CLIENT,
        "lastUsedAt",
        "Last successful use, so the admin list can show dormant clients honestly.",
      ),
      protocolField(CLIENT, "revokedAt", "Revocation timestamp; revocation is this model's lifecycle."),
      protocolField(CLIENT, "revokedReason", "Operator or system reason recorded at revocation."),
      protocolField(CLIENT, "owner", "Prisma relation to User; the scalar ownerUserId carries the governance."),
      protocolField(CLIENT, "agent", "Prisma relation to Agent; the scalar agentId carries the governance."),
      protocolField(CLIENT, "tokens", "Prisma relation to the access tokens issued to this client."),
      protocolField(CLIENT, "authorizationCodes", "Prisma relation to codes issued to this client."),
      protocolField(CLIENT, "refreshTokens", "Prisma relation to refresh tokens issued to this client."),
    ],
  },
  {
    id: CODE,
    physical: { prismaModel: "OAuthAuthorizationCode" },
    domain: "core-identity",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["credential-secret"],
    sensitivity: "restricted",
    criticality: "high",
    subjectLocators: [],
    lifecycleClass: "operational",
    purposeCapabilities: ["platform-operations"],
    residencyClass: "local-only",
    projectionClass: "structure",
    classification: CLASSIFICATION,
    fields: [
      protocolField(CODE, "id", "Surrogate row key."),
      protocolField(
        CODE,
        "codeHash",
        "SHA-256 of a single-use authorization code that expires in minutes. Consumed atomically on first exchange so a replay is detectable.",
      ),
      protocolField(CODE, "oauthClientId", "Foreign key to the OAuthClient the code was issued to."),
      inheritedField(
        CODE,
        "userId",
        "Foreign key to the User who consented. Binding the consenting human is precisely what an authorization code is for, and it is the same subject McpApiToken.userId already references. Governance inherited from the User record.",
      ),
      protocolField(
        CODE,
        "redirectUri",
        "The redirect URI this code was issued against, re-checked at exchange.",
      ),
      protocolField(
        CODE,
        "codeChallenge",
        "RFC 7636 PKCE S256 challenge — a hash of a verifier the client keeps. The verifier itself is never stored.",
      ),
      protocolField(CODE, "codeChallengeMethod", "Always S256; plain is refused."),
      protocolField(
        CODE,
        "resource",
        "RFC 8707 audience: this installation's canonical MCP endpoint URI. Validated on every call, which is what stops a token minted here being replayed at another install.",
      ),
      protocolField(CODE, "scopes", "The public scopes the human actually approved."),
      protocolField(CODE, "expiresAt", "Short expiry; enforced on read regardless of purge."),
      protocolField(CODE, "consumedAt", "Set atomically on first exchange; a second presentation is a replay."),
      protocolField(CODE, "createdAt", "Row creation timestamp."),
      protocolField(CODE, "client", "Prisma relation to OAuthClient."),
      protocolField(CODE, "user", "Prisma relation to User; the scalar userId carries the governance."),
    ],
  },
  {
    id: REFRESH,
    physical: { prismaModel: "OAuthRefreshToken" },
    domain: "core-identity",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["credential-secret"],
    sensitivity: "restricted",
    criticality: "high",
    subjectLocators: [],
    lifecycleClass: "operational",
    purposeCapabilities: ["platform-operations"],
    residencyClass: "local-only",
    projectionClass: "structure",
    classification: CLASSIFICATION,
    fields: [
      protocolField(REFRESH, "id", "Surrogate row key."),
      protocolField(REFRESH, "tokenHash", "SHA-256 of a refresh token, rotated on every use."),
      protocolField(REFRESH, "oauthClientId", "Foreign key to the OAuthClient the token was issued to."),
      inheritedField(
        REFRESH,
        "userId",
        "Foreign key to the User the token acts for — the same subject as the authorization code it descends from. Governance inherited from the User record.",
      ),
      inheritedField(
        REFRESH,
        "agentId",
        "Optional foreign key to an Agent identity. Non-human; governance inherited from the Agent record.",
      ),
      protocolField(REFRESH, "resource", "RFC 8707 audience, as on the authorization code."),
      protocolField(REFRESH, "scopes", "Public scopes carried forward from consent; a refresh may narrow but never widen them."),
      protocolField(
        REFRESH,
        "rotatedToId",
        "Self-reference to this token's successor. This is the mechanism that makes a replayed refresh token detectable, which is why the retention window deliberately outlives the token TTL — purging the chain early would erase the evidence of a stolen token.",
      ),
      protocolField(REFRESH, "expiresAt", "Expiry; enforced on read."),
      protocolField(REFRESH, "consumedAt", "Set when exchanged; presenting a consumed token revokes the whole chain."),
      protocolField(REFRESH, "revokedAt", "Revocation timestamp."),
      protocolField(REFRESH, "revokedReason", "Why the token or its chain was revoked."),
      protocolField(REFRESH, "createdAt", "Row creation timestamp."),
      protocolField(REFRESH, "client", "Prisma relation to OAuthClient."),
      protocolField(REFRESH, "user", "Prisma relation to User; the scalar userId carries the governance."),
      protocolField(REFRESH, "agent", "Prisma relation to Agent; the scalar agentId carries the governance."),
      protocolField(REFRESH, "rotatedTo", "Prisma self-relation to the successor token."),
      protocolField(REFRESH, "rotatedFrom", "Prisma inverse self-relation from predecessor tokens."),
    ],
  },
];
