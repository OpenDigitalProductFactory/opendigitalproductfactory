// apps/web/app/(shell)/complaints/page.tsx
// Customer Complaint Tracker — built by AI Coworker (Build Studio FB-BB6567DC)
import { listComplaints } from "@/lib/actions/complaints";
import { ComplaintsClient } from "./ComplaintsClient";

export default async function ComplaintsPage() {
  const complaints = await listComplaints();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Customer Complaints</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Track and manage customer complaints from submission to resolution
        </p>
      </div>
      <ComplaintsClient initialComplaints={complaints} />
    </div>
  );
}
