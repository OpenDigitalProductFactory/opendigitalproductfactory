import { redirect } from "next/navigation";
import { resolveOrgSlug } from "@/lib/storefront-data";

export default async function CustomerLoginPage() {
  const slug = await resolveOrgSlug() ?? "store";
  redirect(`/s/${slug}/sign-in`);
}
