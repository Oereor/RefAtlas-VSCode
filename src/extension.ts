import * as vscode from 'vscode';
import { identifyDocumentHashReference, TARGET_PATH } from './context';
import { diskSource, TargetChanged, TextMapResolver, type TargetSource } from './textmap';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('RefAtlas');
  const resolver = new TextMapResolver();
  const documentIds = new WeakMap<vscode.TextDocument, number>();
  let nextDocumentId = 0;
  context.subscriptions.push(output);

  async function resolve(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
    if (token.isCancellationRequested || document.uri.scheme !== 'file' || !document.uri.path.endsWith('.json')) return;
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) return;
    const reference = identifyDocumentHashReference(document, position);
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
    return { reference, uri, result, range: new vscode.Range(position.line, reference.startCharacter, position.line, reference.startCharacter + reference.length) };
  }

  const selector: vscode.DocumentSelector = { scheme: 'file', pattern: '**/*.json' };
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, {
      async provideHover(document, position, token) {
        const resolved = await resolve(document, position, token);
        if (!resolved || resolved.result.kind !== 'resolved') return;
        const { result, reference, range } = resolved;
        const markdown = new vscode.MarkdownString();
        markdown.appendText(result.entry.value);
        markdown.appendMarkdown('\n\n');
        markdown.appendText(`TextMapCHS\n${reference.hash}`);
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
