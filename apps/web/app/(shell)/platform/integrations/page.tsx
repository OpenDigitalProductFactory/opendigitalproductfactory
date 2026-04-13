// apps/web/app/(shell)/platform/integrations/page.tsx
// Moved to /platform/tools/catalog — redirect to new canonical URL.
import { permanentRedirect } from "next/navigation";

export default function IntegrationsRedirect() {
  permanentRedirect("/platform/tools/catalog");
}
