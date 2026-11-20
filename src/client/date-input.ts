import { calendarDateSchema } from '../shared/contracts.js';
export function parseDateInput(
  raw: string,
  referenceYear?: string,
): string | null {
  const text = raw.trim();
  if (!text) return null;
  const match = referenceYear
    ? /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/.exec(text)
    : /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  const iso = match
    ? `${match[3] ?? referenceYear}-${match[2]!.padStart(2, '0')}-${match[1]!.padStart(2, '0')}`
    : text;
  return calendarDateSchema.safeParse(iso).success
    ? iso
    : referenceYear
      ? raw
      : text;
}
