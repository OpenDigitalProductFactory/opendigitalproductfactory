export function ChangeLaneBlockers({ blockers }: { blockers: string[] }) {
  if (blockers.length === 0) {
    return <span className="text-[var(--dpf-muted)]">—</span>;
  }
  return (
    <ul className="space-y-0.5">
      {blockers.map((b, i) => (
        <li
          key={`${i}-${b}`}
          className="text-[var(--dpf-error)] text-xs leading-snug"
        >
          {b}
        </li>
      ))}
    </ul>
  );
}
