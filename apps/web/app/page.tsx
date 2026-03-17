// apps/web/app/page.tsx
// Redirect to /welcome (using 307 temporary to avoid browser caching)
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function RootPage() {
  redirect("/welcome");
}
