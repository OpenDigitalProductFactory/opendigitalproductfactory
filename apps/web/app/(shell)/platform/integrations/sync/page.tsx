// apps/web/app/(shell)/platform/integrations/sync/page.tsx
// Moved to /platform/tools/catalog/sync — redirect to new canonical URL.
import { permanentRedirect } from "next/navigation";

export default function IntegrationsSyncRedirect() {
  permanentRedirect("/platform/tools/catalog/sync");
}
