const QA_ID_PATTERN =
  /\b(?:AUTH|SETUP|DASH|EMP|CRM|FIN|GRC|OPS|PORT|INV|EA|BUILD|STORE|AI|ADMIN|REF-LOCALITY|DOCS|AUTH-GOV)-\d+\b/g;

export function extractQaPlanIds(markdown: string): string[] {
  const seen = new Set<string>();
  for (const match of markdown.matchAll(QA_ID_PATTERN)) {
    seen.add(match[0]);
  }
  return Array.from(seen);
}

export function hasQaPlanId(ids: readonly string[], id: string): boolean {
  return ids.includes(id);
}
