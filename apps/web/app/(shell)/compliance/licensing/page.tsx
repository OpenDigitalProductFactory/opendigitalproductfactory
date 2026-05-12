import Link from "next/link";
import { getLicensingWorkspace } from "@/lib/actions/licensing-compliance";
import { LicensingWorkspacePanel } from "@/components/compliance/licensing/LicensingWorkspacePanel";

export default async function ComplianceLicensingPage() {
  const workspace = await getLicensingWorkspace();

  return (
    <div>
      <div className="mb-2">
        <Link
          href="/compliance"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Compliance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">Licensing</span>
      </div>

      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Licensing Readiness</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Track organization licenses, person-held credentials, display obligations, fee readiness, and licensing gaps in one factual Compliance workspace.
        </p>
      </div>

      <div className="mb-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Workspace context</p>
        <p className="mt-1 text-sm text-[var(--dpf-text)]">{workspace.organization.name}</p>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          Compliance remains the operational home here, with factual cross-links into Finance for fees, Staff for holders, and Evidence for public-display proof.
        </p>
      </div>

      <LicensingWorkspacePanel workspace={workspace} />
    </div>
  );
}
