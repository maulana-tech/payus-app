import "server-only";
import AnthropicBedrock, {
  AnthropicBedrockMantle,
} from "@anthropic-ai/bedrock-sdk";
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

/**
 * Which id to ask Bedrock for. Two shapes exist and they are served by two
 * different endpoints, which is measurable rather than a matter of taste:
 *
 *   anthropic.claude-opus-5-5        the Messages (Mantle) endpoint, us-east-1
 *   au.anthropic.claude-opus-5-5     an inference profile, InvokeModel
 *
 * Outside us-east-1 the Messages endpoint answers 404 for every id, and
 * InvokeModel answers "retry with an inference profile" for a bare one — so
 * a region like ap-southeast-2 needs the profile form in BEDROCK_MODEL_ID.
 */
const bedrockModel = () =>
  getServerEnv().BEDROCK_MODEL_ID?.trim() || `anthropic.${MODEL}`;

/** A profile id names a region or the globe; a bare id names the model. */
const isInferenceProfile = (id: string) => !id.startsWith("anthropic.");

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

/**
 * The slice of a client this file actually uses. The three clients (first
 * party, Bedrock Messages, Bedrock InvokeModel) expose wider and slightly
 * different surfaces, so the type says only what is called here.
 */
type Caller = {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
    ): Promise<Anthropic.Message>;
  };
};

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
  const model = which === "bedrock" ? bedrockModel() : MODEL;
  if (!client || clientBackend !== which) {
    client =
      which === "bedrock"
        ? isInferenceProfile(model)
          ? new AnthropicBedrock({ awsRegion: bedrockRegion() })
          : new AnthropicBedrockMantle({ awsRegion: bedrockRegion() })
        : new Anthropic({ apiKey: getServerEnv().ANTHROPIC_API_KEY });
    clientBackend = which;
  }
  return { caller: client, which, model };
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
          : `Bedrock does not serve ${model} in ${bedrockRegion()}. Outside us-east-1 you need an inference profile id in BEDROCK_MODEL_ID, such as au.anthropic.${MODEL} for Sydney.`,
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
