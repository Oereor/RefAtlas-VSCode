import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identifyAvatarNameHash, SOURCE_PATH } from '../context';

const hash = '6186714091647966180';
test('preserves the unsafe numeric lexeme and its exclusive token range', () => {
  const text = `[{"AvatarName":{"Hash":${hash}}}]`;
  const start = text.indexOf(hash);
  for (let offset = start; offset < start + hash.length; offset++) {
    assert.deepEqual(identifyAvatarNameHash(text, offset, SOURCE_PATH), { hash, offset: start, length: hash.length });
  }
  assert.equal(identifyAvatarNameHash(text, start - 1, SOURCE_PATH), undefined);
  assert.equal(identifyAvatarNameHash(text, start + hash.length, SOURCE_PATH), undefined);
});

test('recognizes direct AvatarName.Hash in later records, including escaped property names', () => {
  const text = `[{}, {"Avatar\\u004eame":{"H\\u0061sh":${hash}}}]`;
  assert.equal(identifyAvatarNameHash(text, text.indexOf(hash), SOURCE_PATH)?.hash, hash);
});

test('rejects unrelated fields, string values, nested records and non-array roots', () => {
  for (const text of [
    `[{"AvatarID":${hash}}]`,
    `[{"AvatarFullName":{"Hash":${hash}}}]`,
    `[{"AvatarName":{"Hash":"${hash}"}}]`,
    `[{"Other":{"AvatarName":{"Hash":${hash}}}}]`,
    `[{"AvatarName":{"Nested":{"Hash":${hash}}}}]`,
    `{"AvatarName":{"Hash":${hash}}}`,
    `[[{"AvatarName":{"Hash":${hash}}}]]`,
    `[{"AvatarName":[{"Hash":${hash}}]}]`,
  ]) assert.equal(identifyAvatarNameHash(text, text.indexOf(hash), SOURCE_PATH), undefined, text);
});

test('rejects any other relative source path and invalid standard JSON', () => {
  const valid = `[{"AvatarName":{"Hash":${hash}}}]`;
  for (const path of ['AvatarConfig.json', 'Other/AvatarConfig.json', 'ExcelOutput/Other.json', `dataset/${SOURCE_PATH}`]) {
    assert.equal(identifyAvatarNameHash(valid, valid.indexOf(hash), path), undefined);
  }
  for (const text of [valid.slice(0, -1), valid.replace('}]', '},]'), valid.replace('[', '[/* comment */')]) {
    assert.equal(identifyAvatarNameHash(text, text.indexOf(hash), SOURCE_PATH), undefined);
  }
});
