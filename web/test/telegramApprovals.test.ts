import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createTestDb,
  type IsolatedDb,
  postgresAvailable,
} from "./helpers/pgTestDb";

// Approving from a chat window. What is tested here is the authority: a
// delivery has to be Telegram's, a chat only acts for the account that
// proved it, a code works once, and the decision itself goes down the same
// guardian path as the dashboard's buttons.
const available = await postgresAvailable();

const sent = vi.hoisted(() => ({
  messages: [] as { chatId: string; html: string }[],
  edits: [] as { chatId: string; html: string }[],
  answers: [] as (string | undefined)[],
  /** Set to make the next reply fail, the way a blocked chat does. */
  failNext: false,
}));

vi.mock("../src/server/lib/telegram", () => ({
  telegramConfigured: () => true,
  telegramSecret: () => "shared-secret",
  escapeHtml: (text: string) => text,
  sendMessage: async (chatId: string, html: string) => {
    if (sent.failNext) {
      sent.failNext = false;
      throw new Error("Telegram sendMessage failed: 403 bot was blocked");
    }
    sent.messages.push({ chatId, html });
    return { messageId: sent.messages.length };
  },
  editMessage: async (chatId: string, _id: number, html: string) => {
    sent.edits.push({ chatId, html });
  },
  answerCallback: async (_id: string, text?: string) => {
    sent.answers.push(text);
  },
}));

