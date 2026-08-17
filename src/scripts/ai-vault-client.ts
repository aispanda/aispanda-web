import { getAuth } from 'firebase/auth';
import type {
  AiConnectionStatus,
  AiGenerationRequest,
  AiGenerationResult,
  AiPersistentConnectionPayload,
  AiVaultSnapshot,
} from './ai-connections';
import { getFirebaseClientApp } from './firebase-client';

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const user = getAuth(getFirebaseClientApp()).currentUser;
  if (!user) throw new Error('Sign in before managing a persistent AI connection.');
  const token = await user.getIdToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || 'The saved AI connection could not be updated.');
  return payload;
};

export const loadAiVaultConnections = () => request<AiVaultSnapshot>('/api/ai/connections');

export const saveAiVaultConnection = async (
  provider: string,
  connection: AiPersistentConnectionPayload,
) => {
  const result = await request<{ status: AiConnectionStatus }>(`/api/ai/connections/${encodeURIComponent(provider)}`, {
    method: 'PUT',
    body: JSON.stringify(connection),
  });
  return result.status;
};

export const setActiveAiVaultConnection = (provider: string | null) => request<void>('/api/ai/connections/active', {
  method: 'PUT',
  body: JSON.stringify({ provider }),
});

export const refreshAiVaultConnection = async (provider: string) => {
  const result = await request<{ status: AiConnectionStatus }>(`/api/ai/connections/${encodeURIComponent(provider)}/status`, {
    method: 'POST',
    body: '{}',
  });
  return result.status;
};

export const generateWithAiVault = (provider: string, generation: AiGenerationRequest) => request<AiGenerationResult>(
  `/api/ai/connections/${encodeURIComponent(provider)}/generate`,
  { method: 'POST', body: JSON.stringify(generation) },
);

export const disconnectAiVaultConnection = (provider: string) => request<void>(
  `/api/ai/connections/${encodeURIComponent(provider)}`,
  { method: 'DELETE' },
);
