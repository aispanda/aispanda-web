export type AiRouterCapability =
  | 'text-generation'
  | 'model-routing'
  | 'model-discovery'
  | 'usage-metadata'
  | 'streaming'
  | 'structured-output'
  | 'tool-calling'
  | 'image-generation';

export type AiAuthenticationMode = 'oauth-pkce' | 'user-api-key' | 'managed';
export type AiTransportMode = 'browser-direct' | 'server-relay';
export type AiRoutePreference = 'economy' | 'balanced' | 'quality';

export interface AiRouterDescriptor {
  id: string;
  label: string;
  authentication: readonly AiAuthenticationMode[];
  transports: readonly AiTransportMode[];
  capabilities: ReadonlySet<AiRouterCapability>;
}

export interface AiConnectionStatus {
  connected: boolean;
  label?: string;
  usage?: number;
  limit?: number | null;
  limitRemaining?: number | null;
  limitReset?: string | null;
  expiresAt?: string | null;
}

export interface AiGenerationRequest {
  instruction: string;
  content: string;
  maxOutputTokens?: number;
  routePreference?: AiRoutePreference;
}

export interface AiGenerationResult {
  text: string;
  model: string;
  requestedRoute?: string;
  requestedModel?: string;
  provider?: string;
  requestId?: string;
  firstResponseMs?: number;
  fallbackStatus?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
    cost?: number;
    costUnit?: 'USD' | 'credits';
    costSource?: 'reported' | 'router-estimate';
    reasoningTokens?: number;
  };
}

export interface RouterComparisonResult {
  routerId: string;
  routerLabel: string;
  requestedRoute?: string;
  requestedModel?: string;
  actualModel?: string;
  provider?: string;
  responseText: string;
  responseTruncated: boolean;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cost?: number;
  costUnit?: 'USD' | 'credits';
  costSource?: 'reported' | 'router-estimate';
  firstResponseMs?: number;
  totalLatencyMs: number;
  outputTokensPerSecond?: number;
  modelOwnership: 'Open-weight family' | 'Proprietary family' | 'Not determined';
  usageType: string;
  fallbackStatus: string;
  reasoningTokens?: number;
  latencySource: 'browser';
  cacheHit?: boolean;
  success: boolean;
  error?: string;
}

export interface AiConnectionCallbackResult {
  handled: boolean;
  connected: boolean;
  cleanUrl?: string;
  error?: string;
}

export interface AiPersistentConnectionPayload {
  secret: {
    accessToken: string;
    refreshToken?: string;
  };
  configuration?: Readonly<Record<string, string>>;
  status: AiConnectionStatus;
}

export interface AiVaultSnapshot {
  activeProvider: string | null;
  connections: Array<{ provider: string; status: AiConnectionStatus }>;
}

interface AiVaultBridge {
  list(): Promise<AiVaultSnapshot>;
  save(provider: string, payload: AiPersistentConnectionPayload): Promise<AiConnectionStatus>;
  setActive(provider: string | null): Promise<void>;
  refresh(provider: string): Promise<AiConnectionStatus>;
  generate(provider: string, request: AiGenerationRequest): Promise<AiGenerationResult>;
  disconnect(provider: string): Promise<void>;
}

export interface AiRouterConnector {
  readonly descriptor: AiRouterDescriptor;
  readonly status: AiConnectionStatus;
  beginConnection(returnUrl: string): Promise<void>;
  connectWithApiKey?(apiKey: string): Promise<AiConnectionStatus>;
  connectWithConfiguration?(configuration: Readonly<Record<string, string>>): Promise<AiConnectionStatus>;
  completeConnectionCallback(callbackUrl: string): Promise<AiConnectionCallbackResult>;
  refreshStatus(): Promise<AiConnectionStatus>;
  generate(request: AiGenerationRequest): Promise<AiGenerationResult>;
  disconnect(): void | Promise<void>;
  exportPersistentConnection?(): AiPersistentConnectionPayload | null;
  persistForAccount?(): Promise<AiConnectionStatus>;
  restorePersistedConnection?(status: AiConnectionStatus): void;
  clearBrowserSession?(): void;
}

export class AiConnectorRegistry {
  readonly #connectors = new Map<string, AiRouterConnector>();

  constructor(connectors: readonly AiRouterConnector[] = []) {
    for (const connector of connectors) this.register(connector);
  }

  register(connector: AiRouterConnector) {
    if (this.#connectors.has(connector.descriptor.id)) {
      throw new Error(`AI connector already registered: ${connector.descriptor.id}`);
    }
    this.#connectors.set(connector.descriptor.id, connector);
    return this;
  }

  get(id: string) {
    const connector = this.#connectors.get(id);
    if (!connector) throw new Error(`AI connector is not available: ${id}`);
    return connector;
  }

  list() {
    return [...this.#connectors.values()];
  }
}

type WebCrypto = Pick<Crypto, 'getRandomValues' | 'subtle'>;
type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const ACTIVE_AI_ROUTER_KEY = 'aispanda-ai-active-router-v1';

export class AiActiveConnectionManager {
  readonly #registry: AiConnectorRegistry;
  readonly #sessionStore: SessionStore;
  readonly #onActiveChange?: (id: string | null) => void | Promise<void>;

  constructor(
    registry: AiConnectorRegistry,
    sessionStore: SessionStore = sessionStorage,
    onActiveChange?: (id: string | null) => void | Promise<void>,
  ) {
    this.#registry = registry;
    this.#sessionStore = sessionStore;
    this.#onActiveChange = onActiveChange;
    const requested = sessionStore.getItem(ACTIVE_AI_ROUTER_KEY);
    if (!requested) return;
    try {
      if (!registry.get(requested).status.connected) sessionStore.removeItem(ACTIVE_AI_ROUTER_KEY);
    } catch {
      sessionStore.removeItem(ACTIVE_AI_ROUTER_KEY);
    }
  }

