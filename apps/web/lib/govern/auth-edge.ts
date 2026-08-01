import NextAuth from "next-auth";
import { authBaseConfig } from "./auth-config";

export const { auth } = NextAuth(authBaseConfig);
