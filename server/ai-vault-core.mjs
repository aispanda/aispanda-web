import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const SUPPORTED_AI_PROVIDERS = new Set(['openrouter', 'huggingface', 'cloudflare', 'merge']);
const MAX_INPUT_CHARACTERS = 40_000;
const MAX_OUTPUT_TOKENS = 1_200;
const HUGGING_FACE_CLIENT_ID = 'ef61c83b-89ba-48a8-a2a3-4cb33d62f42c';
const CLOUDFLARE_CLIENT_ID = '29693e35e11d3865e28facf20adfcb38';

const safeString = (value, maximum = 512) => typeof value === 'string' && value.length <= maximum ? value : '';

export const validateVaultConnection = (provider, candidate) => {
  if (!SUPPORTED_AI_PROVIDERS.has(provider)) throw new Error('Unsupported AI provider.');
  if (!candidate || typeof candidate !== 'object') throw new Error('Invalid AI connection.');
  const accessToken = safeString(candidate.secret?.accessToken, 8_192);
  const refreshToken = safeString(candidate.secret?.refreshToken, 8_192) || undefined;
  if (!accessToken || accessToken.length < 16) throw new Error('Invalid AI credential.');
  if (provider === 'openrouter' && !accessToken.startsWith('sk-or-')) throw new Error('Invalid OpenRouter credential.');
  if (provider === 'huggingface' && !accessToken.startsWith('hf_')) throw new Error('Invalid Hugging Face credential.');

  const configuration = candidate.configuration && typeof candidate.configuration === 'object'
    ? Object.fromEntries(Object.entries(candidate.configuration).map(([key, value]) => [key, safeString(value, 256)]))
    : undefined;
  if (provider === 'cloudflare') {
    if (!/^[a-f0-9]{32}$/i.test(configuration?.accountId ?? '')) throw new Error('Invalid Cloudflare account.');
    if (!/^[a-z0-9_-]{1,64}$/i.test(configuration?.gatewayId ?? '')) throw new Error('Invalid Cloudflare gateway.');
    if (!/^[a-z0-9_-]{1,64}$/i.test(configuration?.route ?? '')) throw new Error('Invalid Cloudflare route.');
  }

  const status = candidate.status && typeof candidate.status === 'object'
    ? {
        connected: true,
        label: safeString(candidate.status.label, 256) || undefined,
        usage: Number.isFinite(candidate.status.usage) ? candidate.status.usage : undefined,
        limit: Number.isFinite(candidate.status.limit) || candidate.status.limit === null ? candidate.status.limit : undefined,
        limitRemaining: Number.isFinite(candidate.status.limitRemaining) || candidate.status.limitRemaining === null
          ? candidate.status.limitRemaining
          : undefined,
        limitReset: safeString(candidate.status.limitReset, 128) || null,
        expiresAt: safeString(candidate.status.expiresAt, 128) || null,
      }
    : { connected: true };

  return { secret: { accessToken, refreshToken }, configuration, status };
};

export const decodeVaultKey = (encoded) => {
  const key = Buffer.from(encoded ?? '', 'base64');
  if (key.length !== 32) throw new Error('AI_VAULT_KEY_B64 must decode to exactly 32 bytes.');
  return key;
};

export const encryptVaultConnection = (connection, key, aad) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(connection), 'utf8'), cipher.final()]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
};

export const decryptVaultConnection = (record, key, aad) => {
  if (record?.version !== 1 || record?.algorithm !== 'aes-256-gcm') throw new Error('Unsupported AI vault record.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext);
};

const responseMessage = async (response, label) => {
  let message = '';
  try {
    const payload = await response.json();
    message = typeof payload.error === 'string' ? payload.error : payload.error?.message ?? payload.message ?? '';
  } catch {
    // Use the status-specific message below.
  }
  if (response.status === 401 || response.status === 403) return 'This AI connection is no longer authorized. Reconnect and try again.';
  if (response.status === 402) return `This ${label} account has no available credit.`;
  if (response.status === 429) return `${label} is temporarily rate-limiting this account.`;
  return safeString(message, 240) || `${label} could not complete the request (${response.status}).`;
};

const refreshOAuthToken = async (provider, connection, fetchImpl) => {
  const expiry = Date.parse(connection.status?.expiresAt ?? '');
  if (!Number.isFinite(expiry) || expiry > Date.now() + 60_000) return connection;
  if (!connection.secret.refreshToken) throw new Error('This AI connection expired. Reconnect it once to continue.');
  const isHuggingFace = provider === 'huggingface';
  const endpoint = isHuggingFace ? 'https://huggingface.co/oauth/token' : 'https://dash.cloudflare.com/oauth2/token';
  const clientId = connection.configuration?.clientId || (isHuggingFace ? HUGGING_FACE_CLIENT_ID : CLOUDFLARE_CLIENT_ID);
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: connection.secret.refreshToken,
      client_id: clientId,
    }),
  });
  if (!response.ok) throw new Error(await responseMessage(response, isHuggingFace ? 'Hugging Face' : 'Cloudflare'));
  const payload = await response.json();
  if (!safeString(payload.access_token, 8_192)) throw new Error('The AI provider did not return a renewed connection.');
  return {
    ...connection,
    secret: {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || connection.secret.refreshToken,
    },
    status: {
      ...connection.status,
      connected: true,
      expiresAt: Number.isFinite(payload.expires_in)
        ? new Date(Date.now() + payload.expires_in * 1_000).toISOString()
        : connection.status?.expiresAt,
    },
  };
};

