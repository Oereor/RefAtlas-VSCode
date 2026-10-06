import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { setImmediate as yieldToHost } from 'node:timers/promises';
import { createScanner, ScanError, SyntaxKind } from 'jsonc-parser';

export interface Cancellation {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}
export const neverCancelled: Cancellation = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
};
export interface Entry {
  readonly value: string;
  readonly line: number;
  readonly startCharacter: number;
  readonly endCharacter: number;
}
export type LookupResult =
  | { readonly kind: 'resolved'; readonly entry: Entry }
  | { readonly kind: 'missing-key' | 'target-missing' | 'cancelled' | 'changed' }
  | { readonly kind: 'unsupported-layout' | 'failure'; readonly message: string };

export interface TargetSource {
  readonly id: string;
  revision(): Promise<string>;
  lines(token: Cancellation): AsyncIterable<string>;
}
export class TargetChanged extends Error {}

export function diskSource(path: string): TargetSource {
  return {
    id: path,
    async revision() {
      const info = await stat(path, { bigint: true });
      return `disk:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.ino}`;
    },
    async *lines(token) {
      if (token.isCancellationRequested) return;
      const input = createReadStream(path, { encoding: 'utf8', highWaterMark: 64 * 1024 });
      const reader = createInterface({ input, crlfDelay: Infinity });
      // readline does not forward underlying stream errors to its async iterator.
      let streamError: Error | undefined;
      input.on('error', error => { streamError = error; reader.close(); });
      const subscription = token.onCancellationRequested(() => { reader.close(); input.destroy(); });
      try {
        for await (const line of reader) {
          if (token.isCancellationRequested) return;
          yield line;
        }
        if (streamError) throw streamError;
      } finally {
        subscription.dispose();
        reader.close();
        input.destroy();
      }
    },
  };
}

/** Flat, one-member-per-line TextMap only; no custom general JSON parser. */
export async function lookupLines(
  lines: AsyncIterable<string>, hash: string, token: Cancellation,
): Promise<LookupResult> {
  let opened = false;
  let closed = false;
  let haveMember = false;
  let previousComma = false;
  let lineNumber = 0;
  for await (const rawLine of lines) {
    if (token.isCancellationRequested) return { kind: 'cancelled' };
    if (lineNumber > 0 && lineNumber % 256 === 0) {
      await yieldToHost();
      if (token.isCancellationRequested) return { kind: 'cancelled' };
    }
    const line = lineNumber === 0 && rawLine.startsWith('\uFEFF') ? rawLine.slice(1) : rawLine;
    const bomOffset = rawLine.length - line.length;
    const scanner = createScanner(line, true);
    const next = () => scanner.scan();
    const first = next();
    if (first === SyntaxKind.EOF) { lineNumber++; continue; }
    const unsupported = (): LookupResult => ({ kind: 'unsupported-layout', message: `Expected a flat TextMap with one member per line (line ${lineNumber + 1}).` });
    if (!opened) {
      if (first !== SyntaxKind.OpenBraceToken || next() !== SyntaxKind.EOF) return unsupported();
      opened = true;
    } else if (closed) {
      return unsupported();
    } else if (first === SyntaxKind.CloseBraceToken) {
      if ((haveMember && previousComma) || next() !== SyntaxKind.EOF) return unsupported();
      closed = true;
    } else {
      if ((haveMember && !previousComma) || first !== SyntaxKind.StringLiteral || scanner.getTokenError() !== ScanError.None) return unsupported();
      const key = scanner.getTokenValue();
      const startCharacter = scanner.getTokenOffset() + bomOffset;
      if (next() !== SyntaxKind.ColonToken || next() !== SyntaxKind.StringLiteral || scanner.getTokenError() !== ScanError.None) return unsupported();
      const value = scanner.getTokenValue();
      const endCharacter = scanner.getTokenOffset() + scanner.getTokenLength() + bomOffset;
      const tail = next();
      previousComma = tail === SyntaxKind.CommaToken;
      if (tail !== SyntaxKind.EOF && (!previousComma || next() !== SyntaxKind.EOF)) return unsupported();
      haveMember = true;
      // This validates the visited prefix and matching line, not the unseen suffix or global uniqueness.
      if (key === hash) return { kind: 'resolved', entry: { value, line: lineNumber, startCharacter, endCharacter } };
    }
    lineNumber++;
  }
  if (token.isCancellationRequested) return { kind: 'cancelled' };
  if (!opened || !closed) return { kind: 'unsupported-layout', message: 'Incomplete or unsupported TextMap layout.' };
  return { kind: 'missing-key' };
}

/** Only resolved entries are cached, bounded across all target URIs/revisions. */
export class TextMapResolver {
  private readonly cache = new Map<string, Entry>();

  async resolve(source: TargetSource, hash: string, token: Cancellation): Promise<LookupResult> {
    if (token.isCancellationRequested) return { kind: 'cancelled' };
    try {
      const revision = await source.revision();
      if (token.isCancellationRequested) return { kind: 'cancelled' };
      const cacheKey = JSON.stringify([source.id, revision, hash]);
      const cached = this.cache.get(cacheKey);
      if (cached) return { kind: 'resolved', entry: cached };
      const result = await lookupLines(source.lines(token), hash, token);
      if (token.isCancellationRequested) return { kind: 'cancelled' };
      const finalRevision = await source.revision();
      if (token.isCancellationRequested) return { kind: 'cancelled' };
      if (finalRevision !== revision) return { kind: 'changed' };
      if (result.kind === 'resolved') {
        this.cache.set(cacheKey, result.entry);
        if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
      }
      return result;
    } catch (error) {
      if (token.isCancellationRequested) return { kind: 'cancelled' };
      if (error instanceof TargetChanged) return { kind: 'changed' };
      if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return { kind: 'target-missing' };
      return { kind: 'failure', message: error instanceof Error ? error.message : String(error) };
    }
  }
}
