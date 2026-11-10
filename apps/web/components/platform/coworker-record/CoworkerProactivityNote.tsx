// BI-87C9C91C — replaces CoworkerProactivitySetting, which let a viewer set a
// proactivity level ON A COWORKER.
//
// Proactivity belongs to the outcome-specific Workroom, not to whoever is
// staffed to it: swapping the coworker in a room role must not change how
// persistently the room pursues its outcome. So there is no per-coworker
// control here any more, and this is deliberately NOT a disabled one — a
// control that cannot act is worse than none.
//
// Trust, tool grants, qualifications and autonomy ceilings remain
// participant-specific and still live on the coworker record. They narrow what
// a room permits; they are not a proactivity preference.
export function CoworkerProactivityNote() {
  return (
    <div className="space-y-2 text-sm">
      <p className="text-[var(--dpf-text)]">Set by the room, not the coworker.</p>
      <p className="text-[var(--dpf-muted)]">
        Open the room and use Pace and priority. Everyone in it shares one setting.
      </p>
      <p className="text-[var(--dpf-muted)]">
        This coworker&rsquo;s own limits still apply, and can only narrow it.
      </p>
    </div>
  );
}
