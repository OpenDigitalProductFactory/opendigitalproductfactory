// apps/web/lib/auth.ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@dpf/db";

// Simple SHA-256 hash check (matches seed.ts — upgrade to bcrypt for production)
async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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
  pages: { signIn: "/" },
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
        if (!credentials?.email || !credentials?.password) return null;
        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
          include: { groups: { include: { platformRole: true } } },
        });
        if (!user || !user.isActive) return null;
        const hash = await hashPassword(credentials.password as string);
        if (hash !== user.passwordHash) return null;
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
        const hash = await hashPassword(credentials.password as string);
        if (hash !== contact.passwordHash) return null;
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
  ],
  callbacks: {
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
