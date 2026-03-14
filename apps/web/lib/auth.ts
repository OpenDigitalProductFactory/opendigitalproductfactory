// apps/web/lib/auth.ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@dpf/db";
// Simple SHA-256 hash check (matches seed.ts — upgrade to bcrypt for production)
// Uses Web Crypto API (available in both Node.js and Edge Runtime)
async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type DpfSession = {
  user: {
    id: string;
    email: string;
    platformRole: string | null;
    isSuperuser: boolean;
  };
};

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
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
          platformRole: user.groups[0]?.platformRole.roleId ?? null,
          isSuperuser: user.isSuperuser,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.platformRole = user.platformRole ?? null;
        token.isSuperuser = user.isSuperuser ?? false;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = typeof token.id === "string" ? token.id : token.sub ?? "";
        session.user.platformRole = token.platformRole ?? null;
        session.user.isSuperuser = token.isSuperuser ?? false;
      }
      return session;
    },
  },
});
