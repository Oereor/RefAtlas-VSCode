// Explicit, read-only measurement command, never background work or an index.
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { TARGET_PATH } from './context';
import { diskSource, TextMapResolver, neverCancelled, type Cancellation } from './textmap';
import { MISSING_HASH, REAL_HASH_CASES, readSourceLine, recognitionObservation, sourceStatistics } from './validation';

async function observe<T>(operation: () => Promise<T>) {
  let last = performance.now();
  let maxTickGapMs = 0;
  const memory = process.memoryUsage().rss;
  const timer = setInterval(() => { const now = performance.now(); maxTickGapMs = Math.max(maxTickGapMs, now - last); last = now; }, 5);
  const start = performance.now();
  try {
    const result = await operation();
    return { result, elapsedMs: performance.now() - start, maxTickGapMs, rssDeltaMiB: (process.memoryUsage().rss - memory) / 1048576 };
  } finally { clearInterval(timer); }
}

async function main() {
  const root = resolve(process.argv[2] ?? '../TurnBasedGameData');
  const target = diskSource(join(root, TARGET_PATH));
  const positions = [
    { label: 'early', hash: '6186714091647966180', line: 11232 },
    { label: 'middle', hash: '69414335628115881', line: 237096 },
    { label: 'late', hash: '11241862035883228103', line: 472999 },
    { label: 'missing', hash: MISSING_HASH, line: undefined },
  ];
  const targetObservations = [];
  for (const sample of positions) {
    const resolver = new TextMapResolver();
    const first = await observe(() => resolver.resolve(target, sample.hash, neverCancelled));
    const repeated = await observe(() => resolver.resolve(target, sample.hash, neverCancelled));
    assert.deepEqual(repeated.result, first.result);
    if (sample.line === undefined) assert.equal(first.result.kind, 'missing-key');
    else {
      assert.equal(first.result.kind, 'resolved');
      if (first.result.kind === 'resolved') assert.equal(first.result.entry.line, sample.line);
    }
    targetObservations.push({ ...sample, first, repeated, repeatedWasCached: first.result.kind === 'resolved' });
  }
  let cancelled = false;
  let requestedAt: number | undefined;
  const listeners = new Set<() => void>();
  const token: Cancellation = {
    get isCancellationRequested() { return cancelled; },
    onCancellationRequested(listener) { listeners.add(listener); return { dispose() { listeners.delete(listener); } }; },
  };
  const cancelTimer = setTimeout(() => { cancelled = true; requestedAt = performance.now(); for (const listener of listeners) listener(); }, 20);
  let cancellation;
  try {
    const result = await observe(() => new TextMapResolver().resolve(target, MISSING_HASH, token));
    assert.equal(result.result.kind, 'cancelled');
    assert.equal(listeners.size, 0);
    cancellation = { ...result, requestToEndMs: performance.now() - requestedAt!, remainingListeners: listeners.size };
  } finally { clearTimeout(cancelTimer); }
  const sources = [];
  for (const path of ['ExcelOutput/AvatarSkillConfig.json', 'ExcelOutput/StageConfig.json']) {
    const sample = REAL_HASH_CASES.find(item => item.path === path)!;
    const localLine = await readSourceLine(join(root, path), sample.sourceLine);
    // Recognition is measured before counting lines. No source JSON DOM is built even for statistics.
    const local = recognitionObservation(localLine, sample.hash);
    sources.push({ ...await sourceStatistics(root, path), sampleSourceLine: sample.sourceLine + 1, ...local });
  }
  console.log(JSON.stringify({ root, targetObservations, cancellation, sources }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
