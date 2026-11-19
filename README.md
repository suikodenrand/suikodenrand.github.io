# Stars of Destiny · 0.14.6

Public website: https://suikodenrand.github.io/

The full Windows installer includes the combined Suikoden I & II randomizer,
launcher 1.0.7, BepInEx and Suikoden Fix. Four new S1 quality-of-life
features are on by default. The optional S1 CTB preview starts off. See
[the patch notes](changelog.html) for the inventory, equipment, quick-start
and battle changes. Players can also [join the official Discord](https://discord.gg/NbjPpcG3Cb).

The browser generates **launcher settings presets**, not configured installers.
Players download the full package, use **Load settings…** in the launcher,
apply the preset, then start New Game in the selected game. Presets merge only
the selected game's seed, character mode, roster, protagonist, start and
joining-weapon and joining-inventory options. Other launcher options remain untouched.

[The release manifest](release/0.14.6/manifest.json) records the download URLs,
sizes and SHA-256 hashes for the setup, manual mod-only, plugins-only, launcher-only and CTB preview packages. The manual and plugins-only ZIPs require BepInEx
separately. Keep older release files at their published paths.

The S1-only 0.8.14 web installer generator remains at `/legacy/0.8.14/`, with its
own frozen modules and matching precompiled release. Older release files remain
available at their original paths.

Run the current browser-core and preset checks:

```text
node --test tests/new-runtime-preset.test.mjs
```

The packaged 0.14.6 cores reproduce all 152 saved mapping vectors and both
character catalogs from 0.14.4. The browser suite also covers the original
24 S1 golden profiles and round-trips settings links and JSON presets.
Eighteen generated presets passed import, Apply, backup and reload in launcher
1.0.7, including partial presets from older releases. All four S1 quality-of-life
preferences stayed disabled when importing a campaign preset. See the
[harness instructions](tests/launcher-import-harness/README.md) to repeat these checks.

Serve locally with `python -m http.server 14314 --bind 127.0.0.1`.
GitHub Pages publishes the repository's `main` branch. Keep release binaries
unchanged once their hashes have been published.