  get activeId() {
    const id = this.#sessionStore.getItem(ACTIVE_AI_ROUTER_KEY);
    if (!id) return null;
    try {
      if (this.#registry.get(id).status.connected) return id;
      this.#sessionStore.removeItem(ACTIVE_AI_ROUTER_KEY);
      return null;
    } catch {
      this.#sessionStore.removeItem(ACTIVE_AI_ROUTER_KEY);
      return null;
    }
  }

  get active() {
    const id = this.activeId;
    return id ? this.#registry.get(id) : null;
  }

  activate(id: string) {
    const selected = this.#registry.get(id);
    if (!selected.status.connected) throw new Error(`${selected.descriptor.label} must be connected before it can be active.`);
    this.#sessionStore.setItem(ACTIVE_AI_ROUTER_KEY, id);
    void Promise.resolve(this.#onActiveChange?.(id)).catch(() => undefined);
    return selected;
  }

  async disconnect(id: string) {
    await this.#registry.get(id).disconnect();
    if (this.#sessionStore.getItem(ACTIVE_AI_ROUTER_KEY) === id) {
      this.#sessionStore.removeItem(ACTIVE_AI_ROUTER_KEY);
      await this.#onActiveChange?.(null);
    }
  }

  async disconnectAll() {
    await Promise.all(this.#registry.list().map((connector) => connector.disconnect()));
    this.#sessionStore.removeItem(ACTIVE_AI_ROUTER_KEY);
    await this.#onActiveChange?.(null);
  }

  clearBrowserSession() {
    for (const connector of this.#registry.list()) connector.clearBrowserSession?.();
    this.#sessionStore.removeItem(ACTIVE_AI_ROUTER_KEY);
  }

  restoreActive(id: string | null) {
    if (!id) {
      this.#sessionStore.removeItem(ACTIVE_AI_ROUTER_KEY);
      return;
    }
    const selected = this.#registry.get(id);
    if (selected.status.connected) this.#sessionStore.setItem(ACTIVE_AI_ROUTER_KEY, id);
  }
}

const withAccountPersistence = (connector: AiRouterConnector, vault: AiVaultBridge): AiRouterConnector => {
  let persistedStatus: AiConnectionStatus | null = null;
  const localStatus = () => connector.status;
  const clearLocal = () => connector.clearBrowserSession?.();

  return {
    descriptor: Object.freeze({
      ...connector.descriptor,
      transports: Object.freeze([...new Set([...connector.descriptor.transports, 'server-relay' as const])]),
    }),
    get status() { return localStatus().connected ? localStatus() : persistedStatus ?? localStatus(); },
    beginConnection: (returnUrl) => connector.beginConnection(returnUrl),
    connectWithApiKey: connector.connectWithApiKey
      ? (apiKey) => connector.connectWithApiKey!(apiKey)
      : undefined,
    connectWithConfiguration: connector.connectWithConfiguration
      ? (configuration) => connector.connectWithConfiguration!(configuration)
      : undefined,
    completeConnectionCallback: (callbackUrl) => connector.completeConnectionCallback(callbackUrl),
    exportPersistentConnection: () => connector.exportPersistentConnection?.() ?? null,
    async persistForAccount() {
      const payload = connector.exportPersistentConnection?.();
      if (!payload) {
        if (persistedStatus?.connected) return persistedStatus;
        throw new Error(`${connector.descriptor.label} has no verified connection to save.`);
      }
      const savedStatus = await vault.save(connector.descriptor.id, payload);
      clearLocal();
      persistedStatus = { ...savedStatus, connected: true };
      return persistedStatus;
    },
    restorePersistedConnection(status) {
      clearLocal();
      persistedStatus = { ...status, connected: true };
    },
    clearBrowserSession() {
      clearLocal();
      persistedStatus = null;
    },
    async refreshStatus() {
      if (localStatus().connected) return connector.refreshStatus();
      if (!persistedStatus?.connected) return localStatus();
      persistedStatus = await vault.refresh(connector.descriptor.id);
      return persistedStatus;
    },
    async generate(request) {
      if (localStatus().connected) return connector.generate(request);
      if (!persistedStatus?.connected) return connector.generate(request);
      return vault.generate(connector.descriptor.id, request);
    },
    async disconnect() {
      if (persistedStatus?.connected) await vault.disconnect(connector.descriptor.id);
      else await connector.disconnect();
      clearLocal();
      persistedStatus = null;
    },
  };
};

interface OpenRouterConnectorOptions {
  fetchImpl?: typeof fetch;
  cryptoImpl?: WebCrypto;
  sessionStore?: SessionStore;
  navigate?: (url: string) => void;
  appName?: string;
  siteUrl?: string;
}

interface OpenRouterPendingConnection {
  verifier: string;
  flowId: string;
  createdAt: number;
}

interface OpenRouterSessionConnection {
  apiKey: string;
  status: AiConnectionStatus;
}

interface OpenAiCompatibleRequestOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  request: AiGenerationRequest;
  fetchImpl: typeof fetch;
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  authorizationHeader?: string;
  providerLabel?: string;
  requestedRoute?: string;
  fallbackStatus?: string;
  costUnit?: 'USD' | 'credits';
  costSource?: 'reported' | 'router-estimate';
  errorFormatter?: (response: Response) => Promise<string>;
}

const OPENROUTER_PENDING_KEY = 'aispanda-ai-openrouter-pkce-v1';
const OPENROUTER_SESSION_KEY = 'aispanda-ai-openrouter-session-v1';
const OPENROUTER_ID = 'openrouter';
const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1';
const MAX_INPUT_CHARACTERS = 40_000;
const MAX_OUTPUT_TOKENS = 1_200;
const CONNECTION_MAX_AGE_MS = 30 * 60 * 1_000;
export const PLAYGROUND_MAX_PROMPT_CHARACTERS = 300;
export const PLAYGROUND_MAX_RESPONSE_CHARACTERS = 500;
export const PLAYGROUND_MAX_OUTPUT_TOKENS = 80;

const base64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const randomToken = (cryptoImpl: WebCrypto, size = 32) => {
  const bytes = new Uint8Array(size);
  cryptoImpl.getRandomValues(bytes);
  return base64Url(bytes);
};

export const createPkcePair = async (cryptoImpl: WebCrypto = crypto) => {
  const verifier = randomToken(cryptoImpl, 48);
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
};

export const buildOpenRouterAuthorizationUrl = (callbackUrl: string, challenge: string) => {
  const authorizationUrl = new URL(OPENROUTER_AUTH_URL);
  authorizationUrl.searchParams.set('callback_url', callbackUrl);
  authorizationUrl.searchParams.set('code_challenge', challenge);
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  return authorizationUrl.toString();
};

const responseError = async (response: Response, providerLabel = 'AI provider') => {
  let message = '';
  try {
    const payload = await response.json() as { error?: { message?: string } | string; message?: string };
    message = typeof payload.error === 'string' ? payload.error : payload.error?.message ?? payload.message ?? '';
  } catch {
    // The status-specific fallback below remains actionable when the body is not JSON.
  }
  if (response.status === 401) return 'This AI connection is no longer authorized. Reconnect and try again.';
  if (response.status === 402) return `This ${providerLabel} account has no available credit. Review its spending limit or balance.`;
  if (response.status === 408) return 'The AI request timed out before completion. Try again.';
  if (response.status === 413) return 'This content is too large for the selected AI route. Use selected text instead.';
  if (response.status === 429) return `${providerLabel} is temporarily rate-limiting this account. Wait briefly and try again.`;
  return message || `The AI request failed (${response.status}).`;
};

export const requestOpenAiCompatibleText = async ({
  endpoint,
  apiKey,
  model,
  request,
  fetchImpl,
  headers = {},
  extraBody = {},
  authorizationHeader = 'Authorization',
  providerLabel = 'AI provider',
  requestedRoute,
  fallbackStatus,
  costUnit,
  costSource = 'reported',
  errorFormatter,
}: OpenAiCompatibleRequestOptions): Promise<AiGenerationResult> => {
  const instruction = request.instruction.trim();
  const content = request.content.trim();
  if (!instruction) throw new Error('Add an instruction before generating.');
  if (!content) throw new Error('Add or select content before generating.');
  if (content.length > MAX_INPUT_CHARACTERS) {
    throw new Error(`This request exceeds ${MAX_INPUT_CHARACTERS.toLocaleString()} characters. Use selected text instead.`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  const requestStartedAt = performance.now();
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        [authorizationHeader]: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content },
        ],
        max_tokens: Math.min(Math.max(request.maxOutputTokens ?? 800, 64), MAX_OUTPUT_TOKENS),
        temperature: 0.2,
        stream: false,
        ...extraBody,
      }),
      signal: controller.signal,
    });
    const firstResponseMs = Math.max(0, performance.now() - requestStartedAt);
    if (!response.ok) throw new Error(await (errorFormatter?.(response) ?? responseError(response, providerLabel)));

