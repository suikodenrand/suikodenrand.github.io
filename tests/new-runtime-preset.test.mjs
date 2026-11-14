import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateAdventure, getCombatPool, getGameRoster, getStartPoints, getJoiningWeaponLevels, getProfileMetadata, normalizeSeed, validateCompanions } from '../js/randomizer-core.mjs';
import { GSD2_CATALOG } from '../js/gsd2-catalog.mjs';
import { configFor, createLauncherPreset, presetFilename, profileCsv } from '../js/launcher-preset.mjs';
import { settingsUrl, readSettingsUrl } from '../js/settings-links.mjs';

const fixture = name => readFile(new URL(name, import.meta.url), 'utf8').then(JSON.parse);
const current = await fixture('new-current-runtime-vectors.json');
const mapping = p => p.assignments?.map(row => [row.roleId, row.donorId]) ?? [];
const ids = p => p.heroes?.map(hero => hero.id) ?? [];

test('current packaged 0.14.3 core DLL hashes identify parity evidence', () => {
  assert.equal(current.packageVersion, '0.14.3');
  assert.deepEqual(current.assemblies, [
    { file: 'SuikodenRandomizer.Core.dll', sha256: '0ecc72748f848dc7c116375bb0ad63d2ca0b9869f5fd6d6fbc7f2bb897c96dac' },
    { file: 'SuikodenRandomizer.Suikoden2.Core.dll', sha256: 'ec57741be645193f4367fd5ac55d20e11ddfea2093dbb2e1f270280494fb7da5' }
  ]);
  assert.equal(current.vectors.length, 152);
});

test('both browser catalogs match all current packaged C# catalog identities and eligibility', () => {
  assert.deepEqual(getGameRoster('GSD1').map(({id,name,eligible})=>({id,name,eligible})), current.s1Catalog);
  assert.deepEqual(getGameRoster('GSD2').map(({id,name,slotCost,eligible,fixedEligible})=>({id,name,slotCost,eligible,fixedEligible})), current.s2Catalog);
  assert.equal(GSD2_CATALOG.sourceSha256, current.s2CatalogSourceSha256);
  assert.equal(getCombatPool('GSD1').length, 75);
  assert.equal(getCombatPool('GSD2').length, 78);
});

test('152 vectors from actual packaged C# cores match complete browser mappings, fixed rosters and fingerprints', async () => {
  for (const row of current.vectors) {
    const p = await generateAdventure(row.seed, { game: row.game, mode: row.mode,
      includeTir: row.protagonist, includeProtagonist: row.protagonist,
      companions: row.game === 'GSD2' ? [2,3,4,5,6] : [0,1,2,3,4] });
    assert.equal(p.fingerprint, row.fingerprint);
    assert.equal(p.profileId, row.profileId);
    assert.deepEqual(mapping(p), row.assignments);
    assert.deepEqual(ids(p), row.heroes);
  }
});

test('all 24 published S1 golden profiles retain mappings and fingerprints under every joining weapon policy', async () => {
  for (const row of (await fixture('new-gsd1-v087-golden.json')).cases) {
    for (const joiningWeaponLevel of Object.keys(getJoiningWeaponLevels('GSD1'))) {
      const p = await generateAdventure(row.seed, {...row.options, joiningWeaponLevel});
      assert.equal(p.fingerprint, row.expected.fingerprint);
      assert.deepEqual(mapping(p), mapping(row.expected));
      assert.deepEqual(ids(p), ids(row.expected));
    }
  }
});

