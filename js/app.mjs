import { COMPANION_COUNT, generateAdventure, MODES, GAMES, getCombatPool, getStartPoints, getStartPointHelp, getProfileMetadata, getJoiningWeaponLevels, validateCompanions } from './randomizer-core.mjs?v=0.14.3';
import { createLauncherPreset, profileCsv, presetFilename } from './launcher-preset.mjs?v=0.14.3';
import { settingsUrl, readSettingsUrl } from './settings-links.mjs?v=0.14.3';

const $ = id => document.getElementById(id);
const modeInputs = [...document.querySelectorAll('input[name="mode"]')];
const companionSelects = Array.from({ length: COMPANION_COUNT }, (_, index) => {
  const label = document.createElement('label');
  label.className = 'companion-choice';
  const name = document.createElement('span');
  name.textContent = 'Companion ' + (index + 1);
  const select = document.createElement('select');
  select.id = 'companion-' + (index + 1);
  select.setAttribute('aria-describedby', 'companion-help companion-error');
  select.add(new Option('Select a hero', ''));
  label.append(name, select);
  $('companion-selects').append(label);
  return select;
});
let currentProfile = null;
let settingsGeneration = 0;
let building = false;
let downloadURL = null;
let debounce;
let toastTimer;
let populatedGame = null;

const selectedGame = () => $('game').value;
const selectedMode = () => modeInputs.find(input => input.checked)?.value ?? 'Shuffle';
const selectedCompanions = () => companionSelects.map(select => select.value === '' ? NaN : Number(select.value));

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
}

function renderGame() {
  const game = selectedGame();
  if (populatedGame === game) return;
  const heroes = [...getCombatPool(game)].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const select of companionSelects) {
    select.replaceChildren(new Option('Select a hero', ''));
    for (const hero of heroes) {
      const large = game === 'GSD2' && hero.slotCost === 2;
      const option = new Option((hero.displayName ?? hero.name) + (large ? ' (two slots; Shuffle only)' : ''), String(hero.id));
      option.dataset.fixedExcluded = String(large);
      select.add(option);
    }
  }
  $('start-point').replaceChildren(...Object.entries(getStartPoints(game)).map(([id, name]) => new Option(name, id)));
  $('joining-weapon-level').replaceChildren(...Object.entries(getJoiningWeaponLevels(game)).map(([id, name]) => new Option(name, id)));
  $('include-tir').checked = false;
  populatedGame = game;
}

function renderMode() {
  renderGame();
  const game = selectedGame();
  const mode = selectedMode();
  const chosen = mode === 'FixedChosen';
  const fixed = mode !== 'Shuffle';
  $('include-tir-option').hidden = fixed;
  $('include-tir').disabled = fixed || building;
  $('companion-fieldset').hidden = !chosen;
  const selected = companionSelects.map(select => select.value);
  companionSelects.forEach((select, index) => {
    select.disabled = !chosen || building;
    for (const option of select.options) {
      option.disabled = option.dataset.fixedExcluded === 'true' || (option.value !== '' && selected.some((id, other) => other !== index && id === option.value));
    }
  });
  $('summary-mode').textContent = MODES[mode];
  const hero = game === 'GSD1' ? 'Tir' : 'Your hero';
  $('summary-game').textContent = GAMES[game];
  $('summary-version').textContent = 'Runtime version ' + getProfileMetadata(game).pluginVersion;
  $('summary-pool').textContent = fixed ? hero + ' + five companions'
    : (getCombatPool(game).length + ($('include-tir').checked ? 1 : 0)) + ' combat heroes';
  $('summary-start').textContent = getStartPoints(game)[$('start-point').value];
  $('summary-weapons').textContent = getJoiningWeaponLevels(game)[$('joining-weapon-level').value];
  $('joining-weapon-help').textContent = `Default: ${game === 'GSD1' ? 'Tir' : 'Riou'}’s current weapon level at first join, plus a seeded −3 to +3 (including a match). Applied once; later sharpening is kept.`;
  $('fixed-mode-description').textContent = game === 'GSD1' ? 'Choose five companions. Tir fills the sixth slot.' : 'Choose five single-slot companions. Your hero has a reserved slot.';
  $('random-mode-description').textContent = 'Your seed picks five distinct companions alongside ' + (game === 'GSD1' ? 'Tir.' : 'your hero.');
  $('include-protagonist-label').textContent = 'Include ' + (game === 'GSD1' ? 'Tir' : 'the protagonist') + ' in the shuffle';
  $('include-tir-help').textContent = game === 'GSD1'
    ? 'Experimental. Adds the protagonist and their story role to the pool. Your entered name is preserved.'
    : 'Adds the player-named hero to the pool. The hero and anyone given the hero’s appearance keep their original stats, equipment and runes. Your entered name is preserved.';
  $('companion-help').textContent = game === 'GSD1' ? 'Pick five different heroes. Story roles fill from your roster as the party grows.' : 'Pick five different single-slot heroes. Story roles fill from your roster as the party grows.';
  $('start-help').textContent = getStartPointHelp(game, $('start-point').value);
  $('formation-help').hidden = game !== 'GSD2';
  $('formation-help').textContent = fixed
    ? 'Abizboah, Feather, Siegfried and Rulodia use two formation slots and are available in Character Shuffle only.'
    : 'Two-slot fighters shuffle among other two-slot fighters, preserving the story’s party formations.';
  $('pool-exclusions').replaceChildren(...(game === 'GSD1' ? ['Ted', 'Odessa', 'Non-combat characters'] : ['Jowy / special guests', 'Alternate character records', 'Non-combat characters']).map(name => {
    const span = document.createElement('span'); span.textContent = name; return span;
  }));
  $('preview-label').textContent = fixed ? 'Reveal your roster' : 'Reveal character mapping';
  $('preview-title').textContent = fixed ? 'Your six heroes.' : 'Your cast, revealed.';
  $('preview-description').textContent = fixed
    ? (game === 'GSD1' ? 'Tir' : 'Your hero') + ' and the five companions available during your run.'
    : 'Assignments for the selected seed.';
  $('preview-left-heading').textContent = fixed ? 'Roster slot' : 'Original character';
  $('preview-right-heading').textContent = fixed ? 'Hero' : 'Replacement character';
}

