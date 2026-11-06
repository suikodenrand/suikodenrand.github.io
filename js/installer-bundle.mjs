import { generateAdventure, MODES, PROFILE_METADATA, START_POINTS } from './randomizer-core.mjs?v=0.8.6';
import { sha256Hex as sha256 } from './sha256.mjs';

const encoder = new TextEncoder();
const RELEASE_BASE = new URL('../release/', import.meta.url);
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** Standard ZIP STORE entries, UTF-8 names, CRC32 and central-directory records. */
export function createZip(entries) {
  if (entries.length > 65535) throw new Error('Too many archive entries.');
  const parts = [], directory = [];
  const names = new Set();
  let offset = 0, directorySize = 0;
  for (const entry of entries) {
    if (!entry.name || names.has(entry.name) || entry.name.startsWith('/') || entry.name.includes(':') || entry.name.includes('\\') || entry.name.split('/').some(part => part === '..' || part === '.')) {
      throw new Error('Unsafe archive entry name.');
    }
    names.add(entry.name);
    const name = encoder.encode(entry.name);
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : new Uint8Array(entry.data);
    if (name.length > 65535 || data.length > 0xffffffff) throw new Error('Archive entry is too large.');
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
    view.setUint16(12, 0x0021, true); // DOS date 1980-01-01, stable output.
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true); view.setUint32(22, data.length, true);
    view.setUint16(26, name.length, true); local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const index = new DataView(central.buffer);
    index.setUint32(0, 0x02014b50, true);
    index.setUint16(4, 20, true); index.setUint16(6, 20, true); index.setUint16(8, 0x0800, true);
    index.setUint16(14, 0x0021, true); index.setUint32(16, crc, true);
    index.setUint32(20, data.length, true); index.setUint32(24, data.length, true);
    index.setUint16(28, name.length, true); index.setUint32(42, offset, true);
    central.set(name, 46);
    parts.push(local, data); directory.push(central);
    offset += local.length + data.length; directorySize += central.length;
  }
  if (offset + directorySize > 0xffffffff) throw new Error('Archive is too large.');
  const end = new Uint8Array(22), endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true); endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directorySize, true); endView.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}

export function profileCsv(profile) {
  const cell = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  if (profile.heroes) {
    const rows = profile.heroes.map((hero, index) => [index || 'Hero', hero.id, hero.name].map(cell).join(','));
    return '\ufeffRoster slot,Character ID,Character\r\n' + rows.join('\r\n') + '\r\n';
  }
  const rows = profile.assignments.map(row => [row.roleId, row.roleName, row.donorId, row.donorName].map(cell).join(','));
  return '\ufeffOriginal character ID,Original character,Replacement ID,Replacement character\r\n' + rows.join('\r\n') + '\r\n';
}

function presetFor(profile) {
  return {
    schema: 'srr-web-preset-v2', runtimeVersion: PROFILE_METADATA.pluginVersion,
    seed: profile.seed, mode: profile.mode, startPoint: profile.startPoint,
    companions: profile.mode === 'FixedChosen' ? profile.companionIds : [],
    profileId: profile.profileId, algorithm: profile.algorithm, fingerprint: profile.fingerprint
  };
}

function readme(profile, includeSpoiler) {
  return `SUIKODEN RANDOMIZER ${PROFILE_METADATA.pluginVersion}\r\n\r\nSeed: ${profile.seed}\r\nRoster mode: ${MODES[profile.mode]}\r\nStart point: ${START_POINTS[profile.startPoint]}\r\n\r\nGETTING STARTED\r\n1. Back up your saves and BepInEx/config folder.\r\n2. Read INSTALL_GUIDE.txt for the required BepInEx setup.\r\n3. Close the game. Extract the entire ZIP into a fresh folder and run Install.cmd. Select your Suikoden I & II HD Remaster game folder and wait for setup to finish.\r\n4. Start a New Game to use these settings. Existing randomized saves keep their saved cast.\r\n\r\nHELP\r\nIf something goes wrong, press F6 in-game, close the game, and run Collect-Avatar-Diagnostics.cmd. Include the Desktop ZIP with your report.\r\nRollback.cmd restores the previous plugin and configuration. It does not restore save files.\r\n\r\n${includeSpoiler ? 'mapping-spoiler.csv reveals your full cast.' : 'No spoiler file is included.'}\r\n\r\nSee INSTALL_GUIDE.txt for setup, saved games, and troubleshooting.\r\n`;
}

