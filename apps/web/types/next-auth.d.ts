import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      platformRole: string | null;
      isSuperuser: boolean;
    };
  }

  interface User {
    platformRole?: string | null;
    isSuperuser?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    platformRole?: string | null;
    isSuperuser?: boolean;
  }
}
