import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diskSource, lookupLines, neverCancelled, TargetChanged, TextMapResolver, type Cancellation, type TargetSource } from '../textmap';

const hash = '6186714091647966180';
async function* lines(text: string) { yield* text.split(/\r?\n/); }
function cancellation() {
  let cancelled = false;
  const listeners = new Set<() => void>();
  const token: Cancellation = {
    get isCancellationRequested() { return cancelled; },
    onCancellationRequested(listener) { listeners.add(listener); return { dispose() { listeners.delete(listener); } }; },
  };
  return { token, cancel() { cancelled = true; for (const listener of listeners) listener(); }, listeners };
}

test('exact key, decoded Chinese/escapes, BOM and UTF-16 range with LF and CRLF', async () => {
  const member = `  "${hash}": "三月七\\n\\uFEFF😀\\\"",`;
  for (const newline of ['\n', '\r\n']) {
    const text = ['\uFEFF{', `  "${hash}0": "wrong",`, member, '  "other": "tail"', '}'].join(newline);
    const result = await lookupLines(lines(text), hash, neverCancelled);
    assert.equal(result.kind, 'resolved');
    if (result.kind === 'resolved') {
      assert.equal(result.entry.value, '三月七\n\uFEFF😀"');
      assert.equal(result.entry.line, 2);
      assert.equal(member.slice(result.entry.startCharacter, result.entry.endCharacter), member.trim().slice(0, -1));
    }
  }
});

test('decoded escaped keys match exactly; values containing the hash do not', async () => {
  const text = `{\n  "other": "${hash}",\n  "\\u0036186714091647966180": "三月七"\n}`;
  const result = await lookupLines(lines(text), hash, neverCancelled);
  assert.equal(result.kind, 'resolved');
  if (result.kind === 'resolved') assert.equal(result.entry.line, 2);
  assert.equal((await lookupLines(lines(`{\n  "${hash}0": "x"\n}`), hash, neverCancelled)).kind, 'missing-key');
});

test('unsupported layouts are distinguished from missing keys', async () => {
  for (const text of ['{}', `{\n "x": {"${hash}":"x"}\n}`, '{\n "x": "a",\n}', '{\n "x": "a"', '{\n "x": "a"\n "y": "b"\n}', '{\n "x": "bad\\q"\n}']) {
    assert.equal((await lookupLines(lines(text), hash, neverCancelled)).kind, 'unsupported-layout', text);
  }
  assert.equal((await lookupLines(lines('{\n}'), hash, neverCancelled)).kind, 'missing-key');
});

test('cancellation stops iteration and closes the generator', async () => {
  const control = cancellation();
  let closed = false;
  async function* input() {
    try { yield '{'; control.cancel(); yield `"${hash}": "x"`; assert.fail('must stop'); }
    finally { closed = true; }
  }
  assert.equal((await lookupLines(input(), hash, control.token)).kind, 'cancelled');
  assert.ok(closed);
  assert.equal((await lookupLines(lines(''), hash, control.token)).kind, 'cancelled');
});

test('cached entries are versioned, bounded, and no failures are cached', async () => {
  const resolver = new TextMapResolver();
  let revision = '1';
  let value = '三月七';
  let scans = 0;
  const source: TargetSource = {
    id: 'test', async revision() { return revision; },
    async *lines() { scans++; yield* [`{`, `"${hash}": ${JSON.stringify(value)}`, '}']; },
  };
  await resolver.resolve(source, hash, neverCancelled);
  await resolver.resolve(source, hash, neverCancelled);
  assert.equal(scans, 1);
  revision = '2'; value = '未保存内容';
  const changed = await resolver.resolve(source, hash, neverCancelled);
  assert.equal(changed.kind, 'resolved');
  if (changed.kind === 'resolved') assert.equal(changed.entry.value, value);
  assert.equal(scans, 2);
  await resolver.resolve(source, 'missing', neverCancelled);
  await resolver.resolve(source, 'missing', neverCancelled);
  assert.equal(scans, 4);
  for (let i = 0; i < 65; i++) { revision = String(i + 3); await resolver.resolve(source, hash, neverCancelled); }
  revision = '2';
  const before = scans;
  await resolver.resolve(source, hash, neverCancelled);
  assert.equal(scans, before + 1);
});

