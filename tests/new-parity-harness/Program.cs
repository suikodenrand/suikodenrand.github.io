
using System.Security.Cryptography;
using System.Text.Json;
using SuikodenRandomizer.Core;
using SuikodenRandomizer.Core.Avatars;
using SuikodenRandomizer.Core.Suikoden2;
using StarsOfDestiny.Launcher.Core;
var seeds = new[] { "first-adventure", "stars-of-destiny", "agilen-080", "星たち-é", "quoted-\"seed", "\uFEFFA=B;#'\uFEFF", "a\u2028b" }.Concat(Enumerable.Range(0, 12).Select(i => "parity-0.14.3-" + i)).ToArray();
var vectors = new List<object>();
foreach (string seed in seeds) foreach (string game in new[] { "GSD1", "GSD2" })
{
 foreach (bool protagonist in new[] {false, true})
 {
  if(game == "GSD1") { var p=AvatarShuffleProfile.Create(seed, protagonist); vectors.Add(new {game, seed, mode="Shuffle", protagonist, fingerprint=p.Fingerprint, profileId=p.ProfileId, assignments=p.RoleIds.Select(id => new[] {id,p.GetDonor(id)}).ToArray(), heroes=Array.Empty<int>()}); }
  else { var p=Gsd2AvatarProfile.Create(seed, protagonist); vectors.Add(new {game, seed, mode="Shuffle", protagonist, fingerprint=p.Fingerprint, profileId=p.ProfileId, assignments=p.RoleIds.Select(id=>new[] {id,p.GetDonor(id)}).ToArray(), heroes=Array.Empty<int>()}); }
 }
 foreach (string mode in new[]{"FixedChosen", "FixedRandom"})
 {
  if(game == "GSD1") { var p=mode=="FixedChosen" ? FixedRosterProfile.CreateChosen(new[]{0,1,2,3,4}) : FixedRosterProfile.CreateRandom(seed); vectors.Add(new {game,seed,mode,protagonist=false,fingerprint=p.Fingerprint,profileId=FixedRosterProfile.CurrentProfileId,assignments=Array.Empty<int[]>(),heroes=p.HeroIds.ToArray()}); }
  else { var p=mode=="FixedChosen" ? Gsd2AvatarProfile.CreateChosen(seed,new[]{2,3,4,5,6}) : Gsd2AvatarProfile.CreateRandom(seed); vectors.Add(new {game,seed,mode,protagonist=false,fingerprint=p.Fingerprint,profileId=p.ProfileId,assignments=Array.Empty<int[]>(),heroes=p.HeroIds.ToArray()}); }
 }
}
var hashes = new[]{typeof(AvatarShuffleProfile).Assembly, typeof(Gsd2AvatarProfile).Assembly}.Select(a => new {file=Path.GetFileName(a.Location),sha256=Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(a.Location))).ToLowerInvariant()}).ToArray();
var ini = seeds.Select(seed => { var document=IniDocument.Parse("[Shuffle]\r\nSeed = "+seed+"\r\n");string read=document.Get("Shuffle","Seed");var target=IniDocument.Parse("[Shuffle]\r\nSeed = previous\r\n"); target.Set("Shuffle","Seed",read);return new {seed,read,applied=target.Get("Shuffle","Seed")};}).ToArray();
var proof = new {schema="stars-current-core-browser-vectors-v1",packageVersion="0.14.3",assemblies=hashes,vectors,
 s1Catalog=Enumerable.Range(0,110).Select(id => new{id,name=CombatCatalog.GetName(id),eligible=CombatCatalog.IsNormalCombat(id)}),
 s2Catalog=Gsd2CharacterCatalog.AllCharacters.Select(c => new{id=c.Id,name=c.Name,slotCost=c.SlotCost,eligible=c.IsNormalCombat,fixedEligible=c.IsFixedCompanion}),
 s2CatalogSourceSha256=Gsd2CharacterCatalog.SourceSha256,iniRoundtrips=ini};
File.WriteAllText(args[0],JsonSerializer.Serialize(proof,new JsonSerializerOptions{WriteIndented=true}));
Console.WriteLine($"Wrote {vectors.Count} current packaged-core vectors and both catalogs.");
