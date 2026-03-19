"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { unlinkRiskFromControl } from "@/lib/actions/compliance";

type Props = {
  riskAssessmentId: string;
  controlId: string;
};

export function UnlinkRiskControlButton({ riskAssessmentId, controlId }: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleUnlink() {
    setLoading(true);
    await unlinkRiskFromControl(riskAssessmentId, controlId);
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
