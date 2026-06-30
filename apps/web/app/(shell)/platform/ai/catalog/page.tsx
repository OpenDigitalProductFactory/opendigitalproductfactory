import { CoworkerCatalogView } from "@/components/platform/coworker-service-catalog/CoworkerCatalogView";
import { loadCoworkerCatalog } from "@/lib/coworker-service-catalog/catalog";

export default async function CoworkerCatalogPage() {
  const catalog = await loadCoworkerCatalog();
  return <CoworkerCatalogView catalog={catalog} />;
}