    const payload = await response.json() as {
      id?: string;
      model?: string;
      provider?: string;
      error?: { message?: string } | string;
      choices?: Array<{
        text?: string;
        finish_reason?: string | null;
        error?: { message?: string } | string;
        message?: { content?: string | Array<{ type?: string; text?: string }> };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        cost?: number;
        prompt_tokens_details?: { cached_tokens?: number };
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };
    const choice = payload.choices?.[0];
    const routeError = typeof choice?.error === 'string'
      ? choice.error
      : choice?.error?.message ?? (typeof payload.error === 'string' ? payload.error : payload.error?.message);
    if (routeError) throw new Error(routeError);
    const rawContent = choice?.message?.content;
    const text = typeof rawContent === 'string'
      ? rawContent.trim()
      : rawContent?.map((part) => part.text ?? '').join('').trim() ?? choice?.text?.trim() ?? '';
    if (!text) {
      if (choice?.finish_reason === 'length') {
        throw new Error('The selected AI route reached the short response limit before answering. Try a simpler prompt.');
      }
      const finishReason = choice?.finish_reason ? ` (${choice.finish_reason})` : '';
      throw new Error(`The AI route returned no text${finishReason}. Try another request.`);
    }
    return {
      text,
      model: payload.model ?? model,
      requestedRoute,
      requestedModel: model,
      provider: payload.provider,
      requestId: payload.id,
      firstResponseMs,
      fallbackStatus,
      usage: payload.usage ? {
        inputTokens: payload.usage.prompt_tokens,
        outputTokens: payload.usage.completion_tokens,
        totalTokens: payload.usage.total_tokens,
        cachedInputTokens: payload.usage.prompt_tokens_details?.cached_tokens,
        cost: costUnit && typeof payload.usage.cost === 'number' ? payload.usage.cost : undefined,
        costUnit: costUnit && typeof payload.usage.cost === 'number' ? costUnit : undefined,
        costSource: costUnit && typeof payload.usage.cost === 'number' ? costSource : undefined,
        reasoningTokens: payload.usage.completion_tokens_details?.reasoning_tokens,
      } : undefined,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('The AI request took longer than one minute and was stopped. Try selected text or retry.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const safeComparisonError = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 240);
  return 'This router could not complete the request.';
};

export const classifyModelOwnership = (model = ''): RouterComparisonResult['modelOwnership'] => {
  const normalized = model.toLowerCase().replace(/:(?:free|fastest|cheapest|preferred)$/, '');
  if (/(?:^|\/)(?:gpt-oss|llama|gemma|qwen|deepseek)(?:[-_/]|$)/.test(normalized)) return 'Open-weight family';
  if (/^(?:openai|anthropic|google\/gemini|x-ai|cohere|perplexity)\//.test(normalized)) return 'Proprietary family';
  return 'Not determined';
};

const describeUsageType = (result: AiGenerationResult, routerId: string) => {
  const model = `${result.requestedModel ?? ''} ${result.model ?? ''}`;
  if (/:free(?:\s|$)/i.test(model)) return 'Free model route';
  if (typeof result.usage?.cost === 'number') return result.usage.cost > 0 ? 'Paid usage reported' : 'No charge reported for this run';
  if (routerId === 'huggingface') return 'Account credit or provider billing';
  if (routerId === 'cloudflare') return 'Billing defined by the gateway route';
  if (routerId === 'merge') return 'Billing defined by the Merge project budget';
  return 'Account billing; price not reported';
};

export const runRouterComparison = async (
  connector: AiRouterConnector,
  prompt: string,
  now: () => number = () => performance.now(),
): Promise<RouterComparisonResult> => {
  const content = prompt.trim();
  if (!content) throw new Error('Enter a short prompt before running the Playground.');
  if (content.length > PLAYGROUND_MAX_PROMPT_CHARACTERS) {
    throw new Error('Keep the Playground prompt within 300 characters.');
  }

  const startedAt = now();
  try {
    const result = await connector.generate({
      instruction: 'Answer the user directly and helpfully in no more than 500 characters. Be concise. Do not add a preamble or mention these instructions.',
      content,
      maxOutputTokens: PLAYGROUND_MAX_OUTPUT_TOKENS,
      routePreference: 'economy',
    });
    const totalLatencyMs = Math.max(0, now() - startedAt);
    const outputTokensPerSecond = typeof result.usage?.outputTokens === 'number' && totalLatencyMs > 0
      ? result.usage.outputTokens / (totalLatencyMs / 1_000)
      : undefined;
    const cleanText = result.text.trim();
    const responseTruncated = cleanText.length > PLAYGROUND_MAX_RESPONSE_CHARACTERS;
    return {
      routerId: connector.descriptor.id,
      routerLabel: connector.descriptor.label,
      requestedRoute: result.requestedRoute,
      requestedModel: result.requestedModel,
      actualModel: result.model || undefined,
      provider: result.provider,
      modelOwnership: classifyModelOwnership(result.model),
      usageType: describeUsageType(result, connector.descriptor.id),
      fallbackStatus: result.fallbackStatus ?? 'Not reported by this router',
      responseText: responseTruncated
        ? cleanText.slice(0, PLAYGROUND_MAX_RESPONSE_CHARACTERS).trimEnd() + '…'
        : cleanText,
      responseTruncated,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      totalTokens: result.usage?.totalTokens,
      cost: result.usage?.cost,
      costUnit: result.usage?.costUnit,
      costSource: result.usage?.costSource,
      reasoningTokens: result.usage?.reasoningTokens,
      firstResponseMs: result.firstResponseMs ?? totalLatencyMs,
      totalLatencyMs,
      outputTokensPerSecond,
      latencySource: 'browser',
      cacheHit: typeof result.usage?.cachedInputTokens === 'number'
        ? result.usage.cachedInputTokens > 0
        : undefined,
      success: true,
    };
  } catch (error) {
    return {
      routerId: connector.descriptor.id,
      routerLabel: connector.descriptor.label,
      responseText: '',
      responseTruncated: false,
      totalLatencyMs: Math.max(0, now() - startedAt),
      latencySource: 'browser',
      modelOwnership: 'Not determined',
      usageType: 'Not available',
      fallbackStatus: 'Request did not complete',
      success: false,
      error: safeComparisonError(error),
    };
  }
};

export const createOpenRouterConnector = (options: OpenRouterConnectorOptions = {}): AiRouterConnector => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cryptoImpl = options.cryptoImpl ?? crypto;
  const sessionStore = options.sessionStore ?? sessionStorage;
  const navigate = options.navigate ?? ((url: string) => window.location.assign(url));
  const descriptor: AiRouterDescriptor = Object.freeze({
    id: OPENROUTER_ID,
    label: 'OpenRouter',
    authentication: Object.freeze(['oauth-pkce', 'user-api-key'] as const),
    transports: Object.freeze(['browser-direct'] as const),
    capabilities: new Set<AiRouterCapability>(['text-generation', 'model-routing', 'model-discovery', 'usage-metadata']),
  });
  let restored: OpenRouterSessionConnection | undefined;
  try {
    restored = JSON.parse(sessionStore.getItem(OPENROUTER_SESSION_KEY) ?? '') as OpenRouterSessionConnection;
    if (!restored.apiKey?.startsWith('sk-or-') || restored.status?.connected !== true) restored = undefined;
  } catch {
    restored = undefined;
  }
  let apiKey = restored?.apiKey ?? '';
  let status: AiConnectionStatus = restored?.status ?? { connected: false };

  const forgetConnection = () => {
    apiKey = '';
    status = { connected: false };
    sessionStore.removeItem(OPENROUTER_SESSION_KEY);
  };

  const clearBrowserSession = () => {
    apiKey = '';
    status = { connected: false };
    sessionStore.removeItem(OPENROUTER_SESSION_KEY);
    sessionStore.removeItem(OPENROUTER_PENDING_KEY);
  };

  const rememberConnection = () => {
    if (!apiKey || !status.connected) return;
    sessionStore.setItem(OPENROUTER_SESSION_KEY, JSON.stringify({ apiKey, status } satisfies OpenRouterSessionConnection));
  };

  const refreshStatus = async () => {
    if (!apiKey) return status = { connected: false };
    const response = await fetchImpl(`${OPENROUTER_API_URL}/key`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      if (response.status === 401) forgetConnection();
      throw new Error(await responseError(response, 'OpenRouter'));
    }
    const payload = await response.json() as {
      data?: {
        label?: string;
        usage?: number;
        limit?: number | null;
        limit_remaining?: number | null;
        limit_reset?: string | null;
        expires_at?: string | null;
      };
    };
    const data = payload.data ?? {};
    status = {
      connected: true,
      label: data.label,
      usage: data.usage,
      limit: data.limit,
      limitRemaining: data.limit_remaining,
      limitReset: data.limit_reset,
      expiresAt: data.expires_at,
    };
    rememberConnection();
    return status;
  };

  return {
    descriptor,
    get status() { return status; },

    async beginConnection(returnUrl) {
      const { verifier, challenge } = await createPkcePair(cryptoImpl);
      const flowId = randomToken(cryptoImpl, 18);
      const callbackUrl = new URL(returnUrl);
      callbackUrl.searchParams.delete('code');
      callbackUrl.searchParams.delete('error');
      callbackUrl.searchParams.delete('error_description');
      callbackUrl.searchParams.set('ai_provider', OPENROUTER_ID);
      callbackUrl.searchParams.set('ai_flow', flowId);
      const pending: OpenRouterPendingConnection = { verifier, flowId, createdAt: Date.now() };
      sessionStore.setItem(OPENROUTER_PENDING_KEY, JSON.stringify(pending));
      navigate(buildOpenRouterAuthorizationUrl(callbackUrl.toString(), challenge));
    },

    async connectWithApiKey(value) {
      const candidate = value.trim();
      if (!candidate.startsWith('sk-or-') || candidate.length < 24) {
        throw new Error('Enter a valid OpenRouter API key.');
      }
      apiKey = candidate;
      status = { connected: true };
      try {
        return await refreshStatus();
      } catch (error) {
        forgetConnection();
        throw error;
      }
    },

    async completeConnectionCallback(callbackUrl) {
      const url = new URL(callbackUrl);
      let pending: OpenRouterPendingConnection | undefined;
      try {
        pending = JSON.parse(sessionStore.getItem(OPENROUTER_PENDING_KEY) ?? '') as OpenRouterPendingConnection;
      } catch {
        // Missing or malformed session state is handled below.
      }
      const explicitlyOpenRouter = url.searchParams.get('ai_provider') === OPENROUTER_ID;
      const hasProviderResult = url.searchParams.has('code') || url.searchParams.has('error');
      const belongsToStandardOAuth = url.searchParams.has('state');
      if (!explicitlyOpenRouter && !(pending && hasProviderResult && !belongsToStandardOAuth)) {
        return { handled: false, connected: status.connected };
      }
      const cleanUrl = new URL(url);
      for (const key of ['code', 'error', 'error_description', 'ai_provider', 'ai_flow']) cleanUrl.searchParams.delete(key);
      const providerError = url.searchParams.get('error_description') ?? url.searchParams.get('error');
      if (providerError) {
        sessionStore.removeItem(OPENROUTER_PENDING_KEY);
        return { handled: true, connected: false, cleanUrl: cleanUrl.toString(), error: providerError };
      }

      const code = url.searchParams.get('code');
      sessionStore.removeItem(OPENROUTER_PENDING_KEY);
      const returnedFlowId = url.searchParams.get('ai_flow');
      if (!code || !pending || (returnedFlowId && pending.flowId !== returnedFlowId) || Date.now() - pending.createdAt > CONNECTION_MAX_AGE_MS) {
        return {
          handled: true,
          connected: false,
          cleanUrl: cleanUrl.toString(),
          error: 'The OpenRouter connection expired or could not be verified. Start again.',
        };
      }

      const response = await fetchImpl(`${OPENROUTER_API_URL}/auth/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          code_verifier: pending.verifier,
          code_challenge_method: 'S256',
        }),
      });
      if (!response.ok) {
        return { handled: true, connected: false, cleanUrl: cleanUrl.toString(), error: await responseError(response, 'OpenRouter') };
      }
      const payload = await response.json() as { key?: string };
      if (!payload.key) {
        return { handled: true, connected: false, cleanUrl: cleanUrl.toString(), error: 'OpenRouter did not return a usable connection.' };
      }
      apiKey = payload.key;
      status = { connected: true };
      rememberConnection();
      try {
        await refreshStatus();
      } catch {
        // The authorization succeeded even if optional usage metadata is temporarily unavailable.
      }
      return { handled: true, connected: true, cleanUrl: cleanUrl.toString() };
    },

    refreshStatus,

    async generate(request) {
      if (!apiKey) throw new Error('Connect OpenRouter before generating.');
      if (status.limitRemaining === 0) {
        throw new Error('This OpenRouter connection has no remaining spending allowance.');
      }
      return requestOpenAiCompatibleText({
        endpoint: `${OPENROUTER_API_URL}/chat/completions`,
        apiKey,
        model: 'openrouter/auto',
        request,
        fetchImpl,
        headers: {
          'HTTP-Referer': options.siteUrl ?? window.location.origin,
          'X-OpenRouter-Title': options.appName ?? 'AI Spanda Content Studio',
        },
        extraBody: {
          provider: { data_collection: 'deny', allow_fallbacks: true },
          ...(request.routePreference === 'economy'
            ? { reasoning: { effort: 'none', exclude: true } }
            : {}),
        },
        providerLabel: 'OpenRouter',
        requestedRoute: 'Auto · economy',
        fallbackStatus: 'Automatic provider fallback enabled; whether used was not reported',
        costUnit: 'USD',
        costSource: 'reported',
      });
    },

    exportPersistentConnection() {
      if (!apiKey || !status.connected) return null;
      return { secret: { accessToken: apiKey }, status };
    },

    clearBrowserSession,

    disconnect() {
      forgetConnection();
      sessionStore.removeItem(OPENROUTER_PENDING_KEY);
    },
  };
};

interface BrowserTokenConnectorOptions {
  fetchImpl?: typeof fetch;
  sessionStore?: SessionStore;
}

interface HuggingFaceConnectorOptions extends BrowserTokenConnectorOptions {
  cryptoImpl?: WebCrypto;
  navigate?: (url: string) => void;
  clientId?: string;
}

interface HuggingFacePendingConnection {
  verifier: string;
  state: string;
  redirectUri: string;
  createdAt: number;
}

interface HuggingFaceSessionConnection {
  apiKey: string;
  refreshToken?: string;
  status: AiConnectionStatus;
}

const HUGGING_FACE_SESSION_KEY = 'aispanda-ai-huggingface-session-v1';
const HUGGING_FACE_PENDING_KEY = 'aispanda-ai-huggingface-pkce-v1';
const HUGGING_FACE_API_URL = 'https://router.huggingface.co/v1';
const HUGGING_FACE_AUTH_URL = 'https://huggingface.co/oauth/authorize';
const HUGGING_FACE_TOKEN_URL = 'https://huggingface.co/oauth/token';
// Public OAuth client ID: PKCE protects authorization codes, so no client secret belongs in the browser.
const HUGGING_FACE_CLIENT_ID = 'ef61c83b-89ba-48a8-a2a3-4cb33d62f42c';
const HUGGING_FACE_DEFAULT_MODEL = 'openai/gpt-oss-120b:cheapest';

export const selectHuggingFacePlaygroundModel = (modelIds: readonly string[]) => {
  const available = modelIds.map((id) => id.trim()).filter(Boolean);
  const preferredPatterns = [
    /qwen.*(?:4b|7b|8b).*instruct/i,
    /(?:mistral|ministral).*(?:7b|8b).*instruct/i,
    /llama.*(?:3b|8b).*instruct/i,
    /gemma.*(?:2b|4b|7b|9b).*(?:it|instruct)/i,
  ];
  const baseModel = preferredPatterns
    .map((pattern) => available.find((id) => pattern.test(id)))
    .find(Boolean)
    ?? available.find((id) => !/(?:gpt-oss|deepseek[^/]*r1|reasoning)/i.test(id))
    ?? available[0]
    ?? HUGGING_FACE_DEFAULT_MODEL;
  return /:(?:fastest|cheapest|preferred)$/i.test(baseModel) ? baseModel : `${baseModel}:cheapest`;
};

export const buildHuggingFaceAuthorizationUrl = (
  redirectUri: string,
  challenge: string,
  state: string,
  clientId = HUGGING_FACE_CLIENT_ID,
) => {
  const authorizationUrl = new URL(HUGGING_FACE_AUTH_URL);
  authorizationUrl.searchParams.set('client_id', clientId);
  authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('scope', 'inference-api');
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('code_challenge', challenge);
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  return authorizationUrl.toString();
};

export const createHuggingFaceConnector = (options: HuggingFaceConnectorOptions = {}): AiRouterConnector => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sessionStore = options.sessionStore ?? sessionStorage;
  const cryptoImpl = options.cryptoImpl ?? crypto;
  const navigate = options.navigate ?? ((url: string) => window.location.assign(url));
  const clientId = options.clientId ?? HUGGING_FACE_CLIENT_ID;
  let restored: HuggingFaceSessionConnection | undefined;
  try {
    restored = JSON.parse(sessionStore.getItem(HUGGING_FACE_SESSION_KEY) ?? '') as HuggingFaceSessionConnection;
    if (!restored.apiKey?.startsWith('hf_') || restored.status?.connected !== true) restored = undefined;
  } catch {
    restored = undefined;
  }
  let apiKey = restored?.apiKey ?? '';
  let refreshToken = restored?.refreshToken ?? '';
  let status: AiConnectionStatus = restored?.status ?? { connected: false };
  let model = status.label?.split(' · ')[1] ?? HUGGING_FACE_DEFAULT_MODEL;

  const forgetConnection = () => {
    apiKey = '';
    refreshToken = '';
    status = { connected: false };
    sessionStore.removeItem(HUGGING_FACE_SESSION_KEY);
  };

  const refreshStatus = async () => {
    if (!apiKey) return status = { connected: false };
    if (status.expiresAt && Date.parse(status.expiresAt) <= Date.now()) {
      forgetConnection();
      return status;
    }
    const response = await fetchImpl(`${HUGGING_FACE_API_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) forgetConnection();
      throw new Error(await responseError(response, 'Hugging Face'));
    }
    const payload = await response.json() as { data?: Array<{ id?: string }> };
    model = selectHuggingFacePlaygroundModel(payload.data?.flatMap((entry) => entry.id ? [entry.id] : []) ?? [model]);
    status = { ...status, connected: true, label: `Zero-markup routing · ${model}` };
    sessionStore.setItem(HUGGING_FACE_SESSION_KEY, JSON.stringify({ apiKey, refreshToken: refreshToken || undefined, status } satisfies HuggingFaceSessionConnection));
    return status;
  };

  return {
    descriptor: Object.freeze({
      id: 'huggingface',
      label: 'Hugging Face Router',
      authentication: Object.freeze(['oauth-pkce', 'user-api-key'] as const),
      transports: Object.freeze(['browser-direct'] as const),
      capabilities: new Set<AiRouterCapability>(['text-generation', 'model-routing', 'model-discovery', 'streaming']),
    }),
    get status() { return status; },
    async beginConnection(returnUrl) {
      const { verifier, challenge } = await createPkcePair(cryptoImpl);
      const state = randomToken(cryptoImpl, 24);
      const returnLocation = new URL(returnUrl);
      const redirectUri = new URL('/account', returnLocation.origin).toString();
      const pending: HuggingFacePendingConnection = {
        verifier,
        state,
        redirectUri,
        createdAt: Date.now(),
      };
      sessionStore.setItem(HUGGING_FACE_PENDING_KEY, JSON.stringify(pending));
      navigate(buildHuggingFaceAuthorizationUrl(redirectUri, challenge, state, clientId));
    },
    async connectWithApiKey(value) {
      const candidate = value.trim();
      if (!candidate.startsWith('hf_') || candidate.length < 16) throw new Error('Enter a valid Hugging Face token.');
      apiKey = candidate;
      status = { connected: true };
      try {
        return await refreshStatus();
      } catch (error) {
        forgetConnection();
        throw error;
      }
    },
    async completeConnectionCallback(callbackUrl) {
      const url = new URL(callbackUrl);
      let pending: HuggingFacePendingConnection | undefined;
      try {
        pending = JSON.parse(sessionStore.getItem(HUGGING_FACE_PENDING_KEY) ?? '') as HuggingFacePendingConnection;
      } catch {
        // Missing or malformed session state is handled below.
      }
      const hasProviderResult = url.searchParams.has('code') || url.searchParams.has('error');
      if (!hasProviderResult) return { handled: false, connected: status.connected };

      const cleanUrl = new URL(url);
      for (const key of ['code', 'error', 'error_description', 'state']) cleanUrl.searchParams.delete(key);
      cleanUrl.searchParams.set('section', 'ai');
      if (!pending) {
        return {
          handled: true,
          connected: false,
          cleanUrl: cleanUrl.toString(),
          error: 'The Hugging Face connection could not be verified in this browser tab. Select Connect once more and complete it in this same tab.',
        };
      }
      const providerError = url.searchParams.get('error_description') ?? url.searchParams.get('error');
      sessionStore.removeItem(HUGGING_FACE_PENDING_KEY);
      if (providerError) {
        return { handled: true, connected: false, cleanUrl: cleanUrl.toString(), error: providerError };
      }

      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const redirectLocation = new URL(pending.redirectUri);
      const normalizePath = (pathname: string) => pathname.replace(/\/+$/, '') || '/';
      const callbackPath = normalizePath(url.pathname);
      const redirectPath = normalizePath(redirectLocation.pathname);
      const isAllowedCallbackLocation = url.origin === redirectLocation.origin
        && (callbackPath === redirectPath || callbackPath === '/ai');
      if (
        !code
        || returnedState !== pending.state
        || !isAllowedCallbackLocation
        || Date.now() - pending.createdAt > CONNECTION_MAX_AGE_MS
      ) {
        return {
          handled: true,
          connected: false,
          cleanUrl: cleanUrl.toString(),
          error: 'The Hugging Face connection expired or could not be verified. Start again.',
        };
      }

      let response: Response;
      try {
        response = await fetchImpl(HUGGING_FACE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: clientId,
            redirect_uri: pending.redirectUri,
            code_verifier: pending.verifier,
          }),
        });
      } catch {
        return {
          handled: true,
          connected: false,
          cleanUrl: cleanUrl.toString(),
          error: 'Hugging Face could not complete the connection. Check your network and try again.',
        };
      }
      if (!response.ok) {
        return { handled: true, connected: false, cleanUrl: cleanUrl.toString(), error: await responseError(response, 'Hugging Face') };
      }
      const payload = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
      if (!payload.access_token?.startsWith('hf_') || (payload.scope && !payload.scope.split(' ').includes('inference-api'))) {
        return {
          handled: true,
          connected: false,
          cleanUrl: cleanUrl.toString(),
          error: 'Hugging Face did not grant Inference Providers access.',
        };
      }
      apiKey = payload.access_token;
      refreshToken = payload.refresh_token ?? '';
      status = {
        connected: true,
        expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1_000).toISOString() : undefined,
      };
      try {
        await refreshStatus();
      } catch (error) {
        forgetConnection();
        return {
          handled: true,
          connected: false,
          cleanUrl: cleanUrl.toString(),
          error: error instanceof Error ? error.message : 'Hugging Face could not verify this connection.',
        };
      }
      return { handled: true, connected: true, cleanUrl: cleanUrl.toString() };
    },
    refreshStatus,
    async generate(request) {
      if (!apiKey) throw new Error('Connect Hugging Face Router before generating.');
      const policy = model.match(/:(fastest|cheapest|preferred)$/i)?.[1];
      return requestOpenAiCompatibleText({
        endpoint: `${HUGGING_FACE_API_URL}/chat/completions`,
        apiKey,
        model,
        request,
        fetchImpl,
        providerLabel: 'Hugging Face',
        requestedRoute: policy ? `${policy[0].toUpperCase()}${policy.slice(1).toLowerCase()} provider` : 'Selected model',
        fallbackStatus: 'Automatic provider selection; whether failover was used was not reported',
        extraBody: /gpt-oss/i.test(model) ? { reasoning_effort: 'low' } : {},
      });
    },
    exportPersistentConnection() {
      if (!apiKey || !status.connected) return null;
      return {
        secret: { accessToken: apiKey, refreshToken: refreshToken || undefined },
        configuration: { clientId },
        status,
      };
    },
    clearBrowserSession() {
      apiKey = '';
      refreshToken = '';
      status = { connected: false };
      sessionStore.removeItem(HUGGING_FACE_SESSION_KEY);
      sessionStore.removeItem(HUGGING_FACE_PENDING_KEY);
    },
    disconnect() {
      forgetConnection();
      sessionStore.removeItem(HUGGING_FACE_PENDING_KEY);
    },
  };
};

