// apps/web/app/(shell)/platform/tools/page.tsx
// Redirect bare /platform/tools to the default tab.
import { redirect } from "next/navigation";

export default function ToolsRootRedirect() {
  redirect("/platform/tools/catalog");
}