test('both game defaults and all mode/start/policy/protagonist variants export exact partial launcher presets and roundtrip links', async () => {
  for (const game of ['GSD1','GSD2']) {
    assert.equal(getProfileMetadata(game).pluginVersion, '0.14.3');
    assert.equal((await generateAdventure('defaults',{game})).joiningWeaponLevel, game === 'GSD2' ? 'RiouVariance' : 'TirVariance');
    for (const mode of ['Shuffle','FixedChosen','FixedRandom'])
      for (const startPoint of Object.keys(getStartPoints(game)))
        for (const joiningWeaponLevel of Object.keys(getJoiningWeaponLevels(game)))
          for (const protagonist of [false,true]) {
            const p = await generateAdventure('quotes-"\'=#;星', {game,mode,startPoint,joiningWeaponLevel,
              includeTir:protagonist,includeProtagonist:protagonist,companions:game==='GSD2'?[2,3,4,5,6]:[0,1,2,3,4]});
            const preset = await createLauncherPreset(p);
            assert.equal(preset.schema,'stars-of-destiny-settings-v1');
            const file = game==='GSD2'?'agilen.suikoden2.recruitment_randomizer.cfg':'agilen.suikoden.recruitment_randomizer.cfg';
            assert.deepEqual(Object.keys(preset.configFiles),[file]);
            const ini = preset.configFiles[file];
            assert.equal(ini,await configFor(p));
            assert.ok(ini.includes('Seed = '+p.seed+'\r\n'));
            assert.ok(ini.includes('Mode = '+mode+'\r\n'));
            assert.ok(ini.includes('JoiningWeaponLevel = '+joiningWeaponLevel+'\r\n'));
            assert.ok(ini.includes('Point = '+startPoint+'\r\n'));
            assert.ok(!ini.includes('[Battle]') && !ini.includes('[Treasure]') && !ini.includes('[Interface]'));
            const link = settingsUrl(p,'https://suikodenrand.github.io/?discard=1');
            assert.equal(link.searchParams.has('discard'),false);
            const restored = await generateAdventure(p.seed,readSettingsUrl(link));
            assert.equal(restored.fingerprint,p.fingerprint);
            assert.equal(restored.startPoint,p.startPoint);
            assert.equal(restored.joiningWeaponLevel,p.joiningWeaponLevel);
            assert.deepEqual(restored.companionIds,p.companionIds);
            assert.equal(restored.includeTir,p.includeTir);
            assert.equal(restored.includeProtagonist,p.includeProtagonist);
            assert.match(presetFilename(p),/^StarsOfDestiny-0\.14\.3-SuikodenII?-[a-f0-9]{12}-Settings\.json$/);
            assert.ok(profileCsv(p).includes('Joining weapon policy'));
          }
  }
});

test('published singular weapon parameter and legacy S1 links remain valid', async () => {
  for (const weapon of ['TirVariance','MatchRole','Level1']) {
    const options=readSettingsUrl('https://suikodenrand.github.io/?seed=old&tir=1&start=BeforeViktor&weapon='+weapon);
    assert.equal(options.game,'GSD1');
    assert.equal(options.joiningWeaponLevel,weapon);
    assert.equal(options.includeTir,true);
    assert.equal((await generateAdventure(options.seed,options)).startPoint,'BeforeViktor');
  }
});

test('preset strings preserve launcher-parsed literal seed roundtrips', async () => {
  for (const row of current.iniRoundtrips) {
    assert.equal(row.read,row.seed);
    assert.equal(row.applied,row.seed);
    for (const game of ['GSD1','GSD2']) {
      const p=await generateAdventure(row.seed,{game});
      assert.ok((await configFor(p)).includes('Seed = '+row.seed+'\r\n'));
      assert.equal(normalizeSeed(row.seed),row.seed);
    }
  }
});

test('bad games, cross-game starts/weapons, malformed seeds and forged profiles are rejected', async () => {
  for (const game of ['GSD1','GSD2']) {
    for (const joiningWeaponLevel of [null,true,'','Donor',game==='GSD2'?'TirVariance':'RiouVariance'])
      await assert.rejects(generateAdventure('x',{game,joiningWeaponLevel}),/joining weapon level/);
    await assert.rejects(generateAdventure('x',{game,mode:'Nuzlocke'}));
    await assert.rejects(generateAdventure('x',{game,startPoint:game==='GSD2'?'BeforeViktor':'ViktorCamp'}));
    for (const seed of ['x\ny','x\ry','x\0y','x\\y','\ud800']) await assert.rejects(generateAdventure(seed,{game}));
    const p=await generateAdventure('seed',{game});
    await assert.rejects(createLauncherPreset({...p,seed:'changed'}),/preview changed/);
    await assert.rejects(createLauncherPreset({...p,fingerprint:'0'.repeat(64)}),/preview changed/);
    await assert.rejects(createLauncherPreset({...p,assignments:p.assignments.map((row,index)=>index?row:{...row,donorId:-1})}),/preview changed/);
    assert.throws(()=>validateCompanions([2,3,4,5,2],game));
  }
  for (const query of ['game=bad','game=GSD2&weapon=TirVariance','game=GSD2&start=BeforeViktor','weapon=RiouVariance','mode=Nuzlocke','mode=FixedChosen&companions=0,1,2,3,x'])
    assert.throws(()=>readSettingsUrl('https://suikodenrand.github.io/?seed=x&'+query));
});
