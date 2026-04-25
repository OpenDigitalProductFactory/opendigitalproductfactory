// apps/web/app/(shell)/platform/ai/routing/page.tsx
// Legacy alias: keep old routing links inside the AI Operations family.
import { permanentRedirect } from "next/navigation";

export default function RoutingRedirect() {
  permanentRedirect("/platform/ai/providers");
}
