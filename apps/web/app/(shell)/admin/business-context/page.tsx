import { redirect } from "next/navigation";

export default async function AdminBusinessContextPage() {
  redirect("/storefront/settings/business");
}
