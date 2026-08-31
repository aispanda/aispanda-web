import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CredentialConfigurationError,
  CredentialDenied,
  CredentialRegistry,
  CredentialUnavailable,
  GsmSecretProvider,
  runApprovedCredentialOperation,
} from '../server/agent-credential-foundation.mjs';

const fixtureUrl = new URL('./fixtures/ai62-credential-registry.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
const canonicalEntry = fixture.credentials[0];

function registryWith(updates = {}) {
  return CredentialRegistry.from({
    credentials: [{ ...canonicalEntry, ...updates }],
  });
}

function runtimeSecret() {
  return `runtime-${randomBytes(24).toString('base64url')}`;
}

function crc32c(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (0x82f63b78 & -(checksum & 1));
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function fakeGsmClient(secretText, updates = {}) {
  const data = Buffer.from(secretText);
  const calls = [];
  return {
    calls,
    data,
    async accessSecretVersion(request) {
      calls.push(request);
      if (updates.error) throw updates.error;
      return [{
        payload: {
          data,
          dataCrc32c: updates.dataCrc32c ?? crc32c(data),
        },
      }];
    },
  };
}

function memoryAuditSink(error = null) {
  const events = [];
  return {
    events,
    async emit(event) {
      if (error) throw error;
      events.push({ ...event });
    },
  };
}

test('loads one value-free synthetic non-production registration', () => {
  const registry = CredentialRegistry.from(fixture);
  const registration = registry.authorize({
    caller_id: 'runtime.ai62.test',
    capability_id: 'credential.synthetic.consume',
  });
  assert.equal(fixture.credentials.length, 1);
  assert.equal(registration.credential_alias, 'credential.synthetic.nonprod');
  assert.equal(registration.environment, 'non-production');
  assert.equal(registration.approved_version, '1');
  assert.deepEqual(Object.keys(registration).sort(), [
    'approved_callers', 'approved_version', 'capability_id', 'credential_alias',
    'destination', 'enabled', 'environment', 'gsm_resource', 'operation', 'owner', 'revoked',
  ]);
});

test('fixture contains policy and references but no secret-bearing fields', () => {
  const forbidden = new Set([
    'api_key', 'client_secret', 'credential_value', 'password', 'private_key',
    'refresh_token', 'secret_value', 'token', 'value',
  ]);
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbidden.has(key.toLowerCase()), false, `forbidden field: ${key}`);
      visit(child);
    }
  };
  visit(fixture);
});

test('rejects malformed and unsupported registry configuration', () => {
  assert.throws(
    () => registryWith({ approved_version: 'latest' }),
    CredentialConfigurationError,
  );
  assert.throws(
    () => CredentialRegistry.from({
      credentials: [{ ...canonicalEntry, credential_value: 'not-allowed' }],
    }),
    CredentialConfigurationError,
  );
  assert.throws(
    () => CredentialRegistry.from({ credentials: [canonicalEntry, canonicalEntry] }),
    CredentialConfigurationError,
  );
});

test('denies unknown or malformed caller and capability without echoing input', () => {
  const registry = CredentialRegistry.from(fixture);
  const requests = [
    { caller_id: 'runtime.unknown.test', capability_id: 'credential.synthetic.consume' },
    { caller_id: '../hostile', capability_id: 'credential.synthetic.consume' },
    { caller_id: 'runtime.ai62.test', capability_id: 'credential.unknown.consume' },
    { caller_id: 'runtime.ai62.test', capability_id: '../hostile' },
  ];
  for (const request of requests) {
    assert.throws(
      () => registry.authorize(request),
      (error) => error instanceof CredentialDenied
        && error.message === 'Credential capability request denied'
        && !error.message.includes(request.caller_id)
        && !error.message.includes(request.capability_id),
    );
  }
});

test('denies disabled or revoked registration', () => {
  assert.throws(
    () => registryWith({ enabled: false }).authorize({
      caller_id: 'runtime.ai62.test',
      capability_id: 'credential.synthetic.consume',
    }),
    CredentialDenied,
  );
  assert.throws(
    () => registryWith({ revoked: true }).authorize({
      caller_id: 'runtime.ai62.test',
      capability_id: 'credential.synthetic.consume',
    }),
    CredentialDenied,
  );
});

