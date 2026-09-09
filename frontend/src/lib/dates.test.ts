import { describe, expect, it } from "vitest";
import {
  MONTH_NAMES,
  addDays,
  addMonths,
  addYears,
  dayKey,
  daysInMonth,
  endOfDay,
  formatDate,
  formatMonthYear,
  formatTime,
  formatViewTitle,
  fromDayKey,
  isSameDay,
  isToday,
  isWeekend,
  monthGrid,
  parseISO,
  rangeForView,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  step,
  toDateInput,
  toISO,
  toLocalInput,
  weekDays,
  yearMonths,
} from "./dates";

const MARCH_10_2026 = new Date(2026, 2, 10, 14, 37, 12); // a Tuesday

describe("boundaries", () => {
  it("startOfDay strips the time", () => {
    const start = startOfDay(MARCH_10_2026);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getDate()).toBe(10);
  });

  it("endOfDay is midnight the next day", () => {
    expect(endOfDay(MARCH_10_2026).getTime() - startOfDay(MARCH_10_2026).getTime()).toBe(86_400_000);
  });

  it("startOfWeek finds the Monday", () => {
    const monday = startOfWeek(MARCH_10_2026);
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(9);
  });

  it("startOfWeek on a Sunday goes back six days", () => {
    const sunday = new Date(2026, 2, 15);
    expect(startOfWeek(sunday).getDate()).toBe(9);
  });

  it("startOfWeek can start on Sunday instead", () => {
    expect(startOfWeek(MARCH_10_2026, 0).getDay()).toBe(0);
  });

  it("startOfMonth and startOfYear", () => {
    expect(startOfMonth(MARCH_10_2026).getDate()).toBe(1);
    expect(startOfYear(MARCH_10_2026).getMonth()).toBe(0);
    expect(startOfYear(MARCH_10_2026).getDate()).toBe(1);
  });
});

describe("arithmetic", () => {
  it("addDays crosses month boundaries", () => {
    const result = addDays(new Date(2026, 0, 31), 1);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(1);
  });

  it("addDays goes backwards", () => {
    expect(addDays(new Date(2026, 0, 1), -1).getFullYear()).toBe(2025);
  });

  it("addMonths clamps a day that does not exist in the target month", () => {
    const result = addMonths(new Date(2026, 0, 31), 1);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(28);
  });

  it("addMonths handles a leap February", () => {
    expect(addMonths(new Date(2028, 0, 31), 1).getDate()).toBe(29);
  });

  it("addYears moves twelve months", () => {
    expect(addYears(MARCH_10_2026, 1).getFullYear()).toBe(2027);
  });

  it("daysInMonth", () => {
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2028, 1)).toBe(29);
    expect(daysInMonth(2026, 0)).toBe(31);
  });
});

describe("comparisons", () => {
  it("isSameDay ignores the time", () => {
    expect(isSameDay(new Date(2026, 2, 10, 1), new Date(2026, 2, 10, 23))).toBe(true);
    expect(isSameDay(new Date(2026, 2, 10), new Date(2026, 2, 11))).toBe(false);
  });

  it("isSameDay is not fooled by the same day in another year", () => {
    expect(isSameDay(new Date(2026, 2, 10), new Date(2027, 2, 10))).toBe(false);
  });

  it("isToday takes an injectable now", () => {
    expect(isToday(new Date(2026, 2, 10), new Date(2026, 2, 10, 18))).toBe(true);
    expect(isToday(new Date(2026, 2, 11), new Date(2026, 2, 10))).toBe(false);
  });

  it("isWeekend", () => {
    expect(isWeekend(new Date(2026, 2, 14))).toBe(true); // Saturday
    expect(isWeekend(new Date(2026, 2, 15))).toBe(true); // Sunday
    expect(isWeekend(new Date(2026, 2, 16))).toBe(false);
  });
});

describe("grids", () => {
  it("a month grid is always 42 days", () => {
    for (let month = 0; month < 12; month += 1) {
      expect(monthGrid(new Date(2026, month, 1))).toHaveLength(42);
    }
  });

  it("a month grid starts on a Monday and contains the whole month", () => {
    const grid = monthGrid(MARCH_10_2026);
    expect(grid[0].getDay()).toBe(1);
    const marchDays = grid.filter((day) => day.getMonth() === 2);
    expect(marchDays).toHaveLength(31);
  });

  it("a month grid is contiguous", () => {
    const grid = monthGrid(MARCH_10_2026);
    for (let index = 1; index < grid.length; index += 1) {
      expect(grid[index].getTime() - grid[index - 1].getTime()).toBe(86_400_000);
    }
  });

  it("weekDays returns Monday to Sunday", () => {
    const days = weekDays(MARCH_10_2026);
    expect(days).toHaveLength(7);
    expect(days[0].getDay()).toBe(1);
    expect(days[6].getDay()).toBe(0);
  });

  it("yearMonths returns the twelve firsts", () => {
    const months = yearMonths(MARCH_10_2026);
    expect(months).toHaveLength(12);
    expect(months.every((month) => month.getDate() === 1)).toBe(true);
    expect(months.map((month) => month.getMonth())).toEqual([...Array(12).keys()]);
  });
});

