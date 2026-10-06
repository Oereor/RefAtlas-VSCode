const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const executable = process.env.VS_CODE_EXECUTABLE || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe');
if (!existsSync(executable)) throw new Error('Set VS_CODE_EXECUTABLE to the installed VS Code executable.');
const artifacts = path.join(root, '.test-artifacts');
mkdirSync(artifacts, { recursive: true });
const settingsFolder = path.join(artifacts, 'user-data', 'User');
mkdirSync(settingsFolder, { recursive: true });
writeFileSync(path.join(settingsFolder, 'settings.json'), JSON.stringify({
  'http.proxy': 'http://127.0.0.1:7890', 'http.proxySupport': 'override',
  'update.mode': 'none', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false,
  'telemetry.telemetryLevel': 'off', 'workbench.enableExperiments': false,
  'json.schemaDownload.enable': false,
}));
const fixture = path.join(artifacts, 'fixture');
mkdirSync(path.join(fixture, 'ExcelOutput'), { recursive: true });
mkdirSync(path.join(fixture, 'TextMap'), { recursive: true });
writeFileSync(path.join(fixture, 'ExcelOutput', 'AvatarConfig.json'), '[{"AvatarName":{"Hash":6186714091647966180},"AvatarFullName":{"Hash":6186714091647966180}}]');
writeFileSync(path.join(fixture, 'TextMap', 'TextMapCHS.json'), '{\n  "6186714091647966180": "fixture original"\n}');
const workspace = path.join(artifacts, 'integration.code-workspace');
writeFileSync(workspace, JSON.stringify({ folders: [
  { path: path.resolve(process.env.REFATLAS_DATASET || path.join(root, '..', 'TurnBasedGameData')) },
  { path: fixture },
] }));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [
  '--new-window', '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox',
  `--user-data-dir=${path.join(artifacts, 'user-data')}`,
  `--extensions-dir=${path.join(artifacts, 'extensions')}`,
  `--extensionDevelopmentPath=${root}`,
  `--extensionTestsPath=${path.join(root, 'dist', 'test', 'extensionSuite.js')}`,
  workspace,
], { env, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
