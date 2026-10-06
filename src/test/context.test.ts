import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identifyDocumentHashReference, identifyHashReference } from '../context';

const hash = '6186714091647966180';
test('preserves the unsafe numeric lexeme and its exclusive token range', () => {
  const text = `      "Hash": ${hash}`;
  const start = text.indexOf(hash);
  for (let offset = start; offset < start + hash.length; offset++) {
    assert.deepEqual(identifyHashReference(text, offset), { hash, startCharacter: start, length: hash.length });
  }
  assert.equal(identifyHashReference(text, start - 1), undefined);
  assert.equal(identifyHashReference(text, start + hash.length), undefined);
});

test('recognizes any parent and root schema, escaped exact keys and later inline properties', () => {
  for (const text of [
    `{"SkillName":{"Hash":${hash}}}`, `[{}, {"SkillDesc":{"Hash":${hash}}}]`,
    `[{"Nested":{"Anything":{"Hash":${hash}}}}]`, `{"H\\u0061sh":${hash}}`,
    `{"Other": 1, "Hash": ${hash}}`, `{"Hash":1,"Hash":${hash}}`,
  ]) assert.equal(identifyHashReference(text, text.indexOf(hash))?.hash, hash, text);
});

test('rejects similar/unrelated keys, non-numeric values and misleading strings', () => {
  for (const text of [
    `"AvatarID": ${hash}`, `"HashValue": ${hash}`, `"SomeHash": ${hash}`, `"hash": ${hash}`,
    `"Hash": "${hash}"`, `"Hash": [${hash}]`, `"Other": ${hash}`,
    `"Other": "Hash": ${hash}`, `["Hash": ${hash}]`,
    `"Other": "\\\"Hash\\\": ${hash}"`,
  ]) assert.equal(identifyHashReference(text, text.indexOf(hash)), undefined, text);
});

test('does not recognize text inside current-line comments or scanner errors', () => {
  for (const text of [
    `// "Hash": ${hash}`, `/* "Hash": ${hash} */`, `/* "Hash": ${hash}`,
    `/* comment */ "Hash": ${hash}`, `"Bad\\q":1,"Hash":${hash}`,
  ]) assert.equal(identifyHashReference(text, text.indexOf(hash)), undefined, text);
});

test('valid JSON number lexemes remain unchanged, including negative/decimal/exponent forms', () => {
  for (const raw of ['0', '-0', '-123', '1.2300', '1e+20', '1E-02', '1e9999', hash]) {
    const text = `{"Hash":${raw}}`;
    const start = text.indexOf(':') + 1;
    for (let cursor = start; cursor < start + raw.length; cursor++) {
      assert.equal(identifyHashReference(text, cursor)?.hash, raw, `${raw} at ${cursor}`);
    }
  }
});

test('rejects malformed numeric boundaries and cursors on key/colon/whitespace/delimiter', () => {
  for (const raw of ['01', '-01', '1e', '1e+', '1.', '+1', '123abc', 'NaN', 'Infinity', '--1']) {
    const text = `{"Hash":${raw}}`;
    const start = text.indexOf(':') + 1;
    for (let cursor = start; cursor < start + raw.length; cursor++) {
      assert.equal(identifyHashReference(text, cursor), undefined, `${raw} at ${cursor}`);
    }
  }
  const text = `{"Hash": ${hash}, "Other":123}`;
  const start = text.indexOf(hash);
  for (const cursor of [-1, 0, 2, text.indexOf(':'), start - 1, start + hash.length, text.length, 2.5]) {
    assert.equal(identifyHashReference(text, cursor), undefined, String(cursor));
  }
});

test('small and million-line documents perform exactly one identical source-line read', () => {
  const lineText = `      "Hash": ${hash}`;
  function recognizeAt(line: number, lineCount: number) {
    const accesses: number[] = [];
    const document = {
      lineCount,
      getText(): never { assert.fail('full document access is forbidden'); },
      lineAt(index: number) { accesses.push(index); assert.equal(index, line); return { text: lineText }; },
    };
    const result = identifyDocumentHashReference(document, { line, character: lineText.indexOf(hash) });
    assert.deepEqual(accesses, [line]);
    return result;
  }
  assert.deepEqual(recognizeAt(1, 3), recognizeAt(600000, 1200000));
  assert.deepEqual(recognizeAt(600000, 1200000), identifyHashReference(lineText, lineText.indexOf(hash)));
});
