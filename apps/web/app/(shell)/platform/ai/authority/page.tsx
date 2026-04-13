// apps/web/app/(shell)/platform/ai/authority/page.tsx
// Moved to /platform/audit/authority — redirect to new canonical URL.
import { permanentRedirect } from "next/navigation";

export default function AuthorityRedirect() {
  permanentRedirect("/platform/audit/authority");
}