interface CloudflareConnectionConfiguration {
  accountId: string;
  gatewayId: string;
  route: string;
}

interface CloudflarePendingConnection {
  verifier: string;
  state: string;
  redirectUri: string;
  popup: { close(): void } | null;
}

interface CloudflareConnectorOptions extends BrowserTokenConnectorOptions {
  cryptoImpl?: WebCrypto;
  clientId?: string;
  openWindow?: (url: string, target: string, features: string) => ({ close(): void; location: { assign(url: string): void } } | null);
}

const CLOUDFLARE_CLIENT_ID = '29693e35e11d3865e28facf20adfcb38';
const CLOUDFLARE_AUTH_URL = 'https://dash.cloudflare.com/oauth2/auth';
const CLOUDFLARE_TOKEN_URL = 'https://dash.cloudflare.com/oauth2/token';
const CLOUDFLARE_REVOKE_URL = 'https://dash.cloudflare.com/oauth2/revoke';
// Scope IDs come from GET https://api.cloudflare.com/client/v4/oauth/scopes and are
// abbreviated, so they cannot be inferred from the permission names shown in the dashboard:
// "AI Gateway Run" is aig.run and "Workers AI Read" is ai.read. Both permissions are needed,
// and both must also be selected on the OAuth client in Cloudflare:
// - ai.read: the chat completion call targets /accounts/{id}/ai/*, which Cloudflare documents
//   as requiring Workers AI rather than AI Gateway.
// - aig.run: the call is routed through a gateway via the cf-aig-gateway-id header.
const CLOUDFLARE_OAUTH_SCOPES = ['aig.run', 'ai.read'] as const;

