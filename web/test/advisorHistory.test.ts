import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  type IsolatedDb,
  postgresAvailable,
} from "./helpers/pgTestDb";

// The transcript, against a real Postgres (skipped when none is reachable).
//
// Two guarantees earn the test. A chat id is something the browser sends, so
// it is a claim: one belonging to someone else must not be honoured, or a
// guessed id would file your question into a stranger's conversation — and
// then read it back. And deleting a conversation has to take its turns with
// it, because a row left behind is an answer nobody can see and nobody can
// remove.
const available = await postgresAvailable();

describe.skipIf(!available)("advisor history (Postgres)", () => {
  let history: typeof import("../src/server/modules/agents/history.service");
  let db: typeof import("../src/server/db/client");
  let temp: IsolatedDb;

  beforeAll(async () => {
    temp = await createTestDb();
    process.env.DATABASE_URL = temp.url;
    db = await import("../src/server/db/client");
    history = await import("../src/server/modules/agents/history.service");
  });

  afterAll(async () => {
    await db?.closeDb();
    await temp?.dispose();
  });

  const answer = (question: string) => ({
    question,
    query: "outstanding",
    source: "ledger" as const,
    why: "because",
    caption: "Outstanding invoices",
    rows: [{ total: "1200" }],
    answer: "You are owed $12.00.",
    model: "claude-opus-5-5",
    pickedBy: "advisor@1",
  });

  it("opens a conversation on the first question and keeps the next one in it", async () => {
    const first = await history.recordAdvisorTurn(
      "tess",
      null,
      answer("What am I owed?"),
      120,
      "app",
    );
    const second = await history.recordAdvisorTurn(
      "tess",
      first,
      answer("And last month?"),
      120,
      "app",
    );
    expect(second).toBe(first);

    const turns = await history.chatTurns("tess", first);
    expect(turns.map((t) => t.question)).toEqual([
      "What am I owed?",
      "And last month?",
    ]);

    const chats = await history.listChats("tess");
    expect(chats).toHaveLength(1);
    // Named after the first question, not the last and not by a model.
    expect(chats[0]?.title).toBe("What am I owed?");
    expect(chats[0]?.turns).toBe(2);
  });

  it("will not file a turn into another owner's conversation", async () => {
    const tess = await history.recordAdvisorTurn(
      "tess2",
      null,
      answer("Mine"),
      1,
      "app",
    );
    // vic sends tess's id. It is a claim, so it buys nothing.
    const vic = await history.recordAdvisorTurn(
      "vic",
      tess,
      answer("Yours"),
      1,
      "app",
    );
    expect(vic).not.toBe(tess);

    // And it cannot be read back either.
    expect(await history.chatTurns("vic", tess)).toEqual([]);
    expect(
      (await history.chatTurns("tess2", tess)).map((t) => t.question),
    ).toEqual(["Mine"]);
  });

  it("takes the turns with the conversation, and only that owner's", async () => {
    const mine = await history.recordAdvisorTurn(
      "dana",
      null,
      answer("Keep"),
      1,
      "app",
    );
    const other = await history.recordAdvisorTurn(
      "erin",
      null,
      answer("Untouched"),
      1,
      "app",
    );

    // Someone else's delete does nothing at all.
    await history.deleteChat("erin", mine);
    expect(await history.chatTurns("dana", mine)).toHaveLength(1);

    await history.deleteChat("dana", mine);
    expect(await history.listChats("dana")).toEqual([]);
    expect(await history.chatTurns("dana", mine)).toEqual([]);
    expect(await history.chatTurns("erin", other)).toHaveLength(1);
  });

  it("puts pinned conversations first, whatever their order of use", async () => {
    const older = await history.recordAdvisorTurn(
      "pat",
      null,
      answer("Older"),
      1,
      "app",
    );
    await history.recordAdvisorTurn("pat", null, answer("Newer"), 1, "app");

    expect((await history.listChats("pat")).map((c) => c.title)).toEqual([
      "Newer",
      "Older",
    ]);

    await history.setChatPinned("pat", older, true);
    const pinned = await history.listChats("pat");
    expect(pinned.map((c) => c.title)).toEqual(["Older", "Newer"]);
    expect(pinned[0]?.pinned).toBe(true);
  });

  it("reopens the conversation last used", async () => {
    const first = await history.recordAdvisorTurn(
      "quinn",
      null,
      answer("One"),
      1,
      "app",
    );
    const second = await history.recordAdvisorTurn(
      "quinn",
      null,
      answer("Two"),
      1,
      "app",
    );
    expect(await history.latestChatId("quinn")).toBe(second);

    // Going back to the first one moves it to the top.
    await history.recordAdvisorTurn("quinn", first, answer("Three"), 1, "app");
    expect(await history.latestChatId("quinn")).toBe(first);
  });

  it("cuts a long title at a word, and never at a model's suggestion", async () => {
    const long =
      "What did every single customer of mine pay me during the whole of the last financial year, in total";
    const id = await history.recordAdvisorTurn(
      "rory",
      null,
      answer(long),
      1,
      "app",
    );
    const [chat] = await history.listChats("rory");
    expect(chat?.id).toBe(id);
    expect(chat?.title.length).toBeLessThanOrEqual(81);
    expect(chat?.title.endsWith("…")).toBe(true);
    // Cut at a space, so the title does not stop mid-word.
    expect(chat?.title.slice(0, -1).endsWith(" ")).toBe(false);
    expect(long.startsWith(chat?.title.slice(0, -1) ?? "")).toBe(true);
  });
});
