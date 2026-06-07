// apps/web/app/(shell)/portfolio/architecture/page.tsx
// Relocated: the Business Capability Map now lives in the converged Architecture
// home under the Enterprise Architecture tool (EP-ARCH-NAV). This route is kept as
// a permanent redirect for bookmarks and inbound links.
import { redirect } from "next/navigation";

export default function PortfolioArchitectureRedirect() {
  redirect("/ea/capabilities");
}
