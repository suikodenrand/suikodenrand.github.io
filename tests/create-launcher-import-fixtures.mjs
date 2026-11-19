import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generateAdventure } from '../js/randomizer-core.mjs';
import { createLauncherPreset } from '../js/launcher-preset.mjs';

if (!process.argv[2]) throw new Error('Usage: node tests/create-launcher-import-fixtures.mjs <new fixture directory>');
const output = resolve(process.argv[2]);
await mkdir(output, { recursive: true });
const cases = [];
for (const game of ['GSD1', 'GSD2'])
  for (const mode of ['Shuffle', 'FixedChosen', 'FixedRandom'])
    for (const joiningEquipment of ['MatchRole', 'Donor', null]) {
      const prefix = game === 'GSD1' && joiningEquipment === 'Donor' ? 'star\\moon-' : '';
      const seed = `${prefix}web-0.14.6-${game}-${mode}-${joiningEquipment ?? 'legacy'}-"'星`;
      const joiningWeaponLevel = mode === 'Shuffle' ? (game === 'GSD1' ? 'TirVariance' : 'RiouVariance')
        : mode === 'FixedChosen' ? 'MatchRole' : 'Level1';
      const profile = await generateAdventure(seed, { game, mode, joiningEquipment: joiningEquipment ?? 'MatchRole', joiningWeaponLevel,
        companions: game === 'GSD1' ? [0, 1, 2, 3, 4] : [2, 3, 4, 5, 6], startPoint: 'Opening' });
      const preset = await createLauncherPreset(profile);
      const file = Object.keys(preset.configFiles)[0];
      if (joiningEquipment === null) preset.configFiles[file] = preset.configFiles[file].replace(/^JoiningEquipment = .*\r\n/m, '');
      const name = `${game}-${mode}-${joiningEquipment ?? 'legacy'}.json`;
      await writeFile(resolve(output, name), JSON.stringify(preset, null, 2) + '\n', { flag: 'wx' });
      cases.push({ name, game, mode, seed, joiningWeaponLevel, joiningEquipment, expectedInventoryPolicy: joiningEquipment ?? 'Donor' });
    }
await writeFile(resolve(output, 'cases.json'), JSON.stringify(cases, null, 2) + '\n', { flag: 'wx' });
console.log(`Prepared ${cases.length} new and legacy website preset cases.`);
