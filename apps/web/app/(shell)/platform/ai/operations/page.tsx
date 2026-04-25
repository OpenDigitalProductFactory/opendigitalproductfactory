// apps/web/app/(shell)/platform/ai/operations/page.tsx
// Legacy alias: keep old AI Operations links inside the AI family.
import { permanentRedirect } from "next/navigation";

export default function OperationsRedirect() {
  permanentRedirect("/platform/ai/build-studio");
}
