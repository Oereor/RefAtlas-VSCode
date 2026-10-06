import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { TARGET_PATH } from '../context';
import { REAL_HASH_CASES, MISSING_HASH, recognitionObservation, verifyTargetLocation } from '../validation';

const hash = '6186714091647966180';
async function hovers(uri: vscode.Uri, position: vscode.Position) {
  return await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, position) ?? [];
}
function hoverText(result: vscode.Hover[]) {
  return result.flatMap(hover => hover.contents.map(content => typeof content === 'string' ? content : 'value' in content ? content.value : '')).join('\n');
}
async function definitions(uri: vscode.Uri, position: vscode.Position) {
  return await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', uri, position) ?? [];
}
function location(result: vscode.Location | vscode.LocationLink) {
  return 'uri' in result ? result : new vscode.Location(result.targetUri, result.targetSelectionRange ?? result.targetRange);
}
async function waitUntil(check: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for native editor navigation.');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
async function visualCheckpoint(name: string) {
  if (process.env.REFATLAS_VISUAL_HOLD !== '1') return;
  await writeFile(resolve(__dirname, '..', '..', '.test-artifacts', `visual-${name}-ready.json`), JSON.stringify({ checkpoint: name, time: Date.now() }));
  console.log(`RefAtlas visual checkpoint: ${name} (45 seconds)`);
  await new Promise(resolve => setTimeout(resolve, 45000));
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('refatlas-local.refatlas-vscode');
  assert.ok(extension);
  const folders = vscode.workspace.workspaceFolders;
  assert.ok(folders && folders.length >= 3);
  const realRoot = folders[0]!.uri;
  const fixtureRoot = folders[1]!.uri;
  const missingRoot = folders[2]!.uri;
  const targetUri = vscode.Uri.joinPath(realRoot, TARGET_PATH);
  const observations = [];
  for (const sample of REAL_HASH_CASES) {
    const uri = vscode.Uri.joinPath(realRoot, sample.path);
    const openStart = performance.now();
    let document = await vscode.workspace.openTextDocument(uri);
    const openDocumentMs = performance.now() - openStart;
    // The isolated profile starts JSON files in Plain Text. No onLanguage:json activation is needed.
    if (observations.length === 0) {
      assert.equal(document.languageId, 'plaintext');
      await waitUntil(() => extension.isActive);
    }
    if (document.languageId !== 'plaintext') document = await vscode.languages.setTextDocumentLanguage(document, 'plaintext');
    const lineText = document.lineAt(sample.sourceLine).text;
    const local = recognitionObservation(lineText, sample.hash);
    const position = new vscode.Position(sample.sourceLine, local.startCharacter);
    await vscode.window.showTextDocument(document);
    let tick = performance.now();
    let maxTickGapMs = 0;
    const rssStart = process.memoryUsage().rss;
    const timer = setInterval(() => { const now = performance.now(); maxTickGapMs = Math.max(maxTickGapMs, now - tick); tick = now; }, 5);
    let firstHoverMs: number;
    let cachedHoverMs: number;
    try {
      const start = performance.now();
      const first = await hovers(uri, position);
      firstHoverMs = performance.now() - start;
      assert.ok(hoverText(first).includes(sample.value), sample.field);
      assert.ok(hoverText(first).includes(sample.hash));
      const range = first.find(hover => hover.range?.contains(position))?.range;
      assert.ok(range);
      assert.equal(range.start.line, sample.sourceLine);
      assert.equal(range.start.character, local.startCharacter);
      assert.equal(range.end.character, local.startCharacter + local.length);
      const cachedStart = performance.now();
      assert.ok(hoverText(await hovers(uri, position)).includes(sample.value));
      cachedHoverMs = performance.now() - cachedStart;
    } finally { clearInterval(timer); }
    const hoverRssDeltaMiB = (process.memoryUsage().rss - rssStart) / 1048576;
    const resolved = (await definitions(uri, position)).map(location).find(item => item.uri.toString() === targetUri.toString());
    assert.ok(resolved);
    assert.equal(resolved.range.start.line, sample.targetLine);
    await verifyTargetLocation(targetUri.fsPath, sample.hash, {
      value: sample.value, line: resolved.range.start.line,
      startCharacter: resolved.range.start.character, endCharacter: resolved.range.end.character,
    });
    // Also confirm JSON language mode; its command-chain latency includes other installed providers.
    document = await vscode.languages.setTextDocumentLanguage(document, 'json');
    const jsonStart = performance.now();
    assert.ok(hoverText(await hovers(uri, position)).includes(sample.value));
    const jsonModeCachedHoverMs = performance.now() - jsonStart;
    assert.equal(document.isDirty, false, 'real dataset documents must remain unedited');
    observations.push({
      field: sample.field, path: sample.path, bytes: (await stat(uri.fsPath)).size, lines: document.lineCount,
      sourceLine: sample.sourceLine + 1, ...local, openDocumentMs, targetLine: sample.targetLine + 1,
      targetMode: 'disk', firstHoverMs, cachedHoverMs, jsonModeCachedHoverMs, maxTickGapMs,
      hoverRssDeltaMiB, caseRssDeltaMiB: (process.memoryUsage().rss - rssStart) / 1048576,
    });
  }

  // Exercise actual native commands, not a RefAtlas substitute UI.
  const sourceUri = vscode.Uri.joinPath(realRoot, REAL_HASH_CASES[0].path);
  const source = await vscode.workspace.openTextDocument(sourceUri);
  const position = new vscode.Position(REAL_HASH_CASES[0].sourceLine, source.lineAt(REAL_HASH_CASES[0].sourceLine).text.indexOf(hash));
  await vscode.window.showTextDocument(source);
  vscode.window.activeTextEditor!.selection = new vscode.Selection(position, position);
  await vscode.commands.executeCommand('editor.action.showHover');
  await visualCheckpoint('hover');
  await vscode.commands.executeCommand('editor.action.revealDefinition');
  await waitUntil(() => vscode.window.activeTextEditor?.document.uri.toString() === targetUri.toString());
  assert.equal(vscode.window.activeTextEditor!.selection.start.line, 11232);
  await vscode.window.showTextDocument(source);
  vscode.window.activeTextEditor!.selection = new vscode.Selection(position, position);
  await vscode.commands.executeCommand('editor.action.peekDefinition');
  await new Promise(resolve => setTimeout(resolve, 300));
  await visualCheckpoint('peek');
  await vscode.commands.executeCommand('closeReferenceSearch');

  // Dirty-document and multi-root checks edit only disposable fixtures in this project.
  const fixtureSource = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(fixtureRoot, 'Config/Example.json'));
  const fixturePosition = fixtureSource.positionAt(fixtureSource.getText().indexOf(hash));
  const fixtureTarget = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(fixtureRoot, TARGET_PATH));
  assert.match(hoverText(await hovers(fixtureSource.uri, fixturePosition)), /fixture(?:&nbsp;| )original/);
  const fixtureDefinition = (await definitions(fixtureSource.uri, fixturePosition)).map(location)[0];
  assert.equal(fixtureDefinition?.uri.toString(), fixtureTarget.uri.toString());
  const edit = new vscode.WorkspaceEdit();
  edit.replace(fixtureTarget.uri, new vscode.Range(new vscode.Position(0, 0), fixtureTarget.positionAt(fixtureTarget.getText().length)), `{\n\n  "${hash}": "未保存三月七"\n}`);
  assert.ok(await vscode.workspace.applyEdit(edit));
  assert.ok(fixtureTarget.isDirty);
  assert.match(hoverText(await hovers(fixtureSource.uri, fixturePosition)), /未保存三月七/);
  const dirtyDefinition = (await definitions(fixtureSource.uri, fixturePosition)).map(location)[0];
  assert.equal(dirtyDefinition?.range.start.line, 2);
  assert.equal(fixtureTarget.getText(dirtyDefinition!.range), `"${hash}": "未保存三月七"`);
  // Formerly unsupported parent fields now resolve; string/similar-key patterns remain silent.
  const fixtureText = fixtureSource.getText();
  const otherOffset = fixtureText.indexOf(hash, fixtureText.indexOf('AvatarFullName'));
  assert.match(hoverText(await hovers(fixtureSource.uri, fixtureSource.positionAt(otherOffset))), /未保存三月七/);
  for (const field of ['StringHash', 'SomeHash', 'HashValue', 'FakeText', 'Missing']) {
    const cursor = fixtureText.indexOf(field === 'Missing' ? MISSING_HASH : hash, fixtureText.indexOf(`"${field}"`));
    assert.equal((await hovers(fixtureSource.uri, fixtureSource.positionAt(cursor))).length, 0, field);
    assert.equal((await definitions(fixtureSource.uri, fixtureSource.positionAt(cursor))).length, 0, field);
  }
  const missingTargetDocument = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(missingRoot, 'Example.json'));
  const missingPosition = new vscode.Position(0, missingTargetDocument.lineAt(0).text.indexOf(hash));
  assert.equal((await hovers(missingTargetDocument.uri, missingPosition)).length, 0);
  assert.equal((await definitions(missingTargetDocument.uri, missingPosition)).length, 0);
  const outside = await vscode.workspace.openTextDocument(vscode.Uri.file(resolve(__dirname, '..', '..', '.test-artifacts', 'outside.json')));
  assert.equal(vscode.workspace.getWorkspaceFolder(outside.uri), undefined);
  const outsidePosition = new vscode.Position(0, outside.lineAt(0).text.indexOf(hash));
  assert.equal((await hovers(outside.uri, outsidePosition)).length, 0);
  assert.equal((await definitions(outside.uri, outsidePosition)).length, 0);
  await vscode.window.showTextDocument(fixtureTarget);
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  const observation = {
    success: true, vscodeVersion: vscode.version, cases: observations,
    activation: 'workspaceContains activated extension with JSON files initially in Plain Text',
    nativeGoToDefinition: 'command navigated to the expected editor and line',
    nativePeek: 'native command executed; visual widget appearance not asserted by extension API',
    multiRoot: 'passed', dirtyTarget: 'passed (project fixture only)',
    silentMissingKey: 'passed', silentMissingTarget: 'passed', outsideWorkspace: 'passed',
  };
  const artifactRoot = resolve(__dirname, '..', '..', '.test-artifacts');
  await writeFile(join(artifactRoot, 'extension-results.json'), JSON.stringify(observation, null, 2));
  console.log('RefAtlas extension integration PASS', JSON.stringify(observation));
}
