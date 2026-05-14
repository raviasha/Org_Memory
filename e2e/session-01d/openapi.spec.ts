/**
 * Session 1d — OpenAPI contract tests
 *
 * Pure file-system contract tests: no running server required.
 * Validates that openapi/v1.yaml exists, parses as valid YAML,
 * conforms to OpenAPI 3.1, and contains all required endpoints
 * with the correct security/error/idempotency conventions.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPEC_PATH = path.resolve(__dirname, '../../openapi/v1.yaml');

/** Parse the spec once and cache it for the test run. */
let _spec: Record<string, unknown> | null = null;
function loadSpec(): Record<string, unknown> {
  if (_spec) return _spec;
  const raw = fs.readFileSync(SPEC_PATH, 'utf8');
  _spec = yaml.load(raw) as Record<string, unknown>;
  return _spec;
}

/** Return the paths object from the spec. */
function getPaths(): Record<string, unknown> {
  return (loadSpec().paths ?? {}) as Record<string, unknown>;
}

/** Return the operation object for a given path + method, or null. */
function getOperation(
  pathKey: string,
  method: string,
): Record<string, unknown> | null {
  const pathItem = (getPaths()[pathKey] ?? {}) as Record<string, unknown>;
  return (pathItem[method.toLowerCase()] ?? null) as Record<string, unknown> | null;
}

/** Mutating endpoints that must carry an Idempotency-Key parameter. */
const MUTATING_OPERATIONS: Array<[string, string]> = [
  ['/tasks/curate', 'post'],
  ['/subtasks/{subtask_id}/curate', 'post'],
  ['/subtasks/{subtask_id}/write-intents', 'post'],
];

