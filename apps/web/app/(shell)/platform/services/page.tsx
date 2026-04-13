// apps/web/app/(shell)/platform/services/page.tsx
// Moved to /platform/tools/services — redirect to new canonical URL.
import { permanentRedirect } from "next/navigation";

export default function ServicesRedirect() {
  permanentRedirect("/platform/tools/services");
}