describe.skipIf(!available)("telegram approvals (Postgres)", () => {
  let route: typeof import("../src/app/api/webhooks/telegram/route");
  let telegram: typeof import("../src/server/modules/notifications/telegram.service");
  let guardian: typeof import("../src/server/modules/guardian/guardian.service");
  let ledger: typeof import("../src/server/modules/ledger/ledger.service");
  let db: typeof import("../src/server/db/client");
  let temp: IsolatedDb;

  beforeAll(async () => {
    temp = await createTestDb();
    process.env.DATABASE_URL = temp.url;
    process.env.PAYPAL_PAYOUTS_ENABLED = "";
    db = await import("../src/server/db/client");
    route = await import("../src/app/api/webhooks/telegram/route");
    telegram = await import(
      "../src/server/modules/notifications/telegram.service"
    );
    guardian = await import("../src/server/modules/guardian/guardian.service");
    ledger = await import("../src/server/modules/ledger/ledger.service");

    for (const owner of ["tess", "vic"])
      await ledger.post(
        { id: `capture:T-${owner}`, kind: "payment.captured", owner },
        [
          { account: ledger.account.paypalCash(), debitMinor: 100_000n },
          {
            account: ledger.account.merchantPayable(owner),
            creditMinor: 100_000n,
          },
        ],
      );
    // Everything above $1 needs a look, so proposals wait.
    for (const owner of ["tess", "vic"])
      await guardian.savePolicy(owner, {
        newRecipientNeedsApproval: false,
        approveAboveMinor: "100",
      });
  });

  afterAll(async () => {
    await db?.closeDb();
    await temp?.dispose();
  });

  const post = (body: unknown, secret = "shared-secret") =>
    route.POST(
      new Request("http://payus.test/api/webhooks/telegram", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": secret,
        },
        body: JSON.stringify(body),
      }),
    );

  const startWith = (chatId: number, text: string) =>
    post({ message: { chat: { id: chatId }, text } });

  const propose = (owner: string, intentKey: string) =>
    guardian.proposePayout({
      owner,
      payload: {
        amountMinor: "5000",
        currency: "USD",
        destination: `${owner}@example.com`,
        intentKey,
      },
    });

  it("refuses a delivery that is not Telegram's", async () => {
    const response = await post({ message: {} }, "guessed");
    expect(response.status).toBe(401);
  });

  // The route's promise is that Telegram never gets a non-2xx, because a
  // retry would record a second act of consent for one press of a button.
  // Failing to *speak back* is the realistic way that promise breaks: a chat
  // that blocked the bot, a message too old to edit, a rate limit.
  it("still answers 200 when the reply itself fails", async () => {
    sent.failNext = true;
    const response = await startWith(4242, "/start nonsense");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(sent.failNext).toBe(false);
  });

  it("links a chat with a single-use code", async () => {
    const code = await telegram.linkCode("tess");
    await startWith(100, `/start ${code}`);
    expect(await telegram.ownerForChat("100")).toBe("tess");

    // The same code from another chat is worthless.
    await startWith(999, `/start ${code}`);
    expect(await telegram.ownerForChat("999")).toBeNull();
  });

  it("asks the linked chat when the Guardian holds something", async () => {
    sent.messages.length = 0;
    const proposal = await propose("tess", "attempt-1");
    expect(proposal.status).toBe("awaiting");
    // The side effect is not awaited, so give the microtask a turn.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent.messages.at(-1)?.chatId).toBe("100");
    expect(sent.messages.at(-1)?.html).toContain("Waiting for you");
  });

  it("approves from the chat, down the same path as the button", async () => {
    const proposal = await propose("tess", "attempt-2");
    await post({
      callback_query: {
        id: "cb1",
        data: `a:${proposal.id}`,
        message: { chat: { id: 100 }, message_id: 7 },
      },
    });

    const after = (await guardian.recentProposals("tess")).find(
      (row) => row.id === proposal.id,
    );
    expect(after?.status).toBe("executed");
    // And the consent says where it came from.
    const trail = await guardian.auditTrail("tess");
    const approved = trail.find(
      (row) => row.proposalId === proposal.id && row.action === "approved",
    );
    expect(approved?.detail).toMatchObject({ via: "telegram" });
  });

  it("will not let a chat decide another account's proposal", async () => {
    const theirs = await propose("vic", "attempt-3");
    sent.answers.length = 0;
    await post({
      callback_query: {
        id: "cb2",
        data: `a:${theirs.id}`,
        message: { chat: { id: 100 }, message_id: 8 },
      },
    });

    const after = (await guardian.recentProposals("vic")).find(
      (row) => row.id === theirs.id,
    );
    expect(after?.status).toBe("awaiting");
    expect(sent.answers.at(-1)).toBeTruthy();
  });

  it("ignores a chat it has never met", async () => {
    const proposal = await propose("tess", "attempt-4");
    await post({
      callback_query: {
        id: "cb3",
        data: `a:${proposal.id}`,
        message: { chat: { id: 555 }, message_id: 9 },
      },
    });
    const after = (await guardian.recentProposals("tess")).find(
      (row) => row.id === proposal.id,
    );
    expect(after?.status).toBe("awaiting");
    expect(sent.answers.at(-1)).toMatch(/not linked/);
  });
  it("lists every command it has, not just the two it started with", async () => {
    sent.messages.length = 0;
    await startWith(7100, "/help");
    const listed = sent.messages[0].html;
    for (const command of ["/status", "/ask", "/today", "/help", "/unlink"])
      expect(listed).toContain(command);
  });

  it("answers an unlinked chat with what it can do and how to link", async () => {
    sent.messages.length = 0;
    await startWith(7001, "/help");
    const [first] = sent.messages;
    expect(first.html).toContain("not linked");
    for (const command of ["/status", "/help", "/unlink"])
      expect(first.html).toContain(command);
    expect(first.html).toContain("Link a chat");
  });

  it("tells a linked chat what is waiting, with the buttons on each", async () => {
    // Chat 100 is already tess's from the linking test above; asking for a
    // second code would be refused, which is itself the right behaviour.
    sent.messages.length = 0;
    await startWith(100, "/status");
    const before = sent.messages.length;

    const proposal = await propose("tess", "status-check");
    expect(proposal.status).toBe("awaiting");

    sent.messages.length = 0;
    await startWith(100, "/status");
    expect(sent.messages.length).toBeGreaterThan(before);
    // `some`, not index 0: proposing also notifies the chat, and that side
    // effect is deliberately not awaited, so it can land in any order.
    const heading = (m: { html: string }) => m.html.includes("waiting for");
    const card = (m: { html: string }) => m.html.includes("Waiting for you");
    expect(sent.messages.some(heading)).toBe(true);
    // One message per proposal, because each carries its own two buttons.
    expect(sent.messages.some(card)).toBe(true);

    // Telegram appends @thebot in groups; the command still has to work.
    sent.messages.length = 0;
    await startWith(100, "/status@payus1_bot");
    expect(sent.messages.some(heading)).toBe(true);
  });

  it("lets a chat detach itself, and then acts for nobody", async () => {
    const code = await telegram.linkCode("vic");
    await startWith(7003, `/start ${code}`);
    expect(await telegram.ownerForChat("7003")).toBe("vic");

    sent.messages.length = 0;
    await startWith(7003, "/unlink");
    expect(sent.messages.at(-1)?.html).toContain("Unlinked");
    expect(await telegram.ownerForChat("7003")).toBeNull();
  });
});
