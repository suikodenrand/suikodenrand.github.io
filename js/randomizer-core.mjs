/**
 * Browser port of SuikodenRandomizer.Core avatar shuffle and fixed roster profiles.
 * Keep algorithm IDs, roster IDs, BinaryWriter serialization and policy strings
 * stable: they identify the exact mapping that the installed plugin generates.
 * Tests compare complete mappings and fingerprints with the actual C# Core.
 */
import { sha256Bytes } from "./sha256.mjs";

const NAMES = Object.freeze([
  "Eileen", "Cleo", "Gremio", "Camille", "Kirkis", "Mose", "Pahn", "Luikan", "Tir McDohl",
  "Sylvina", "Sonya", "Anji", "Varkas", "Ronnie Bell", "Kuromimi", "Krin", "Kasim", "Flik",
  "Fukien", "Futch", "Gen", "Humphrey", "Kage", "Kasumi", "Kun To", "Kwanda Rosman", "Luc",
  "Mathiu", "Milich", "Milia", "Lepant", "Sydonia", "Tai Ho", "Tengaar", "Tesla", "Viktor",
  "Valeria", "Warren", "Yam Koo", "Juppo", "Kessler", "Leonardo", "Griffith", "Kanak",
  "Giovanni", "Kimberly", "Marie", "Lorelai", "Alen", "Grenshiel", "Vincent De Boule", "Rubi",
  "Morgan", "Clive", "Sarah", "Fuma", "Lotte", "Esmeralda", "Templeton", "Hellion", "Apple",
  "Mina", "Sheena", "Hix", "Crowley", "Fu Su Lu", "Eikei", "Kamandol", "Quincy", "Meese",
  "Maas", "Mace", "Moose", "Blackman", "Kreutz", "Stallion", "Meg", "Joshua", "Ledon",
  "Taggart", "Gon", "Kirke", "Maximillian", "Sancho", "Georges", "Roc", "Melodye", "Window",
  "Gaspar", "Onil", "Zen", "Kai", "Sergei", "Hugo", "Ivanov", "Sansuke", "Jabba", "Viki",
  "Qlon", "Jeane", "Kasios", "Antonio", "Lester", "Marco", "Chapman", "Chandler",
  "Leon Silverberg", "Pesmerga", "Ted", "Odessa"
]);

const ROLE_IDS = Object.freeze([
  0,1,2,3,4,5,6,7,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,25,26,28,29,30,31,32,
  33,35,36,37,38,39,40,41,42,43,45,47,48,49,51,52,53,54,55,56,59,61,62,63,64,65,66,
  67,68,69,70,71,72,73,74,75,76,80,81,91,92,95,101,102,107
]);
const ROLE_SET = new Set(ROLE_IDS);
const PROTECTED_IDS = new Set([8, 108, 109]);

export const PROFILE_METADATA = Object.freeze({
  pluginVersion: "0.8.14",
  profileId: "combat-avatar-shuffle-v1",
  version: 1,
  algorithm: "sha256-splitmix64-fisher-yates-v1",
  startPolicy: "donor-live-start-once",
  progressionPolicy: "donor-live-start-once-canonical-save-replay-v1",
  defaultSeed: "agilen-080",
  maximumSeedLength: 128,
  eligibleRoleCount: 75,
  excludedAsRolesAndDonors: true,
  selfAssignmentsAllowed: true
});

export const ROSTER = Object.freeze(NAMES.map((name, id) => Object.freeze({
  id, name, eligible: ROLE_SET.has(id), protected: PROTECTED_IDS.has(id)
})));
export const COMBAT_POOL = Object.freeze(ROSTER.filter(hero => hero.eligible));
export const PROTECTED_HEROES = Object.freeze(ROSTER.filter(hero => hero.protected));
export const NON_COMBAT_HEROES = Object.freeze(ROSTER.filter(hero => !hero.eligible && !hero.protected));

export const MODES = Object.freeze({ Shuffle: "Character Shuffle", FixedChosen: "Fixed Roster", FixedRandom: "Random Roster" });
export const START_POINTS = Object.freeze({ Opening: "Normal Opening", BeforeViktor: "Before Viktor" });
export const JOINING_WEAPON_LEVELS = Object.freeze({ TirVariance: "Match Tir at first join (±3)", MatchRole: "Match original character", Level1: "Level 1" });
export const COMPANION_COUNT = 5;
const TIR_ID = 8;
const TIR_PROFILE_ID = "combat-avatar-shuffle-with-tir-v1";
const ROLE_IDS_WITH_TIR = Object.freeze([...ROLE_IDS.slice(0, 8), TIR_ID, ...ROLE_IDS.slice(8)]);
const FIXED_PROFILE_ID = "fixed-roster-v1";

// String.Trim uses .NET Char.IsWhiteSpace, which differs from JavaScript trim:
// .NET trims U+0085 but preserves U+FEFF. Length limits count UTF-16 code units.
const DOTNET_EDGE_WHITESPACE = /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;

export function normalizeSeed(value) {
  if (typeof value !== "string") throw new TypeError("Enter a seed as text.");
  if (value.length > PROFILE_METADATA.maximumSeedLength) {
    throw new RangeError("Seed exceeds 128 characters.");
  }
  const trimmed = value.replace(DOTNET_EDGE_WHITESPACE, "");
  // .NET normalization rejects malformed UTF-16; JS normalize does not.
  for (let index = 0; index < trimmed.length; index++) {
    const code = trimmed.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = trimmed.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError("Seed contains invalid Unicode text.");
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("Seed contains invalid Unicode text.");
    }
  }
  const normalized = trimmed.normalize("NFC");
  if (!normalized.length || normalized.length > PROFILE_METADATA.maximumSeedLength) {
    throw new RangeError("Seed must contain 1 to 128 characters.");
  }
  if (/[\u0000-\u001f\u007f-\u009f]/.test(normalized)) {
    throw new TypeError("Seed cannot contain control characters.");
  }
  return normalized;
}

