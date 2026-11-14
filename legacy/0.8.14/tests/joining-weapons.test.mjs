import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { generateAdventure, JOINING_WEAPON_LEVELS, PROFILE_METADATA } from '../js/randomizer-core.mjs';
import { buildInstaller, profileCsv } from '../js/installer-bundle.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
// Captured from the published 0.8.7 website before applying the policy backport.
const goldenCases = [
  ['first-adventure', {}, '9c0722892caedca6f92b06ac05a5c5f2d610215b3ce24b896987b59d264512cb', '92322ee81085f72114fa3dd7fc80d33e93ed08104198c4aad38eb4df04156a2e'],
  ['first-adventure', { includeTir: true }, '72da1297e5dab7e385e535d4e01b70fc9cfbe50b993e8dd07af9dbd2d5326a6f', '6e7f455d05c42d0d4125e7c7ab4507eaaee0566b2aad5a99d6a7531d8de6e25e'],
  ['first-adventure', { mode: 'FixedChosen', companions: [0, 1, 2, 3, 4] }, '969ea55a1cb4ed2a9d3c2984a856cc66c6d567e3070153d060719d9c57435432', 'e4ca1e0abd3c0fcfc1709ec1bc75143f73f94decb3dc90947dcebfcbb86a577b'],
  ['first-adventure', { mode: 'FixedRandom' }, '8b70786b8eb083050c9c78cb6e6e5a9ab23e435cc4a3ce01c0081cea8142d604', 'e581cef0d86edba09b1bd0db7ac101bc045b7a12e6df3d5bf5dc0185f8c29f4e'],
  ['星たち-é', { startPoint: 'BeforeViktor' }, '38bdae5aa174799f5c8e31260006bbe4d8796542bc1cf466e7ad7ac125c6b463', '837bdac22df40a217b9ec2d0dc6c00a9d5912bbe50533026734b3e092549e491']
];

test('all three policies retain all published mapping and fingerprint golden cases', async () => {
  assert.deepEqual(Object.keys(JOINING_WEAPON_LEVELS), ['TirVariance', 'MatchRole', 'Level1']);
  for (const [seed, options, fingerprint, mappingHash] of goldenCases) {
    for (const joiningWeaponLevel of Object.keys(JOINING_WEAPON_LEVELS)) {
      const profile = await generateAdventure(seed, { ...options, joiningWeaponLevel });
      const mapping = profile.assignments?.map(row => [row.roleId, row.donorId]) ?? profile.heroes.map(hero => hero.id);
      assert.equal(profile.fingerprint, fingerprint);
      assert.equal(digest(JSON.stringify(mapping)), mappingHash);
      assert.equal(profile.joiningWeaponLevel, joiningWeaponLevel);
    }
  }
});

test('omitted policy defaults to TirVariance and unsupported policies fail', async () => {
  assert.equal((await generateAdventure('old-settings')).joiningWeaponLevel, 'TirVariance');
  for (const value of ['', 'Donor', '13', 'matchrole', null, true]) {
    await assert.rejects(generateAdventure('seed', { joiningWeaponLevel: value }), /joining weapon level/);
  }
});

const setup = new TextEncoder().encode('Test installer fixture, never executed.');
const notices = new TextEncoder().encode('Test notices fixture.');
const manifest = {
  schema: 'srr-precompiled-release-v1', runtimeVersion: '0.8.14',
  setup: { name: 'StarsOfDestiny-Setup.exe', bytes: setup.length, sha256: digest(setup) },
  notices: { name: 'THIRD_PARTY_NOTICES.txt', bytes: notices.length, sha256: digest(notices) }
};
const fixtureFetcher = async url => {
  const name = new URL(url).pathname.split('/').at(-1);
  if (name === 'manifest.json') return new Response(JSON.stringify(manifest));
  if (name === manifest.setup.name) return new Response(setup);
  if (name === manifest.notices.name) return new Response(notices);
  throw new Error('Unexpected test asset ' + url);
};

function unzipStored(bytes) {
  const entries = new Map();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    assert.equal(view.getUint16(offset + 8, true), 0, 'ZIP entry must use STORE');
    const length = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const start = offset + 30 + nameLength + extraLength;
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    entries.set(name, bytes.subarray(start, start + length));
    offset = start + length;
  }
  return entries;
}

test('downloaded ZIP writes the chosen policy for every mode and preserves settings/spoilers', async () => {
  assert.equal(PROFILE_METADATA.pluginVersion, '0.8.14');
  for (const mode of ['Shuffle', 'FixedChosen', 'FixedRandom']) {
    const names = [];
    let previousCsv;
    for (const joiningWeaponLevel of ['TirVariance', 'MatchRole', 'Level1']) {
      const profile = await generateAdventure('quoted-"seed', {
        mode, companions: [0, 1, 2, 3, 4], includeTir: mode === 'Shuffle',
        startPoint: 'BeforeViktor', joiningWeaponLevel
      });
      const result = await buildInstaller({ profile, includeSpoiler: true, fetcher: fixtureFetcher });
      const entries = unzipStored(new Uint8Array(await result.blob.arrayBuffer()));
      const text = name => new TextDecoder().decode(entries.get(name));
      assert.deepEqual(entries.get('StarsOfDestiny-Setup.exe'), setup);
      assert.equal(entries.size, 5);
      const config = text('agilen.suikoden.recruitment_randomizer.cfg');
      assert.match(config, new RegExp('JoiningWeaponLevel = ' + joiningWeaponLevel + '\r\n'));
      assert.ok(config.includes('Seed = quoted-\\"seed\r\n'));
      assert.ok(config.includes('Mode = ' + mode + '\r\n'));
      assert.ok(config.includes('[Start]\r\nPoint = BeforeViktor\r\n'));
      if (mode === 'FixedChosen') assert.ok(config.includes('Companions = 0,1,2,3,4\r\n'));
      if (mode === 'Shuffle') assert.ok(config.includes('IncludeTir = true\r\n'));
      assert.ok(text('README.txt').includes('Joining weapon level: ' + JOINING_WEAPON_LEVELS[joiningWeaponLevel]));
      if (joiningWeaponLevel === 'TirVariance') {
        assert.ok(text('README.txt').includes('At first party join: current Tir weapon level plus a seeded -3 to +3 (including 0), clamped to 1-16. Rejoining never reapplies it.'));
      }
      const csv = text('mapping-spoiler.csv');
      assert.equal(csv, profileCsv(profile).replace(/^\ufeff/, ''));
      if (previousCsv) assert.equal(csv, previousCsv);
      previousCsv = csv;
      names.push(result.filename);
      assert.match(result.filename, /^StarsOfDestiny-0\.8\.14-/);
    }
    assert.equal(new Set(names).size, 3, 'Different policy configurations need distinct download names');
  }
});

