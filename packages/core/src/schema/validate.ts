// SPDX-License-Identifier: MIT

import _Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import _addFormats from 'ajv-formats';

// Ajv 8 and ajv-formats are CommonJS with an attached `.default`. Under
// NodeNext the runtime hands back the callable and TypeScript hands back the
// namespace, so the two disagree about what the import is. Re-typing here is
// the narrow fix; the alternative is `esModuleInterop`, which would relax the
// setting for every import in the package to paper over two.
const Ajv2020 = _Ajv2020 as unknown as typeof _Ajv2020.default;
const addFormats = _addFormats as unknown as typeof _addFormats.default;

import {
  collaredStructureSchema,
  referenceCompositionSchema,
  scenarioSchema,
} from './schemas.generated.ts';
import type {
  CollaredStructure,
  DocumentKind,
  ReferenceComposition,
  Scenario,
} from './types.ts';

/** The schema version this build of the core speaks. */
export const SUPPORTED_SCHEMA_VERSION = '0.2.0';

export interface Problem {
  /** JSON pointer into the document, or '' for the document itself. */
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; document: T; problems: [] }
  | { ok: false; document: null; problems: Problem[] };

/**
 * Compatibility gate for `schema_version`. Invariant 5 and D-21: unknown
 * versions are refused, not guessed at.
 *
 * Below 1.0 the MINOR component is the compatibility axis, because 0.x
 * pre-release versions conventionally break on minor bumps and the invariant
 * would otherwise be vacuous — every 0.x document shares major 0, so a
 * major-only check would accept every future breaking change. A 0.2.x reader
 * therefore refuses 0.1.x and 0.3.x alike.
 *
 * At and above 1.0 the rule is the ordinary one: the major must match, and a
 * minor newer than this build is refused because it may carry fields this build
 * would silently ignore. An older minor is accepted — minor versions may add
 * optional fields only, so an older document is merely a document without them.
 */
export function checkSchemaVersion(version: unknown): Problem | null {
  if (typeof version !== 'string') {
    return {
      path: '/schema_version',
      message: `schema_version is required and must be a string; got ${typeof version}. This build speaks ${SUPPORTED_SCHEMA_VERSION}.`,
    };
  }
  const parsed = parseVersion(version);
  if (!parsed) {
    return {
      path: '/schema_version',
      message: `schema_version "${version}" is not a MAJOR.MINOR.PATCH version. This build speaks ${SUPPORTED_SCHEMA_VERSION}.`,
    };
  }
  const supported = parseVersion(SUPPORTED_SCHEMA_VERSION);
  if (!supported) throw new Error('SUPPORTED_SCHEMA_VERSION is malformed');

  if (parsed.major !== supported.major) {
    return {
      path: '/schema_version',
      message: `schema_version ${version} has major ${parsed.major}; this build speaks ${SUPPORTED_SCHEMA_VERSION} and refuses other majors rather than guessing at them.`,
    };
  }
  if (supported.major === 0) {
    if (parsed.minor !== supported.minor) {
      return {
        path: '/schema_version',
        message: `schema_version ${version} is not compatible with ${SUPPORTED_SCHEMA_VERSION}. Below 1.0 the minor version is the compatibility axis, so 0.${parsed.minor}.x and 0.${supported.minor}.x are different contracts.`,
      };
    }
    return null;
  }
  if (parsed.minor > supported.minor) {
    return {
      path: '/schema_version',
      message: `schema_version ${version} is newer than this build's ${SUPPORTED_SCHEMA_VERSION} and may carry fields it would ignore.`,
    };
  }
  return null;
}

function parseVersion(v: string): { major: number; minor: number; patch: number } | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
addFormats(ajv);

const validators: Record<DocumentKind, ValidateFunction> = {
  collared_structure: ajv.compile(collaredStructureSchema),
  scenario: ajv.compile(scenarioSchema),
  reference_composition: ajv.compile(referenceCompositionSchema),
};

function toProblem(e: ErrorObject): Problem {
  const path = e.instancePath || '';
  const extra =
    e.keyword === 'additionalProperties'
      ? ` (unexpected property "${String((e.params as { additionalProperty?: string }).additionalProperty)}")`
      : '';
  return { path, message: `${path || 'document'} ${e.message ?? 'is invalid'}${extra}` };
}

/**
 * Validate a parsed document against its schema.
 *
 * The version gate runs first and short-circuits, so a document from a
 * different contract produces one message about the contract rather than fifty
 * about fields that moved.
 */
export function validateDocument<T>(kind: DocumentKind, doc: unknown): ValidationResult<T> {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return {
      ok: false,
      document: null,
      problems: [{ path: '', message: 'document must be a JSON object' }],
    };
  }

  const versionProblem = checkSchemaVersion((doc as { schema_version?: unknown }).schema_version);
  if (versionProblem) {
    return { ok: false, document: null, problems: [versionProblem] };
  }

  const validate = validators[kind];
  if (!validate(doc)) {
    const problems = (validate.errors ?? []).map(toProblem);
    return { ok: false, document: null, problems };
  }
  return { ok: true, document: doc as T, problems: [] };
}

/**
 * Checks that only a whole-document view can make: references that the schema
 * cannot express, because JSON Schema has no way to say "this string must be a
 * key of that object".
 *
 * These are the errors a mis-mapped CSV produces, which is why they are caught
 * here and reported by field rather than surfacing later as a plausible-looking
 * wrong number.
 */
export function checkStructureReferences(s: CollaredStructure): Problem[] {
  const problems: Problem[] = [];
  const keys = Object.keys(s.underlyings);

  if (!(s.reference_id in s.underlyings)) {
    problems.push({
      path: '/reference_id',
      message: `reference_id "${s.reference_id}" is not a key of underlyings (have: ${keys.join(', ')})`,
    });
  }

  const seen = new Set<string>();
  s.option_legs.forEach((leg, i) => {
    if (!(leg.underlying_id in s.underlyings)) {
      problems.push({
        path: `/option_legs/${i}/underlying_id`,
        message: `leg "${leg.leg_id}" names underlying "${leg.underlying_id}", which is not a key of underlyings (have: ${keys.join(', ')})`,
      });
    }
    if (seen.has(leg.leg_id)) {
      problems.push({
        path: `/option_legs/${i}/leg_id`,
        message: `leg_id "${leg.leg_id}" appears more than once`,
      });
    }
    seen.add(leg.leg_id);

    if (Number.isNaN(Date.parse(leg.expiry))) {
      problems.push({
        path: `/option_legs/${i}/expiry`,
        message: `leg "${leg.leg_id}" has an unparseable expiry "${leg.expiry}"`,
      });
    }
  });

  if (Number.isNaN(Date.parse(s.as_of))) {
    problems.push({ path: '/as_of', message: `as_of "${s.as_of}" is not a parseable date` });
  }

  return problems;
}

/** Validate a structure document and its cross-references together. */
export function validateStructure(doc: unknown): ValidationResult<CollaredStructure> {
  const base = validateDocument<CollaredStructure>('collared_structure', doc);
  if (!base.ok) return base;
  const refs = checkStructureReferences(base.document);
  if (refs.length > 0) return { ok: false, document: null, problems: refs };
  return base;
}

export function validateScenario(doc: unknown): ValidationResult<Scenario> {
  return validateDocument<Scenario>('scenario', doc);
}

export function validateReferenceComposition(doc: unknown): ValidationResult<ReferenceComposition> {
  return validateDocument<ReferenceComposition>('reference_composition', doc);
}