/** All required v1 endpoint paths. */
const REQUIRED_PATHS = [
  '/health',
  '/tasks/curate',
  '/subtasks/{subtask_id}/curate',
  '/subtasks/{subtask_id}/write-intents',
  '/snapshots/{snapshot_id}',
  '/snapshots/{snapshot_id}/export-assets',
  '/runs/{run_id}/events',
  '/assets/{asset_id}/representations',
  '/memory-stores/{memory_store_id}/activity',
  '/wiki/graph',
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('session-01d › OpenAPI spec contract', () => {

  // --- File existence -------------------------------------------------------

  test('openapi/v1.yaml exists on disk', () => {
    expect(fs.existsSync(SPEC_PATH)).toBe(true);
  });

  // --- YAML validity --------------------------------------------------------

  test('openapi/v1.yaml is valid YAML', () => {
    const raw = fs.readFileSync(SPEC_PATH, 'utf8');
    expect(() => yaml.load(raw)).not.toThrow();
  });

  // --- OpenAPI 3.1 version --------------------------------------------------

  test('spec declares openapi: 3.1.0', () => {
    const spec = loadSpec();
    expect(spec.openapi).toBe('3.1.0');
  });

  // --- Required top-level fields -------------------------------------------

  test('spec has info.title and info.version', () => {
    const info = loadSpec().info as Record<string, unknown>;
    expect(typeof info.title).toBe('string');
    expect((info.title as string).length).toBeGreaterThan(0);
    expect(typeof info.version).toBe('string');
  });

  // --- Bearer auth scheme ---------------------------------------------------

  test('spec defines a bearerAuth security scheme', () => {
    const components = loadSpec().components as Record<string, unknown>;
    const schemes = components?.securitySchemes as Record<string, unknown>;
    expect(schemes).toBeDefined();
    const bearer = schemes?.bearerAuth as Record<string, unknown>;
    expect(bearer).toBeDefined();
    expect(bearer.type).toBe('http');
    expect(bearer.scheme).toBe('bearer');
  });

  test('spec has a global security requirement', () => {
    const security = loadSpec().security as unknown[];
    expect(Array.isArray(security)).toBe(true);
    expect(security.length).toBeGreaterThan(0);
  });

  // --- Required endpoints ---------------------------------------------------

  for (const pathKey of REQUIRED_PATHS) {
    test(`spec contains path: ${pathKey}`, () => {
      const paths = getPaths();
      expect(
        Object.keys(paths),
        `Missing required path: ${pathKey}`,
      ).toContain(pathKey);
    });
  }

  // --- Each endpoint has at least one operation -----------------------------

  test('every required path has at least one HTTP operation defined', () => {
    const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];
    for (const pathKey of REQUIRED_PATHS) {
      const pathItem = (getPaths()[pathKey] ?? {}) as Record<string, unknown>;
      const ops = HTTP_METHODS.filter((m) => pathItem[m] != null);
      expect(ops.length, `Path ${pathKey} has no operations`).toBeGreaterThan(0);
    }
  });

  // --- Security on every operation -----------------------------------------

  test('every operation has a security requirement (explicit or inherited)', () => {
    const globalSecurity = loadSpec().security as unknown[];
    const hasGlobal = Array.isArray(globalSecurity) && globalSecurity.length > 0;

    const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];
    for (const pathKey of REQUIRED_PATHS) {
      const pathItem = (getPaths()[pathKey] ?? {}) as Record<string, unknown>;
      for (const method of HTTP_METHODS) {
        const op = pathItem[method] as Record<string, unknown> | undefined;
        if (!op) continue;
        // Operation-level security overrides global; if absent, global applies.
        const opSecurity = op.security as unknown[] | undefined;
        const covered =
          (Array.isArray(opSecurity) && opSecurity.length > 0) || hasGlobal;
        expect(
          covered,
          `${method.toUpperCase()} ${pathKey} has no security requirement`,
        ).toBe(true);
      }
    }
  });

  // --- 401 response on every operation -------------------------------------

  test('every operation declares a 401 response', () => {
    const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];
    for (const pathKey of REQUIRED_PATHS) {
      const pathItem = (getPaths()[pathKey] ?? {}) as Record<string, unknown>;
      for (const method of HTTP_METHODS) {
        const op = pathItem[method] as Record<string, unknown> | undefined;
        if (!op) continue;
        const responses = op.responses as Record<string, unknown> | undefined;
        expect(
          responses?.['401'],
          `${method.toUpperCase()} ${pathKey} missing 401 response`,
        ).toBeDefined();
      }
    }
  });

  // --- Idempotency-Key on mutating endpoints --------------------------------

  test('mutating endpoints declare an Idempotency-Key parameter', () => {
    for (const [pathKey, method] of MUTATING_OPERATIONS) {
      const op = getOperation(pathKey, method);
      expect(op, `Operation not found: ${method.toUpperCase()} ${pathKey}`).not.toBeNull();
      const params = (op?.parameters ?? []) as Array<Record<string, unknown>>;
      const hasIdempotency = params.some(
        (p) =>
          p.name === 'Idempotency-Key' ||
          (typeof p.$ref === 'string' && p.$ref.includes('IdempotencyKey')),
      );
      expect(
        hasIdempotency,
        `${method.toUpperCase()} ${pathKey} is missing Idempotency-Key parameter`,
      ).toBe(true);
    }
  });

  // --- ACL envelope on request bodies --------------------------------------

  test('mutating endpoints include acl_scope in the request body schema', () => {
    for (const [pathKey, method] of MUTATING_OPERATIONS) {
      const op = getOperation(pathKey, method);
      const body = op?.requestBody as Record<string, unknown> | undefined;
      expect(
        body,
        `${method.toUpperCase()} ${pathKey} is missing a requestBody`,
      ).toBeDefined();

      // Walk into content -> application/json -> schema (possibly allOf)
      const content = body?.content as Record<string, unknown> | undefined;
      const jsonContent = content?.['application/json'] as Record<string, unknown> | undefined;
      const schema = jsonContent?.schema as Record<string, unknown> | undefined;
      expect(
        schema,
        `${method.toUpperCase()} ${pathKey} requestBody has no JSON schema`,
      ).toBeDefined();

      // Accept either a direct properties.acl_scope or via allOf referencing AclEnvelope
      const bodyStr = JSON.stringify(schema);
      const hasAcl =
        bodyStr.includes('acl_scope') || bodyStr.includes('AclEnvelope');
      expect(
        hasAcl,
        `${method.toUpperCase()} ${pathKey} requestBody does not include acl_scope / AclEnvelope`,
      ).toBe(true);
    }
  });

  // --- Pagination on list endpoints ----------------------------------------

  const PAGINATED_OPERATIONS: Array<[string, string]> = [
    ['/snapshots/{snapshot_id}/export-assets', 'get'],
    ['/runs/{run_id}/events', 'get'],
    ['/memory-stores/{memory_store_id}/activity', 'get'],
    ['/wiki/graph', 'get'],
  ];

  test('paginated list endpoints declare cursor and limit query parameters', () => {
    // Pre-resolve component parameter $refs so we can compare by `name` field.
    const components = loadSpec().components as Record<string, unknown>;
    const compParams = (components?.parameters ?? {}) as Record<string, unknown>;

    function resolveParamName(p: Record<string, unknown>): string {
      if (typeof p.name === 'string') return p.name;
      if (typeof p.$ref === 'string') {
        const refKey = p.$ref.split('/').pop() ?? '';
        const resolved = compParams[refKey] as Record<string, unknown> | undefined;
        return typeof resolved?.name === 'string' ? resolved.name : refKey;
      }
      return '';
    }

    for (const [pathKey, method] of PAGINATED_OPERATIONS) {
      const op = getOperation(pathKey, method);
      expect(op, `Operation not found: ${method.toUpperCase()} ${pathKey}`).not.toBeNull();
      const params = (op?.parameters ?? []) as Array<Record<string, unknown>>;
      const names = params.map(resolveParamName);
      expect(
        names,
        `${method.toUpperCase()} ${pathKey} missing cursor pagination param`,
      ).toContain('cursor');
      expect(
        names,
        `${method.toUpperCase()} ${pathKey} missing limit pagination param`,
      ).toContain('limit');
    }
  });

  // --- Standard error codes -------------------------------------------------

  const STANDARD_ERROR_CODES = ['400', '401', '403', '404', '422', '429', '500'];

  test('reusable error responses cover all standard codes', () => {
    const components = loadSpec().components as Record<string, unknown>;
    const responses = components?.responses as Record<string, unknown> ?? {};
    for (const code of STANDARD_ERROR_CODES) {
      expect(
        responses[code],
        `Missing reusable response component for status ${code}`,
      ).toBeDefined();
    }
  });

  // --- Error schema has required fields ------------------------------------

  test('Error schema requires error and code string fields', () => {
    const components = loadSpec().components as Record<string, unknown>;
    const schemas = components?.schemas as Record<string, unknown> ?? {};
    const errorSchema = schemas.Error as Record<string, unknown> | undefined;
    expect(errorSchema, 'Error schema not defined in components').toBeDefined();

    const required = errorSchema?.required as string[] | undefined;
    expect(required, 'Error schema required array missing').toBeDefined();
    expect(required).toContain('error');
    expect(required).toContain('code');
  });

});
