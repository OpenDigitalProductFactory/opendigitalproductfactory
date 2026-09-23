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
    .setExpirationTime(TEMP_TOKEN_EXPIRY)
    .setIssuedAt()
    .sign(getTempTokenSecret());
}

export async function verifyTempToken(token: string): Promise<SocialProfile> {
  const { payload } = await jwtVerify(token, getTempTokenSecret());
  return {
    provider: payload.provider as string,
    providerAccountId: payload.providerAccountId as string,
    email: payload.email as string,
    name: (payload.name as string) ?? null,
  };
}
