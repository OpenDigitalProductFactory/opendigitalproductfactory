"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { unlinkControlFromObligation } from "@/lib/actions/compliance";

type Props = {
  controlId: string;
  obligationId: string;
};

export function UnlinkControlButton({ controlId, obligationId }: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleUnlink() {
    setLoading(true);
    await unlinkControlFromObligation(controlId, obligationId);
    setLoading(false);
    router.refresh();
  }

  return (
    <button
      onClick={handleUnlink}
      disabled={loading}
      className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors whitespace-nowrap"
    >
      {loading ? "Unlinking..." : "Unlink"}
    </button>
  );
}