function renderMapping() {
  const query = $('hero-search').value.trim().toLocaleLowerCase();
  const roster = currentProfile?.heroes;
  const all = roster
    ? roster.map((hero, index) => [index ? 'Companion ' + index : 'Hero (reserved)', hero.displayName ?? hero.name])
    : currentProfile?.assignments.map(row => [row.roleName, row.donorName]) ?? [];
  const rows = all.filter(row => row.join(' ').toLocaleLowerCase().includes(query));
  $('mapping-table').replaceChildren(...rows.map(row => {
    const tr = document.createElement('tr');
    for (const name of row) {
      const td = document.createElement('td');
      td.textContent = name;
      tr.append(td);
    }
    return tr;
  }));
  $('mapping-count').textContent = currentProfile
    ? `${rows.length} of ${all.length} ${roster ? 'heroes' : 'characters'} shown.`
    : 'Choose valid settings to preview your cast.';
}

function syncButtons() {
  $('build-installer').disabled = building || !currentProfile;
  $('copy-seed').disabled = building || !currentProfile;
  $('download-spoiler').disabled = building || !currentProfile;
}

async function refreshSettings() {
  const generation = ++settingsGeneration;
  currentProfile = null;
  syncButtons();
  renderMode();
  renderMapping();
  $('seed-error').hidden = true;
  $('companion-error').hidden = true;
  $('seed').removeAttribute('aria-invalid');

  const mode = selectedMode();
  const companions = selectedCompanions();
  if (mode === 'FixedChosen') {
    try {
      validateCompanions(companions, selectedGame());
    } catch (error) {
      $('companion-error').textContent = error.message;
      $('companion-error').hidden = false;
      return;
    }
  }

  try {
    const profile = await generateAdventure($('seed').value, {
      game: selectedGame(),
      mode, companions, startPoint: $('start-point').value, joiningWeaponLevel: $('joining-weapon-level').value,
      includeTir: selectedGame() === 'GSD1' && mode === 'Shuffle' && $('include-tir').checked,
      includeProtagonist: selectedGame() === 'GSD2' && mode === 'Shuffle' && $('include-tir').checked
    });
    if (generation !== settingsGeneration) return;
    currentProfile = profile;
    syncButtons();
    renderMapping();
  } catch (error) {
    if (generation !== settingsGeneration) return;
    $('seed-error').textContent = error.message || 'Enter a valid seed.';
    $('seed-error').hidden = false;
    $('seed').setAttribute('aria-invalid', 'true');
  }
}

function clearResult() {
  $('download-result').hidden = true;
  $('build-status').textContent = '';
}

