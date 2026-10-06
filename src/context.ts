import { createScanner, ScanError, SyntaxKind } from 'jsonc-parser';

export const TARGET_PATH = 'TextMap/TextMapCHS.json';

export interface HashReference {
  readonly hash: string;
  readonly startCharacter: number;
  readonly length: number;
}

/** Current-line lexical recognition only; never builds a source DOM or numeric value. */
export function identifyHashReference(lineText: string, character: number): HashReference | undefined {
  if (!Number.isInteger(character) || character < 0 || character >= lineText.length) return;
  const scanner = createScanner(lineText, false);
  const previous: { kind: SyntaxKind; value?: string }[] = [];
  function next(): SyntaxKind {
    let kind: SyntaxKind;
    do { kind = scanner.scan(); } while (kind === SyntaxKind.Trivia);
    return kind;
  }
  for (let kind = next(); kind !== SyntaxKind.EOF; kind = next()) {
    // Standard JSON scope. Starting inside a cross-line comment is deliberately not inferred.
    if (scanner.getTokenError() !== ScanError.None || kind === SyntaxKind.Unknown
      || kind === SyntaxKind.LineBreakTrivia || kind === SyntaxKind.LineCommentTrivia
      || kind === SyntaxKind.BlockCommentTrivia) return;
    const start = scanner.getTokenOffset();
    const length = scanner.getTokenLength();
    if (kind === SyntaxKind.NumericLiteral && character >= start && character < start + length) {
      const colon = previous.at(-1);
      const key = previous.at(-2);
      const beforeKey = previous.at(-3)?.kind;
      if (colon?.kind !== SyntaxKind.ColonToken || key?.kind !== SyntaxKind.StringLiteral || key.value !== 'Hash'
        || (beforeKey !== undefined && beforeKey !== SyntaxKind.OpenBraceToken && beforeKey !== SyntaxKind.CommaToken)) return;
      const tail = next();
      if (scanner.getTokenError() !== ScanError.None || (tail !== SyntaxKind.EOF && tail !== SyntaxKind.CommaToken
        && tail !== SyntaxKind.CloseBraceToken && tail !== SyntaxKind.CloseBracketToken)) return;
      // Numeric scanner values are never read. In particular, unsafe integers remain exact.
      return { hash: lineText.slice(start, start + length), startCharacter: start, length };
    }
    previous.push({ kind, ...(kind === SyntaxKind.StringLiteral ? { value: scanner.getTokenValue() } : {}) });
    if (previous.length > 3) previous.shift();
    if (start > character) return;
  }
  return;
}

/** The provider's source adapter exposes only one line read, also usable in work-count tests. */
export function identifyDocumentHashReference(
  document: { lineAt(line: number): { readonly text: string } },
  position: { readonly line: number; readonly character: number },
): HashReference | undefined {
  return identifyHashReference(document.lineAt(position.line).text, position.character);
}
