# Website preset import verification

Run the browser-generated presets through the packaged launcher 1.0.7
`SettingsWorkspace.StagePreset` method. The previous 1.0.4 import method and
its provenance are retained alongside this harness as historical evidence.

Generate 18 fixtures: both games, all three modes, MatchRole, Donor and a legacy
partial preset without JoiningEquipment. The legacy cases must preserve an
existing Donor choice. The S1 Donor cases also cover a literal backslash. All cases check that
all four disabled S1 quality-of-life options and unrelated settings are preserved, import writes nothing before
Apply, and Apply backs up the original selected config.

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
