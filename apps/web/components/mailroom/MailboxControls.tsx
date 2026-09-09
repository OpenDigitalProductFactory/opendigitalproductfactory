"use client";

// Per-mailbox controls: check now, pause/resume, remove (design 2026-09-09 §4.9).

import { useState, useTransition } from "react";

import { checkMailboxNow, pauseMailbox, removeMailbox } from "@/app/(shell)/workspace/mailroom/actions";
import { Button } from "@/components/ui/Button";

export function MailboxControls({ mailboxId, paused }: { mailboxId: string; paused: boolean }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={pending || paused}
        onClick={() =>
          start(async () => {
            const r = await checkMailboxNow(mailboxId);
            setNote(r.ok ? `Checked: ${r.data.summary}` : r.error);
          })
        }
      >
        Check now
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await pauseMailbox(mailboxId);
            setNote(r.ok ? (paused ? "Reading again." : "Paused; history kept.") : r.error);
          })
        }
      >
        {paused ? "Resume" : "Pause"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Remove this mailbox? Messages already received stay in the Mailroom.")) return;
          start(async () => {
            const r = await removeMailbox(mailboxId);
            setNote(r.ok ? "Removed." : r.error);
          });
        }}
      >
        Remove
      </Button>
      {note ? <span className="text-xs text-[var(--dpf-text-muted)]">{note}</span> : null}
    </div>
  );
}
