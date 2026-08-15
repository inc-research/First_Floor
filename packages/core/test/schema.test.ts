// SPDX-License-Identifier: MIT

/**
 * Phase 0 gate: both example structures and both scenarios round-trip without
 * loss, and invalid documents are rejected with a useful message.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  SUPPORTED_SCHEMA_VERSION,
  checkSchemaVersion,
  validateReferenceComposition,
  validateScenario,
  validateStructure,
} from '../src/schema/validate.ts';
import { render } from '../../../scripts/generate-schema-module.mjs';

const ROOT = new URL('../../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(fileURLToPath(new URL(p, ROOT)), 'utf8'));

const EXAMPLE_A = 'examples/example_a_laddered_floor.json';
const EXAMPLE_C = 'examples/example_c_minimal_hand_typed.json';

describe('generated schema module', () => {
  it('is in step with schemas/*.json', () => {
    const onDisk = readFileSync(
      fileURLToPath(new URL('packages/core/src/schema/schemas.generated.ts', ROOT)),
      'utf8',
    );
    assert.equal(
      onDisk,
      render(),
      'schemas.generated.ts is stale; run `node scripts/generate-schema-module.mjs`',
    );
  });
});

describe('example documents', () => {
  it('accepts both structures', () => {
    for (const p of [EXAMPLE_A, EXAMPLE_C]) {
      const r = validateStructure(read(p));
      assert.ok(r.ok, `${p} rejected: ${JSON.stringify(r.problems, null, 2)}`);
    }
  });

  it('accepts both scenarios', () => {
    for (const p of ['examples/example_scenario.json', 'examples/scenario_minimal.json']) {
      const r = validateScenario(read(p));
      assert.ok(r.ok, `${p} rejected: ${JSON.stringify(r.problems, null, 2)}`);
    }
  });

  it('accepts both reference compositions', () => {
    for (const p of [
      'examples/reference_composition_synthetic.json',
      'examples/reference_composition_stale.json',
    ]) {
      const r = validateReferenceComposition(read(p));
      assert.ok(r.ok, `${p} rejected: ${JSON.stringify(r.problems, null, 2)}`);
    }
  });

  it('round-trips through JSON without loss', () => {
    for (const p of [EXAMPLE_A, EXAMPLE_C]) {
      const original = read(p);
      const r = validateStructure(original);
      assert.ok(r.ok);
      assert.deepEqual(JSON.parse(JSON.stringify(r.document)), original);
    }
  });
});

describe('schema_version gate', () => {
  it('accepts only its own contract below 1.0', () => {
    assert.equal(checkSchemaVersion(SUPPORTED_SCHEMA_VERSION), null);
    assert.equal(checkSchemaVersion('0.2.7'), null, 'patch bumps are compatible');
    for (const bad of ['0.1.0', '0.3.0', '1.0.0', '2.0.0']) {
      assert.notEqual(checkSchemaVersion(bad), null, `${bad} should be refused`);
    }
  });

  it('refuses malformed and missing versions rather than guessing', () => {
    for (const bad of [undefined, null, 42, '', 'v0.2.0', '0.2']) {
      const p = checkSchemaVersion(bad);
      assert.notEqual(p, null, `${String(bad)} should be refused`);
      assert.match(p!.message, /schema_version/);
    }
  });

  it('short-circuits, so a foreign document yields one message about the contract', () => {
    const doc = { ...read(EXAMPLE_A), schema_version: '9.0.0' };
    const r = validateStructure(doc);
    assert.equal(r.ok, false);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0]!.message, /major/);
  });
});

describe('invalid documents are rejected by field', () => {
  const mutate = (fn: (d: Record<string, unknown>) => void) => {
    const d = read(EXAMPLE_A) as Record<string, unknown>;
    fn(d);
    return validateStructure(d);
  };

  it('rejects a negative contract count, because direction lives in position', () => {
    const r = mutate((d) => {
      (d['option_legs'] as { contracts: number }[])[0]!.contracts = -6835;
    });
    assert.equal(r.ok, false);
    assert.match(r.problems.map((p) => p.path).join(' '), /option_legs\/0\/contracts/);
  });

  it('rejects a leg naming an underlying that does not exist', () => {
    const r = mutate((d) => {
      (d['option_legs'] as { underlying_id: string }[])[2]!.underlying_id = 'TYPO';
    });
    assert.equal(r.ok, false);
    assert.match(r.problems[0]!.message, /TYPO.*not a key of underlyings/);
  });

  it('rejects a reference_id that does not exist', () => {
    const r = mutate((d) => {
      d['reference_id'] = 'NOPE';
    });
    assert.equal(r.ok, false);
    assert.match(r.problems[0]!.message, /NOPE.*not a key of underlyings/);
  });

  it('rejects duplicate leg ids', () => {
    const r = mutate((d) => {
      const legs = d['option_legs'] as { leg_id: string }[];
      legs[1]!.leg_id = legs[0]!.leg_id;
    });
    assert.equal(r.ok, false);
    assert.match(r.problems[0]!.message, /appears more than once/);
  });

  it('rejects a forward-looking field on a structure document', () => {
    // Invariant 4: structures describe today. A scenario field here is a
    // category error, not a harmless extra.
    const r = mutate((d) => {
      d['vol_beta'] = 0.65;
    });
    assert.equal(r.ok, false);
    assert.match(r.problems.map((p) => p.message).join(' '), /vol_beta/);
  });

  it('rejects a held_asset_response missing its source', () => {
    // Invariant 2: the response is an explicit object. A beta without a stated
    // source is the hidden default the tool exists to expose.
    const r = mutate((d) => {
      (d['held_asset'] as Record<string, unknown>)['response'] = { beta_down: 1.1, beta_up: 1.0 };
    });
    assert.equal(r.ok, false);
    assert.match(r.problems.map((p) => p.message).join(' '), /source/);
  });

  it('rejects a missing net_assets', () => {
    const r = mutate((d) => {
      delete (d['capital'] as Record<string, unknown>)['net_assets'];
    });
    assert.equal(r.ok, false);
    assert.match(r.problems.map((p) => p.message).join(' '), /net_assets/);
  });

  it('names the offending field in every message', () => {
    const r = mutate((d) => {
      (d['option_legs'] as { strike: number }[])[0]!.strike = 0;
    });
    assert.equal(r.ok, false);
    assert.ok(r.problems.every((p) => p.message.length > 0));
    assert.match(r.problems.map((p) => p.path).join(' '), /strike/);
  });

  it('requires a source_note on a reference composition', () => {
    const d = read('examples/reference_composition_synthetic.json') as Record<string, unknown>;
    delete d['source_note'];
    const r = validateReferenceComposition(d);
    assert.equal(r.ok, false);
    assert.match(r.problems.map((p) => p.message).join(' '), /source_note/);
  });
});
