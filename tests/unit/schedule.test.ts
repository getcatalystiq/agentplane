import { describe, it, expect } from "vitest";
import {
  scheduleConfigToCron,
  computeNextRunAt,
  isValidTimezone,
  buildScheduleConfig,
} from "@/lib/schedule";

describe("scheduleConfigToCron", () => {
  it("returns null for manual", () => {
    expect(scheduleConfigToCron({ frequency: "manual" })).toBeNull();
  });

  it("returns hourly expression", () => {
    expect(scheduleConfigToCron({ frequency: "hourly" })).toBe("0 * * * *");
  });

  it("returns daily expression with time", () => {
    expect(scheduleConfigToCron({ frequency: "daily", time: "09:30" })).toBe("30 9 * * *");
  });

  it("returns weekdays expression with time", () => {
    expect(scheduleConfigToCron({ frequency: "weekdays", time: "14:00" })).toBe("0 14 * * 1-5");
  });

  it("returns weekly expression with time and day", () => {
    expect(scheduleConfigToCron({ frequency: "weekly", time: "08:00", dayOfWeek: 1 })).toBe("0 8 * * 1");
  });

  it("handles midnight correctly", () => {
    expect(scheduleConfigToCron({ frequency: "daily", time: "00:00" })).toBe("0 0 * * *");
  });

  it("handles end of day correctly", () => {
    expect(scheduleConfigToCron({ frequency: "daily", time: "23:59" })).toBe("59 23 * * *");
  });
});

describe("computeNextRunAt", () => {
  it("returns null for manual schedule", () => {
    expect(computeNextRunAt({ frequency: "manual" }, "UTC")).toBeNull();
  });

  it("returns a future date for hourly schedule", () => {
    const now = new Date();
    const next = computeNextRunAt({ frequency: "hourly" }, "UTC", now);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("returns a future date for daily schedule", () => {
    const now = new Date();
    const next = computeNextRunAt({ frequency: "daily", time: "09:00" }, "UTC", now);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("respects timezone", () => {
    const now = new Date("2026-03-07T12:00:00Z");
    const utcNext = computeNextRunAt({ frequency: "daily", time: "15:00" }, "UTC", now);
    const tokyoNext = computeNextRunAt({ frequency: "daily", time: "15:00" }, "Asia/Tokyo", now);
    expect(utcNext).not.toBeNull();
    expect(tokyoNext).not.toBeNull();
    // Tokyo is UTC+9, so 15:00 Tokyo = 06:00 UTC (already passed at 12:00 UTC)
    // Should schedule for next day 15:00 Tokyo = 06:00 UTC next day
    expect(utcNext!.getTime()).not.toBe(tokyoNext!.getTime());
  });

  it("handles weekly schedule with specific day", () => {
    // Wednesday March 7, 2026
    const now = new Date("2026-03-07T12:00:00Z");
    const next = computeNextRunAt(
      { frequency: "weekly", time: "09:00", dayOfWeek: 1 }, // Monday
      "UTC",
      now,
    );
    expect(next).not.toBeNull();
    expect(next!.getDay()).toBe(1); // Monday
  });
});

describe("isValidTimezone", () => {
  it("accepts valid IANA timezones", () => {
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("Europe/London")).toBe(true);
    expect(isValidTimezone("Asia/Tokyo")).toBe(true);
  });

  it("rejects invalid timezones", () => {
    expect(isValidTimezone("Invalid/Timezone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone("UTCC")).toBe(false);
    expect(isValidTimezone("99:99")).toBe(false);
  });
});

describe("buildScheduleConfig", () => {
  it("builds manual config", () => {
    expect(buildScheduleConfig("manual", null, null)).toEqual({ frequency: "manual" });
  });

  it("builds hourly config", () => {
    expect(buildScheduleConfig("hourly", null, null)).toEqual({ frequency: "hourly" });
  });

  it("builds daily config with time", () => {
    expect(buildScheduleConfig("daily", "09:00", null)).toEqual({ frequency: "daily", time: "09:00" });
  });

  it("falls back to manual when daily has no time", () => {
    expect(buildScheduleConfig("daily", null, null)).toEqual({ frequency: "manual" });
  });

  it("builds weekdays config with time", () => {
    expect(buildScheduleConfig("weekdays", "14:30", null)).toEqual({ frequency: "weekdays", time: "14:30" });
  });

  it("builds weekly config with time and day", () => {
    expect(buildScheduleConfig("weekly", "08:00", 1)).toEqual({
      frequency: "weekly",
      time: "08:00",
      dayOfWeek: 1,
    });
  });

  it("falls back to manual when weekly has no day", () => {
    expect(buildScheduleConfig("weekly", "08:00", null)).toEqual({ frequency: "manual" });
  });

  it("falls back to manual when weekly has no time", () => {
    expect(buildScheduleConfig("weekly", null, 1)).toEqual({ frequency: "manual" });
  });
});