const utf8 = new TextEncoder();
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
const unsigned64 = value => BigInt.asUintN(64, value);

function stableRandom(initialHash) {
  let state = 0n;
  for (let index = 0; index < 8; index++) state |= BigInt(initialHash[index]) << BigInt(index * 8);
  const next64 = () => {
    state = unsigned64(state + 0x9e3779b97f4a7c15n);
    let value = unsigned64((state ^ (state >> 30n)) * 0xbf58476d1ce4e5b9n);
    value = unsigned64((value ^ (value >> 27n)) * 0x94d049bb133111ebn);
    return value ^ (value >> 31n);
  };
  return maximum => {
    const bound = BigInt(maximum);
    const threshold = unsigned64(-bound) % bound;
    let value;
    do { value = next64(); } while (value < threshold);
    return Number(value % bound);
  };
}

function fingerprintBytes(seed, roleIds, donors, profileId) {
  const result = [];
  const int32 = value => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setInt32(0, value, true);
    result.push(...bytes);
  };
  const string = value => {
    const bytes = utf8.encode(value);
    let length = bytes.length;
    while (length >= 128) { result.push((length & 127) | 128); length >>>= 7; }
    result.push(length, ...bytes);
  };
  string(profileId);
  int32(PROFILE_METADATA.version);
  string(PROFILE_METADATA.algorithm);
  string(seed);
  string(PROFILE_METADATA.startPolicy);
  string(PROFILE_METADATA.progressionPolicy);
  int32(roleIds.length);
  roleIds.forEach((role, index) => { int32(role); int32(donors[index]); });
  return new Uint8Array(result);
}

export async function generateProfile(value, includeTir = false) {
  const seed = normalizeSeed(value);
  const roleIds = includeTir ? ROLE_IDS_WITH_TIR : ROLE_IDS;
  const profileId = includeTir ? TIR_PROFILE_ID : PROFILE_METADATA.profileId;
  const initialHash = await sha256Bytes(utf8.encode(PROFILE_METADATA.algorithm + "\n" + seed));
  const next = stableRandom(initialHash);
  const donors = [...roleIds];
  for (let index = donors.length - 1; index > 0; index--) {
    const other = next(index + 1);
    [donors[index], donors[other]] = [donors[other], donors[index]];
  }
  const fingerprint = hex(await sha256Bytes(fingerprintBytes(seed, roleIds, donors, profileId)));
  const assignments = Object.freeze(roleIds.map((roleId, index) => Object.freeze({
    roleId, roleName: NAMES[roleId], donorId: donors[index], donorName: NAMES[donors[index]]
  })));
  return Object.freeze({
    seed, fingerprint,
    profileId,
    algorithm: PROFILE_METADATA.algorithm,
    startPolicy: PROFILE_METADATA.startPolicy,
    progressionPolicy: PROFILE_METADATA.progressionPolicy,
    assignments
  });
}

export function validateCompanions(ids) {
  if (!Array.isArray(ids) || ids.length !== COMPANION_COUNT || new Set(ids).size !== COMPANION_COUNT
      || ids.some(id => !ROLE_SET.has(id))) {
    throw new Error("Choose five distinct combat heroes. Tir is already included.");
  }
}

export async function generateAdventure(value, { mode = "Shuffle", companions = [], startPoint = "Opening", includeTir = false, joiningWeaponLevel = "TirVariance" } = {}) {
  if (!Object.hasOwn(MODES, mode)) throw new Error("Choose a roster mode.");
  if (!Object.hasOwn(START_POINTS, startPoint)) throw new Error("Choose a start point.");
  if (!Object.hasOwn(JOINING_WEAPON_LEVELS, joiningWeaponLevel)) throw new Error("Choose a joining weapon level.");
  const seed = normalizeSeed(value);
  if (seed.includes("\\")) throw new Error("Backslashes are not supported in installer seeds. Choose another character.");

  if (typeof includeTir !== "boolean") throw new Error("Choose whether to include Tir.");
  if (mode === "Shuffle") return Object.freeze({ ...await generateProfile(seed, includeTir), mode, startPoint, includeTir, joiningWeaponLevel });

  let companionIds;
  if (mode === "FixedChosen") {
    validateCompanions(companions);
    companionIds = [...companions];
  } else {
    const shuffle = await generateProfile(seed);
    companionIds = shuffle.assignments.slice(0, COMPANION_COUNT).map(row => row.donorId);
  }
  const heroIds = [TIR_ID, ...companionIds];
  const fingerprint = hex(await sha256Bytes(utf8.encode(FIXED_PROFILE_ID + "\n" + heroIds.join(","))));
  return Object.freeze({
    seed, mode, startPoint, includeTir: false, joiningWeaponLevel, fingerprint, profileId: FIXED_PROFILE_ID,
    algorithm: mode === "FixedRandom" ? PROFILE_METADATA.algorithm : undefined,
    companionIds: Object.freeze(companionIds),
    heroes: Object.freeze(heroIds.map(id => ROSTER[id]))
  });
}
