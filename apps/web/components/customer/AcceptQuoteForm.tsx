"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptQuoteByToken } from "@/lib/actions/quote-accept-public";

// Customer-side acceptance on the public quote page: name + email as the
// acceptance record (e-sign-lite, mirroring the invoice signature capture),
// then one Accept button that confirms the order.
export function AcceptQuoteForm({ token }: { token: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const router = useRouter();

  function submit() {
    if (!name.trim() || !email.includes("@")) {
      setError("Please enter your name and a valid email.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await acceptQuoteByToken({ token, acceptedByName: name, acceptedByEmail: email });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong — please try again.");
      }
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 p-5">
      <p className="mb-3 text-sm font-medium text-gray-700">Accept this quote</p>
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <input
          className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400"
          placeholder="Your full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400"
          placeholder="Your email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <button
        className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        disabled={isPending}
        onClick={submit}
      >
        {isPending ? "Accepting…" : "Accept quote & confirm order"}
      </button>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <p className="mt-3 text-xs text-gray-400">
        By accepting you confirm the order on the terms above. Your name and email are recorded as the acceptance.
      </p>
    </div>
  );
}
