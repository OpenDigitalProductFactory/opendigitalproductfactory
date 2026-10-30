import "next-auth";
import "next-auth/jwt";
import type { AutomationOAuthConsent } from "@/lib/auth/oauth-automation-consent";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      principalId: string;
      email: string;
      type: "admin" | "customer";
      platformRole: string | null;
      isSuperuser: boolean;
      accountId: string | null;
      accountName: string | null;
      contactId: string | null;
    };
  }

  interface User {
    principalId?: string;
    type?: "admin" | "customer";
    platformRole?: string | null;
    isSuperuser?: boolean;
    accountId?: string | null;
    accountName?: string | null;
    contactId?: string | null;
    automationOAuthConsent?: AutomationOAuthConsent;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    principalId?: string;
    type?: "admin" | "customer";
    platformRole?: string | null;
    isSuperuser?: boolean;
    accountId?: string | null;
    accountName?: string | null;
    contactId?: string | null;
    automationOAuthConsent?: AutomationOAuthConsent;
  }
}