test('request cannot supply alias, version, destination, or operation', () => {
  const registry = CredentialRegistry.from(fixture);
  for (const field of ['credential_alias', 'approved_version', 'destination', 'operation']) {
    assert.throws(
      () => registry.authorize({
        caller_id: 'runtime.ai62.test',
        capability_id: 'credential.synthetic.consume',
        [field]: 'caller-controlled',
      }),
      CredentialDenied,
    );
  }
});

test('runs one approved internal operation and returns only a sanitized receipt', async () => {
  const secret = runtimeSecret();
  const client = fakeGsmClient(secret);
  const auditSink = memoryAuditSink();
  const contexts = [];
  const receipt = await runApprovedCredentialOperation({
    registry: CredentialRegistry.from(fixture),
    provider: new GsmSecretProvider({ client }),
    auditSink,
    callerId: 'runtime.ai62.test',
    capabilityId: 'credential.synthetic.consume',
    clock: () => '2026-08-31T04:00:00.000Z',
    trustedOperation: async (secretBytes, context) => {
      assert.equal(Buffer.from(secretBytes).toString('utf8'), secret);
      contexts.push(context);
      return { ignored: secret };
    },
  });

  assert.deepEqual(client.calls, [{
    name: 'projects/example-nonprod/secrets/synthetic-proof/versions/1',
  }]);
  assert.deepEqual(contexts, [{
    caller_id: 'runtime.ai62.test',
    capability_id: 'credential.synthetic.consume',
    credential_alias: 'credential.synthetic.nonprod',
    destination: 'internal:synthetic-proof',
    operation: 'credential.synthetic.consume',
    version: '1',
  }]);
  assert.deepEqual(receipt, {
    ...contexts[0],
    timestamp: '2026-08-31T04:00:00.000Z',
    outcome: 'succeeded',
  });
  assert.equal(Object.hasOwn(receipt, 'value'), false);
  assert.deepEqual(auditSink.events, [
    {
      caller: 'runtime.ai62.test',
      capability: 'credential.synthetic.consume',
      credential_alias: 'credential.synthetic.nonprod',
      version: '1',
      timestamp: '2026-08-31T04:00:00.000Z',
      outcome: 'attempted',
    },
    {
      caller: 'runtime.ai62.test',
      capability: 'credential.synthetic.consume',
      credential_alias: 'credential.synthetic.nonprod',
      version: '1',
      timestamp: '2026-08-31T04:00:00.000Z',
      outcome: 'succeeded',
    },
  ]);
  assert.equal(JSON.stringify(receipt).includes(secret), false);
  assert.equal(JSON.stringify(auditSink.events).includes(secret), false);
  assert.equal(client.data.every((byte) => byte === 0), true);
});

test('denies caller, capability, and lifecycle failures before GSM access', async () => {
  const cases = [
    { registry: CredentialRegistry.from(fixture), callerId: 'runtime.unknown.test' },
    { registry: CredentialRegistry.from(fixture), capabilityId: 'credential.unknown.consume' },
    { registry: registryWith({ enabled: false }) },
    { registry: registryWith({ revoked: true }) },
  ];

  for (const candidate of cases) {
    let providerCalls = 0;
    let operationCalls = 0;
    const auditSink = memoryAuditSink();
    await assert.rejects(
      runApprovedCredentialOperation({
        registry: candidate.registry,
        provider: { async accessSecret() { providerCalls += 1; } },
        auditSink,
        callerId: candidate.callerId ?? 'runtime.ai62.test',
        capabilityId: candidate.capabilityId ?? 'credential.synthetic.consume',
        trustedOperation: async () => { operationCalls += 1; },
      }),
      CredentialDenied,
    );
    assert.equal(providerCalls, 0);
    assert.equal(operationCalls, 0);
    assert.equal(auditSink.events.length, 1);
    assert.equal(auditSink.events[0].outcome, 'denied');
    assert.deepEqual(Object.keys(auditSink.events[0]).sort(), [
      'caller', 'capability', 'credential_alias', 'outcome', 'timestamp', 'version',
    ]);
  }
});

