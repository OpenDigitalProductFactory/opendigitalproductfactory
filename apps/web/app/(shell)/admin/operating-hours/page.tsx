import { redirect } from "next/navigation";

export default async function OperatingHoursPage() {
  redirect("/storefront/settings/operations");
}
