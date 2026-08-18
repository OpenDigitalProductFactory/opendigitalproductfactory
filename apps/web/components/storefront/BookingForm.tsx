"use client";

import { useState } from "react";
import { submitBooking } from "@/lib/storefront-actions";
import { useRouter } from "next/navigation";
import {
  TextField,
  EmailField,
  TextareaField,
  SubmitButton,
  FormStatus,
} from "@/components/ui/form";

export function BookingForm({
  orgSlug,
  itemId,
  itemName,
  durationMinutes,
}: {
  orgSlug: string;
  itemId: string;
  itemName: string;
  durationMinutes: number;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");

  const today = new Date().toISOString().split("T")[0];

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const scheduledAt = new Date(`${date}T${time}:00`);

    const result = await submitBooking(orgSlug, {
      itemId,
      customerEmail: email,
      customerName: name,
      customerPhone: phone || undefined,
      scheduledAt,
      durationMinutes,
      notes: notes || undefined,
    });

    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.push(`/s/${orgSlug}/checkout?ref=${result.data.ref}&type=booking`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-[480px] flex-col gap-4" noValidate>
      <FormStatus error={error} />
      <TextField
        name="name"
        label="Full name"
        value={name}
        onValueChange={setName}
        required
        autoComplete="name"
      />
      <EmailField
        name="email"
        label="Email address"
        value={email}
        onValueChange={setEmail}
        required
        autoComplete="email"
      />
      <TextField
        name="phone"
        label="Phone"
        type="tel"
        value={phone}
        onValueChange={setPhone}
        optional
        autoComplete="tel"
      />
      <div className="flex gap-3">
        <TextField
          name="date"
          label="Date"
          type="date"
          value={date}
          onValueChange={setDate}
          required
          autoComplete="off"
          min={today}
          className="flex-1"
        />
        <TextField
          name="time"
          label="Time"
          type="time"
          value={time}
          onValueChange={setTime}
          required
          autoComplete="off"
          className="flex-1"
        />
      </div>
      <div className="text-sm text-[var(--dpf-muted)]">Duration: {durationMinutes} minutes</div>
      <TextareaField
        name="notes"
        label="Notes"
        value={notes}
        onValueChange={setNotes}
        optional
        rows={3}
        hint="Anything we should know — dietary needs, party size, accessibility."
      />
      <SubmitButton pending={loading} pendingLabel="Booking…">
        {`Book ${itemName}`}
      </SubmitButton>
    </form>
  );
}
