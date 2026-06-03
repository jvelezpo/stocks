export const marketTimeZone = "America/New_York";

const openMinutes = 9 * 60 + 30;
const regularCloseMinutes = 16 * 60;
const earlyCloseMinutes = 13 * 60;
const transitionGraceMs = 1_000;

type LocalDate = {
  year: number;
  month: number;
  day: number;
};

type ZonedParts = LocalDate & {
  hour: number;
  minute: number;
  second: number;
};

type MarketSession = {
  isOpen: boolean;
  reason: string;
  nextOpenAt: Date | null;
  openedAt: Date | null;
  closesAt: Date | null;
  isEarlyClose: boolean;
};

const easternFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: marketTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function getMarketSession(now = new Date()): MarketSession {
  const localNow = easternParts(now);
  const todaySession = tradingSessionForLocalDate(localNow);

  if (todaySession) {
    if (now >= todaySession.openedAt && now < todaySession.closesAt) {
      return {
        isOpen: true,
        reason: todaySession.isEarlyClose
          ? "market open; early close today"
          : "market open",
        nextOpenAt: null,
        openedAt: todaySession.openedAt,
        closesAt: todaySession.closesAt,
        isEarlyClose: todaySession.isEarlyClose,
      };
    }

    if (now < todaySession.openedAt) {
      return {
        isOpen: false,
        reason: "market closed before core session",
        nextOpenAt: todaySession.openedAt,
        openedAt: null,
        closesAt: null,
        isEarlyClose: false,
      };
    }
  }

  return {
    isOpen: false,
    reason: todaySession ? "market closed after core session" : "market closed",
    nextOpenAt: nextMarketOpenAfter(now),
    openedAt: null,
    closesAt: null,
    isEarlyClose: false,
  };
}

export function formatMarketDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: marketTimeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function millisecondsUntil(date: Date): number {
  return Math.max(date.getTime() - Date.now() + transitionGraceMs, transitionGraceMs);
}

function tradingSessionForLocalDate(date: LocalDate):
  | {
      openedAt: Date;
      closesAt: Date;
      isEarlyClose: boolean;
    }
  | null {
  if (!isWeekday(date) || marketHolidayKeys(date.year).has(dateKey(date))) {
    return null;
  }

  const isEarlyClose = isEarlyCloseDate(date);
  const closeMinutes = isEarlyClose ? earlyCloseMinutes : regularCloseMinutes;

  return {
    openedAt: zonedTimeToDate(date, openMinutes),
    closesAt: zonedTimeToDate(date, closeMinutes),
    isEarlyClose,
  };
}

function nextMarketOpenAfter(now: Date): Date {
  const localNow = easternParts(now);

  for (let offset = 0; offset <= 14; offset += 1) {
    const date = addLocalDays(localNow, offset);
    const session = tradingSessionForLocalDate(date);

    if (session && session.openedAt > now) {
      return session.openedAt;
    }
  }

  throw new Error("Could not find next market open within 14 days.");
}

function easternParts(date: Date): ZonedParts {
  const parts = Object.fromEntries(
    easternFormatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function zonedTimeToDate(date: LocalDate, minutesAfterMidnight: number): Date {
  const hour = Math.floor(minutesAfterMidnight / 60);
  const minute = minutesAfterMidnight % 60;
  const localUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0);
  let timestamp = localUtc;

  for (let index = 0; index < 3; index += 1) {
    const offset = easternOffsetMinutes(new Date(timestamp));
    timestamp = localUtc - offset * 60_000;
  }

  return new Date(timestamp);
}

function easternOffsetMinutes(date: Date): number {
  const parts = easternParts(date);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return (localAsUtc - date.getTime()) / 60_000;
}

function dateKey(date: LocalDate): string {
  return [
    date.year.toString().padStart(4, "0"),
    date.month.toString().padStart(2, "0"),
    date.day.toString().padStart(2, "0"),
  ].join("-");
}

function isWeekday(date: LocalDate): boolean {
  const weekday = dayOfWeek(date);

  return weekday >= 1 && weekday <= 5;
}

function dayOfWeek(date: LocalDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function addLocalDays(date: LocalDate, days: number): LocalDate {
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day + days));

  return {
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate(),
  };
}

function marketHolidayKeys(year: number): Set<string> {
  const holidays = new Set<string>();

  addNewYearsDay(holidays, { year, month: 1, day: 1 });
  holidays.add(nthWeekdayOfMonth(year, 1, 1, 3));
  holidays.add(nthWeekdayOfMonth(year, 2, 1, 3));
  holidays.add(dateKey(addLocalDays(easterSunday(year), -2)));
  holidays.add(lastWeekdayOfMonth(year, 5, 1));
  addObservedFixedHoliday(holidays, { year, month: 6, day: 19 });
  addObservedFixedHoliday(holidays, { year, month: 7, day: 4 });
  holidays.add(nthWeekdayOfMonth(year, 9, 1, 1));
  holidays.add(nthWeekdayOfMonth(year, 11, 4, 4));
  addObservedFixedHoliday(holidays, { year, month: 12, day: 25 });

  return holidays;
}

function addNewYearsDay(holidays: Set<string>, date: LocalDate): void {
  const weekday = dayOfWeek(date);

  if (weekday === 6) {
    return;
  }

  holidays.add(dateKey(weekday === 0 ? addLocalDays(date, 1) : date));
}

function addObservedFixedHoliday(holidays: Set<string>, date: LocalDate): void {
  const weekday = dayOfWeek(date);

  if (weekday === 6) {
    holidays.add(dateKey(addLocalDays(date, -1)));
    return;
  }

  if (weekday === 0) {
    holidays.add(dateKey(addLocalDays(date, 1)));
    return;
  }

  holidays.add(dateKey(date));
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  nth: number
): string {
  const first = { year, month, day: 1 };
  const firstWeekday = dayOfWeek(first);
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + (nth - 1) * 7;

  return dateKey({ year, month, day });
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = { year, month, day: lastDay };
  const lastWeekday = dayOfWeek(last);
  const day = lastDay - ((lastWeekday - weekday + 7) % 7);

  return dateKey({ year, month, day });
}

function easterSunday(year: number): LocalDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return { year, month, day };
}

function isEarlyCloseDate(date: LocalDate): boolean {
  if (marketHolidayKeys(date.year).has(dateKey(date)) || !isWeekday(date)) {
    return false;
  }

  const dayAfterThanksgiving = addLocalDays(
    keyToLocalDate(nthWeekdayOfMonth(date.year, 11, 4, 4)),
    1
  );

  if (dateKey(date) === dateKey(dayAfterThanksgiving)) {
    return true;
  }

  if (date.month === 7 && date.day === 3) {
    return true;
  }

  return date.month === 12 && date.day === 24;
}

function keyToLocalDate(key: string): LocalDate {
  const [year, month, day] = key.split("-").map(Number);

  return { year, month, day };
}
