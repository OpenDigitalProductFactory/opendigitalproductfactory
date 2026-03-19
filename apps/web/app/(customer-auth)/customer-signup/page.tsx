// apps/web/app/(customer-auth)/customer-signup/page.tsx
import { prisma } from "@dpf/db";
import { CustomerSignupForm } from "./signup-form";

async function isSocialAuthEnabled(): Promise<boolean> {
  if (process.env.ENABLE_SOCIAL_AUTH === "true") return true;
  try {
    const googleId = await prisma.platformConfig.findUnique({
      where: { key: "google_client_id" },
      select: { value: true },
    });
    return !!googleId && typeof googleId.value === "string" && googleId.value.length > 0;
  } catch {
    return false;
  }
}

export default async function CustomerSignupPage() {
  const socialEnabled = await isSocialAuthEnabled();
  return <CustomerSignupForm socialEnabled={socialEnabled} />;
}
