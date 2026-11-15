# Packaged launcher import check

This fixture reuses the launcher's exact `ImportPreset` and `Entries` method
bodies, with UI-only shims for choosing a file, rebuilding pages, displaying
status and reporting errors. `method-provenance.json` records the matching
source and method hashes. The actual packaged launcher-core DLL supplies its
INI parser, settings catalog, validation, merge documents, transactional Apply
and reload behavior. This is not an automated WinForms file-dialog test.

Generate 18 fixtures: both games, all three modes, MatchRole, Donor and a legacy
partial preset without JoiningEquipment. The legacy cases must preserve an
existing Donor choice. All cases check that unrelated settings/configs remain
unchanged, import writes nothing before Apply, and Apply backs up the original
selected config.

```powershell
node tests/create-launcher-import-fixtures.mjs ../validation/preset-inputs
dotnet run --project tests/launcher-import-harness/LauncherImport.csproj -c Release "-p:LauncherPath=C:/path/to/actual/package/StarsOfDestiny Launcher" -- ../validation/preset-inputs ../validation/new-disposable-fixtures C:/path/to/package/BepInEx/config C:/path/to/package/BepInEx/plugins/SuikodenRandomizer/SuikodenRandomizer.dll ../validation/launcher-import.json
```

Use fresh output directories. The unified DLL is copied only to disposable
fixtures for reading its file version; it is never loaded or executed. No
live installation or personal save is required.

To recapture the browser mapping evidence from the actual runtime payload:

```powershell
dotnet run --project tests/new-parity-harness/new-parity-harness.csproj -c Release "-p:RuntimePath=C:/path/to/package/BepInEx/plugins/SuikodenRandomizer" "-p:LauncherPath=C:/path/to/package/StarsOfDestiny Launcher" -- ../validation/new-parity.json
```

That harness executes only the pure managed profile cores and launcher INI
parser. Keep the published historical vectors unchanged when adding a new
version's evidence. No game/native code is executed by either harness.