test('installer revalidates policy and rejects a mismatched mapping', async () => {
  const profile = await generateAdventure('seed');
  await assert.rejects(buildInstaller({ profile: { ...profile, joiningWeaponLevel: '13' }, fetcher: fixtureFetcher }), /joining weapon level/);
  await assert.rejects(buildInstaller({ profile: { ...profile, fingerprint: 'bad' }, fetcher: fixtureFetcher }), /roster preview changed/);
});

class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.options = []; this.listeners = new Map();
    this.attributes = new Map(); this.style = {}; this.dataset = {}; this._value = '';
    this.checked = false; this.disabled = false; this.hidden = false; this.textContent = '';
  }
  get value() { return this._value; }
  set value(value) { this._value = String(value); }
  add(option) { this.options.push(option); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  async dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) await listener(event);
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  remove() {}
  click() {}
  select() {}
  scrollIntoView() {}
}

async function loadApp(search, exercise) {
  const saved = new Map();
  const timers = [];
  const originalTimeout = globalThis.setTimeout;
  const install = (name, value) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], new Element()]));
  const get = id => { assert.ok(elements.has(id), 'Actual app requested missing HTML element ' + id); return elements.get(id); };
  get('seed').value = 'first-adventure';
  get('start-point').value = 'Opening';
  get('joining-weapon-level').value = 'TirVariance';
  const modes = ['Shuffle', 'FixedChosen', 'FixedRandom'].map(value => Object.assign(new Element('input'), { value, checked: value === 'Shuffle' }));
  for (const mode of modes) {
    mode._checked = mode.checked;
    Object.defineProperty(mode, 'checked', {
      get() { return this._checked; },
      set(value) {
        if (value) for (const other of modes) other._checked = false;
        this._checked = value;
      }
    });
  }
  let copied;
  try {
    install('document', {
      getElementById: get, querySelectorAll: () => modes,
      createElement: tag => new Element(tag), body: new Element('body')
    });
    install('Option', class { constructor(text, value) { this.text = text; this.value = value; this.disabled = false; } });
    install('location', { href: 'https://example.test/' + search });
    install('navigator', { clipboard: { writeText: async value => { copied = value; } } });
    install('setTimeout', (callback, delay, ...args) => {
      const timer = originalTimeout(callback, delay, ...args); timers.push(timer); return timer;
    });
    await import('../js/app.mjs?test=' + Math.random());
    for (let attempt = 0; attempt < 100 && get('build-installer').disabled; attempt++)
      await new Promise(resolve => setImmediate(resolve));
    assert.equal(get('build-installer').disabled, false, 'Actual app did not accept the linked settings');
    await exercise(get, async () => {
      await get('copy-seed').dispatch('click');
      return new URL(copied);
    });
  } finally {
    for (const timer of timers) clearTimeout(timer);
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('actual app defaults old/invalid share links to TirVariance and copies the default safely', async () => {
  for (const suffix of ['', '&weapon=Donor', '&weapon=13']) {
    await loadApp('?seed=old-link&start=BeforeViktor&tir=1' + suffix, async (get, copy) => {
      assert.equal(get('joining-weapon-level').value, 'TirVariance');
      assert.equal(get('summary-weapons').textContent, 'Match Tir at first join (±3)');
      const link = await copy();
      assert.equal(link.searchParams.get('seed'), 'old-link');
      assert.equal(link.searchParams.get('start'), 'BeforeViktor');
      assert.equal(link.searchParams.get('tir'), '1');
      assert.equal(link.searchParams.has('weapon'), false);
    });
  }
});

test('actual app preserves explicit old policies in fixed-roster settings links', async () => {
  for (const policy of ['MatchRole', 'Level1']) {
    await loadApp('?seed=chosen-link&mode=FixedChosen&companions=0,1,2,3,4&weapon=' + policy, async (get, copy) => {
      assert.equal(get('joining-weapon-level').value, policy);
      assert.equal(get('summary-weapons').textContent, JOINING_WEAPON_LEVELS[policy]);
      const link = await copy();
      assert.equal(link.searchParams.get('mode'), 'FixedChosen');
      assert.equal(link.searchParams.get('companions'), '0,1,2,3,4');
      assert.equal(link.searchParams.get('weapon'), policy);
      assert.equal(link.hash, '#generate');
    });
  }
});

test('actual app accepts an explicit TirVariance link and retains it as the default', async () => {
  await loadApp('?seed=tir-link&weapon=TirVariance', async (get, copy) => {
    assert.equal(get('joining-weapon-level').value, 'TirVariance');
    assert.equal((await copy()).searchParams.has('weapon'), false);
  });
});
