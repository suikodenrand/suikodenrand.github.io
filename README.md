# Stars of Destiny · 0.14.3

Public website: https://suikodenrand.github.io/

The main release is the combined Suikoden I & II full Windows package. Its
precompiled NSIS installer includes the randomizer, launcher, BepInEx and
Suikoden Fix. S1 ATB remains optional and is installed disabled.

The browser generates **launcher settings presets**, not configured installers.
Players download the full package, use **Load settings…** in the launcher,
apply the preset, then start New Game in the selected game. Presets merge only
the selected game's seed, character mode, roster, protagonist, start and
joining-weapon options. Other launcher options remain untouched.

`release/0.14.3/manifest.json` pins the exact qualified EXE and full ZIP hashes.
Upstream sources are extracted folders inside the package; no source archives
are nested in it. Verification details and gameplay limits accompany the release.

The S1-only 0.8.14 web installer generator remains at `/legacy/0.8.14/`, with its
own frozen modules and matching precompiled release. Older release files remain
available at their original paths.

Run the current browser-core and preset checks:

```text
node --test tests/new-runtime-preset.test.mjs
```

Tests compare complete mappings and fingerprints against 152 vectors captured
from the exact packaged 0.14.3 C# cores, all catalog entries, the 24 original S1
golden profiles, settings links, and launcher preset combinations. The capture
harness and input hashes are in `tests/new-parity-harness/`; build output is ignored.

Serve locally with `python -m http.server 14314 --bind 127.0.0.1`.
GitHub Pages publishes the repository's `main` branch. Keep release binaries
unchanged once their hashes have been published.
