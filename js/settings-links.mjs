import { GAMES, MODES, getStartPoints, getJoiningWeaponLevels, normalizeSeed, validateCompanions } from './randomizer-core.mjs?v=0.14.3';

export function settingsUrl(profile, currentUrl) {
  const link = new URL(currentUrl);
  link.search = '';
  if (profile.game === 'GSD2') link.searchParams.set('game', 'GSD2');
  link.searchParams.set('seed', profile.seed);
  if (profile.mode !== 'Shuffle') link.searchParams.set('mode', profile.mode);
  if (profile.mode === 'FixedChosen') link.searchParams.set('companions', profile.companionIds.join(','));
  if (profile.includeTir) link.searchParams.set('tir', '1');
  if (profile.includeProtagonist) link.searchParams.set('hero', '1');
  if (profile.startPoint !== 'Opening') link.searchParams.set('start', profile.startPoint);
  link.searchParams.set('weapon', profile.joiningWeaponLevel ?? (profile.game === 'GSD2' ? 'RiouVariance' : 'TirVariance'));
  link.hash = 'generate';
  return link;
}

export function readSettingsUrl(value) {
  const params = new URL(value).searchParams;
  const game = params.get('game') ?? 'GSD1';
  if (!Object.hasOwn(GAMES, game)) throw new Error('This settings link names an unsupported game.');
  const mode = params.get('mode') ?? 'Shuffle';
  if (!Object.hasOwn(MODES, mode)) throw new Error('This settings link names an unsupported mode.');
  const startPoint = params.get('start') ?? 'Opening';
  if (!Object.hasOwn(getStartPoints(game), startPoint)) throw new Error('This settings link uses a start point from another game.');
  const joiningWeaponLevel = params.get('weapon') ?? params.get('weapons') ?? (game === 'GSD2' ? 'RiouVariance' : 'TirVariance');
  if (!Object.hasOwn(getJoiningWeaponLevels(game), joiningWeaponLevel)) throw new Error('This settings link uses an unsupported joining weapon level for this game.');
  const companionStrings = mode === 'FixedChosen' ? (params.get('companions') ?? '').split(',') : [];
  if (mode === 'FixedChosen') {
    if (companionStrings.some(id => !/^\d+$/.test(id))) throw new Error('This settings link contains invalid companions.');
    validateCompanions(companionStrings.map(Number), game);
  }
  return { game, ...(params.has('seed') ? { seed: normalizeSeed(params.get('seed')) } : {}), mode,
    companionStrings, companions: companionStrings.map(Number),
    includeTir: game === 'GSD1' && mode === 'Shuffle' && params.get('tir') === '1',
    includeProtagonist: game === 'GSD2' && mode === 'Shuffle' && params.get('hero') === '1',
    startPoint, joiningWeaponLevel };
}
