import { generateProfile } from './randomizer-core.mjs';
import { buildInstaller } from './installer-bundle.mjs';

const $ = id => document.getElementById(id);
let currentProfile = null;
let seedGeneration = 0;
let building = false;
let downloadURL = null;
let debounce;
let toastTimer;

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
}

function csvFor(profile) {
  const cell = value => '"' + String(value).replaceAll('"', '""') + '"';
  return 'Story role,Assigned avatar\r\n' + profile.assignments.map(row => [row.roleName,row.donorName].map(cell).join(',')).join('\r\n') + '\r\n';
}

function renderMapping() {
  const query = $('hero-search').value.trim().toLocaleLowerCase();
  const rows = currentProfile?.assignments.filter(row => (row.roleName + ' ' + row.donorName).toLocaleLowerCase().includes(query)) ?? [];
  $('mapping-table').replaceChildren(...rows.map(row => {
    const tr = document.createElement('tr');
    for (const name of [row.roleName, row.donorName]) {
      const td = document.createElement('td'); td.textContent = name; tr.append(td);
    }
    return tr;
  }));
  $('mapping-count').textContent = `${rows.length} of 75 characters shown.`;
}

async function refreshSeed() {
  const generation = ++seedGeneration;
  currentProfile = null;
  $('build-installer').disabled = true;
  $('download-spoiler').disabled = true;
  $('seed-error').hidden = true;
  $('seed').removeAttribute('aria-invalid');
  try {
    if ($('seed').value.includes('\\')) throw new Error('Backslashes are not supported in installer seeds. Choose another character.');
    const profile = await generateProfile($('seed').value);
    if (generation !== seedGeneration) return null;
    currentProfile = profile;
    $('build-installer').disabled = building;
    $('download-spoiler').disabled = false;
    renderMapping();
    return profile;
  } catch (error) {
    if (generation !== seedGeneration) return null;
    $('seed-error').textContent = error.message || 'Enter a valid seed.';
    $('seed-error').hidden = false;
    $('seed').setAttribute('aria-invalid','true');
    $('mapping-table').replaceChildren();
    $('mapping-count').textContent = 'Enter a valid seed to preview its cast.';
    return null;
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

$('seed').addEventListener('input', () => {
  clearTimeout(debounce);
  ++seedGeneration;
  currentProfile = null;
  $('build-installer').disabled = true;
  $('download-result').hidden = true;
  $('build-status').textContent = '';
  debounce = setTimeout(refreshSeed, 200);
});
$('seed').addEventListener('change', () => { clearTimeout(debounce); refreshSeed(); });
$('random-seed').addEventListener('click', () => {
  const bits = crypto.getRandomValues(new Uint8Array(6));
  $('seed').value = 'stars-' + [...bits].map(x => x.toString(16).padStart(2,'0')).join('');
  $('download-result').hidden = true;
  $('build-status').textContent = '';
  refreshSeed();
});
$('hero-search').addEventListener('input', renderMapping);
$('include-spoiler').addEventListener('change', () => {
  $('download-result').hidden = true;
  $('build-status').textContent = '';
});
$('download-spoiler').addEventListener('click', () => {
  if (!currentProfile) return;
  downloadBlob(new Blob(['\ufeff' + csvFor(currentProfile)],{type:'text/csv;charset=utf-8'}),`Suikoden-${currentProfile.fingerprint.slice(0,12)}-spoiler.csv`);
});
$('copy-seed').addEventListener('click', async () => {
  const profile = await refreshSeed();
  if (!profile) return;
  const link = new URL(location.href);
  link.search = ''; link.searchParams.set('seed',profile.seed); link.hash = 'generate';
  try { await navigator.clipboard.writeText(link.href); toast('Seed link copied. Share the same cast.'); }
  catch {
    const field = document.createElement('textarea'); field.value = link.href;
    field.style.position = 'fixed'; field.style.opacity = '0'; document.body.append(field);
    field.select(); const copied = document.execCommand('copy'); field.remove();
    if (copied) toast('Seed link copied.');
    else { $('build-status').textContent = 'Copy this seed link: ' + link.href; }
  }
});
$('generator-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (building) return;
  clearTimeout(debounce);
  const profile = await refreshSeed();
  if (!profile) { $('seed').focus(); return; }
  building = true;
  for (const id of ['seed','random-seed','include-spoiler','copy-seed','build-installer']) $(id).disabled = true;
  $('download-result').hidden = true;
  $('build-installer').textContent = 'Preparing your ZIP…';
  $('build-status').textContent = 'Checking the package files…';
  try {
    const result = await buildInstaller({profile,includeSpoiler:$('include-spoiler').checked,onProgress:progress => { $('build-status').textContent = typeof progress === 'string' ? 'Preparing your download…' : `Preparing your download… ${progress.percent}%`; }});
    if (downloadURL) URL.revokeObjectURL(downloadURL);
    downloadURL = URL.createObjectURL(result.blob);
    $('download-again').href = downloadURL;
    $('download-again').download = result.filename;
    $('download-summary').textContent = `Seed: ${profile.seed} · ${Math.ceil(result.blob.size/1024)} KB · Extract all files and run Install.cmd.`;
    $('download-result').hidden = false;
    $('build-status').textContent = 'Your download is ready.';
    const click = document.createElement('a'); click.href = downloadURL; click.download = result.filename; document.body.append(click); click.click(); click.remove();
    $('download-result').scrollIntoView({behavior:'smooth',block:'nearest'});
    toast('Installer ready. Your adventure is packed.');
  } catch (error) {
    $('build-status').textContent = 'Could not prepare the installer: ' + (error.message || 'Please try again.');
  } finally {
    building = false;
    for (const id of ['seed','random-seed','include-spoiler','copy-seed']) $(id).disabled = false;
    $('build-installer').disabled = !currentProfile;
    $('build-installer').innerHTML = '<span aria-hidden="true">↓</span> Build installer ZIP';
  }
});

$('nav-toggle').addEventListener('click', () => {
  const open = $('nav-toggle').getAttribute('aria-expanded') === 'true';
  $('nav-toggle').setAttribute('aria-expanded',String(!open));
  $('main-nav').dataset.open = String(!open);
});
$('main-nav').addEventListener('click', event => {
  if (event.target.closest('a')) { $('main-nav').dataset.open='false'; $('nav-toggle').setAttribute('aria-expanded','false'); }
});
const urlSeed = new URL(location.href).searchParams.get('seed');
if (urlSeed !== null) $('seed').value = urlSeed;
refreshSeed();
