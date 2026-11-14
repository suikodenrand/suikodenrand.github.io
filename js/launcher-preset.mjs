import { generateAdventure } from './randomizer-core.mjs?v=0.14.3';

const CONFIGS = Object.freeze({ GSD1: 'agilen.suikoden.recruitment_randomizer.cfg', GSD2: 'agilen.suikoden2.recruitment_randomizer.cfg' });

async function revalidate(profile) {
  if (!profile || typeof profile !== 'object' || typeof profile.seed !== 'string') throw new Error('Generate a valid seed before downloading settings.');
  const game = profile.game ?? 'GSD1';
  const actual = await generateAdventure(profile.seed, { game, mode: profile.mode, companions: profile.companionIds,
    startPoint: profile.startPoint, includeTir: profile.includeTir, includeProtagonist: profile.includeProtagonist,
    joiningWeaponLevel: profile.joiningWeaponLevel });
  if (actual.seed !== profile.seed || actual.fingerprint !== profile.fingerprint
      || JSON.stringify(actual.assignments?.map(row => [row.roleId, row.donorId]) ?? actual.heroes?.map(hero => hero.id))
        !== JSON.stringify(profile.assignments?.map(row => [row.roleId, row.donorId]) ?? profile.heroes?.map(hero => hero.id))) {
    throw new Error('The roster preview changed. Generate it again before downloading settings.');
  }
  // The launcher parses one INI value per line and trims .NET whitespace.
  // Profile normalization rejects line/control characters and unsafe escapes;
  // quotes, equals signs, non-ASCII names and literal punctuation remain literal.
  if (/[\r\n\0\\]/.test(actual.seed)) throw new Error('This seed cannot be represented safely in launcher settings.');
  return { game, actual };
}

function ini(game, profile) {
  const lines = [...(game === 'GSD2' ? ['[Game]', 'Target = GSD2', ''] : []), '[Shuffle]',
    'Seed = ' + profile.seed, 'Mode = ' + profile.mode, 'Companions = ' + (profile.companionIds?.join(',') ?? ''),
    (game === 'GSD2' ? 'IncludeProtagonist = ' + !!profile.includeProtagonist : 'IncludeTir = ' + !!profile.includeTir),
    'JoiningWeaponLevel = ' + profile.joiningWeaponLevel, '', '[Start]', 'Point = ' + profile.startPoint, ''];
  return lines.join('\r\n');
}

export async function configFor(profile) {
  const { game, actual } = await revalidate(profile);
  return ini(game, actual);
}

export async function createLauncherPreset(profile) {
  const { game, actual } = await revalidate(profile);
  return { schema: 'stars-of-destiny-settings-v1', configFiles: { [CONFIGS[game]]: ini(game, actual) } };
}

export function presetFilename(profile) {
  const game = profile.game === 'GSD2' ? 'SuikodenII' : 'SuikodenI';
  if (!/^[0-9a-f]{64}$/.test(profile.fingerprint)) throw new Error('Generate a valid profile before downloading settings.');
  return 'StarsOfDestiny-0.14.3-' + game + '-' + profile.fingerprint.slice(0, 12) + '-Settings.json';
}

export function profileCsv(profile) {
  const cell = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  const game = profile.game ?? 'GSD1';
  const prefix = [game, profile.startPoint, profile.joiningWeaponLevel];
  const rows = profile.heroes
    ? profile.heroes.map((hero, index) => [...prefix, index || 'Hero', hero.id, hero.displayName ?? hero.name])
    : profile.assignments.map(row => [...prefix, row.roleId, row.roleName, row.donorId, row.donorName]);
  const columns = 'Game,Start point,Joining weapon policy,' + (profile.heroes
    ? 'Roster slot,Character ID,Character' : 'Original character ID,Original character,Replacement ID,Replacement character');
  return '\ufeff' + columns + '\r\n' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
