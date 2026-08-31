const CAPABILITY_ID = /^[a-z][a-z0-9]*(?:\.[a-z0-9][a-z0-9_-]*){2,}$/;
const CREDENTIAL_ALIAS = /^credential(?:\.[a-z0-9][a-z0-9_-]*){2,}$/;
const CALLER_ID = /^[a-z][a-z0-9._:-]{2,127}$/;
const GSM_RESOURCE = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/secrets\/[A-Za-z0-9_-]{1,255}$/;
const NUMBERED_VERSION = /^[1-9][0-9]*$/;
const DESTINATION = /^internal:[a-z][a-z0-9._-]{2,127}$/;
const OPERATION = /^[a-z][a-z0-9]*(?:\.[a-z0-9][a-z0-9_-]*){2,}$/;
const ENVIRONMENT = /^(?:development|test|non-production|staging|production)$/;

const REGISTRATION_FIELDS = Object.freeze([
  'capability_id',
  'credential_alias',
  'gsm_resource',
  'approved_version',
  'approved_callers',
  'destination',
  'operation',
  'owner',
  'environment',
  'enabled',
  'revoked',
]);

export class CredentialConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CredentialConfigurationError';
  }
}

export class CredentialDenied extends Error {
  constructor() {
    super('Credential capability request denied');
    this.name = 'CredentialDenied';
  }
}