const selectHuggingFaceModel = (ids) => {
  const available = ids.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim());
  const preferred = available.find((id) => /qwen.*(?:4b|7b|8b).*instruct/i.test(id))
    ?? available.find((id) => /(?:mistral|ministral).*(?:7b|8b).*instruct/i.test(id))
    ?? available.find((id) => !/(?:gpt-oss|deepseek[^/]*r1|reasoning)/i.test(id))
    ?? available[0]
    ?? 'openai/gpt-oss-120b:cheapest';
  return /:(?:fastest|cheapest|preferred)$/i.test(preferred) ? preferred : `${preferred}:cheapest`;
};

export const refreshProviderConnection = async (provider, rawConnection, fetchImpl = fetch) => {
  let connection = validateVaultConnection(provider, rawConnection);
  if (provider === 'huggingface' || provider === 'cloudflare') {
    connection = await refreshOAuthToken(provider, connection, fetchImpl);
  }
  const token = connection.secret.accessToken;
  let response;
  if (provider === 'openrouter') {
    response = await fetchImpl('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(await responseMessage(response, 'OpenRouter'));
    const data = (await response.json()).data ?? {};
    connection.status = {
      connected: true,
      label: safeString(data.label, 256) || undefined,
      usage: Number.isFinite(data.usage) ? data.usage : undefined,
      limit: Number.isFinite(data.limit) || data.limit === null ? data.limit : undefined,
      limitRemaining: Number.isFinite(data.limit_remaining) || data.limit_remaining === null ? data.limit_remaining : undefined,
      limitReset: safeString(data.limit_reset, 128) || null,
      expiresAt: safeString(data.expires_at, 128) || null,
    };
  } else if (provider === 'huggingface') {
    response = await fetchImpl('https://router.huggingface.co/v1/models', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(await responseMessage(response, 'Hugging Face'));
    const payload = await response.json();
    const model = selectHuggingFaceModel(payload.data?.map((entry) => entry.id) ?? []);
    connection.status = { ...connection.status, connected: true, label: `Zero-markup routing · ${model}` };
  } else if (provider === 'cloudflare') {
    const { accountId, gatewayId, route } = connection.configuration;
    response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'cf-aig-gateway-id': gatewayId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: `dynamic/${route}`, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 1, temperature: 0, stream: false }),
    });
    if (!response.ok) throw new Error(await responseMessage(response, 'Cloudflare AI Gateway'));
    connection.status = { ...connection.status, connected: true, label: `${gatewayId} · dynamic/${route}` };
  } else {
    response = await fetchImpl('https://api-gateway.merge.dev/v1/models', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(await responseMessage(response, 'Merge Gateway'));
    connection.status = { ...connection.status, connected: true, label: 'Project policy · default_routing' };
  }
  return { connection, status: connection.status };
};

