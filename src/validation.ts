// Read-only validation helpers. Not imported by the extension runtime.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { stat } from 'node:fs/promises';
import { createScanner, SyntaxKind } from 'jsonc-parser';
import { identifyHashReference } from './context';
import { diskSource, neverCancelled, type Entry } from './textmap';

export const REAL_HASH_CASES = [
  { field: 'AvatarName.Hash', path: 'ExcelOutput/AvatarConfig.json', sourceLine: 4, hash: '6186714091647966180', value: '三月七', targetLine: 11232 },
  { field: 'SkillName.Hash', path: 'ExcelOutput/AvatarSkillConfig.json', sourceLine: 4, hash: '7167396225780900216', value: '攻击', targetLine: 15421 },
  { field: 'SkillDesc.Hash', path: 'ExcelOutput/AvatarSkillConfig.json', sourceLine: 19, hash: '6612596470888090439', value: '攻击敌人，进入战斗后削弱敌方目标对应属性韧性。', targetLine: 14291 },
  { field: 'StageName.Hash', path: 'ExcelOutput/StageConfig.json', sourceLine: 5, hash: '3319612321481484338', value: '炽燃徘徊者', targetLine: 113322 },
] as const;
export const MISSING_HASH = '999999999999999999999999999999999999999';

export async function readSourceLine(path: string, wantedLine: number): Promise<string> {
  let line = 0;
  for await (const text of diskSource(path).lines(neverCancelled)) {
    if (line++ === wantedLine) return text;
  }
  throw new Error(`Missing line ${wantedLine + 1}: ${path}`);
}

export async function verifyTargetLocation(path: string, hash: string, entry: Entry): Promise<void> {
  const line = await readSourceLine(path, entry.line);
  const member = line.slice(entry.startCharacter, entry.endCharacter);
  const scanner = createScanner(member, true);
  assert.equal(scanner.scan(), SyntaxKind.StringLiteral);
  assert.equal(scanner.getTokenValue(), hash);
  assert.equal(scanner.scan(), SyntaxKind.ColonToken);
  assert.equal(scanner.scan(), SyntaxKind.StringLiteral);
  assert.equal(scanner.getTokenValue(), entry.value);
  assert.equal(scanner.scan(), SyntaxKind.EOF);
}

export function recognitionObservation(line: string, hash: string) {
  const character = line.indexOf(hash);
  const samples: number[] = [];
  let reference = identifyHashReference(line, character);
  assert.equal(reference?.hash, hash);
  for (let i = 0; i < 1000; i++) {
    const start = performance.now();
    reference = identifyHashReference(line, character);
    samples.push(performance.now() - start);
  }
  assert.ok(reference);
  samples.sort((a, b) => a - b);
  return {
    ...reference,
    scannedLineCharacters: line.length,
    recognitionMedianMs: samples[500]!,
    recognitionP95Ms: samples[950]!,
  };
}

export async function sourceStatistics(root: string, relativePath: string) {
  const path = join(root, relativePath);
  let lines = 0;
  for await (const _line of diskSource(path).lines(neverCancelled)) lines++;
  return { path: relativePath, bytes: (await stat(path)).size, lines };
}
