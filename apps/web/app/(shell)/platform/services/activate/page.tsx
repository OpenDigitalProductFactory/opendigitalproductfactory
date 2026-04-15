// apps/web/app/(shell)/platform/services/activate/page.tsx
// Moved to /platform/tools/services/activate — redirect to new canonical URL.
import { permanentRedirect } from "next/navigation";

export default function ActivateRedirect() {
  permanentRedirect("/platform/tools/services/activate");
}
