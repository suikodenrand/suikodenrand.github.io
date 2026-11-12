import { COMBAT_POOL, COMPANION_COUNT, generateAdventure, JOINING_WEAPON_LEVELS, MODES, START_POINTS, validateCompanions } from './randomizer-core.mjs?v=0.8.14';
import { buildInstaller, profileCsv } from './installer-bundle.mjs?v=0.8.14';

const $ = id => document.getElementById(id);
const modeInputs = [...document.querySelectorAll('input[name="mode"]')];
const heroesByName = [...COMBAT_POOL].sort((a, b) => a.name.localeCompare(b.name, 'en'));
const companionSelects = Array.from({ length: COMPANION_COUNT }, (_, index) => {
  const label = document.createElement('label');
  label.className = 'companion-choice';
  const name = document.createElement('span');
  name.textContent = 'Companion ' + (index + 1);
  const select = document.createElement('select');
  select.id = 'companion-' + (index + 1);
  select.setAttribute('aria-describedby', 'companion-help companion-error');
  select.add(new Option('Select a hero', ''));
  for (const hero of heroesByName) select.add(new Option(hero.name, String(hero.id)));
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

const selectedMode = () => modeInputs.find(input => input.checked)?.value ?? 'Shuffle';
const selectedCompanions = () => companionSelects.map(select => select.value === '' ? NaN : Number(select.value));

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
}

function renderMode() {
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
      option.disabled = option.value !== '' && selected.some((id, other) => other !== index && id === option.value);
    }
  });
  $('summary-mode').textContent = MODES[mode];
  $('summary-pool').textContent = fixed ? 'Tir + five companions'
    : $('include-tir').checked ? '76 combat heroes' : '75 combat heroes';
  $('summary-start').textContent = START_POINTS[$('start-point').value];
  $('summary-weapons').textContent = JOINING_WEAPON_LEVELS[$('joining-weapon-level').value];
  $('preview-label').textContent = fixed ? 'Reveal your roster' : 'Reveal character mapping';
  $('preview-title').textContent = fixed ? 'Your six heroes.' : 'Your cast, revealed.';
  $('preview-description').textContent = fixed
    ? 'Tir and the five companions available during your run.'
    : 'Assignments for the selected seed.';
  $('preview-left-heading').textContent = fixed ? 'Roster slot' : 'Original character';
  $('preview-right-heading').textContent = fixed ? 'Hero' : 'Replacement character';
}

function renderMapping() {
  const query = $('hero-search').value.trim().toLocaleLowerCase();
  const roster = currentProfile?.heroes;
  const all = roster
    ? roster.map((hero, index) => [index ? 'Companion ' + index : 'Hero (reserved)', hero.name])
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
      validateCompanions(companions);
    } catch (error) {
      $('companion-error').textContent = error.message;
      $('companion-error').hidden = false;
      return;
    }
  }

  try {
    const profile = await generateAdventure($('seed').value, {
      mode, companions, startPoint: $('start-point').value,
      includeTir: mode === 'Shuffle' && $('include-tir').checked,
      joiningWeaponLevel: $('joining-weapon-level').value
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
for (const input of [...modeInputs, ...companionSelects, $('start-point'), $('include-tir'), $('joining-weapon-level')]) {
  input.addEventListener('change', settingsChanged);
}
$('hero-search').addEventListener('input', renderMapping);
$('include-spoiler').addEventListener('change', clearResult);
$('download-spoiler').addEventListener('click', () => {
  if (!currentProfile) return;
  downloadBlob(new Blob([profileCsv(currentProfile)], { type: 'text/csv;charset=utf-8' }),
    `Suikoden-${currentProfile.fingerprint.slice(0, 12)}-spoiler.csv`);
});
$('copy-seed').addEventListener('click', async () => {
  const profile = currentProfile;
  if (!profile) return;
  const link = new URL(location.href);
  link.search = '';
  link.searchParams.set('seed', profile.seed);
  if (profile.mode !== 'Shuffle') link.searchParams.set('mode', profile.mode);
  if (profile.mode === 'FixedChosen') link.searchParams.set('companions', profile.companionIds.join(','));
  if (profile.includeTir) link.searchParams.set('tir', '1');
  if (profile.startPoint !== 'Opening') link.searchParams.set('start', profile.startPoint);
  if (profile.joiningWeaponLevel !== 'TirVariance') link.searchParams.set('weapon', profile.joiningWeaponLevel);
  link.hash = 'generate';
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
  for (const input of [...modeInputs, $('seed'), $('random-seed'), $('include-spoiler'), $('start-point'), $('joining-weapon-level')]) {
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
  $('build-installer').textContent = 'Preparing your ZIP…';
  $('build-status').textContent = 'Checking the package files…';
  try {
    const result = await buildInstaller({
      profile,
      includeSpoiler: $('include-spoiler').checked,
      onProgress: progress => { $('build-status').textContent = `Preparing your download… ${progress.percent}%`; }
    });
    if (downloadURL) URL.revokeObjectURL(downloadURL);
    downloadURL = URL.createObjectURL(result.blob);
    $('download-again').href = downloadURL;
    $('download-again').download = result.filename;
    const modeLabel = MODES[profile.mode] + (profile.includeTir ? ' · Tir included' : '');
    $('download-summary').textContent = `${modeLabel} · ${START_POINTS[profile.startPoint]} · Weapons: ${JOINING_WEAPON_LEVELS[profile.joiningWeaponLevel]} · Seed ${profile.seed} · ${Math.ceil(result.blob.size / 1024)} KB`;
    $('download-result').hidden = false;
    $('build-status').textContent = 'Your download is ready.';
    const click = document.createElement('a');
    click.href = downloadURL;
    click.download = result.filename;
    document.body.append(click);
    click.click();
    click.remove();
    $('download-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    toast('Installer ready. Extract the ZIP and open StarsOfDestiny-Setup.exe.');
  } catch (error) {
    $('build-status').textContent = 'Could not prepare the installer: ' + (error.message || 'Please try again.');
  } finally {
    setBuilding(false);
    $('build-installer').innerHTML = '<span aria-hidden="true">↓</span> Build installer ZIP';
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

const params = new URL(location.href).searchParams;
if (params.has('seed')) $('seed').value = params.get('seed');
const linkedMode = modeInputs.find(input => input.value === params.get('mode'));
if (linkedMode) linkedMode.checked = true;
if (Object.hasOwn(START_POINTS, params.get('start'))) $('start-point').value = params.get('start');
$('joining-weapon-level').value = Object.hasOwn(JOINING_WEAPON_LEVELS, params.get('weapon')) ? params.get('weapon') : 'TirVariance';
$('include-tir').checked = params.get('tir') === '1';
if (selectedMode() === 'FixedChosen') {
  const ids = (params.get('companions') ?? '').split(',');
  if (ids.length === COMPANION_COUNT) companionSelects.forEach((select, index) => { select.value = ids[index]; });
}
refreshSettings();