export class CredentialUnavailable extends Error {
  constructor(message = 'Credential capability is unavailable') {
    super(message);
    this.name = 'CredentialUnavailable';
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactFields(value, expected, label) {
  const keys = Object.keys(value).sort();
  const required = [...expected].sort();
  if (keys.length !== required.length || keys.some((key, index) => key !== required[index])) {
    throw new CredentialConfigurationError(`${label} fields are invalid`);
  }
}

function validateRegistration(value) {
  if (!isRecord(value)) {
    throw new CredentialConfigurationError('Credential registry entry must be an object');
  }
  assertExactFields(value, REGISTRATION_FIELDS, 'Credential registry entry');

  const stringFields = [
    'capability_id',
    'credential_alias',
    'gsm_resource',
    'approved_version',
    'destination',
    'operation',
    'owner',
    'environment',
  ];
  if (stringFields.some((field) => typeof value[field] !== 'string')) {
    throw new CredentialConfigurationError('Credential registry string fields are invalid');
  }
  if (!CAPABILITY_ID.test(value.capability_id)) {
    throw new CredentialConfigurationError('Credential capability_id is invalid');
  }
  if (!CREDENTIAL_ALIAS.test(value.credential_alias)) {
    throw new CredentialConfigurationError('Credential alias is invalid');
  }
  if (!GSM_RESOURCE.test(value.gsm_resource)) {
    throw new CredentialConfigurationError('Credential GSM resource is invalid');
  }
  if (!NUMBERED_VERSION.test(value.approved_version)) {
    throw new CredentialConfigurationError('Credential version must be numbered');
  }
  if (!DESTINATION.test(value.destination)) {
    throw new CredentialConfigurationError('Credential destination is invalid');
  }
  if (!OPERATION.test(value.operation)) {
    throw new CredentialConfigurationError('Credential operation is invalid');
  }
  if (!value.owner.trim() || value.owner.length > 128 || !ENVIRONMENT.test(value.environment)) {
    throw new CredentialConfigurationError('Credential ownership fields are invalid');
  }
  if (!Array.isArray(value.approved_callers)
    || value.approved_callers.length === 0
    || value.approved_callers.some((caller) => typeof caller !== 'string' || !CALLER_ID.test(caller))
    || new Set(value.approved_callers).size !== value.approved_callers.length) {
    throw new CredentialConfigurationError('Credential approved_callers are invalid');
  }
  if (typeof value.enabled !== 'boolean' || typeof value.revoked !== 'boolean') {
    throw new CredentialConfigurationError('Credential lifecycle fields are invalid');
  }

  return Object.freeze({
    ...value,
    approved_callers: Object.freeze([...value.approved_callers]),
  });
}

export class CredentialRegistry {
  #byCapability;

  constructor(registrations) {
    if (!Array.isArray(registrations) || registrations.length === 0) {
      throw new CredentialConfigurationError('Credential registry must contain entries');
    }

    this.#byCapability = new Map();
    const aliasResources = new Map();
    for (const rawRegistration of registrations) {
      const registration = validateRegistration(rawRegistration);
      if (this.#byCapability.has(registration.capability_id)) {
        throw new CredentialConfigurationError('Credential capability_id must be unique');
      }
      const aliasBinding = `${registration.gsm_resource}/versions/${registration.approved_version}`;
      const priorBinding = aliasResources.get(registration.credential_alias);
      if (priorBinding && priorBinding !== aliasBinding) {
        throw new CredentialConfigurationError('Credential alias has inconsistent bindings');
      }
      aliasResources.set(registration.credential_alias, aliasBinding);
      this.#byCapability.set(registration.capability_id, registration);
    }
  }

  static from(value) {
    if (!isRecord(value)) {
      throw new CredentialConfigurationError('Credential registry must be an object');
    }
    assertExactFields(value, ['credentials'], 'Credential registry');
    return new CredentialRegistry(value.credentials);
  }

  auditContext(request) {
    const caller = safeAuditIdentity(request?.caller_id, CALLER_ID, 'invalid-caller');
    const capability = safeAuditIdentity(
      request?.capability_id,
      CAPABILITY_ID,
      'invalid-capability',
    );
    const registration = capability === 'invalid-capability'
      ? null
      : this.#byCapability.get(capability);
    return Object.freeze({
      caller,
      capability,
      credential_alias: registration?.credential_alias ?? 'unresolved',
      version: registration?.approved_version ?? 'unresolved',
    });
  }

  authorize(request) {
    if (!isRecord(request)
      || Object.keys(request).length !== 2
      || !Object.hasOwn(request, 'caller_id')
      || !Object.hasOwn(request, 'capability_id')
      || typeof request.caller_id !== 'string'
      || typeof request.capability_id !== 'string'
      || !CALLER_ID.test(request.caller_id)
      || !CAPABILITY_ID.test(request.capability_id)) {
      throw new CredentialDenied();
    }

    const registration = this.#byCapability.get(request.capability_id);
    if (!registration
      || !registration.enabled
      || registration.revoked
      || !registration.approved_callers.includes(request.caller_id)) {
      throw new CredentialDenied();
    }
    return registration;
  }
}

function normalizeCrc32c(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0xffffffff
    ? numeric
    : null;
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

function clearSecretBytes(value) {
  if (value instanceof Uint8Array) value.fill(0);
}

export class GsmSecretProvider {
  #client;

  // The host supplies the official client configured through ADC or workload
  // identity. Credential files and raw key options are deliberately unsupported.
  constructor(options) {
    if (!isRecord(options)) {
      throw new CredentialConfigurationError('GSM provider options are invalid');
    }
    assertExactFields(options, ['client'], 'GSM provider');
    if (!options.client || typeof options.client.accessSecretVersion !== 'function') {
      throw new CredentialConfigurationError('GSM client is unavailable');
    }
    this.#client = options.client;
  }

  async accessSecret(registration) {
    const resourceName = `${registration.gsm_resource}/versions/${registration.approved_version}`;
    let bytes;
    try {
      const result = await this.#client.accessSecretVersion({ name: resourceName });
      const response = Array.isArray(result) ? result[0] : result;
      bytes = response?.payload?.data;
      const expectedChecksum = normalizeCrc32c(response?.payload?.dataCrc32c);
      if (!(bytes instanceof Uint8Array)
        || bytes.byteLength === 0
        || expectedChecksum === null
        || crc32c(bytes) !== expectedChecksum) {
        throw new Error('invalid provider response');
      }
      return bytes;
    } catch {
      clearSecretBytes(bytes);
      throw new CredentialUnavailable();
    }
  }
}

function safeAuditIdentity(value, pattern, fallback) {
  return typeof value === 'string' && pattern.test(value) ? value : fallback;
}

function auditedTimestamp(clock) {
  const timestamp = clock();
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    throw new CredentialConfigurationError('Credential receipt timestamp is invalid');
  }
  return timestamp;
}

async function emitAudit(auditSink, event) {
  try {
    await auditSink.emit(Object.freeze(event));
  } catch {
    throw new CredentialUnavailable('Credential audit is unavailable');
  }
}

export async function runApprovedCredentialOperation({
  registry,
  provider,
  auditSink,
  callerId,
  capabilityId,
  trustedOperation,
  clock = () => new Date().toISOString(),
}) {
  if (!(registry instanceof CredentialRegistry)
    || !provider
    || typeof provider.accessSecret !== 'function'
    || !auditSink
    || typeof auditSink.emit !== 'function'
    || typeof trustedOperation !== 'function'
    || typeof clock !== 'function') {
    throw new CredentialConfigurationError('Credential operation dependencies are invalid');
  }

  let registration;
  const deniedAuditContext = registry.auditContext({
    caller_id: callerId,
    capability_id: capabilityId,
  });
  try {
    registration = registry.authorize({
      caller_id: callerId,
      capability_id: capabilityId,
    });
  } catch (error) {
    if (!(error instanceof CredentialDenied)) throw error;
    await emitAudit(auditSink, {
      ...deniedAuditContext,
      timestamp: auditedTimestamp(clock),
      outcome: 'denied',
    });
    throw error;
  }

  const auditBase = Object.freeze({
    caller: callerId,
    capability: registration.capability_id,
    credential_alias: registration.credential_alias,
    version: registration.approved_version,
  });
  await emitAudit(auditSink, {
    ...auditBase,
    timestamp: auditedTimestamp(clock),
    outcome: 'attempted',
  });

  let secretBytes;
  try {
    secretBytes = await provider.accessSecret(registration);
    if (!(secretBytes instanceof Uint8Array) || secretBytes.byteLength === 0) {
      throw new CredentialUnavailable();
    }

    // This is a direct trusted-runtime boundary, not a network gateway. The
    // registry fixes the internal destination and operation before resolution.
    const context = Object.freeze({
      caller_id: callerId,
      capability_id: registration.capability_id,
      credential_alias: registration.credential_alias,
      destination: registration.destination,
      operation: registration.operation,
      version: registration.approved_version,
    });
    await trustedOperation(secretBytes, context);
    clearSecretBytes(secretBytes);
    secretBytes = undefined;

    const timestamp = auditedTimestamp(clock);
    await emitAudit(auditSink, { ...auditBase, timestamp, outcome: 'succeeded' });
    return Object.freeze({ ...context, timestamp, outcome: 'succeeded' });
  } catch (error) {
    clearSecretBytes(secretBytes);
    secretBytes = undefined;
    try {
      await emitAudit(auditSink, {
        ...auditBase,
        timestamp: auditedTimestamp(clock),
        outcome: 'unavailable',
      });
    } catch {
      throw new CredentialUnavailable('Credential audit is unavailable');
    }
    if (error instanceof CredentialConfigurationError) throw error;
    throw new CredentialUnavailable();
  }
}
