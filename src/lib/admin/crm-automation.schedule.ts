export type AutomationWindow = {
  enabled?: boolean;
  timezone?: string;
  weekdays?: number[];
  start?: string;
  end?: string;
};

export function defaultScheduleWindow(
  value?: AutomationWindow,
): AutomationWindow & { enabled: boolean } {
  return {
    enabled: value?.enabled !== false,
    timezone: value?.timezone ?? "Europe/Madrid",
    weekdays: value?.weekdays ?? [1, 2, 3, 4, 5],
    start: value?.start ?? "09:00",
    end: value?.end ?? "18:00",
  };
}

function timeToMinutes(value: string | undefined, fallback: string) {
  const text = value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
  const [hour, minute] = text.split(":").map(Number);
  return hour * 60 + minute;
}

export function isWithinWindow(date: Date, window: AutomationWindow) {
  if (window.enabled === false) return true;
  const timezone = window.timezone ?? "Europe/Madrid";
  const weekdayText = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(date);
  const timeText = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  const weekdays = window.weekdays ?? [1, 2, 3, 4, 5];
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekdayText as "Sun"];
  const [hour, minute] = timeText.split(":").map(Number);
  const minutes = hour * 60 + minute;
  return (
    weekdays.includes(weekday) &&
    minutes >= timeToMinutes(window.start, "09:00") &&
    minutes < timeToMinutes(window.end, "18:00")
  );
}

export function nextAllowedRunAt(now: Date, window: AutomationWindow) {
  if (window.enabled === false) return now;
  let cursor = new Date(now.getTime() + 60_000);
  cursor.setUTCSeconds(0, 0);
  // Scan in quarter-hour jumps, then refine to the first permitted minute.
  for (let i = 0; i < 14 * 24 * 4; i++) {
    if (isWithinWindow(cursor, window)) {
      let earliest = cursor;
      for (let minute = 1; minute <= 14; minute++) {
        const candidate = new Date(cursor.getTime() - minute * 60_000);
        if (candidate <= now || !isWithinWindow(candidate, window)) break;
        earliest = candidate;
      }
      return earliest;
    }
    cursor = new Date(cursor.getTime() + 15 * 60_000);
  }
  throw new Error("Nao ha horario permitido nos proximos 14 dias.");
}
