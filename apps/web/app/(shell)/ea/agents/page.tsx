// apps/web/app/(shell)/ea/agents/page.tsx
import { redirect } from "next/navigation";

export default function EaAgentsPage() {
  redirect("/platform/identity/agents");
}
