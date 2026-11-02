import { describe, expect, it } from "vitest";
import { unknownNumbers } from "../src/server/modules/agents/reporter.agent";

// The Reporter's one hard rule: it may not state a figure it was not given.
// These cases are the rule, so they are tested without a database or a
// model — the check is pure.

const figures = {
  "payments taken": "3",
  "total taken": "$1,500.00",
  "owed to you now": "$1,275.00",
  "open invoices": "2",
  "overdue invoices": "1",
  "set aside in tax_reserve:shop": "$150.00",
};

describe("reporter · figures it was given", () => {
  it("accepts a report built only from them", () => {
    expect(
      unknownNumbers(
        "You took 3 payments, $1,500.00 in all. $1,275.00 is yours to release, and $150.00 is set aside for tax. Of 2 open invoices, 1 is overdue.",
        figures,
      ),
    ).toEqual([]);
  });

  it("accepts a figure read back without its cents", () => {
    expect(
      unknownNumbers("You have $1,275 waiting to be released.", figures),
    ).toEqual([]);
  });

  it("catches a total it worked out for itself", () => {
    // $1,500.00 minus $150.00 is a real sum, and still not a figure it was
    // handed — which is exactly the mistake this seat must not make.
    expect(unknownNumbers("That leaves $1,350.00 after tax.", figures)).toEqual(
      ["$1,350.00"],
    );
  });

  it("catches an invented average, percentage and count", () => {
    expect(unknownNumbers("Your average sale was $500.00.", figures)).toEqual([
      "$500.00",
    ]);
    expect(unknownNumbers("Fees took 2.9% of that.", figures)).toEqual([
      "2.9%",
    ]);
    expect(unknownNumbers("You issued 47 invoices.", figures)).toEqual(["47"]);
  });

  it("allows a single digit in prose, since it is not a claim about money", () => {
    expect(unknownNumbers("Only 1 thing needs you today.", figures)).toEqual(
      [],
    );
    expect(
      unknownNumbers("There are 9 days left in the month.", figures),
    ).toEqual([]);
  });

  it("says nothing about a report with no numbers at all", () => {
    expect(
      unknownNumbers(
        "Nothing has arrived yet, so there is nothing to tell.",
        figures,
      ),
    ).toEqual([]);
  });
});
