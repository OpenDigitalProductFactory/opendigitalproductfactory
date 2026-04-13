// apps/web/app/(shell)/platform/ai/history/page.tsx
// Moved to /platform/audit/ledger — redirect to new canonical URL.
import { permanentRedirect } from "next/navigation";

export default function HistoryRedirect() {
  permanentRedirect("/platform/audit/ledger");
}
