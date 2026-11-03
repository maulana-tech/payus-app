import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  type IsolatedDb,
  postgresAvailable,
} from "./helpers/pgTestDb";

// The Advisor does not write the query and cannot write anything else. It
// picks one of ours by name, we run it scoped to the owner, and the answer
// is then held to the rows: a figure that is not in them throws the answer
// away. These are those two rules, against a real database.
const available = await postgresAvailable();

type Completion = {
  json: unknown;
  model: string;
  promptVersion: string;
};

/** An `ask` that answers from a script, and records what it was asked. */
function scripted(replies: unknown[]) {
  const prompts: string[] = [];
  let next = 0;
  const ask = async (input: { prompt: string }): Promise<Completion> => {
    prompts.push(input.prompt);
    const json = replies[next] ?? replies[replies.length - 1];
    next += 1;
    return { json, model: "test", promptVersion: "test" };
  };
  return { ask: ask as never, prompts };
}

describe.skipIf(!available)("advisor (Postgres)", () => {
  let advisor: typeof import("../src/server/modules/agents/advisor.agent");
  let invoices: typeof import("../src/server/modules/invoices/invoices.service");
  let db: typeof import("../src/server/db/client");
  let temp: IsolatedDb;

  beforeAll(async () => {
    temp = await createTestDb();
    process.env.DATABASE_URL = temp.url;
    db = await import("../src/server/db/client");
    advisor = await import("../src/server/modules/agents/advisor.agent");
    invoices = await import("../src/server/modules/invoices/invoices.service");

    await invoices.createInvoice("ida", {
      number: "INV-1",
      clientName: "Acme",
      clientEmail: null,
      dueDate: "2026-01-01",
      notes: "",
      items: [{ description: "Work", quantity: 1, unitPrice: "400.00" }],
      recurrence: "none",
    });
    await invoices.createInvoice("ida", {
      number: "INV-2",
      clientName: "Blue Harbour",
      clientEmail: null,
      dueDate: "2026-12-01",
      notes: "",
      items: [{ description: "Work", quantity: 1, unitPrice: "150.00" }],
      recurrence: "none",
    });
  });

  afterAll(async () => {
    await db?.closeDb();
    await temp?.dispose();
  });

  it("answers from the rows of the query it chose", async () => {
    const { ask, prompts } = scripted([
      { query: "open_invoices", why: "what is still owed" },
      {
        answer:
          "Two invoices are open: INV-1 for $400.00, which is overdue, and INV-2 for $150.00.",
      },
    ]);
    const result = await advisor.runAdvisor("ida", "What am I owed?", { ask });

    expect(result.query).toBe("open_invoices");
    expect(result.rows).toHaveLength(2);
    // The rows go to the model, and come back to the owner with the answer.
    expect(prompts[1]).toContain("INV-1");
    expect(result.answer).toContain("$400.00");
  });

  it("throws the answer away when a figure is not in the rows", async () => {
    const { ask } = scripted([
      { query: "open_invoices", why: "totals" },
      // $550.00 is the correct sum, and still not a figure it was given.
      { answer: "You are owed $550.00 in all." },
    ]);
    await expect(
      advisor.runAdvisor("ida", "What am I owed in total?", { ask }),
    ).rejects.toThrow(/not in the rows/);
  });

  it("will not run a query we do not have", async () => {
    const { ask } = scripted([
      { query: "drop_everything", why: "no" },
      { answer: "…" },
    ]);
    await expect(
      advisor.runAdvisor("ida", "Delete my data", { ask }),
    ).rejects.toThrow(/did not choose a query we have/);
  });

  it("sees only its own owner's rows", async () => {
    const { ask } = scripted([
      { query: "open_invoices", why: "theirs" },
      { answer: "There is nothing open." },
    ]);
    const result = await advisor.runAdvisor("someone-else", "Anything?", {
      ask,
    });
    expect(result.rows).toEqual([]);
  });
});

describe("advisor · what counts as a figure", () => {
  it("allows every value in the rows, and the number of rows", async () => {
    const { figuresIn } = await import(
      "../src/server/modules/agents/advisor.agent"
    );
    const figures = figuresIn([
      { invoice: "INV-1", owed: "$400.00" },
      { invoice: "INV-2", owed: "$150.00" },
    ]);
    expect(Object.values(figures)).toContain("$400.00");
    expect(figures.rows).toBe("2");
  });
});
