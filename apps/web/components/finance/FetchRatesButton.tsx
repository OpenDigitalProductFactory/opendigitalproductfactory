"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function FetchRatesButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFetch() {
    setLoading(true);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch("/api/v1/finance/exchange-rates", {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage("Rates updated");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch rates");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {message && (
        <span className="text-[10px]" style={{ color: "#4ade80" }}>{message}</span>
      )}
      {error && (
        <span className="text-[10px]" style={{ color: "#ef4444" }}>{error}</span>
      )}
      <button
        type="button"
        onClick={handleFetch}
        disabled={loading}
        className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {loading ? "Fetching..." : "Fetch Latest Rates"}
      </button>
    </div>
  );
}
