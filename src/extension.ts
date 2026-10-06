import * as vscode from 'vscode';
import { relative } from 'node:path';
import { identifyAvatarNameHash, SOURCE_PATH, TARGET_PATH } from './context';
import { diskSource, TargetChanged, TextMapResolver, type LookupResult, type TargetSource } from './textmap';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('RefAtlas');
  const resolver = new TextMapResolver();
  const documentIds = new WeakMap<vscode.TextDocument, number>();
  let nextDocumentId = 0;
  context.subscriptions.push(output);

  async function resolve(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
    if (token.isCancellationRequested || document.uri.scheme !== 'file') return;
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder || relative(folder.uri.fsPath, document.uri.fsPath).split('\\').join('/') !== SOURCE_PATH) return;
    const reference = identifyAvatarNameHash(document.getText(), document.offsetAt(position), SOURCE_PATH);
    if (!reference) return;
    const sourceVersion = document.version;
    const uri = vscode.Uri.joinPath(folder.uri, TARGET_PATH);
    const openDocument = () => vscode.workspace.textDocuments.find(item => item.uri.toString() === uri.toString() && !item.isClosed);
    const targetDocument = openDocument();
    let source: TargetSource;
    if (targetDocument) {
      if (!documentIds.has(targetDocument)) documentIds.set(targetDocument, ++nextDocumentId);
      const documentId = documentIds.get(targetDocument)!;
      source = {
        id: uri.toString(),
        async revision() {
          if (targetDocument.isClosed) throw new TargetChanged('TextMap document was closed during lookup.');
          return `document:${documentId}:${targetDocument.version}`;
        },
        async *lines(cancellation) {
          for (let line = 0; line < targetDocument.lineCount; line++) {
            if (cancellation.isCancellationRequested) return;
            yield targetDocument.lineAt(line).text;
          }
        },
      };
    } else {
      const disk = diskSource(uri.fsPath);
      source = { ...disk, id: uri.toString(), async revision() {
        // Discard disk results if the editor opened this target while we were reading it.
        if (openDocument()) throw new TargetChanged('TextMap document opened during disk lookup.');
        return disk.revision();
      } };
    }
    const result = await resolver.resolve(source, reference.hash, token);
    if (token.isCancellationRequested || document.version !== sourceVersion) return;
    if (result.kind === 'failure' || result.kind === 'unsupported-layout') output.appendLine(`${TARGET_PATH}: ${result.message}`);
    return { reference, uri, result, range: new vscode.Range(document.positionAt(reference.offset), document.positionAt(reference.offset + reference.length)) };
  }

  const selector: vscode.DocumentSelector = { language: 'json', scheme: 'file', pattern: '**/ExcelOutput/AvatarConfig.json' };
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, {
      async provideHover(document, position, token) {
        const resolved = await resolve(document, position, token);
        if (!resolved) return;
        const { result, reference, range } = resolved;
        const markdown = new vscode.MarkdownString();
        if (result.kind === 'resolved') {
          markdown.appendText(result.entry.value);
          markdown.appendMarkdown('\n\n');
          markdown.appendText(`TextMapCHS\n${reference.hash}`);
        } else {
          const message = missingMessage(result);
          if (!message) return;
          markdown.appendText(message);
        }
        return new vscode.Hover(markdown, range);
      },
    }),
    vscode.languages.registerDefinitionProvider(selector, {
      async provideDefinition(document, position, token) {
        const resolved = await resolve(document, position, token);
        if (!resolved || resolved.result.kind !== 'resolved') return;
        const entry = resolved.result.entry;
        return new vscode.Location(resolved.uri, new vscode.Range(entry.line, entry.startCharacter, entry.line, entry.endCharacter));
      },
    }),
  );
}

function missingMessage(result: LookupResult): string | undefined {
  if (result.kind === 'target-missing') return 'TextMapCHS.json is missing in this workspace folder.';
  if (result.kind === 'missing-key') return 'No matching key in TextMapCHS.';
  return undefined;
}
