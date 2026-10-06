# RefAtlas — VS Code V0.1

RefAtlas adds deterministic reference navigation to raw TurnBasedGameData JSON in VS Code.

RefAtlas currently resolves numeric JSON properties named exactly `Hash` against
`TextMap/TextMapCHS.json`. The source can be any local `.json` file in a workspace
folder; no parent field name, filename, root schema, or numeric size is required.
Large-integer identities are preserved as raw source lexemes.

**Found:** localized Hover preview and native Definition / Peek.
**Not found:** no Hover or Definition, including when the target file is absent.

Hover previews the Chinese text and hash. VS Code's native **Go to Definition**
(F12), **Peek Definition** (Alt+F12 on Windows), and Ctrl+Click navigate to the
actual TextMap key/value. RefAtlas adds providers alongside the built-in JSON
language features.

## Development

Requirements: Node.js 22+, npm, and VS Code desktop 1.100+. Validated locally with
Node 24.21.0 and VS Code 1.140.0.

From this directory:

```powershell
npm ci
npm run build
npm test
npm run smoke
npm run measure
npm run test:extension
```

The project-local `.npmrc` routes npm public requests through
`http://127.0.0.1:7890`. Start that proxy before installing; an unavailable proxy
must cause installation to fail. It does not change user/system npm settings.

Open **this extension project** in VS Code and press **F5** using the `RefAtlas V0.1`
launch configuration. The Extension Development Host opens the sibling
`../TurnBasedGameData/` as a workspace folder. Open `ExcelOutput/AvatarConfig.json`
and hover over the first `AvatarName.Hash` (`6186714091647966180`): it previews
`三月七`. F12 / Alt+F12 resolve to TextMap line 11233 in the supplied snapshot.
`SkillName.Hash`, `SkillDesc.Hash`, `StageName.Hash`, and any other numeric `Hash`
property use the same rule. The filename selector also works in Plain Text mode;
RefAtlas does not depend on VS Code's JSON language service being enabled.

For normal use, `TurnBasedGameData/` itself must be a workspace folder. A parent
folder alone is insufficient. Multi-root workspaces are supported: each source
resolves only within its own workspace folder.

`smoke` reads the sibling dataset without modifying it; an alternate dataset can
be supplied using `node dist/smoke.js C:/path/to/TurnBasedGameData` after building.
`measure` separately observes target lookup at early/middle/late positions, an
absent key, cancellation, and local recognition in two large sources. Supply an
alternate root with `node dist/measure.js C:/path/to/TurnBasedGameData`. Measurements
are observations, not SLAs or cold filesystem benchmarks; a missing key's second
scan is not cached.
`test:extension` uses an installed VS Code without downloading a test runtime.
Set `VS_CODE_EXECUTABLE` if it is not at the usual Windows user-install path, and
`REFATLAS_DATASET` to override the dataset path. It creates an isolated profile,
multi-root workspace, and disposable fixtures in ignored `.test-artifacts/`.
Only those fixtures are edited for dirty-document tests; real data stays read-only.
The isolated test profile initially opens `.json` as Plain Text to verify automatic
workspace activation and then checks JSON mode explicitly. Its results distinguish
local recognition, document opening, and the VS Code Hover command chain.

For an interactive integration check, set `$env:REFATLAS_VISUAL_HOLD='1'` before
running `npm run test:extension`; the native Hover and Peek stages each pause for
45 seconds. Results are written to `.test-artifacts/extension-results.json`.
The automated test asserts native F12 navigation; a successful Peek command alone
does not assert the widget's appearance.

## Current limits and non-goals

- Source recognition reads/scans only the current line using JSON tokens. It
  supports same-line `"Hash": <number>` in standard JSON, not split-line values.
  Strings and current-line comments do not produce references. It does not validate
  the entire source or infer cross-line comment context. Exceptionally long physical
  lines cost more; normal dataset Hash lines are short.
- Target lookup supports a flat root object with one string member per physical
  line, as in the supplied TextMap. Minified/multiline-member layouts are unsupported.
  The matching line and visited prefix are checked; the unseen suffix and global
  duplicate-key uniqueness are not audited.
- Open TextMap documents use current editor content, including unsaved edits;
  unopened targets use cancellable asynchronous UTF-8 streaming. Resolved entries
  have a 64-entry versioned memory cache. Missing results are silent; actual read
  failures/unsupported target layouts appear in the `RefAtlas` Output channel.
  Uncached late/missing lookups remain linear scans; no index is built.
- No non-Hash ID references, other locales, custom JSON viewer, global search, graph,
  database, indexing, Dataset Contract DSL, or general-purpose HSR modeling.
- `../RefAtlas/` is a previous standalone experiment/research archive. The extension
  does not depend on it. Both sibling repositories remain read-only for this work.

Implementation and validation observations:
[V0.1 report](docs/investigations/v0.1-generic-textmap-hash-references.md).
[V0 history](docs/investigations/v0-textmap-reference-navigation.md).