const providerGenerationConfiguration = (provider, connection, request) => {
  if (provider === 'openrouter') return {
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'openrouter/auto',
    headers: { 'HTTP-Referer': 'https://aispanda.com', 'X-OpenRouter-Title': 'AI Spanda' },
    extra: { provider: { data_collection: 'deny', allow_fallbacks: true }, ...(request.routePreference === 'economy' ? { reasoning: { effort: 'none', exclude: true } } : {}) },
    requestedRoute: 'Auto · economy',
    fallbackStatus: 'Automatic provider fallback enabled; whether used was not reported',
    costUnit: 'USD',
  };
  if (provider === 'huggingface') {
    const model = connection.status?.label?.split(' · ')[1] || 'openai/gpt-oss-120b:cheapest';
    const policy = model.match(/:(fastest|cheapest|preferred)$/i)?.[1];
    return {
      endpoint: 'https://router.huggingface.co/v1/chat/completions', model, headers: {},
      extra: /gpt-oss/i.test(model) ? { reasoning_effort: 'low' } : {},
      requestedRoute: policy ? `${policy[0].toUpperCase()}${policy.slice(1).toLowerCase()} provider` : 'Selected model',
      fallbackStatus: 'Automatic provider selection; whether failover was used was not reported',
    };
  }
  if (provider === 'cloudflare') {
    const { accountId, gatewayId, route } = connection.configuration;
    return {
      endpoint: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`,
      model: `dynamic/${route}`, headers: { 'cf-aig-gateway-id': gatewayId }, extra: {},
      requestedRoute: `dynamic/${route}`,
      fallbackStatus: 'Controlled by the dynamic route; whether fallback was used was not reported',
    };
  }
  return {
    endpoint: 'https://api-gateway.merge.dev/v1/openai/chat/completions', model: 'default_routing', headers: {}, extra: {},
    requestedRoute: 'Project routing policy', fallbackStatus: 'Controlled by the Merge project routing policy', costUnit: 'USD',
  };
};

export const generateWithProvider = async (provider, rawConnection, rawRequest, fetchImpl = fetch) => {
  const rawInstruction = typeof rawRequest?.instruction === 'string' ? rawRequest.instruction : '';
  const rawContent = typeof rawRequest?.content === 'string' ? rawRequest.content : '';
  if (rawInstruction.length > MAX_INPUT_CHARACTERS || rawContent.length > MAX_INPUT_CHARACTERS) {
    throw new Error('This content is too large for the selected AI route.');
  }
  const instruction = rawInstruction.trim();
  const content = rawContent.trim();
  if (!instruction) throw new Error('Add an instruction before generating.');
  if (!content) throw new Error('Add or select content before generating.');
  let connection = validateVaultConnection(provider, rawConnection);
  if (provider === 'huggingface' || provider === 'cloudflare') {
    connection = await refreshOAuthToken(provider, connection, fetchImpl);
  }
  const config = providerGenerationConfiguration(provider, connection, rawRequest);
  const startedAt = performance.now();
  const response = await fetchImpl(config.endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.secret.accessToken}`, 'Content-Type': 'application/json', ...config.headers },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'system', content: instruction }, { role: 'user', content }],
      max_tokens: Math.min(Math.max(Number(rawRequest.maxOutputTokens) || 800, 64), MAX_OUTPUT_TOKENS),
      temperature: 0.2,
      stream: false,
      ...config.extra,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const firstResponseMs = Math.max(0, performance.now() - startedAt);
  if (!response.ok) throw new Error(await responseMessage(response, provider));
  const payload = await response.json();
  const choice = payload.choices?.[0];
  const responseContent = choice?.message?.content;
  const text = typeof responseContent === 'string'
    ? responseContent.trim()
    : responseContent?.map((part) => part.text ?? '').join('').trim() ?? choice?.text?.trim() ?? '';
  if (!text) throw new Error('The AI route returned no text. Try another request.');
  const usage = payload.usage;
  return {
    connection,
    result: {
      text,
      model: payload.model ?? config.model,
      requestedRoute: config.requestedRoute,
      requestedModel: config.model,
      provider: payload.provider,
      requestId: payload.id,
      firstResponseMs,
      fallbackStatus: config.fallbackStatus,
      usage: usage ? {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        cachedInputTokens: usage.prompt_tokens_details?.cached_tokens,
        cost: config.costUnit && Number.isFinite(usage.cost) ? usage.cost : undefined,
        costUnit: config.costUnit && Number.isFinite(usage.cost) ? config.costUnit : undefined,
        costSource: config.costUnit && Number.isFinite(usage.cost) ? 'reported' : undefined,
        reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
      } : undefined,
    },
  };
};

export const revokeProviderConnection = async (provider, rawConnection, fetchImpl = fetch) => {
  const connection = validateVaultConnection(provider, rawConnection);
  if (provider !== 'cloudflare') return;
  await fetchImpl('https://dash.cloudflare.com/oauth2/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: connection.secret.accessToken, client_id: connection.configuration?.clientId || CLOUDFLARE_CLIENT_ID }),
  }).catch(() => undefined);
};