test('changed revisions and cancellations discard results', async () => {
  const resolver = new TextMapResolver();
  let revision = 0;
  const source: TargetSource = { id: 'changing', async revision() { return String(revision++); }, lines: () => lines(`{\n"${hash}":"x"\n}`) };
  assert.equal((await resolver.resolve(source, hash, neverCancelled)).kind, 'changed');
  const control = cancellation();
  control.cancel();
  assert.equal((await resolver.resolve(source, hash, control.token)).kind, 'cancelled');
  assert.equal((await resolver.resolve({ ...source, async revision() { throw new TargetChanged('opened during lookup'); } }, hash, neverCancelled)).kind, 'changed');
  const atFinalStat = cancellation();
  let stats = 0;
  let scans = 0;
  const cancelAtStat: TargetSource = {
    id: 'cancel-at-stat', async revision() { if (++stats === 2) atFinalStat.cancel(); return 'same'; },
    async *lines() { scans++; yield* ['{', `"${hash}":"x"`, '}']; },
  };
  assert.equal((await resolver.resolve(cancelAtStat, hash, atFinalStat.token)).kind, 'cancelled');
  await resolver.resolve(cancelAtStat, hash, neverCancelled);
  assert.equal(scans, 2, 'cancelled result was not cached');
});

test('disk UTF-8 decoding preserves chunk-boundary characters and FEFF; missing/errors are distinct', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'refatlas-test-'));
  const path = join(folder, 'TextMapCHS.json');
  try {
    // Place a multibyte character across the 64 KiB stream boundary.
    const prefix = `{\n "${hash}": "`;
    const padding = 'a'.repeat(65535 - Buffer.byteLength(prefix));
    await writeFile(path, `${prefix}${padding}三\uFEFF月七"\n}`, 'utf8');
    const resolver = new TextMapResolver();
    const result = await resolver.resolve(diskSource(path), hash, neverCancelled);
    assert.equal(result.kind, 'resolved');
    if (result.kind === 'resolved') assert.equal(result.entry.value, `${padding}三\uFEFF月七`);
    const control = cancellation(); control.cancel();
    assert.equal((await resolver.resolve(diskSource(path), hash, control.token)).kind, 'cancelled');
    assert.equal(control.listeners.size, 0);
    const active = cancellation();
    const duringRead: Cancellation = {
      get isCancellationRequested() { return active.token.isCancellationRequested; },
      onCancellationRequested(listener) {
        const subscription = active.token.onCancellationRequested(listener);
        setImmediate(() => active.cancel());
        return subscription;
      },
    };
    assert.equal((await new TextMapResolver().resolve(diskSource(path), hash, duringRead)).kind, 'cancelled');
    assert.equal(active.listeners.size, 0, 'active stream cancellation listener was disposed');
    assert.equal((await resolver.resolve(diskSource(join(folder, 'absent')), hash, neverCancelled)).kind, 'target-missing');
    assert.equal((await resolver.resolve({ id: 'error', async revision() { throw new Error('actual failure'); }, lines: () => lines('') }, hash, neverCancelled)).kind, 'failure');
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('long buffered scans yield to the event loop and can be cancelled', async () => {
  const control = cancellation();
  const immediate = setImmediate(() => control.cancel());
  const text = ['{', ...Array.from({ length: 10000 }, (_, i) => `"${i}": "x",`), '"last": "x"', '}'].join('\n');
  try { assert.equal((await lookupLines(lines(text), hash, control.token)).kind, 'cancelled'); }
  finally { clearImmediate(immediate); }
});
