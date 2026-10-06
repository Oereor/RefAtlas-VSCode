import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { TARGET_PATH } from './context';
import { diskSource, TextMapResolver, neverCancelled } from './textmap';
import { REAL_HASH_CASES, MISSING_HASH, readSourceLine, recognitionObservation, verifyTargetLocation } from './validation';

async function main() {
  const root = resolve(process.argv[2] ?? '../TurnBasedGameData');
  const resolver = new TextMapResolver();
  const source = diskSource(join(root, TARGET_PATH));
  const observations = [];
  for (const sample of REAL_HASH_CASES) {
    const line = await readSourceLine(join(root, sample.path), sample.sourceLine);
    const reference = recognitionObservation(line, sample.hash);
    const start = performance.now();
    const first = await resolver.resolve(source, reference.hash, neverCancelled);
    const firstMs = performance.now() - start;
    assert.equal(first.kind, 'resolved');
    if (first.kind !== 'resolved') throw new Error('Expected a resolved real-data sample.');
    assert.equal(first.entry.value, sample.value);
    assert.equal(first.entry.line, sample.targetLine);
    const cachedStart = performance.now();
    assert.deepEqual(await resolver.resolve(source, reference.hash, neverCancelled), first);
    const cachedMs = performance.now() - cachedStart;
    await verifyTargetLocation(join(root, TARGET_PATH), reference.hash, first.entry);
    observations.push({ field: sample.field, path: sample.path, sourceLine: sample.sourceLine + 1, ...reference, target: first.entry, firstMs, cachedMs });
  }
  assert.equal((await resolver.resolve(source, MISSING_HASH, neverCancelled)).kind, 'missing-key');
  console.log(JSON.stringify({ root, cases: observations, missing: 'missing-key' }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
