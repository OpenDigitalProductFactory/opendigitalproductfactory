"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { seedDefaultDunningSequence } from "@/lib/actions/dunning";

export function SeedDunningButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSeed() {
    setLoading(true);
    try {
      await seedDefaultDunningSequence();
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleSeed}
      disabled={loading}
      className="px-4 py-2 rounded-md text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
    >
      {loading ? "Seeding…" : "Seed Default Sequence"}
    </button>
  );
}
