/** A bare label: a tool name followed by a colon and nothing else, or empty. */
export function isBareQuestion(question: string): boolean {
  const q = question.trim();
  return q.length === 0 || /^[a-z0-9 _-]{1,60}:$/i.test(q);
}
