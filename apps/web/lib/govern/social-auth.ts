import { prisma } from "@dpf/db";
import { SignJWT, jwtVerify } from "jose";
import { isCustomerAccountSessionCapable } from "@/lib/identity/customer-auth-policy";

function getTempTokenSecret(): Uint8Array {
  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) {
    throw new Error("AUTH_SECRET environment variable is required for social auth token signing");
  }
  return new TextEncoder().encode(authSecret);
}
const TEMP_TOKEN_EXPIRY = "5m";

/**
 * Issuer and audience of the social-login temp token (BI-7B4B5F5D). Other
 * tokens are HS256-signed with the same AUTH_SECRET (mobile access, MCP
 * session, automation sign-in), so the verifier requires these exact values
 * and refuses every other kind. A temp token minted before this change is
 * refused too; the link/complete-profile page reports an expired session and
 * the person signs in with their provider again.
 */
export const SOCIAL_TEMP_TOKEN_ISSUER = "dpf-portal";
export const SOCIAL_TEMP_TOKEN_AUDIENCE = "dpf-social-link";

export type SocialProfile = {
  provider: string;
  providerAccountId: string;
  email: string;
  name: string | null;
};

export type SocialAuthFlow =
  | { flow: "sign-in"; contact: ContactWithAccount }
  | { flow: "link"; contact: ContactWithAccount }
  | { flow: "onboard" }
  | { flow: "blocked" };

type ContactWithAccount = {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  account: { id: string; accountId: string; name: string; status: string };
};

export async function determineSocialAuthFlow(
  profile: SocialProfile
): Promise<SocialAuthFlow> {
  const identity = await prisma.socialIdentity.findUnique({
    where: {
      provider_providerAccountId: {
        provider: profile.provider,
        providerAccountId: profile.providerAccountId,
      },
    },
    include: {
      contact: {
        include: {
          account: { select: { id: true, accountId: true, name: true, status: true } },
        },
      },
    },
  });

  if (identity) {
    if (!identity.contact.isActive || !isCustomerAccountSessionCapable(identity.contact.account.status)) {
      return { flow: "blocked" };
    }
    return { flow: "sign-in", contact: identity.contact };
  }

  if (profile.email) {
    const contact = await prisma.customerContact.findUnique({
      where: { email: profile.email.toLowerCase() },
      include: {
        account: { select: { id: true, accountId: true, name: true, status: true } },
      },
    });
    if (contact) {
      if (!contact.isActive || !isCustomerAccountSessionCapable(contact.account.status)) {
        return { flow: "blocked" };
      }
      // Email only identifies which guarded linking ceremony to offer. It
      // never selects an identity for session issuance. The ceremony must
      // independently prove the existing credential; contacts without one
      // therefore fail closed in linkSocialIdentity.
      return { flow: "link", contact };
    }
  }

  return { flow: "onboard" };
}

export async function createTempToken(profile: SocialProfile): Promise<string> {
  return new SignJWT({
    provider: profile.provider,
    providerAccountId: profile.providerAccountId,
    email: profile.email,
    name: profile.name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SOCIAL_TEMP_TOKEN_ISSUER)
    .setAudience(SOCIAL_TEMP_TOKEN_AUDIENCE)
    .setExpirationTime(TEMP_TOKEN_EXPIRY)
    .setIssuedAt()
    .sign(getTempTokenSecret());
}

export async function verifyTempToken(token: string): Promise<SocialProfile> {
  const { payload } = await jwtVerify(token, getTempTokenSecret(), {
    issuer: SOCIAL_TEMP_TOKEN_ISSUER,
    audience: SOCIAL_TEMP_TOKEN_AUDIENCE,
    algorithms: ["HS256"],
    requiredClaims: ["exp", "iat"],
  });
  const { provider, providerAccountId, email, name } = payload;
  if (typeof provider !== "string" || typeof providerAccountId !== "string" || typeof email !== "string") {
    throw new Error("Social temp token is missing its profile claims");
  }
  return {
    provider,
    providerAccountId,
    email,
    name: typeof name === "string" ? name : null,
  };
}
