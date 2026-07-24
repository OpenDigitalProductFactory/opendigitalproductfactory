// apps/web/app/(shell)/platform/ai/page.tsx
// EP-26E528F5 (coworker UX carry-through): the AI section's front door is the
// workforce itself — the directory at /platform/ai/overview, where each row
// opens the coworker's record. Health altitudes (Readiness, Operations Map)
// stay one tab away in the same family nav.
// BI-54A93A3C: this is a section FRONT DOOR, not a relocated page. It has never
// lived anywhere else — it is a convenience alias that may be re-pointed as the
// section's landing surface changes. `permanentRedirect` emits a 308, which
// browsers cache hard and durably, so a future re-point would strand every
// operator whose browser had already seen the old target. A moved page deserves
// a 308 (see admin/prompts, admin/skills); a front door does not.
//
// In-app links now target /platform/ai/overview directly, so this route exists
// only for bookmarks and typed URLs.
import { redirect } from "next/navigation";

export default async function PlatformAiPage() {
  redirect("/platform/ai/overview");
}
