// The topic names, alone in a file that imports nothing: the queue's
// producers and its handlers both need them, and a shared constant must not
// drag one into the other.

export const topics = {
  /** A PayPal capture completed; the amounts are read back from PayPal. */
  captureCompleted: "paypal.capture.completed",
  /** A capture that was recorded but whose split did not get written. */
  settleCapture: "ledger.settle.capture",
} as const;

export type Topic = (typeof topics)[keyof typeof topics];
