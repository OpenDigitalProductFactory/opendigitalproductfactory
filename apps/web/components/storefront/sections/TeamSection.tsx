interface TeamMember {
  name: string;
  role: string;
  bio?: string;
  imageUrl?: string;
}

export function TeamSection({ content }: { content: Record<string, unknown> }) {
  const members = Array.isArray(content.members) ? (content.members as TeamMember[]) : [];

  if (members.length === 0) return null;

  return (
    <div style={{ padding: "40px 0" }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: 24,
      }}>
        {members.map((member, i) => (
          <div key={i} style={{ textAlign: "center" }}>
            {member.imageUrl && (
              <img
                src={member.imageUrl}
                alt={member.name}
                style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover", marginBottom: 8 }}
              />
            )}
            <div style={{ fontWeight: 600, fontSize: 15, color: "var(--dpf-text)" }}>{member.name}</div>
            <div style={{ fontSize: 13, color: "var(--dpf-muted)", marginTop: 2 }}>{member.role}</div>
            {member.bio && (
              <div style={{ fontSize: 13, color: "var(--dpf-text)", marginTop: 6, lineHeight: 1.5 }}>{member.bio}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
