import { GSD2_CATALOG } from './gsd2-catalog.mjs?v=0.14.3';
import { sha256Bytes } from './sha256.mjs';

export const GSD2_METADATA = Object.freeze({
  pluginVersion: '0.14.3', version: 1,
  profileId: 'gsd2-combat-avatar-shuffle-v1',
  protagonistProfileId: 'gsd2-combat-avatar-shuffle-with-protagonist-v1',
  fixedProfileId: 'gsd2-fixed-roster-v1',
  algorithm: 'sha256-splitmix64-footprint-fisher-yates-v1',
  startPolicy: 'gsd2-canonical-role-donor-start-once-v1',
  progressionPolicy: 'gsd2-canonical-role-save-bound-v1',
  maximumSeedLength: 128, eligibleRoleCount: 78, fixedCompanionCount: 74,
  selfAssignmentsAllowed: true
});
export const GSD2_START_POINTS = Object.freeze({ Opening: 'Normal Opening', ViktorCamp: 'Viktor’s camp' });
export const GSD2_CAMP_START_HELP = 'Start in Viktor’s camp after Pohl’s instructions and box demonstration, before completing the chores.';
export const GSD2_ROSTER = Object.freeze(GSD2_CATALOG.characters.map(hero => Object.freeze({ ...hero })));
export const GSD2_COMBAT_POOL = Object.freeze(GSD2_ROSTER.filter(hero => hero.eligible));
export const GSD2_FIXED_POOL = Object.freeze(GSD2_ROSTER.filter(hero => hero.fixedEligible));

export function createGsd2Generators({ normalizeSeed, stableRandom, fingerprintBytes, utf8, hex }) {
  const byId = new Map(GSD2_ROSTER.map(hero => [hero.id, hero]));
  const roleIds = GSD2_COMBAT_POOL.map(hero => hero.id);
  const singleIds = new Set(GSD2_FIXED_POOL.map(hero => hero.id));
  const protagonistId = GSD2_CATALOG.protagonistId;

  function validateCompanions(ids) {
    if (!Array.isArray(ids) || ids.length !== 5 || new Set(ids).size !== 5 || ids.some(id => !singleIds.has(id))) {
      throw new Error('Choose five distinct single-slot Suikoden II companions. The hero is reserved; two-slot units are Shuffle-only.');
    }
  }

  async function generateProfile(value, includeProtagonist = false) {
    const seed = normalizeSeed(value);
    if (seed.includes('\\')) throw new Error('Backslashes are not supported in installer seeds.');
    if (typeof includeProtagonist !== 'boolean') throw new Error('Choose whether to include the protagonist.');
    const roles = [...roleIds, ...(includeProtagonist ? [protagonistId] : [])].sort((a, b) => a - b);
    const hash = await sha256Bytes(utf8.encode(GSD2_METADATA.algorithm + '\n' + seed));
    const next = stableRandom(hash);
    const donorsByRole = new Map();
    for (const slotCost of [1, 2]) {
      const group = roles.filter(id => byId.get(id).slotCost === slotCost);
      const donors = [...group];
      for (let index = donors.length - 1; index > 0; index--) {
        const other = next(index + 1);
        [donors[index], donors[other]] = [donors[other], donors[index]];
      }
      group.forEach((role, index) => donorsByRole.set(role, donors[index]));
    }
    const profileId = includeProtagonist ? GSD2_METADATA.protagonistProfileId : GSD2_METADATA.profileId;
    const donors = roles.map(id => donorsByRole.get(id));
    const fingerprint = hex(await sha256Bytes(fingerprintBytes(seed, roles, donors, profileId, GSD2_METADATA)));
    return Object.freeze({ game: 'GSD2', seed, fingerprint, profileId,
      algorithm: GSD2_METADATA.algorithm, startPolicy: GSD2_METADATA.startPolicy,
      progressionPolicy: GSD2_METADATA.progressionPolicy,
      assignments: Object.freeze(roles.map((roleId, index) => Object.freeze({
        roleId, roleName: byId.get(roleId).displayName, donorId: donors[index],
        donorName: byId.get(donors[index]).displayName
      }))) });
  }

  async function generateAdventure(value, { mode = 'Shuffle', companions = [], startPoint = 'Opening', includeProtagonist = false } = {}) {
    if (!['Shuffle', 'FixedChosen', 'FixedRandom'].includes(mode)) throw new Error('Choose a roster mode.');
    if (!Object.hasOwn(GSD2_START_POINTS, startPoint)) throw new Error('Choose a Suikoden II start point.');
    const seed = normalizeSeed(value);
    if (seed.includes('\\')) throw new Error('Backslashes are not supported in installer seeds. Choose another character.');
    if (typeof includeProtagonist !== 'boolean') throw new Error('Choose whether to include the protagonist.');
    if (mode === 'Shuffle') return Object.freeze({ ...await generateProfile(seed, includeProtagonist), mode, startPoint, includeProtagonist });
    let companionIds;
    if (mode === 'FixedChosen') { validateCompanions(companions); companionIds = [...companions]; }
    else {
      const shuffle = await generateProfile(seed);
      companionIds = shuffle.assignments.filter(row => singleIds.has(row.roleId)).slice(0, 5).map(row => row.donorId);
    }
    const heroIds = [protagonistId, ...companionIds];
    const fingerprint = hex(await sha256Bytes(utf8.encode(GSD2_METADATA.fixedProfileId + '\n' + heroIds.join(','))));
    return Object.freeze({ game: 'GSD2', seed, mode, startPoint, includeProtagonist: false, fingerprint,
      profileId: GSD2_METADATA.fixedProfileId,
      algorithm: mode === 'FixedRandom' ? GSD2_METADATA.algorithm : undefined,
      companionIds: Object.freeze(companionIds), heroes: Object.freeze(heroIds.map(id => byId.get(id))) });
  }
  return { generateProfile, generateAdventure, validateCompanions };
}
