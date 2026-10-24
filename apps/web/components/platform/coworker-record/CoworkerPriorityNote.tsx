// BI-7ADEBDC1 — replaces CoworkerPriorityControl, which let a viewer set a
// Cost / Quality / Time posture ON A COWORKER.
//
// The Golden Triangle is a parameter of the Workroom definition, chosen so the
// room achieves its expected outcome: swapping the coworker in a room role
// must not change how the room trades cost against quality against time. So
// there is no per-coworker control here any more, and this is deliberately NOT
// a disabled one — a control that cannot act is worse than none.
//
// The platform-wide default for rooms still lives on Priority & Models; a room
// that declares its own posture wins over it, and its shape's default wins over
// nothing at all.
export function CoworkerPriorityNote() {
  return (
    <div className="space-y-2 text-sm">
      <p className="text-[var(--dpf-text)]">Set by the room, not the coworker.</p>
      <p className="text-[var(--dpf-muted)]">Open the room and use Pace and priority.</p>
    </div>
  );
}