/** Build a complete seed-specific installer ZIP, with hash-verified fixed assets. */
export async function buildInstaller({ profile, includeSpoiler = false, onProgress = () => {}, fetcher = globalThis.fetch, releaseBase = RELEASE_BASE } = {}) {
  if (!profile?.seed) throw new Error('Generate a valid seed before building an installer.');
  const actual = await generateAdventure(profile.seed, {
    mode: profile.mode, companions: profile.companionIds, startPoint: profile.startPoint
  });
  if (profile.fingerprint !== actual.fingerprint) throw new Error('The roster preview changed. Generate it again before downloading.');
  const base = new URL(releaseBase);
  onProgress({ phase: 'verify', percent: 5, message: 'Checking the release manifest…' });
  const manifestResponse = await fetcher(new URL('manifest.json', base), { cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error('The release manifest could not be downloaded. Try again.');
  const manifest = await manifestResponse.json();
  if (manifest.schema !== 'srr-web-release-v1' || manifest.runtimeVersion !== PROFILE_METADATA.pluginVersion || !Array.isArray(manifest.files) || manifest.files.length < 8) {
    throw new Error('This release manifest is not supported.');
  }
  const entries = [];
  const names = new Set();
  for (let n = 0; n < manifest.files.length; n++) {
    const file = manifest.files[n];
    if (typeof file.name !== 'string' || names.has(file.name) || file.name.startsWith('/') || file.name.includes(':') || file.name.includes('\\') || file.name.split('/').some(part => part === '..' || part === '.') || !/^[0-9a-f]{64}$/.test(file.sha256)) {
      throw new Error('The release manifest contains an invalid file.');
    }
    names.add(file.name);
    const response = await fetcher(new URL('base/' + file.name, base), { cache: 'no-cache' });
    if (!response.ok) throw new Error('Could not download ' + file.name + '. Try again.');
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.length !== file.bytes || await sha256(data) !== file.sha256) throw new Error('Release verification failed for ' + file.name + '. Refresh the page and try again.');
    entries.push({ name: file.name, data });
    onProgress({ phase: 'verify', percent: 10 + Math.round(65 * (n + 1) / manifest.files.length), message: 'Verified ' + file.name });
  }
  const guideResponse = await fetcher(new URL('../assets/guide.txt', base), { cache: 'no-cache' });
  if (!guideResponse.ok) throw new Error('The installation guide is unavailable. Try again.');
  entries.push({ name: 'INSTALL_GUIDE.txt', data: await guideResponse.text() });
  entries.push({ name: 'README-FIRST.txt', data: readme(actual, includeSpoiler) });
  const preset = JSON.stringify(presetFor(actual), null, 2) + '\n';
  entries.push({ name: 'installer/preset.json', data: preset });
  if (includeSpoiler) entries.push({ name: 'mapping-spoiler.csv', data: profileCsv(actual) });
  onProgress({ phase: 'package', percent: 85, message: 'Assembling your installer…' });
  const blob = createZip(entries);
  const hash = await sha256(new Uint8Array(await blob.arrayBuffer()));
  const presetId = (await sha256(encoder.encode(preset))).slice(0, 12);
  onProgress({ phase: 'ready', percent: 100, message: 'Your installer ZIP is ready.' });
  return { blob, filename: `SuikodenRandomizer-${PROFILE_METADATA.pluginVersion}-${presetId}-Installer.zip`, sha256: hash, profile: actual };
}
