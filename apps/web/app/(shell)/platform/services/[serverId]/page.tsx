// apps/web/app/(shell)/platform/services/[serverId]/page.tsx
// Moved to /platform/tools/services/[serverId] — redirect to new canonical URL.
import { permanentRedirect } from "next/navigation";

export default async function ServiceDetailRedirect({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;
  permanentRedirect(`/platform/tools/services/${serverId}`);
}
