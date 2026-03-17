// apps/web/app/(shell)/ea/views/page.tsx
// Redirect to the main EA page which shows the views list.
import { redirect } from "next/navigation";

export default function EaViewsIndexPage() {
  redirect("/ea");
}
