import { generateAdventure, MODES, PROFILE_METADATA, START_POINTS, STARTING_GEAR } from './randomizer-core.mjs?v=0.8.12';
import { sha256Hex as sha256 } from './sha256.mjs';

const encoder = new TextEncoder();
const RELEASE_BASE = new URL('../release/' + PROFILE_METADATA.pluginVersion + '/', import.meta.url);
const SETUP_NAME = 'StarsOfDestiny-Setup.exe';
const CONFIG_NAME = 'agilen.suikoden.recruitment_randomizer.cfg';
const NOTICES_NAME = 'THIRD_PARTY_NOTICES.txt';
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

function configFor(profile) {
  const seed = profile.seed.replace(/['"]/g, quote => '\\' + quote);
  const lines = ['[Shuffle]', 'Seed = ' + seed, 'Mode = ' + profile.mode];
  if (profile.mode === 'FixedChosen') lines.push('Companions = ' + profile.companionIds.join(','));
  if (profile.mode === 'Shuffle') lines.push('IncludeTir = ' + profile.includeTir);
  lines.push('', '[Balance]', 'StartingGear = ' + profile.startingGear,
    '', '[Start]', 'Point = ' + profile.startPoint, '');
  return lines.join('\r\n');
}

function readme(profile) {
  return [
    'Stars of Destiny - Character Randomizer ' + PROFILE_METADATA.pluginVersion,
    '',
    MODES[profile.mode] + ' | ' + START_POINTS[profile.startPoint],
    STARTING_GEAR[profile.startingGear] + ' | Runes keep their usual behavior.',
    'Seed ' + profile.seed,
    ...(profile.includeTir ? ['Tir is in the shuffle pool.'] : []),
    '',
    '1. Install BepInEx 6 IL2CPP and launch the game once to set it up.',
    '2. Close the game and extract all files into the same folder.',
    '3. Open ' + SETUP_NAME + ' and select your game folder.',
    '4. Launch Suikoden I and choose New Game.',
    '',
    'Setup guide: https://suikodenrand.github.io/guide.html',
    ''
  ].join('\r\n');
}

async function verifiedAsset(fetcher, base, asset, name) {
  if (asset?.name !== name || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1
      || !/^[0-9a-f]{64}$/.test(asset.sha256)) {
    throw new Error('This release is unavailable. Refresh the page and try again.');
  }
  const response = await fetcher(new URL(name, base), { cache: 'no-cache' });
  if (!response.ok) throw new Error('Could not download ' + name + '. Try again.');
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.length !== asset.bytes || await sha256(data) !== asset.sha256) {
    throw new Error('The download did not pass verification. Refresh the page and try again.');
  }
  return { name, data };
}

/** Package the same precompiled Windows setup with each player's config. */
export async function buildInstaller({ profile, includeSpoiler = false, onProgress = () => {}, fetcher = globalThis.fetch, releaseBase = RELEASE_BASE } = {}) {
  if (!profile?.seed) throw new Error('Generate a valid seed before building an installer.');
  const actual = await generateAdventure(profile.seed, {
    mode: profile.mode, companions: profile.companionIds, startPoint: profile.startPoint,
    includeTir: profile.includeTir, startingGear: profile.startingGear
  });
  if (profile.fingerprint !== actual.fingerprint) throw new Error('The roster preview changed. Generate it again before downloading.');

  const base = new URL(releaseBase);
  onProgress({ percent: 10 });
  const manifestResponse = await fetcher(new URL('manifest.json', base), { cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error('The release information is unavailable. Try again.');
  const manifest = await manifestResponse.json();
  if (manifest.schema !== 'srr-precompiled-release-v1' || manifest.runtimeVersion !== PROFILE_METADATA.pluginVersion) {
    throw new Error('This release is unavailable. Refresh the page and try again.');
  }

  onProgress({ percent: 40 });
  const [installer, notices] = await Promise.all([
    verifiedAsset(fetcher, base, manifest.setup, SETUP_NAME),
    verifiedAsset(fetcher, base, manifest.notices, NOTICES_NAME)
  ]);

  const config = configFor(actual);
  const entries = [
    installer,
    notices,
    { name: CONFIG_NAME, data: config },
    { name: 'README.txt', data: readme(actual) }
  ];
  if (includeSpoiler) entries.push({ name: 'mapping-spoiler.csv', data: profileCsv(actual) });

  onProgress({ percent: 85 });
  const blob = createZip(entries);
  const presetId = (await sha256(encoder.encode(config))).slice(0, 12);
  onProgress({ percent: 100 });
  return { blob, filename: 'StarsOfDestiny-' + PROFILE_METADATA.pluginVersion + '-' + presetId + '-Installer.zip' };
}
