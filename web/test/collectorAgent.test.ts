import { describe, expect, it } from "vitest";
import {
  MAX_ASKS,
  QUIET_DAYS,
  stopReason,
} from "../src/server/modules/agents/collector.agent";

// "Knows when to stop" is the Collector's whole claim, so it is code and
// not a line in a prompt. This is that code, tested without a model.

const NOW = new Date("2026-11-03T09:00:00Z");
const base = {
  status: "pending",
  dueDate: "2026-10-01",
  clientEmail: "client@example.com",
  dueMinor: 50_000n,
  asked: 0,
  lastAskedAt: null as Date | null,
};

describe("collector · when not to write", () => {
  it("writes when an invoice is overdue and nobody has asked", () => {
    expect(stopReason(base, NOW)).toBeNull();
  });

  it("does not chase what is settled, void, or already paid off", () => {
    expect(stopReason({ ...base, status: "paid" }, NOW)).toMatch(/settled/);
    expect(stopReason({ ...base, status: "void" }, NOW)).toMatch(/settled/);
    expect(stopReason({ ...base, dueMinor: 0n }, NOW)).toMatch(/outstanding/);
  });

  it("does not chase before the due date", () => {
    expect(stopReason({ ...base, dueDate: "2026-11-30" }, NOW)).toMatch(
      /not overdue/,
    );
    // Due today is not overdue either.
    expect(stopReason({ ...base, dueDate: "2026-11-03" }, NOW)).toMatch(
      /not overdue/,
    );
  });

  it("has nowhere to write without a client address", () => {
    expect(stopReason({ ...base, clientEmail: null }, NOW)).toMatch(/address/);
  });

  it("leaves a week between letters", () => {
    const yesterday = new Date(NOW.getTime() - 86_400_000);
    expect(
      stopReason({ ...base, asked: 1, lastAskedAt: yesterday }, NOW),
    ).toMatch(/give it a week/);
    const longAgo = new Date(NOW.getTime() - (QUIET_DAYS + 1) * 86_400_000);
    expect(
      stopReason({ ...base, asked: 1, lastAskedAt: longAgo }, NOW),
    ).toBeNull();
  });

  it("stops asking after three letters, whatever the dates say", () => {
    const longAgo = new Date(NOW.getTime() - 60 * 86_400_000);
    expect(
      stopReason({ ...base, asked: MAX_ASKS, lastAskedAt: longAgo }, NOW),
    ).toMatch(/belongs with a person/);
  });
});