export const buildCloudflareAuthorizationUrl = ({
  clientId,
  redirectUri,
  state,
  challenge,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}) => {
  const authorizationUrl = new URL(CLOUDFLARE_AUTH_URL);
  authorizationUrl.searchParams.set('client_id', clientId);
  authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('scope', CLOUDFLARE_OAUTH_SCOPES.join(' '));
  authorizationUrl.searchParams.set('code_challenge', challenge);
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  return authorizationUrl.toString();
};

export const createCloudflareAiGatewayConnector = (options: CloudflareConnectorOptions = {}): AiRouterConnector => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cryptoImpl = options.cryptoImpl ?? crypto;
  const clientId = options.clientId ?? CLOUDFLARE_CLIENT_ID;
  const openWindow = options.openWindow ?? ((url: string, target: string, features: string) => {
    const popup = window.open(url, target, features);
    if (!popup) return null;
    return {
      close: () => popup.close(),
      location: { assign: (nextUrl: string) => { popup.location.href = nextUrl; } },
    };
  });
  let accessToken = '';
  let refreshToken = '';
  let configuration: CloudflareConnectionConfiguration | undefined;
  let pending: CloudflarePendingConnection | undefined;
  let status: AiConnectionStatus = { connected: false };

  const forgetConnection = () => {
    const tokenToRevoke = accessToken;
    accessToken = '';
    refreshToken = '';
    configuration = undefined;
    pending?.popup?.close();
    pending = undefined;
    status = { connected: false };
    if (tokenToRevoke) {
      void fetchImpl(CLOUDFLARE_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: tokenToRevoke, client_id: clientId }),
      }).catch(() => undefined);
    }
  };

  const refreshStatus = async () => {
    if (!accessToken || !configuration) return status = { connected: false };
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${configuration.accountId}/ai/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'cf-aig-gateway-id': configuration.gatewayId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: `dynamic/${configuration.route}`,
        messages: [{ role: 'user', content: 'Reply OK.' }],
        max_tokens: 1,
        temperature: 0,
        stream: false,
      }),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        accessToken = '';
        status = { connected: false };
      }
      throw new Error(await responseError(response, 'Cloudflare AI Gateway'));
    }
    status = { connected: true, label: `${configuration.gatewayId} · dynamic/${configuration.route}` };
    return status;
  };

  return {
    descriptor: Object.freeze({
      id: 'cloudflare',
      label: 'Cloudflare AI Gateway',
      authentication: Object.freeze(['oauth-pkce'] as const),
      transports: Object.freeze(['browser-direct'] as const),
      capabilities: new Set<AiRouterCapability>(['text-generation', 'model-routing', 'usage-metadata', 'streaming', 'structured-output', 'tool-calling']),
    }),
    get status() { return status; },
    async beginConnection(returnUrl) {
      if (!configuration) throw new Error('Enter your Cloudflare account, gateway and route details first.');
      const popup = openWindow('about:blank', 'aispanda-cloudflare-oauth', 'popup=yes,width=560,height=720');
      if (!popup) throw new Error('Allow pop-ups for AI Spanda, then try Connect again.');
      try {
        const { verifier, challenge } = await createPkcePair(cryptoImpl);
        const state = randomToken(cryptoImpl, 24);
        const redirectUri = new URL('/auth/cloudflare/callback', returnUrl).toString();
        pending = { verifier, state, redirectUri, popup };
        popup.location.assign(buildCloudflareAuthorizationUrl({ clientId, redirectUri, state, challenge }));
      } catch (error) {
        popup.close();
        throw error;
      }
    },
    async connectWithConfiguration(candidateConfiguration) {
      const candidateAccount = candidateConfiguration.accountId?.trim();
      const candidateGateway = candidateConfiguration.gatewayId?.trim();
      const candidateRoute = candidateConfiguration.route?.trim().replace(/^dynamic\//, '');
      if (!/^[a-f0-9]{32}$/i.test(candidateAccount ?? '')) throw new Error('Enter your 32-character Cloudflare account ID.');
      if (!/^[a-z0-9_-]{1,64}$/i.test(candidateGateway ?? '')) throw new Error('Enter a valid Cloudflare gateway ID.');
      if (!/^[a-z0-9_-]{1,64}$/i.test(candidateRoute ?? '')) throw new Error('Enter the deployed dynamic route name.');
      configuration = {
        accountId: candidateAccount ?? '',
        gatewayId: candidateGateway ?? '',
        route: candidateRoute ?? '',
      };
      status = { connected: false, label: 'Ready for Cloudflare approval' };
      return status;
    },
    async completeConnectionCallback(callbackUrl) {
      const callback = new URL(callbackUrl);
      const code = callback.searchParams.get('code');
      const returnedState = callback.searchParams.get('state');
      const oauthError = callback.searchParams.get('error');
      if (!code && !oauthError) return { handled: false, connected: status.connected };
      if (!pending) return { handled: false, connected: status.connected };
      pending.popup?.close();
      if (oauthError) {
        pending = undefined;
        if (oauthError === 'invalid_scope') {
          return {
            handled: true,
            connected: false,
            error: 'Cloudflare OAuth rejected the requested permissions. Select both AI Gateway → Run and Workers AI → Read on the OAuth client in Cloudflare, then try again.',
          };
        }
        return { handled: true, connected: false, error: 'Cloudflare authorization was cancelled or denied.' };
      }
      if (!returnedState || returnedState !== pending.state) {
        pending = undefined;
        return { handled: true, connected: false, error: 'Cloudflare returned an invalid connection state. Start the connection again.' };
      }
      const tokenResponse = await fetchImpl(CLOUDFLARE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code ?? '',
          client_id: clientId,
          redirect_uri: pending.redirectUri,
          code_verifier: pending.verifier,
        }),
      });
      pending = undefined;
      if (!tokenResponse.ok) {
        return { handled: true, connected: false, error: await responseError(tokenResponse, 'Cloudflare OAuth') };
      }
      const tokenPayload = await tokenResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!tokenPayload.access_token) {
        return { handled: true, connected: false, error: 'Cloudflare did not return an access token. Start the connection again.' };
      }
      accessToken = tokenPayload.access_token;
      refreshToken = tokenPayload.refresh_token ?? '';
      status = {
        connected: true,
        expiresAt: typeof tokenPayload.expires_in === 'number'
          ? new Date(Date.now() + tokenPayload.expires_in * 1_000).toISOString()
          : null,
      };
      try {
        await refreshStatus();
        return { handled: true, connected: true };
      } catch (error) {
        accessToken = '';
        status = { connected: false };
        return {
          handled: true,
          connected: false,
          error: error instanceof Error ? error.message : 'Cloudflare could not verify this gateway route.',
        };
      }
    },
    refreshStatus,
    async generate(request) {
      if (!accessToken || !configuration) throw new Error('Connect Cloudflare AI Gateway before generating.');
      return requestOpenAiCompatibleText({
        endpoint: `https://api.cloudflare.com/client/v4/accounts/${configuration.accountId}/ai/v1/chat/completions`,
        apiKey: accessToken,
        model: `dynamic/${configuration.route}`,
        request,
        fetchImpl,
        headers: { 'cf-aig-gateway-id': configuration.gatewayId },
        providerLabel: 'Cloudflare AI Gateway',
        requestedRoute: `dynamic/${configuration.route}`,
        fallbackStatus: 'Controlled by the dynamic route; whether fallback was used was not reported',
      });
    },
    exportPersistentConnection() {
      if (!accessToken || !configuration || !status.connected) return null;
      return {
        secret: { accessToken, refreshToken: refreshToken || undefined },
        configuration: { ...configuration, clientId },
        status,
      };
    },
    clearBrowserSession() {
      accessToken = '';
      refreshToken = '';
      configuration = undefined;
      pending?.popup?.close();
      pending = undefined;
      status = { connected: false };
    },
    disconnect: forgetConnection,
  };
};

