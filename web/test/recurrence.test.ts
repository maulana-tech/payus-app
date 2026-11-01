import { describe, expect, it } from "vitest";
import { nextDay, nextIssueAt } from "../src/features/invoices/recurrence";

describe("invoice recurrence", () => {
  it("moves weekly and monthly, clamping month ends", () => {
    expect(nextDay("2026-10-15", "weekly")).toBe("2026-10-22");
    expect(nextDay("2026-12-29", "weekly")).toBe("2027-01-05");
    expect(nextDay("2026-10-15", "monthly")).toBe("2026-11-15");
    expect(nextDay("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextDay("2028-01-31", "monthly")).toBe("2028-02-29");
    expect(nextDay("2026-12-31", "monthly")).toBe("2027-01-31");
    expect(nextDay("2026-10-15", "none")).toBe("2026-10-15");
  });

  it("keeps the time of day for the next issue", () => {
    expect(
      nextIssueAt(
        new Date("2026-01-31T09:30:00.000Z"),
        "monthly",
      )?.toISOString(),
    ).toBe("2026-02-28T09:30:00.000Z");
    expect(nextIssueAt(new Date(), "none")).toBeNull();
  });
});
