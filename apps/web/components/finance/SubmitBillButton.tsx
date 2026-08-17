"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitBillForApproval } from "@/lib/actions/ap";
import { Button } from "@/components/ui/Button";
import { FormStatus } from "@/components/ui/form";

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
      <Button onClick={handleSubmit} disabled={loading}>
        {loading ? "Submitting…" : "Submit for Approval"}
      </Button>
      <FormStatus error={error} className="mt-2" />
    </div>
  );
}
