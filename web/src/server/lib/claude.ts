import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getServerEnv } from "../../env.server";

// The one place a model is called. Everything an agent sends goes through
// here, so the model, the effort, and the shape of what comes back are
// decided in a single file — and so a deployment without a key degrades to
// an honest "not configured" instead of a half-working agent.

/** Opus 5.5: thinking is always on, so the parameter is omitted entirely. */
export const AGENT_MODEL = "claude-opus-5-5";

/** Bumped whenever a prompt changes, and recorded on every proposal. */
export const PROMPT_VERSION = "2026-11-02.1";

export class ClaudeNotConfiguredError extends Error {
  constructor() {
    super("No ANTHROPIC_API_KEY, so the agents are switched off.");
    this.name = "ClaudeNotConfiguredError";
  }
}

export class ClaudeRefusedError extends Error {
  constructor(readonly category: string | null) {
    super("Claude declined to answer this one.");
    this.name = "ClaudeRefusedError";
  }
}

export class ClaudeShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeShapeError";
  }
}

export const claudeConfigured = () => Boolean(getServerEnv().ANTHROPIC_API_KEY);

let client: Anthropic | undefined;

function anthropic(): Anthropic {
  const key = getServerEnv().ANTHROPIC_API_KEY;
  if (!key) throw new ClaudeNotConfiguredError();
  client ??= new Anthropic({ apiKey: key });
  return client;
}

/** What every agent call returns: the parsed JSON and what produced it. */
export type Completion = {
  json: unknown;
  model: string;
  promptVersion: string;
};

/**
 * Asks for one JSON object of a given shape. Structured outputs constrain
 * the response, so the model cannot answer with prose — and the caller
 * still validates the result, because a schema the API honours is not the
 * same as a decision this application is willing to act on.
 */
export async function askForJson(input: {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  /** Simple decisions do not need deep thinking; this is a cost lever. */
  effort?: "low" | "medium" | "high";
}): Promise<Completion> {
  const response = await anthropic().messages.create({
    model: AGENT_MODEL,
    // A decision object is a few hundred tokens; this is a deliberate cap.
    max_tokens: 4096,
    system: input.system,
    output_config: {
      effort: input.effort ?? "low",
      format: { type: "json_schema", schema: input.schema },
    },
    messages: [{ role: "user", content: input.prompt }],
  });

  if (response.stop_reason === "refusal")
    throw new ClaudeRefusedError(response.stop_details?.category ?? null);

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  if (!text.trim()) throw new ClaudeShapeError("The model answered nothing.");

  try {
    return {
      json: JSON.parse(text),
      model: response.model,
      promptVersion: PROMPT_VERSION,
    };
  } catch {
    throw new ClaudeShapeError("The model's answer was not JSON.");
  }
}
