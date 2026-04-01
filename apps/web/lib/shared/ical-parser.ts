// apps/web/lib/ical-parser.ts
// Lightweight iCalendar (.ics) parser — extracts VEVENT entries.

export type ICalEvent = {
  uid: string;
  summary: string;
  description: string | null;
  dtStart: Date;
  dtEnd: Date | null;
  allDay: boolean;
};

export function parseICal(icsContent: string): ICalEvent[] {
  const events: ICalEvent[] = [];
  const lines = unfoldLines(icsContent);

  let inEvent = false;
  let current: Partial<ICalEvent> = {};

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      inEvent = false;
      if (current.uid && current.summary && current.dtStart) {
        events.push({
          uid: current.uid,
          summary: current.summary,
          description: current.description ?? null,
          dtStart: current.dtStart,
          dtEnd: current.dtEnd ?? null,
          allDay: current.allDay ?? false,
        });
      }
      continue;
    }
    if (!inEvent) continue;

    const [key, ...valueParts] = line.split(":");
    const value = valueParts.join(":");
    if (!key || value === undefined) continue;

    const baseKey = key.split(";")[0]!;

    switch (baseKey) {
      case "UID":
        current.uid = value;
        break;
      case "SUMMARY":
        current.summary = unescapeICalText(value);
        break;
      case "DESCRIPTION":
        current.description = unescapeICalText(value);
        break;
      case "DTSTART": {
        const isDateOnly = key.includes("VALUE=DATE") || value.length === 8;
        current.dtStart = parseICalDate(value);
        current.allDay = isDateOnly;
        break;
      }
      case "DTEND":
        current.dtEnd = parseICalDate(value);
        break;
    }
  }

  return events;
}

/** Unfold continuation lines (RFC 5545: lines starting with space/tab are continuations) */
function unfoldLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .reduce<string[]>((acc, line) => {
      if (line.startsWith(" ") || line.startsWith("\t")) {
        if (acc.length > 0) {
          acc[acc.length - 1] += line.slice(1);
        }
      } else {
        acc.push(line);
      }
      return acc;
    }, []);
}

function parseICalDate(value: string): Date {
  // Date-only: 20260315
  if (value.length === 8) {
    const y = parseInt(value.slice(0, 4));
    const m = parseInt(value.slice(4, 6)) - 1;
    const d = parseInt(value.slice(6, 8));
    return new Date(y, m, d);
  }
  // DateTime: 20260315T120000 or 20260315T120000Z
  const y = parseInt(value.slice(0, 4));
  const m = parseInt(value.slice(4, 6)) - 1;
  const d = parseInt(value.slice(6, 8));
  const h = parseInt(value.slice(9, 11)) || 0;
  const min = parseInt(value.slice(11, 13)) || 0;
  const s = parseInt(value.slice(13, 15)) || 0;
  if (value.endsWith("Z")) {
    return new Date(Date.UTC(y, m, d, h, min, s));
  }
  return new Date(y, m, d, h, min, s);
}

function unescapeICalText(text: string): string {
  return text
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}
