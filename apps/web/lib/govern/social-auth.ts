import { prisma } from "@dpf/db";
import { SignJWT, jwtVerify } from "jose";

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
  | { flow: "auto-link"; contact: ContactWithAccount }
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
    if (!identity.contact.isActive || identity.contact.account.status === "inactive") {
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
      if (!contact.isActive || contact.account.status === "inactive") {
        return { flow: "blocked" };
      }
      if (!contact.passwordHash) {
        return { flow: "auto-link", contact };
      }
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
