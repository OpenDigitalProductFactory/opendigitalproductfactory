import { resolveOrgSlug } from "@/lib/storefront-data";
import { LinkAccountClient } from "./link-account-client";

export default async function CustomerLinkAccountPage() {
  const slug = await resolveOrgSlug() ?? "store";
  return <LinkAccountClient slug={slug} />;
}
