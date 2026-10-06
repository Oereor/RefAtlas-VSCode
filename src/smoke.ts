import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { identifyAvatarNameHash, SOURCE_PATH, TARGET_PATH } from './context';
import { diskSource, TextMapResolver, neverCancelled } from './textmap';

async function main() {
  const root = resolve(process.argv[2] ?? '../TurnBasedGameData');
  const text = await readFile(join(root, SOURCE_PATH), 'utf8');
  const hash = '6186714091647966180';
  const reference = identifyAvatarNameHash(text, text.indexOf(hash), SOURCE_PATH);
  assert.equal(reference?.hash, hash);
  const resolver = new TextMapResolver();
  const source = diskSource(join(root, TARGET_PATH));
  const memory = process.memoryUsage().rss;
  let lastTick = performance.now();
  let maxTickGap = 0;
  const timer = setInterval(() => { const now = performance.now(); maxTickGap = Math.max(maxTickGap, now - lastTick); lastTick = now; }, 5);
  try {
    const start = performance.now();
    const first = await resolver.resolve(source, hash, neverCancelled);
    const firstMs = performance.now() - start;
    assert.equal(first.kind, 'resolved');
    if (first.kind !== 'resolved') return;
    assert.equal(first.entry.value, '三月七');
    assert.equal(first.entry.line, 11232);
    const cachedStart = performance.now();
    assert.deepEqual(await resolver.resolve(source, hash, neverCancelled), first);
    const cachedMs = performance.now() - cachedStart;
    // Full text is not read to verify the location: resolve via a second bounded line stream.
    let line = 0;
    for await (const targetLine of source.lines(neverCancelled)) {
      if (line++ !== first.entry.line) continue;
      assert.equal(targetLine.slice(first.entry.startCharacter, first.entry.endCharacter), `"${hash}": "三月七"`);
      break;
    }
    console.log(JSON.stringify({ root, hash: reference?.hash, ...first.entry, firstMs, cachedMs, rssDeltaMiB: (process.memoryUsage().rss - memory) / 1048576, maxTickGapMs: maxTickGap }, null, 2));
  } finally { clearInterval(timer); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
