# Stars of Destiny · 0.14.4

Public website: https://suikodenrand.github.io/

The main release is the combined Suikoden I & II full Windows package. Its
precompiled NSIS installer includes the randomizer, launcher, BepInEx and
Suikoden Fix. S1 ATB remains optional and is installed disabled.

The browser generates **launcher settings presets**, not configured installers.
Players download the full package, use **Load settings…** in the launcher,
apply the preset, then start New Game in the selected game. Presets merge only
the selected game's seed, character mode, roster, protagonist, start and
joining-weapon and joining-inventory options. Other launcher options remain untouched.

`release/0.14.4/manifest.json` pins the exact qualified setup EXE and mod-only manual ZIP hashes and GitHub release URLs. The manual ZIP requires the pinned BepInEx loader separately; full setup bundles it.
Upstream sources are extracted folders inside the full setup; no source archives
are nested in the mod-only ZIP. Verification details and gameplay limits accompany the release.

The S1-only 0.8.14 web installer generator remains at `/legacy/0.8.14/`, with its
own frozen modules and matching precompiled release. Older release files remain
available at their original paths.

Run the current browser-core and preset checks:

```text
node --test tests/new-runtime-preset.test.mjs
```

Tests compare complete mappings and fingerprints against 152 vectors from
the actual 0.14.4 C# cores and retained 0.14.3 evidence, all catalog entries,
24 original S1 golden profiles, settings links and preset combinations.
An 18-case launcher import check verifies partial-preset merging with the
actual packaged launcher core. The capture/import harness instructions are
in `tests/launcher-import-harness/README.md`. The capture
harness and input hashes are in `tests/new-parity-harness/`; build output is ignored.

Serve locally with `python -m http.server 14314 --bind 127.0.0.1`.
GitHub Pages publishes the repository's `main` branch. Keep release binaries
unchanged once their hashes have been published.
