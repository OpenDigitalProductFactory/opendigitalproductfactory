import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
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
    type?: "admin" | "customer";
    platformRole?: string | null;
    isSuperuser?: boolean;
    accountId?: string | null;
    accountName?: string | null;
    contactId?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    type?: "admin" | "customer";
    platformRole?: string | null;
    isSuperuser?: boolean;
    accountId?: string | null;
    accountName?: string | null;
    contactId?: string | null;
  }
}
