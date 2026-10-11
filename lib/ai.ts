/**
 * Small, server-only Groq client used by the chat route handlers.
 *
 * The browser never receives the API key.  Groq exposes an OpenAI compatible
 * endpoint, so keeping the client here avoids adding another dependency to the
 * application and makes model fallback behaviour consistent for both chats.
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export type GroqMessage = {
  role: ChatRole;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: GroqToolCall[];
};

export type GroqToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type GroqTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type GroqAssistantMessage = GroqMessage & {
  role: 'assistant';
  tool_calls?: GroqToolCall[];
};

export type GroqCompletion = {
  provider: 'groq' | 'openrouter';
  model: string;
  message: GroqAssistantMessage;
};

export type CompletionOptions = {
  tools?: GroqTool[];
  toolChoice?: 'auto' | 'none' | 'required';
  maxTokens?: number;
  temperature?: number;
  parallelToolCalls?: boolean;
  deadlineMs?: number;
};

const DEFAULT_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
] as const;

/** Models are configurable so a deprecation at Groq does not take the chat down. */
export function groqModels() {
  const configured = [
    process.env.GROQ_MODEL,
    ...(process.env.GROQ_MODELS || '').split(','),
  ]
    .filter((model): model is string => typeof model === 'string' && model.trim().length > 0)
    .map(model => model.trim());
  return [...new Set([...configured, ...DEFAULT_MODELS])];
}

const DEFAULT_OPENROUTER_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'google/gemma-4-31b-it:free',
  'openrouter/free',
] as const;

/** Read a Hostinger/server-panel secret without treating pasted dotenv syntax as part of it. */
function serverSecret(name: string) {
  let value = process.env[name]?.trim() || '';
  if (value.startsWith(`${name}=`)) value = value.slice(name.length + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

/** Free OpenRouter models are the preferred provider for the private owner copilot. */
export function openRouterModels() {
  const configured = (process.env.OPENROUTER_MODELS || '').split(',')
    .filter(model => model.trim().length > 0)
    .map(model => model.trim());
  // Only :free models and the official free router are allowed. A deployment
  // config mistake must never turn this owner fallback into paid inference.
  return [...new Set([...configured, ...DEFAULT_OPENROUTER_MODELS])]
    .filter(model => model === 'openrouter/free' || model.endsWith(':free'))
    .slice(0, 4);
}

function responseError(provider: string, status: number, detail: string) {
  const error = new Error(`${provider} request failed (${status}): ${detail}`) as Error & {
    status?: number;
  };
  error.status = status;
  return error;
}

function normalizeAssistant(value: unknown): GroqAssistantMessage {
  if (!value || typeof value !== 'object') throw new Error('Provider returned no assistant message.');
  const raw = value as Record<string, unknown>;
  if (raw.role !== 'assistant') throw new Error('Provider returned an invalid assistant message.');
  const content = typeof raw.content === 'string' ? raw.content.trim() : null;
  const toolCalls = Array.isArray(raw.tool_calls) ? raw.tool_calls.flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const call = value as Record<string, unknown>;
    const fn = call.function && typeof call.function === 'object' ? call.function as Record<string, unknown> : null;
    if (call.type !== 'function' || typeof call.id !== 'string' || !fn || typeof fn.name !== 'string') return [];
    const args = typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {});
    try { JSON.parse(args); } catch { return []; }
    return [{ id: call.id, type: 'function' as const, function: { name: fn.name, arguments: args } }];
  }) : [];
  if (!content && !toolCalls.length) throw new Error('Provider returned an empty assistant message.');
  return { role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
}

/**
 * Call Groq with a short timeout and try each configured model in order.
 * We intentionally do not use a client-side SDK: this module is imported only
 * by route handlers and the key stays in the server environment.
 */
export async function completeGroq(
  messages: GroqMessage[],
  options: CompletionOptions = {},
): Promise<GroqCompletion> {
  const apiKey = serverSecret('GROQ_API_KEY');
  if (!apiKey) throw new Error('GROQ_API_KEY is not configured.');

  let lastError: unknown;
  const deadline = options.deadlineMs ?? Date.now() + 45_000;
  for (const model of groqModels()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(28_000, remaining));
    try {
      const body: Record<string, unknown> = {
        model,
        messages,
        max_tokens: options.maxTokens ?? 900,
        temperature: options.temperature ?? 0.2,
      };
      if (options.tools?.length) {
        body.tools = options.tools;
        body.tool_choice = options.toolChoice ?? 'auto';
        if (options.parallelToolCalls !== undefined) body.parallel_tool_calls = options.parallelToolCalls;
      }

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null) as {
        choices?: Array<{ finish_reason?: string; message?: unknown }>;
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        throw responseError('Groq', response.status, payload?.error?.message || 'Unknown provider error');
      }
      const choice = payload?.choices?.[0];
      if (choice?.finish_reason === 'length') throw new Error('Groq response was truncated.');
      return { provider: 'groq', model, message: normalizeAssistant(choice?.message) };
    } catch (error) {
      lastError = error;
      // A model can be temporarily rate limited or retired.  Trying the next
      // configured model keeps the feature available during those transitions.
      console.error(`Groq model ${model} failed`, error);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All Groq models failed.');
}

/** Call OpenRouter's free model pool. This key is server-only. */
export async function completeOpenRouter(
  messages: GroqMessage[],
  options: CompletionOptions = {},
): Promise<GroqCompletion> {
  const apiKey = serverSecret('OPENROUTER_API_KEY');
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured.');

  let lastError: unknown;
  const deadline = options.deadlineMs ?? Date.now() + 36_000;
  for (const model of openRouterModels()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(12_000, remaining));
    try {
      const body: Record<string, unknown> = {
        model,
        messages,
        max_tokens: options.maxTokens ?? 900,
        temperature: options.temperature ?? 0.2,
        provider: { max_price: { prompt: 0, completion: 0, request: 0 }, require_parameters: true },
        reasoning: { enabled: false },
      };
      if (options.tools?.length) {
        body.tools = options.tools;
        body.tool_choice = options.toolChoice ?? 'auto';
      }
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'http-referer': process.env.APP_ORIGIN || 'https://namchekitchen.ca',
          'x-openrouter-title': 'Namche Kitchen owner assistant',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null) as {
      model?: string;
      choices?: Array<{ finish_reason?: string; message?: unknown }>;
      error?: { message?: string };
      } | null;
      if (!response.ok) throw responseError('OpenRouter', response.status, payload?.error?.message || 'Unknown provider error');
      const choice = payload?.choices?.[0];
      if (choice?.finish_reason === 'length') throw new Error('OpenRouter response was truncated.');
      return { provider: 'openrouter', model: typeof payload?.model === 'string' ? payload.model : model, message: normalizeAssistant(choice?.message) };
    } catch (error) {
      lastError = error;
      console.error(`OpenRouter model ${model} failed`, error);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All OpenRouter models failed.');
}

/** Owner routing: OpenRouter free models first, then the configured Groq fallbacks. */
export async function completeOwnerAI(
  messages: GroqMessage[],
  options: CompletionOptions = {},
): Promise<GroqCompletion> {
  const deadline = options.deadlineMs ?? Date.now() + 65_000;
  try {
    return await completeOpenRouter(messages, { ...options, deadlineMs: Math.min(deadline - 15_000, Date.now() + 36_000) });
  } catch {
    return completeGroq(messages, { ...options, deadlineMs: deadline });
  }
}
