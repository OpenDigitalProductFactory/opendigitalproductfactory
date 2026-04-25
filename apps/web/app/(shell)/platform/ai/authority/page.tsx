// apps/web/app/(shell)/platform/ai/authority/page.tsx
// Legacy alias: keep old AI authority links inside the AI family.
import { permanentRedirect } from "next/navigation";

export default function AuthorityRedirect() {
  permanentRedirect("/platform/ai");
}
