# RefAtlas

- RefAtlas adds deterministic reference navigation to raw TurnBasedGameData JSON in VS Code.
- Use VS Code's native browsing and language features; do not duplicate them.
- `../TurnBasedGameData/` is permanently READ-ONLY.
- `../RefAtlas/` is historical evidence only, not a dependency or migration source.
- Preserve large ID/hash identities as raw source lexemes, never JS numbers.
- References require explicit source/structure/type rules, never raw equality heuristics.
- Keep features minimal until a real browsing pain justifies expansion. V0.1 resolves same-line numeric properties named exactly Hash to CHS; missing matches are silent.
- Source recognition reads only the current line; never getText/parseTree an entire source JSON for Hover or Definition.
- All public network access must use `127.0.0.1:7890` and fail closed; never change permanent user proxy settings.
- Leave work local for review; do not commit, push, create branches/PRs/issues, or publish.
