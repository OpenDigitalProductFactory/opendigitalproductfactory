// apps/web/app/(shell)/platform/ai/model-assignment/page.tsx
// Moved to /platform/ai/assignments — redirect to new canonical URL.
import { permanentRedirect } from "next/navigation";

export default function ModelAssignmentRedirect() {
  permanentRedirect("/platform/ai/assignments");
}
