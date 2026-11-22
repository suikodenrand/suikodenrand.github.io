# Stars of Destiny · 0.14.6

Public website: https://suikodenrand.github.io/

The [PlayStation alpha](https://suikodenrand.github.io/#playstation) is a standalone seed generator for the original U.S. discs. The homepage describes the alpha's known Suikoden II scene bugs and links to its setup guide and ZIP checksum.

The full Windows installer includes the combined Suikoden I & II randomizer,
launcher 1.0.8, BepInEx and Suikoden Fix. Setup revision 3 offers repair and
uninstall for an existing installation. Four new S1 quality-of-life
features are on by default. The optional S1 CTB preview starts off. See
[the patch notes](changelog.html) for the inventory, equipment, quick-start
and battle changes. The [standalone launcher 1.0.8 update](https://github.com/suikodenrand/suikodenrando/releases/download/v0.14.6/Stars-of-Destiny-Launcher-1.0.8-Windows.zip) adds **Join our Discord** to the main window.

The browser generates **launcher settings presets**, not configured installers.
Players download the full package, use **Load settings…** in the launcher,
apply the preset, then start New Game in the selected game. Presets merge only
the selected game's seed, character mode, roster, protagonist, start and
joining-weapon and joining-inventory options. Other launcher options remain untouched.

[The revision 3 manifest](release/0.14.6-r3/manifest.json) records the current setup and its checksum. [The revision 2 manifest](release/0.14.6-r2/manifest.json) records package URLs, sizes and SHA-256 hashes. The [original 0.14.6 manifest](release/0.14.6/manifest.json) covers the first download set. The manual and plugins-only ZIPs require BepInEx separately.

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
