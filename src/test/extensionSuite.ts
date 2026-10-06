import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { SOURCE_PATH, TARGET_PATH } from '../context';

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
  await extension.activate();
  const folders = vscode.workspace.workspaceFolders;
  assert.ok(folders && folders.length >= 2);
  const realRoot = folders[0]!.uri;
  const fixtureRoot = folders[1]!.uri;
  const sourceUri = vscode.Uri.joinPath(realRoot, SOURCE_PATH);
  const targetUri = vscode.Uri.joinPath(realRoot, TARGET_PATH);
  const source = await vscode.workspace.openTextDocument(sourceUri);
  const position = source.positionAt(source.getText().indexOf(hash));
  const editor = await vscode.window.showTextDocument(source);
  editor.selection = new vscode.Selection(position, position);
  let tick = performance.now();
  let maxTickGapMs = 0;
  const heartbeat = setInterval(() => { const now = performance.now(); maxTickGapMs = Math.max(maxTickGapMs, now - tick); tick = now; }, 5);
  const rssStart = process.memoryUsage().rss;
  let firstHoverMs = 0;
  let cachedHoverMs = 0;
  let hoverRssDeltaMiB = 0;
  try {
    const start = performance.now();
    const first = await hovers(sourceUri, position);
    firstHoverMs = performance.now() - start;
    assert.match(hoverText(first), /三月七/);
    assert.match(hoverText(first), new RegExp(hash));
    assert.ok(first.some(hover => hover.range?.contains(position)));
    const cachedStart = performance.now();
    assert.match(hoverText(await hovers(sourceUri, position)), /三月七/);
    cachedHoverMs = performance.now() - cachedStart;
    hoverRssDeltaMiB = (process.memoryUsage().rss - rssStart) / 1048576;
  } finally { clearInterval(heartbeat); }
  await vscode.commands.executeCommand('editor.action.showHover');
  await visualCheckpoint('hover');
  const resolved = (await definitions(sourceUri, position)).map(location).find(item => item.uri.toString() === targetUri.toString());
  assert.ok(resolved);
  assert.equal(resolved.range.start.line, 11232);
  const target = await vscode.workspace.openTextDocument(resolved.uri);
  assert.equal(target.getText(resolved.range), `"${hash}": "三月七"`);

  // Exercise actual native commands, not a RefAtlas substitute UI.
  await vscode.window.showTextDocument(source);
  vscode.window.activeTextEditor!.selection = new vscode.Selection(position, position);
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
  const fixtureSource = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(fixtureRoot, SOURCE_PATH));
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
  // Source rule rejects another hash even when its value is resolvable.
  const invalidOffset = fixtureSource.getText().lastIndexOf(hash);
  assert.equal((await hovers(fixtureSource.uri, fixtureSource.positionAt(invalidOffset))).length, 0);
  assert.equal((await definitions(fixtureSource.uri, fixtureSource.positionAt(invalidOffset))).length, 0);
  await vscode.window.showTextDocument(fixtureTarget);
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  const observation = {
    success: true, vscodeVersion: vscode.version, firstHoverMs, cachedHoverMs,
    hoverRssDeltaMiB, afterOpeningTargetRssDeltaMiB: (process.memoryUsage().rss - rssStart) / 1048576,
    maxTickGapMs, definitionLine: resolved.range.start.line + 1,
    nativeGoToDefinition: 'command navigated to the expected editor and line',
    nativePeek: 'native command executed; visual widget appearance not asserted by extension API',
    multiRoot: 'passed', dirtyTarget: 'passed (project fixture only)',
  };
  const artifactRoot = resolve(__dirname, '..', '..', '.test-artifacts');
  await writeFile(join(artifactRoot, 'extension-results.json'), JSON.stringify(observation, null, 2));
  console.log('RefAtlas extension integration PASS', JSON.stringify(observation));
}