interface MergeGatewaySessionConnection {
  apiKey: string;
  status: AiConnectionStatus;
}

const MERGE_GATEWAY_SESSION_KEY = 'aispanda-ai-merge-session-v1';
const MERGE_GATEWAY_API_URL = 'https://api-gateway.merge.dev/v1';
const MERGE_GATEWAY_MODEL = 'default_routing';

const mergeGatewayResponseError = async (response: Response) => {
  let code = '';
  try {
    const payload = await response.json() as { code?: string; error?: { code?: string } | string };
    code = typeof payload.error === 'string' ? payload.error : payload.error?.code ?? payload.code ?? '';
  } catch {
    // Status-specific messages below do not expose provider response content.
  }
  if (response.status === 401 || response.status === 403) {
    return 'This Merge Gateway key is invalid or has been revoked. Reconnect with a Project API Key.';
  }
  if (response.status === 402) {
    return 'Your Merge Gateway project budget has been reached. Update the budget in Merge Gateway to continue.';
  }
  if (response.status === 429) return 'Merge Gateway is rate-limiting this project. Wait briefly and try again.';
  if (code.toLowerCase().includes('model_required')) {
    return 'Merge Gateway needs a routing policy. Attach one to this key\'s project, then try again.';
  }
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    return 'The model or provider selected by Merge Gateway is unavailable. Try again shortly or review the project routing policy.';
  }
  return 'Merge Gateway could not complete this request. Try again or review the project in Merge Gateway.';
};