test('preserves a valid authenticated but unapproved caller in denial evidence', async () => {
  const auditSink = memoryAuditSink();
  await assert.rejects(
    runApprovedCredentialOperation({
      registry: CredentialRegistry.from(fixture),
      provider: { async accessSecret() { assert.fail('provider must not run'); } },
      auditSink,
      callerId: 'runtime.unapproved.test',
      capabilityId: 'credential.synthetic.consume',
      clock: () => '2026-08-31T04:00:00.000Z',
      trustedOperation: async () => assert.fail('operation must not run'),
    }),
    CredentialDenied,
  );
  assert.deepEqual(auditSink.events, [{
    caller: 'runtime.unapproved.test',
    capability: 'credential.synthetic.consume',
    credential_alias: 'credential.synthetic.nonprod',
    version: '1',
    timestamp: '2026-08-31T04:00:00.000Z',
    outcome: 'denied',
  }]);
});

test('fails closed before GSM access when audit evidence is unavailable', async () => {
  let providerCalls = 0;
  await assert.rejects(
    runApprovedCredentialOperation({
      registry: CredentialRegistry.from(fixture),
      provider: { async accessSecret() { providerCalls += 1; } },
      auditSink: memoryAuditSink(new Error('audit unavailable')),
      callerId: 'runtime.ai62.test',
      capabilityId: 'credential.synthetic.consume',
      trustedOperation: async () => assert.fail('operation must not run'),
    }),
    (error) => error instanceof CredentialUnavailable
      && error.message === 'Credential audit is unavailable',
  );
  assert.equal(providerCalls, 0);
});

test('masks provider and trusted-operation failures and clears retrieved bytes', async () => {
  const secret = runtimeSecret();
  const failingClient = fakeGsmClient(secret, {
    error: new Error(`provider leaked ${secret}`),
  });
  const failureAudit = memoryAuditSink();
  await assert.rejects(
    runApprovedCredentialOperation({
      registry: CredentialRegistry.from(fixture),
      provider: new GsmSecretProvider({ client: failingClient }),
      auditSink: failureAudit,
      callerId: 'runtime.ai62.test',
      capabilityId: 'credential.synthetic.consume',
      trustedOperation: async () => undefined,
    }),
    (error) => error instanceof CredentialUnavailable && !error.message.includes(secret),
  );
  assert.equal(JSON.stringify(failureAudit.events).includes(secret), false);

  const operationClient = fakeGsmClient(secret);
  const operationAudit = memoryAuditSink();
  await assert.rejects(
    runApprovedCredentialOperation({
      registry: CredentialRegistry.from(fixture),
      provider: new GsmSecretProvider({ client: operationClient }),
      auditSink: operationAudit,
      callerId: 'runtime.ai62.test',
      capabilityId: 'credential.synthetic.consume',
      trustedOperation: async () => { throw new Error(`operation leaked ${secret}`); },
    }),
    (error) => error instanceof CredentialUnavailable && !error.message.includes(secret),
  );
  assert.equal(operationClient.data.every((byte) => byte === 0), true);
  assert.equal(JSON.stringify(operationAudit.events).includes(secret), false);
  assert.equal(operationAudit.events.at(-1).outcome, 'unavailable');
});

test('rejects checksum mismatch and key-file style provider configuration', async () => {
  const secret = runtimeSecret();
  const client = fakeGsmClient(secret, { dataCrc32c: 1 });
  await assert.rejects(
    runApprovedCredentialOperation({
      registry: CredentialRegistry.from(fixture),
      provider: new GsmSecretProvider({ client }),
      auditSink: memoryAuditSink(),
      callerId: 'runtime.ai62.test',
      capabilityId: 'credential.synthetic.consume',
      trustedOperation: async () => assert.fail('operation must not run'),
    }),
    CredentialUnavailable,
  );
  assert.equal(client.data.every((byte) => byte === 0), true);
  assert.throws(
    () => new GsmSecretProvider({ client, credentialsFile: 'service-account.json' }),
    CredentialConfigurationError,
  );
});

