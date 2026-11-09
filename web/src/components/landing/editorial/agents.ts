// The table. Twelve seats in the order a payment travels: the members that
// move money are plain deterministic code and run today; the ones that think
// are in build. `status` is the only thing that should ever be edited to
// claim otherwise.

export type Seat = {
  id: string;
  name: string;
  role: string;
  engine: "code" | "llm";
  status: "live" | "building";
  /** The face this seat sits at, as % of the painting. */
  head: [number, number];
  epigram: string;
  task: string;
  when: string;
  chips: string[];
  facts: ({ label: string } & ({ code: string } | { text: string }))[];
};

export const TABLE: Seat[] = [
  {
    id: "teller",
    name: "Teller",
    role: "Takes the payment",
    engine: "code",
    status: "live",
    head: [36.5, 39.5],
    epigram: "Opens the hand, closes the till.",
    task: "Opens a PayPal order for exactly what is still due on an invoice, then captures it when the payer approves. The order id is kept, so a capture always finds its way back to one invoice.",
    when: "The moment a payer presses pay.",
    chips: ["Orders v2", "One invoice", "Idempotent"],
    facts: [
      { label: "Calls", code: "startPaypalOrder()" },
      { label: "Then", code: "capturePaypalOrder()" },
      { label: "Limit", text: "Can only charge what the invoice still owes." },
    ],
  },
  {
    id: "courier",
    name: "Courier",
    role: "Carries the news",
    engine: "code",
    status: "live",
    head: [28.4, 38.4],
    epigram: "Never trusts the letter, always checks the sender.",
    task: "Picks up what PayPal's webhook left behind and reads the capture back from PayPal before anything is believed. Claims its work with a row lock, retries with a growing delay, and parks a job that keeps failing instead of looping on it.",
    when: "Every minute, and whenever a capture lands.",
    chips: ["Outbox", "Skip locked", "8 tries"],
    facts: [
      { label: "Calls", code: "drainOutbox()" },
      { label: "Reads", code: "GET /v2/payments/captures/:id" },
      {
        label: "Limit",
        text: "A webhook body is a hint; it is never a number.",
      },
    ],
  },
  {
    id: "ledger",
    name: "Ledger",
    role: "Keeps the books",
    engine: "code",
    status: "live",
    head: [50.2, 37.2],
    epigram: "Writes both sides, or neither.",
    task: "Posts every movement as double entry in integer minor units. A transaction that does not balance is refused before the database is touched, and a transaction id can only be posted once — so a replay writes nothing at all.",
    when: "On every captured payment.",
    chips: ["Double entry", "Minor units", "Replay safe"],
    facts: [
      { label: "Calls", code: "ledger.post(txn, postings)" },
      { label: "Holds", code: "trialBalance() === 0n" },
      { label: "Limit", text: "No floats, anywhere, ever." },
    ],
  },
  {
    id: "herald",
    name: "Herald",
    role: "Tells your server",
    engine: "code",
    status: "live",
    head: [61.4, 38.4],
    epigram: "Speaks once, and signs what it says.",
    task: "Posts a signed event to your endpoint the moment an invoice turns paid, retries when your server is having a bad minute, and keeps a delivery log you can read.",
    when: "On the transition to paid — once, whoever caused it.",
    chips: ["HMAC", "Retries", "Delivery log"],
    facts: [
      { label: "Sends", code: "checkout.paid · invoice.paid" },
      { label: "Header", code: "Payus-Signature" },
      { label: "Limit", text: "Fires on the transition, not on every report." },
    ],
  },
  {
    id: "scribe",
    name: "Scribe",
    role: "Writes the invoices",
    engine: "code",
    status: "live",
    head: [21.3, 34.8],
    epigram: "Remembers the date you forgot.",
    task: "Issues the next invoice of a recurring series and reminds a client who is late. Two runs at once cannot issue the same invoice twice; the row is claimed, not merely read.",
    when: "Daily, and when you open your invoices.",
    chips: ["Recurring", "Reminders", "Claimed"],
    facts: [
      { label: "Calls", code: "runInvoiceSchedule()" },
      { label: "Guards", code: "FOR UPDATE SKIP LOCKED" },
      { label: "Limit", text: "Only sends where an address was given." },
    ],
  },
  {
    id: "guardian",
    name: "Guardian",
    role: "Refuses what breaks a rule",
    engine: "code",
    status: "live",
    head: [88.3, 27.8],
    epigram: "Not clever. Not negotiable.",
    task: "Checks every proposal against limits you set: per payment, per day, who may be paid at all, whether a price is strange for its category. An approval is bound to the hash of the proposal it approved, so changing a digit afterwards voids it.",
    when: "Between every proposal and every execution.",
    chips: ["Deterministic", "Hash-bound", "Reason logged"],
    facts: [
      { label: "Calls", code: "decide(proposal, policy, context)" },
      { label: "Cannot", text: "Write a proposal or edit one." },
      { label: "Writes", code: "audit_log(verdict, reason)" },
    ],
  },
  {
    id: "allocator",
    name: "Allocator",
    role: "Proposes the split",
    engine: "llm",
    status: "live",
    head: [5.1, 32.5],
    epigram: "Divides the morning's takings before noon.",
    task: "Suggests how money that just landed should be divided: the platform's cut, tax set aside, what is yours to spend. It writes a proposal and nothing more.",
    when: "Each time money arrives.",
    chips: ["Proposal", "Percent + fixed", "Largest remainder"],
    facts: [
      { label: "Reads", code: "split_rules · ledger balances" },
      {
        label: "Limit",
        text: "Rounding is settled in code, not by the model.",
      },
    ],
  },
  {
    id: "payer",
    name: "Payer",
    role: "Pays what is due",
    engine: "llm",
    status: "live",
    head: [77.1, 37.2],
    epigram: "Knows which pot the bill comes out of.",
    task: "Watches what falls due and proposes paying it from the right pot. Short in one place, it proposes a move from another — and that move is a proposal too.",
    when: "Daily, and on a due date.",
    chips: ["Due dates", "Pot to pot", "Needs approval"],
    facts: [
      { label: "Proposes", code: "payout_intent" },
      {
        label: "Limit",
        text: "Cannot pay a recipient the Guardian has not met.",
      },
    ],
  },
  {
    id: "reporter",
    name: "Reporter",
    role: "Writes the day down",
    engine: "llm",
    status: "live",
    head: [16.2, 23],
    epigram: "Counts nothing. Explains everything.",
    task: "Turns the day's rows into a few sentences: what came in, what was set aside, what is still owed to you, what was refused and why.",
    when: "On request, and every morning once you want it.",
    chips: ["From SQL", "No arithmetic", "Checked"],
    facts: [
      { label: "Calls", code: "unknownNumbers(report, figures)" },
      {
        label: "Limit",
        text: "A number it was not given throws the report away.",
      },
    ],
  },
  {
    id: "builder",
    name: "Builder",
    role: "Builds the storefront",
    engine: "llm",
    status: "live",
    head: [83.2, 33.6],
    epigram: "Describe the shop; walk into it.",
    task: "Turns a conversation into a storefront: products, prices, a page at your own address. It writes the page as blocks — the same ones you would have used — so every line of it is yours to edit afterwards. It will change a page you already have, and put right the things this app can check; it cannot write markup, and it cannot write an address, only name one of yours.",
    when: "When you ask for a shop, or ask it to change one.",
    chips: ["Blocks, not markup", "Your addresses only", "Owner applies"],
    facts: [
      { label: "Writes", code: "storefront_config (validated)" },
      {
        label: "Limit",
        text: "It proposes; the page is yours to apply and yours to publish.",
      },
    ],
  },
  {
    id: "collector",
    name: "Collector",
    role: "Chases the overdue",
    engine: "llm",
    status: "live",
    head: [11.7, 36],
    epigram: "Polite on the first letter.",
    task: "Drafts the follow-up for an invoice that has gone quiet, in your voice. Whether to write at all is not its decision: that is settled in code before it is asked, and it stops after three letters.",
    when: "After a due date passes.",
    chips: ["Drafts", "You send", "Stops at three"],
    facts: [
      { label: "Calls", code: "stopReason(invoice, now)" },
      { label: "Limit", text: "Writes the message; never changes the amount." },
      { label: "Checked", code: "unknownNumbers(draft, figures)" },
    ],
  },
  {
    id: "advisor",
    name: "Advisor",
    role: "Answers from the books",
    engine: "llm",
    status: "live",
    head: [72.1, 38.4],
    epigram: "Asked anything, looks it up.",
    task: "Answers a question about your money — including the ones that end in bad news. It does not write the query: it picks one of six we wrote, we run it scoped to you, and the rows it read are shown under the answer.",
    when: "Whenever you ask.",
    chips: ["Picks a query", "Read only", "Shows the rows"],
    facts: [
      { label: "Chooses", code: "QUESTIONS[].name" },
      { label: "Limit", text: "Has no write access of any kind." },
      { label: "Checked", code: "unknownNumbers(answer, rowFigures)" },
    ],
  },
];

export const LIVE_SEATS = TABLE.filter((s) => s.status === "live").length;

const WORDS = [
  "No",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
] as const;

/** Written out, so the headline cannot drift from the table below it. */
export const spell = (n: number) => WORDS[n] ?? String(n);