function settingsChanged() {
  clearTimeout(debounce);
  clearResult();
  refreshSettings();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

$('seed').addEventListener('input', () => {
  clearTimeout(debounce);
  ++settingsGeneration;
  currentProfile = null;
  syncButtons();
  renderMapping();
  clearResult();
  debounce = setTimeout(refreshSettings, 200);
});
$('random-seed').addEventListener('click', () => {
  const bits = crypto.getRandomValues(new Uint8Array(6));
  $('seed').value = 'stars-' + [...bits].map(x => x.toString(16).padStart(2, '0')).join('');
  settingsChanged();
});
for (const input of [...modeInputs, ...companionSelects, $('game'), $('start-point'), $('joining-weapon-level'), $('include-tir')]) {
  input.addEventListener('change', settingsChanged);
}
$('hero-search').addEventListener('input', renderMapping);
$('download-spoiler').addEventListener('click', () => {
  if (!currentProfile) return;
  downloadBlob(new Blob([profileCsv(currentProfile)], { type: 'text/csv;charset=utf-8' }),
    `Suikoden-${currentProfile.fingerprint.slice(0, 12)}-spoiler.csv`);
});
$('copy-seed').addEventListener('click', async () => {
  const profile = currentProfile;
  if (!profile) return;
  const link = settingsUrl(profile, location.href);
  try {
    await navigator.clipboard.writeText(link.href);
    toast('Settings link copied.');
  } catch {
    const field = document.createElement('textarea');
    field.value = link.href;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    if (copied) toast('Settings link copied.');
    else $('build-status').textContent = 'Copy this settings link: ' + link.href;
  }
});

function setBuilding(value) {
  building = value;
  for (const input of [...modeInputs, $('game'), $('seed'), $('random-seed'), $('start-point'), $('joining-weapon-level')]) {
    input.disabled = value;
  }
  renderMode();
  syncButtons();
}

$('generator-form').addEventListener('submit', async event => {
  event.preventDefault();
  const profile = currentProfile;
  if (building || !profile) return;
  setBuilding(true);
  $('download-result').hidden = true;
  $('build-installer').textContent = 'Preparing preset…';
  $('build-status').textContent = 'Validating your settings…';
  try {
    const preset = await createLauncherPreset(profile);
    const result = { blob: new Blob([JSON.stringify(preset, null, 2) + '\n'], { type: 'application/json' }), filename: presetFilename(profile) };
    if (downloadURL) URL.revokeObjectURL(downloadURL);
    downloadURL = URL.createObjectURL(result.blob);
    $('download-again').href = downloadURL;
    $('download-again').download = result.filename;
    const modeLabel = MODES[profile.mode] + (profile.includeTir ? ' · Tir included' : profile.includeProtagonist ? ' · Protagonist included' : '');
    $('download-summary').textContent = `${GAMES[profile.game ?? 'GSD1']} · ${modeLabel} · ${getStartPoints(profile.game ?? 'GSD1')[profile.startPoint]} · Seed ${profile.seed} · ${Math.ceil(result.blob.size / 1024)} KB`;
    $('download-result').hidden = false;
    $('build-status').textContent = 'Your download is ready.';
    const click = document.createElement('a');
    click.href = downloadURL;
    click.download = result.filename;
    document.body.append(click);
    click.click();
    click.remove();
    $('download-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    toast('Preset ready. In the launcher, choose Load settings… then Apply settings.');
  } catch (error) {
    $('build-status').textContent = 'Could not prepare the preset: ' + (error.message || 'Please try again.');
  } finally {
    setBuilding(false);
    $('build-installer').innerHTML = 'Download settings preset ↓';
  }
});

$('nav-toggle').addEventListener('click', () => {
  const open = $('nav-toggle').getAttribute('aria-expanded') === 'true';
  $('nav-toggle').setAttribute('aria-expanded', String(!open));
  $('main-nav').dataset.open = String(!open);
});
$('main-nav').addEventListener('click', event => {
  if (event.target.closest('a')) {
    $('main-nav').dataset.open = 'false';
    $('nav-toggle').setAttribute('aria-expanded', 'false');
  }
});

try {
  const linked = readSettingsUrl(location.href);
  $('game').value = linked.game;
  renderGame();
  if (linked.seed !== undefined) $('seed').value = linked.seed;
  modeInputs.find(input => input.value === linked.mode).checked = true;
  $('start-point').value = linked.startPoint;
  $('joining-weapon-level').value = linked.joiningWeaponLevel;
  $('include-tir').checked = linked.includeTir || linked.includeProtagonist;
  if (linked.companionStrings.length === COMPANION_COUNT) companionSelects.forEach((select, index) => { select.value = linked.companionStrings[index]; });
  refreshSettings();
} catch (error) {
  renderMode();
  $('build-status').textContent = error.message;
  syncButtons();
}
