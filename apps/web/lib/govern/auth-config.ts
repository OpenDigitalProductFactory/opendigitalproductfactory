import type { NextAuthConfig } from "next-auth";
import { normalizeAuthRedirect } from "./auth-redirect";

export type UserType = "admin" | "customer";

export type DpfSession = {
  user: {
    id: string;
    email: string;
    type: UserType;
    platformRole: string | null;
    isSuperuser: boolean;
    accountId: string | null;
    accountName: string | null;
    contactId: string | null;
  };
};

// Portal (localhost:3000) and sandbox (localhost:3035) share the same
// localhost domain. Browsers scope cookies by domain, not port, so sandbox
// sessions need a distinct cookie name while the main portal keeps the default.
const isSandboxEnv = process.env.DPF_ENVIRONMENT === "sandbox";
const sessionCookieName = isSandboxEnv
  ? "authjs.session-token.sandbox"
  : "authjs.session-token";

// Gate secure cookies on the declared public protocol rather than NODE_ENV so
// production LAN installs over plain HTTP can still retain sessions.
const publicUrl = process.env.PUBLIC_URL ?? "";
const isHttps = publicUrl.startsWith("https://");

export const authBaseConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  cookies: {
    sessionToken: {
      name: sessionCookieName,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isHttps,
      },
    },
  },
  providers: [],
  callbacks: {
    redirect({ url, baseUrl }) {
      return normalizeAuthRedirect({ url, baseUrl, publicUrl: process.env.PUBLIC_URL });
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
} satisfies NextAuthConfig;