test('masks malformed payloads and malformed injected provider returns', async () => {
  const secret = runtimeSecret();
  const malformedClient = {
    async accessSecretVersion() {
      return [{ payload: { data: secret, dataCrc32c: 1 } }];
    },
  };
  await assert.rejects(
    runApprovedCredentialOperation({
      registry: CredentialRegistry.from(fixture),
      provider: new GsmSecretProvider({ client: malformedClient }),
      auditSink: memoryAuditSink(),
      callerId: 'runtime.ai62.test',
      capabilityId: 'credential.synthetic.consume',
      trustedOperation: async () => assert.fail('operation must not run'),
    }),
    (error) => error instanceof CredentialUnavailable && !error.message.includes(secret),
  );
  await assert.rejects(
    runApprovedCredentialOperation({
      registry: CredentialRegistry.from(fixture),
      provider: { async accessSecret() { return secret; } },
      auditSink: memoryAuditSink(),
      callerId: 'runtime.ai62.test',
      capabilityId: 'credential.synthetic.consume',
      trustedOperation: async () => assert.fail('operation must not run'),
    }),
    (error) => error instanceof CredentialUnavailable && !error.message.includes(secret),
  );
});

test('verifies CRC32C against an independent known vector', async () => {
  const data = Buffer.from('123456789');
  const client = {
    async accessSecretVersion() {
      return [{ payload: { data, dataCrc32c: 0xe3069283 } }];
    },
  };
  const receipt = await runApprovedCredentialOperation({
    registry: CredentialRegistry.from(fixture),
    provider: new GsmSecretProvider({ client }),
    auditSink: memoryAuditSink(),
    callerId: 'runtime.ai62.test',
    capabilityId: 'credential.synthetic.consume',
    trustedOperation: async () => undefined,
  });
  assert.equal(receipt.outcome, 'succeeded');
  assert.equal(data.every((byte) => byte === 0), true);
});

test('rotates and rolls back a stable alias through registry-only numbered version changes', async () => {
  const observedNames = [];
  const observedSecrets = [];
  for (const approvedVersion of ['1', '2', '1']) {
    const secret = runtimeSecret();
    const client = fakeGsmClient(secret);
    const receipt = await runApprovedCredentialOperation({
      registry: registryWith({ approved_version: approvedVersion }),
      provider: new GsmSecretProvider({ client }),
      auditSink: memoryAuditSink(),
      callerId: 'runtime.ai62.test',
      capabilityId: 'credential.synthetic.consume',
      trustedOperation: async (secretBytes) => {
        observedSecrets.push(Buffer.from(secretBytes).toString('utf8'));
      },
    });
    observedNames.push(client.calls[0].name);
    assert.equal(receipt.credential_alias, 'credential.synthetic.nonprod');
    assert.equal(receipt.version, approvedVersion);
  }
  assert.deepEqual(observedNames, [
    'projects/example-nonprod/secrets/synthetic-proof/versions/1',
    'projects/example-nonprod/secrets/synthetic-proof/versions/2',
    'projects/example-nonprod/secrets/synthetic-proof/versions/1',
  ]);
  assert.equal(new Set(observedSecrets).size, 3);
});

test('reuses an alias only when compatible capabilities share its exact binding', () => {
  const compatible = {
    ...canonicalEntry,
    capability_id: 'credential.synthetic.verify',
    operation: 'credential.synthetic.verify',
  };
  assert.doesNotThrow(() => CredentialRegistry.from({
    credentials: [canonicalEntry, compatible],
  }));
  assert.throws(
    () => CredentialRegistry.from({
      credentials: [canonicalEntry, { ...compatible, approved_version: '2' }],
    }),
    CredentialConfigurationError,
  );
});

test('rejects network destinations because this MVP has no gateway', () => {
  assert.throws(
    () => registryWith({ destination: 'https://caller-controlled.example' }),
    CredentialConfigurationError,
  );
});