export const createMergeGatewayConnector = (options: BrowserTokenConnectorOptions = {}): AiRouterConnector => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sessionStore = options.sessionStore ?? sessionStorage;
  let restored: MergeGatewaySessionConnection | undefined;
  try {
    restored = JSON.parse(sessionStore.getItem(MERGE_GATEWAY_SESSION_KEY) ?? '') as MergeGatewaySessionConnection;
    if (!restored.apiKey || restored.status?.connected !== true) restored = undefined;
  } catch {
    restored = undefined;
  }
  let apiKey = restored?.apiKey ?? '';
  let status: AiConnectionStatus = restored?.status ?? { connected: false };

  const forgetConnection = () => {
    apiKey = '';
    status = { connected: false };
    sessionStore.removeItem(MERGE_GATEWAY_SESSION_KEY);
  };

  const refreshStatus = async () => {
    if (!apiKey) return status = { connected: false };
    const response = await fetchImpl(`${MERGE_GATEWAY_API_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      forgetConnection();
      throw new Error(await mergeGatewayResponseError(response));
    }
    status = { connected: true, label: 'Project policy · default_routing' };
    sessionStore.setItem(MERGE_GATEWAY_SESSION_KEY, JSON.stringify({ apiKey, status } satisfies MergeGatewaySessionConnection));
    return status;
  };

  return {
    descriptor: Object.freeze({
      id: 'merge',
      label: 'Merge Gateway',
      authentication: Object.freeze(['user-api-key'] as const),
      transports: Object.freeze(['browser-direct', 'server-relay'] as const),
      capabilities: new Set<AiRouterCapability>(['text-generation', 'model-routing', 'model-discovery', 'usage-metadata', 'streaming', 'structured-output', 'tool-calling']),
    }),
    get status() { return status; },
    async beginConnection() { throw new Error('Enter your Merge Gateway Project API Key to connect.'); },
    async connectWithApiKey(candidate) {
      const normalized = candidate.trim();
      if (normalized.startsWith('mgmt_')) throw new Error('Use a Merge Project API Key, not a management key.');
      if (normalized.length < 16) throw new Error('Enter your Merge Gateway Project API Key.');
      apiKey = normalized;
      status = { connected: true };
      try {
        return await refreshStatus();
      } catch (error) {
        forgetConnection();
        throw error;
      }
    },
    async completeConnectionCallback() { return { handled: false, connected: status.connected }; },
    refreshStatus,
    async generate(request) {
      if (!apiKey) throw new Error('Connect Merge Gateway before generating.');
      return requestOpenAiCompatibleText({
        endpoint: `${MERGE_GATEWAY_API_URL}/openai/chat/completions`,
        apiKey,
        model: MERGE_GATEWAY_MODEL,
        request,
        fetchImpl,
        providerLabel: 'Merge Gateway',
        requestedRoute: 'Project routing policy',
        fallbackStatus: 'Controlled by the Merge project routing policy',
        costUnit: 'USD',
        costSource: 'reported',
        errorFormatter: mergeGatewayResponseError,
      });
    },
    exportPersistentConnection() {
      if (!apiKey || !status.connected) return null;
      return { secret: { accessToken: apiKey }, status };
    },
    clearBrowserSession() {
      apiKey = '';
      status = { connected: false };
      sessionStore.removeItem(MERGE_GATEWAY_SESSION_KEY);
    },
    disconnect: forgetConnection,
  };
};

export const AI_CONNECTIONS_CHANGED_EVENT = 'aispanda:ai-connections-changed';

let browserAiConnectionContext: {
  registry: AiConnectorRegistry;
  manager: AiActiveConnectionManager;
  vault: AiVaultBridge;
} | undefined;

const createBrowserVaultBridge = (): AiVaultBridge => ({
  list: async () => (await import('./ai-vault-client')).loadAiVaultConnections(),
  save: async (provider, payload) => (await import('./ai-vault-client')).saveAiVaultConnection(provider, payload),
  setActive: async (provider) => (await import('./ai-vault-client')).setActiveAiVaultConnection(provider),
  refresh: async (provider) => (await import('./ai-vault-client')).refreshAiVaultConnection(provider),
  generate: async (provider, request) => (await import('./ai-vault-client')).generateWithAiVault(provider, request),
  disconnect: async (provider) => (await import('./ai-vault-client')).disconnectAiVaultConnection(provider),
});

export const getBrowserAiConnectionContext = () => {
  if (!browserAiConnectionContext) {
    const vault = createBrowserVaultBridge();
    const registry = new AiConnectorRegistry([
      withAccountPersistence(createOpenRouterConnector({ appName: 'AI Spanda', siteUrl: window.location.origin }), vault),
      withAccountPersistence(createHuggingFaceConnector(), vault),
      withAccountPersistence(createCloudflareAiGatewayConnector(), vault),
      withAccountPersistence(createMergeGatewayConnector(), vault),
    ]);
    browserAiConnectionContext = {
      registry,
      manager: new AiActiveConnectionManager(registry, sessionStorage, (id) => vault.setActive(id)),
      vault,
    };
  }
  return browserAiConnectionContext;
};

export const persistBrowserAiConnections = async () => {
  const { registry } = getBrowserAiConnectionContext();
  for (const connector of registry.list()) {
    if (!connector.status.connected || !connector.exportPersistentConnection?.()) continue;
    await connector.persistForAccount?.();
  }
};

export const restoreBrowserAiConnections = async () => {
  const { registry, manager, vault } = getBrowserAiConnectionContext();
  const snapshot = await vault.list();
  for (const connection of snapshot.connections) {
    try {
      registry.get(connection.provider).restorePersistedConnection?.(connection.status);
    } catch {
      // Ignore records for a provider that this browser build does not support.
    }
  }
  manager.restoreActive(snapshot.activeProvider);
  window.dispatchEvent(new Event(AI_CONNECTIONS_CHANGED_EVENT));
  return snapshot;
};
