"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitBillForApproval } from "@/lib/actions/ap";

interface Props {
  billId: string;
}

export function SubmitBillButton({ billId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    try {
      await submitBillForApproval(billId);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit for approval");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="px-4 py-2 rounded-md text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {loading ? "Submitting…" : "Submit for Approval"}
      </button>
      {error && (
        <p className="mt-2 text-xs text-[var(--dpf-error)]">{error}</p>
      )}
    </div>
  );
}
