import "server-only";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import Anthropic from "@anthropic-ai/sdk";
import { getServerEnv } from "../../env.server";

// The one place a model is called. Everything an agent sends goes through
// here, so the model, the effort, and the shape of what comes back are
// decided in a single file — and so a deployment without a key degrades to
// an honest "not configured" instead of a half-working agent.

/**
 * Opus 5.5: thinking is always on, so the parameter is omitted entirely.
 * Bedrock serves the same model under an `anthropic.` prefixed id.
 */
const MODEL = "claude-opus-5-5";
export const AGENT_MODEL = MODEL;

/** Bumped whenever a prompt changes, and recorded on every proposal. */
export const PROMPT_VERSION = "2026-11-02.1";

export class ClaudeNotConfiguredError extends Error {
  constructor(
    message = "No ANTHROPIC_API_KEY and no Bedrock region, so the agents are switched off.",
  ) {
    super(message);
    this.name = "ClaudeNotConfiguredError";
  }
}

export class ClaudeRefusedError extends Error {
  constructor(readonly category: string | null) {
    super("Claude declined to answer this one.");
    this.name = "ClaudeRefusedError";
  }
}

/**
 * The provider accepted the credentials and refused the model. On Bedrock
 * this is the usual first wall: a key authenticates, and the AWS account
 * still has no access to the model granted.
 */
export class ClaudeAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeAccessError";
  }
}

export class ClaudeShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeShapeError";
  }
}

export type Backend = "api" | "bedrock";

const bedrockRegion = () => {
  const env = getServerEnv();
  return env.BEDROCK_AWS_REGION || env.AWS_REGION;
};

/** Which way out, following the explicit setting or the key that is present. */
export function backend(): Backend | null {
  const env = getServerEnv();
  if (env.ANTHROPIC_BACKEND === "bedrock")
    return bedrockRegion() ? "bedrock" : null;
  return env.ANTHROPIC_API_KEY ? "api" : null;
}

/**
 * Whether the agents have somewhere to go. On Bedrock this means a region is
 * set, not that the credentials work: the AWS chain resolves at call time —
 * an IAM role leaves no environment variable to check — so a credentials
 * problem surfaces as an error on the first run rather than here.
 */
export const claudeConfigured = () => backend() !== null;

/** Both clients expose the same `messages` surface; only the id differs. */
type Caller = Pick<Anthropic, "messages">;

let client: Caller | undefined;
let clientBackend: Backend | undefined;

function anthropic(): { caller: Caller; which: Backend; model: string } {
  const which = backend();
  if (!which)
    throw new ClaudeNotConfiguredError(
      getServerEnv().ANTHROPIC_BACKEND === "bedrock"
        ? "Bedrock is selected but no region is set (BEDROCK_AWS_REGION or AWS_REGION)."
        : undefined,
    );
  if (!client || clientBackend !== which) {
    client =
      which === "bedrock"
        ? new AnthropicBedrockMantle({ awsRegion: bedrockRegion() })
        : new Anthropic({ apiKey: getServerEnv().ANTHROPIC_API_KEY });
    clientBackend = which;
  }
  // Bedrock namespaces the model; the first-party API does not.
  return {
    caller: client,
    which,
    model: which === "bedrock" ? `anthropic.${MODEL}` : MODEL,
  };
}

/**
 * Turns a provider's "no" into something the owner can act on. A 403 from
 * Bedrock means the credentials were fine and the account has no access to
 * the model; a 404 there means the region does not serve it at all.
 */
async function call<T>(
  which: Backend,
  model: string,
  send: () => Promise<T>,
): Promise<T> {
  try {
    return await send();
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (which === "bedrock" && (status === 403 || status === 404))
      throw new ClaudeAccessError(
        status === 403
          ? `Bedrock accepted the credentials but this AWS account has no access to ${model}. Grant it in the Bedrock console under Model access, in the region you configured.`
          : `${model} is not served by Bedrock in the region you configured. Try us-east-1.`,
      );
    if (status === 401 || status === 403)
      throw new ClaudeAccessError(
        "Claude refused the credentials for this request.",
      );
    throw error;
  }
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
  const { caller, model, which } = anthropic();
  const response = await call(which, model, () =>
    caller.messages.create({
      model,
      // A decision object is a few hundred tokens; this is a deliberate cap.
      max_tokens: 4096,
      system: input.system,
      output_config: {
        effort: input.effort ?? "low",
        format: { type: "json_schema", schema: input.schema },
      },
      messages: [{ role: "user", content: input.prompt }],
    }),
  );

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