describe("view ranges", () => {
  it("day", () => {
    const range = rangeForView("day", MARCH_10_2026);
    expect(range.end.getTime() - range.start.getTime()).toBe(86_400_000);
  });

  it("week covers seven days from Monday", () => {
    const range = rangeForView("week", MARCH_10_2026);
    expect(range.start.getDay()).toBe(1);
    expect(range.end.getTime() - range.start.getTime()).toBe(7 * 86_400_000);
  });

  it("month covers the whole 42-day grid, not just the calendar month", () => {
    const range = rangeForView("month", MARCH_10_2026);
    const grid = monthGrid(MARCH_10_2026);
    expect(range.start.getTime()).toBe(grid[0].getTime());
    expect(range.end.getTime()).toBe(addDays(grid[41], 1).getTime());
  });

  it("year covers January to January", () => {
    const range = rangeForView("year", MARCH_10_2026);
    expect(range.start.getFullYear()).toBe(2026);
    expect(range.end.getFullYear()).toBe(2027);
    expect(range.end.getMonth()).toBe(0);
  });

  it("agenda looks forward 90 days", () => {
    const range = rangeForView("agenda", MARCH_10_2026);
    expect(range.end.getTime() - range.start.getTime()).toBe(90 * 86_400_000);
  });

  it("an unknown view falls back to month", () => {
    expect(rangeForView("wat", MARCH_10_2026)).toEqual(rangeForView("month", MARCH_10_2026));
  });
});

describe("stepping", () => {
  it("moves by one view-sized unit", () => {
    expect(step("day", MARCH_10_2026, 1).getDate()).toBe(11);
    expect(step("week", MARCH_10_2026, 1).getDate()).toBe(17);
    expect(step("month", MARCH_10_2026, 1).getMonth()).toBe(3);
    expect(step("year", MARCH_10_2026, 1).getFullYear()).toBe(2027);
    expect(step("agenda", MARCH_10_2026, 1).getMonth()).toBe(3);
  });

  it("moves backwards too", () => {
    expect(step("month", MARCH_10_2026, -1).getMonth()).toBe(1);
    expect(step("day", MARCH_10_2026, -1).getDate()).toBe(9);
  });

  it("stepping forwards then back returns to the start", () => {
    for (const view of ["day", "week", "month", "year"]) {
      const there = step(view, MARCH_10_2026, 1);
      expect(step(view, there, -1).getTime()).toBe(MARCH_10_2026.getTime());
    }
  });
});

describe("keys and formatting", () => {
  it("dayKey is zero padded", () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(dayKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("dayKey round-trips through fromDayKey", () => {
    const date = new Date(2026, 6, 4);
    expect(fromDayKey(dayKey(date)).getTime()).toBe(date.getTime());
  });

  it("formatTime pads", () => {
    expect(formatTime(new Date(2026, 2, 10, 9, 5))).toBe("09:05");
    expect(formatTime(new Date(2026, 2, 10, 23, 59))).toBe("23:59");
  });

  it("formatDate and formatMonthYear", () => {
    expect(formatDate(new Date(2026, 2, 10))).toBe("10 March 2026");
    expect(formatMonthYear(new Date(2026, 2, 10))).toBe("March 2026");
  });

  it("MONTH_NAMES has twelve entries", () => {
    expect(MONTH_NAMES).toHaveLength(12);
  });

  it("view titles", () => {
    expect(formatViewTitle("month", MARCH_10_2026)).toBe("March 2026");
    expect(formatViewTitle("year", MARCH_10_2026)).toBe("2026");
    expect(formatViewTitle("day", MARCH_10_2026)).toBe("10 March 2026");
    expect(formatViewTitle("agenda", MARCH_10_2026)).toBe("From 10 March 2026");
  });

  it("a week title inside one month is compact", () => {
    expect(formatViewTitle("week", MARCH_10_2026)).toBe("9 - 15 March 2026");
  });

  it("a week title spanning two months names both", () => {
    expect(formatViewTitle("week", new Date(2026, 2, 31))).toBe("30 March - 5 April 2026");
  });

  it("a week title spanning two years names both in full", () => {
    expect(formatViewTitle("week", new Date(2026, 11, 31))).toBe("28 December 2026 - 3 January 2027");
  });

  it("input formatting", () => {
    const date = new Date(2026, 2, 10, 9, 5);
    expect(toLocalInput(date)).toBe("2026-03-10T09:05");
    expect(toDateInput(date)).toBe("2026-03-10");
  });

  it("ISO round trip", () => {
    const iso = "2026-03-10T09:00:00Z";
    expect(toISO(parseISO(iso))).toBe(iso);
  });

  it("toISO drops milliseconds", () => {
    expect(toISO(new Date(Date.UTC(2026, 2, 10, 9, 0, 0, 123)))).toBe("2026-03-10T09:00:00Z");
  });
});
