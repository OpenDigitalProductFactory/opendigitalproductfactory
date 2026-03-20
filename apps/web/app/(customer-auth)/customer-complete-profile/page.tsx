import { resolveOrgSlug } from "@/lib/storefront-data";
import { CompleteProfileClient } from "./complete-profile-client";

export default async function CustomerCompleteProfilePage() {
  const slug = await resolveOrgSlug() ?? "store";
  return <CompleteProfileClient slug={slug} />;
}
