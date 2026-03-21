// apps/web/lib/auth.ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Apple from "next-auth/providers/apple";
import { prisma } from "@dpf/db";
import { verifyPassword, hashPassword } from "./password";
import { determineSocialAuthFlow, createTempToken } from "./social-auth";

/**
 * Load social auth credentials from PlatformConfig DB into process.env.
 * Called at startup and after admin saves new credentials.
 * This bridges DB-stored credentials to NextAuth's env-var-based provider config.
 */
const SOCIAL_AUTH_DB_KEYS = [
  "google_client_id",
  "google_client_secret",
  "apple_client_id",
  "apple_client_secret",
  "apple_team_id",
  "apple_key_id",
];

export async function syncSocialAuthCredentials(): Promise<void> {
  try {
    const configs = await prisma.platformConfig.findMany({
      where: { key: { in: SOCIAL_AUTH_DB_KEYS } },
      select: { key: true, value: true },
    });
    for (const config of configs) {
      if (typeof config.value === "string" && config.value.length > 0) {
        const envKey = config.key.toUpperCase();
        process.env[envKey] = config.value;
      }
    }
    // Auto-enable social auth if at least Google is configured
    const hasGoogle = !!process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID !== "not-configured";
    const hasApple = !!process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_ID !== "not-configured";
    if (hasGoogle || hasApple) {
      process.env.ENABLE_SOCIAL_AUTH = "true";
      process.env.NEXT_PUBLIC_ENABLE_SOCIAL_AUTH = "true";
    }
  } catch {
    // DB not available yet — env vars will be used as-is
  }
}

// Sync credentials from DB on module load
syncSocialAuthCredentials();

export type UserType = "admin" | "customer";

export type DpfSession = {
  user: {
    id: string;
    email: string;
    type: UserType;
    // Admin fields
    platformRole: string | null;
    isSuperuser: boolean;
    // Customer fields
    accountId: string | null;
    accountName: string | null;
    contactId: string | null;
  };
};

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    // Admin/workforce login
    Credentials({
      id: "workforce",
      name: "Workforce",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.email || !credentials?.password) return null;
          const user = await prisma.user.findUnique({
            where: { email: credentials.email as string },
            include: { groups: { include: { platformRole: true } } },
          });
          if (!user || !user.isActive) return null;
          const { valid, needsRehash } = await verifyPassword(credentials.password as string, user.passwordHash);
          if (!valid) return null;
          if (needsRehash) {
            const newHash = await hashPassword(credentials.password as string);
            await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
          }
          return {
            id: user.id,
            email: user.email,
            type: "admin" as const,
            platformRole: user.groups[0]?.platformRole.roleId ?? null,
            isSuperuser: user.isSuperuser,
            accountId: null,
            accountName: null,
            contactId: null,
          };
        } catch (err) {
          console.error("[auth] workforce authorize error:", err);
          return null;
        }
      },
    }),
    // Customer portal login
    Credentials({
      id: "customer",
      name: "Customer",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const contact = await prisma.customerContact.findUnique({
          where: { email: credentials.email as string },
          include: { account: { select: { id: true, accountId: true, name: true, status: true } } },
        });
        if (!contact || !contact.isActive || !contact.passwordHash) return null;
        if (contact.account.status === "inactive") return null;
        const { valid, needsRehash } = await verifyPassword(credentials.password as string, contact.passwordHash);
        if (!valid) return null;
        if (needsRehash) {
          const newHash = await hashPassword(credentials.password as string);
          await prisma.customerContact.update({ where: { id: contact.id }, data: { passwordHash: newHash } });
        }
        return {
          id: contact.id,
          email: contact.email,
          type: "customer" as const,
          platformRole: null,
          isSuperuser: false,
          accountId: contact.account.accountId,
          accountName: contact.account.name,
          contactId: contact.id,
        };
      },
    }),
    // Social providers — credentials sourced from PlatformConfig DB (admin settings page)
    // with env var fallback. Always registered; if credentials are empty, the OAuth
    // redirect will fail at the provider's end with a clear error.
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "not-configured",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "not-configured",
    }),
    Apple({
      clientId: process.env.APPLE_CLIENT_ID ?? "not-configured",
      clientSecret: process.env.APPLE_CLIENT_SECRET ?? "not-configured",
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      // Credential providers: pass through (existing behavior)
      if (!account || account.type !== "oauth") return true;

      // Social sign-in: determine flow
      const flow = await determineSocialAuthFlow({
        provider: account.provider,
        providerAccountId: account.providerAccountId ?? "",
        email: user.email ?? "",
        name: user.name ?? null,
      });

      if (flow.flow === "blocked") return false;

      if (flow.flow === "sign-in") {
        user.id = flow.contact.id;
        user.type = "customer";
        user.platformRole = null;
        user.isSuperuser = false;
        user.accountId = flow.contact.account.accountId;
        user.accountName = flow.contact.account.name;
        user.contactId = flow.contact.id;
        return true;
      }

      if (flow.flow === "auto-link") {
        const { prisma } = await import("@dpf/db");
        await prisma.socialIdentity.create({
          data: {
            provider: account.provider,
            providerAccountId: account.providerAccountId ?? "",
            email: user.email ?? undefined,
            contactId: flow.contact.id,
          },
        });
        if (user.name && !flow.contact.name) {
          await prisma.customerContact.update({
            where: { id: flow.contact.id },
            data: { name: user.name },
          });
        }
        user.id = flow.contact.id;
        user.type = "customer";
        user.platformRole = null;
        user.isSuperuser = false;
        user.accountId = flow.contact.account.accountId;
        user.accountName = flow.contact.account.name;
        user.contactId = flow.contact.id;
        return true;
      }

      // For "link" and "onboard" flows, redirect with temp token
      const tempToken = await createTempToken({
        provider: account.provider,
        providerAccountId: account.providerAccountId ?? "",
        email: user.email ?? "",
        name: user.name ?? null,
      });

      if (flow.flow === "link") {
        return `/customer-link-account?token=${encodeURIComponent(tempToken)}`;
      }
      return `/customer-complete-profile?token=${encodeURIComponent(tempToken)}`;
    },

    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.type = user.type ?? "admin";
        token.platformRole = user.platformRole ?? null;
        token.isSuperuser = user.isSuperuser ?? false;
        token.accountId = user.accountId ?? null;
        token.accountName = user.accountName ?? null;
        token.contactId = user.contactId ?? null;
      }
      return token;
    },

    session({ session, token }) {
      if (session.user) {
        session.user.id = typeof token.id === "string" ? token.id : token.sub ?? "";
        session.user.type = (token.type as UserType) ?? "admin";
        session.user.platformRole = token.platformRole ?? null;
        session.user.isSuperuser = token.isSuperuser ?? false;
        session.user.accountId = (token.accountId as string) ?? null;
        session.user.accountName = (token.accountName as string) ?? null;
        session.user.contactId = (token.contactId as string) ?? null;
      }
      return session;
    },
  },
});
