// apps/web/app/(shell)/platform/ai/operations/page.tsx
// Moved to /platform/audit/operations — redirect to new canonical URL.
import { permanentRedirect } from "next/navigation";

export default function OperationsRedirect() {
  permanentRedirect("/platform/audit/operations");
}
