"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendPurchaseOrder, convertPOToBill } from "@/lib/actions/ap";
import { Button } from "@/components/ui/Button";

interface Props {
  poId: string;
  status: string;
}

export function POActionButtons({ poId, status }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    setLoading("send");
    setError(null);
    try {
      await sendPurchaseOrder(poId);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send PO");
    } finally {
      setLoading(null);
    }
  }

  async function handleConvert() {
    setLoading("convert");
    setError(null);
    try {
      const bill = await convertPOToBill(poId);
      router.push(`/finance/bills/${bill.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to convert PO to bill");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        {status === "draft" && (
          <Button onClick={handleSend} disabled={loading !== null}>
            {loading === "send" ? "Sending…" : "Send to Supplier"}
          </Button>
        )}
        {(status === "sent" || status === "acknowledged") && (
          <Button onClick={handleConvert} disabled={loading !== null}>
            {loading === "convert" ? "Converting…" : "Convert to Bill"}
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-[var(--dpf-error)]">{error}</p>}
    </div>
  );
}
