// apps/web/lib/auth.ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@dpf/db";
import * as crypto from "crypto";

// Simple SHA-256 hash check (matches seed.ts — upgrade to bcrypt for production)
function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
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
        const hash = hashPassword(credentials.password as string);
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
        token.platformRole = user.platformRole ?? null;
        token.isSuperuser = user.isSuperuser ?? false;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.platformRole = token.platformRole ?? null;
        session.user.isSuperuser = token.isSuperuser ?? false;
      }
      return session;
    },
  },
});
