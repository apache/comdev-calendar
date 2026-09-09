/**
 * Date helpers.
 *
 * Everything here works in the browser's local timezone, which is what a
 * calendar grid should do. The backend stores and returns UTC; the conversion
 * happens when a date string is parsed.
 *
 * All-day events are the exception: the backend snaps them to UTC midnight, so
 * we read their date parts in UTC to decide which days they cover. Otherwise a
 * whole-day event would appear to start the evening before for anyone west of
 * Greenwich.
 */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Monday. ISO weeks are the ASF norm and match the WEEKDAY_NAMES above. */
export const WEEK_STARTS_ON = 1;

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function endOfDay(date: Date): Date {
  const copy = startOfDay(date);
  copy.setDate(copy.getDate() + 1);
  return copy;
}

export function addDays(date: Date, count: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + count);
  return copy;
}

export function addMonths(date: Date, count: number): Date {
  const copy = new Date(date);
  const targetDay = copy.getDate();
  copy.setDate(1);
  copy.setMonth(copy.getMonth() + count);
  // Clamp: 31 January plus one month is 28/29 February, not 3 March.
  const lastDay = daysInMonth(copy.getFullYear(), copy.getMonth());
  copy.setDate(Math.min(targetDay, lastDay));
  return copy;
}

export function addYears(date: Date, count: number): Date {
  return addMonths(date, count * 12);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function startOfWeek(date: Date, weekStartsOn = WEEK_STARTS_ON): Date {
  const copy = startOfDay(date);
  const shift = (copy.getDay() - weekStartsOn + 7) % 7;
  copy.setDate(copy.getDate() - shift);
  return copy;
}

export function startOfMonth(date: Date): Date {
  const copy = startOfDay(date);
  copy.setDate(1);
  return copy;
}

export function startOfYear(date: Date): Date {
  const copy = startOfMonth(date);
  copy.setMonth(0);
  return copy;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

export function isToday(date: Date, now: Date = new Date()): boolean {
  return isSameDay(date, now);
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * The six-week grid a month view shows: always 42 days, starting on the first
 * WEEK_STARTS_ON on or before the 1st. A fixed size keeps the grid from
 * jumping about as the user pages through months.
 */
export function monthGrid(date: Date, weekStartsOn = WEEK_STARTS_ON): Date[] {
  const first = startOfWeek(startOfMonth(date), weekStartsOn);
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
}

/** The seven days of the week containing `date`. */
export function weekDays(date: Date, weekStartsOn = WEEK_STARTS_ON): Date[] {
  const first = startOfWeek(date, weekStartsOn);
  return Array.from({ length: 7 }, (_, index) => addDays(first, index));
}

/** The twelve first-of-the-month dates for the year containing `date`. */
export function yearMonths(date: Date): Date[] {
  const january = startOfYear(date);
  return Array.from({ length: 12 }, (_, index) => new Date(january.getFullYear(), index, 1));
}

export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * The window of time a view needs loaded. The month view asks for its whole
 * 42-day grid, not just the calendar month, so events from the neighbouring
 * months that are visible in the grid are there too.
 */
export function rangeForView(view: string, cursor: Date): DateRange {
  switch (view) {
    case "day":
      return { start: startOfDay(cursor), end: endOfDay(cursor) };
    case "week": {
      const first = startOfWeek(cursor);
      return { start: first, end: addDays(first, 7) };
    }
    case "year": {
      const first = startOfYear(cursor);
      return { start: first, end: new Date(first.getFullYear() + 1, 0, 1) };
    }
    case "agenda": {
      const first = startOfDay(cursor);
      return { start: first, end: addDays(first, 90) };
    }
    case "month":
    default: {
      const grid = monthGrid(cursor);
      return { start: grid[0], end: addDays(grid[41], 1) };
    }
  }
}

/** Moves the cursor one view-sized step forwards or backwards. */
export function step(view: string, cursor: Date, direction: number): Date {
  switch (view) {
    case "day":
      return addDays(cursor, direction);
    case "week":
      return addDays(cursor, 7 * direction);
    case "year":
      return addYears(cursor, direction);
    case "agenda":
      return addDays(cursor, 30 * direction);
    case "month":
    default:
      return addMonths(cursor, direction);
  }
}

/** A stable YYYY-MM-DD key for a local date, used to bucket events by day. */
export function dayKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The inverse of dayKey(), for reading dates back out of form fields. */
export function fromDayKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

// ---- formatting -----------------------------------------------------------

export function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatDate(date: Date): string {
  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatMonthYear(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

/** The heading shown above each view. */
export function formatViewTitle(view: string, cursor: Date): string {
  switch (view) {
    case "day":
      return formatDate(cursor);
    case "week": {
      const days = weekDays(cursor);
      const first = days[0];
      const last = days[6];
      if (first.getMonth() === last.getMonth()) {
        return `${first.getDate()} - ${last.getDate()} ${formatMonthYear(first)}`;
      }
      if (first.getFullYear() === last.getFullYear()) {
        return `${first.getDate()} ${MONTH_NAMES[first.getMonth()]} - ${last.getDate()} ${formatMonthYear(last)}`;
      }
      return `${formatDate(first)} - ${formatDate(last)}`;
    }
    case "year":
      return String(cursor.getFullYear());
    case "agenda":
      return `From ${formatDate(cursor)}`;
    case "month":
    default:
      return formatMonthYear(cursor);
  }
}

/** Formats a value for an <input type="datetime-local">. */
export function toLocalInput(date: Date): string {
  return `${dayKey(date)}T${formatTime(date)}`;
}

/** Formats a value for an <input type="date">. */
export function toDateInput(date: Date): string {
  return dayKey(date);
}

/** Reads an ISO 8601 string from the API into a Date. */
export function parseISO(value: string): Date {
  return new Date(value);
}

/** Serialises a Date for the API. */
export function toISO(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
