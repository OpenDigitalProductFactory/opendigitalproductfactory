import { notFound, permanentRedirect } from "next/navigation";

import { getHomeSurfaceForEntity } from "@/lib/workbooks/platform-tables";

type Props = {
  params: Promise<{ entityType: string }>;
};

// EP-2FB6C0CC (BI-DD763B93): superseded. Every platform table is embedded as a
// grid on its entity's home page (PlatformGridSection), and nothing in the app
// links here. The route stays for deep links (workbooks spec 2026-06-06) and
// forwards to that home.
export default async function PlatformTableRedirect({ params }: Props) {
  const { entityType } = await params;
  const home = getHomeSurfaceForEntity(entityType);
  if (!home) notFound();
  permanentRedirect(home.path);
}
