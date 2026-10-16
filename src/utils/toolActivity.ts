/** Return only specialist names explicitly reported by the current runtime. */
export function getReportedSpecialists(specialists: unknown): string[] {
  if (!Array.isArray(specialists)) return [];
  const seen = new Set<string>();
  const reported: string[] = [];

  for (const candidate of specialists) {
    if (typeof candidate !== 'string') continue;
    const name = candidate.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    reported.push(name);
  }

  return reported;
}
