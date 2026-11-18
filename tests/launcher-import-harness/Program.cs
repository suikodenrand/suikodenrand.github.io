using System.Security.Cryptography;
using System.Text.Json;
using StarsOfDestiny.Launcher.Core;

if(args.Length is <5 or >6)throw new ArgumentException("Usage: LauncherImport <presets> <new disposable fixture root> <defaults> <unified.dll metadata input> <report.json> [source commit]");
string presets=Path.GetFullPath(args[0]),root=Path.GetFullPath(args[1]),defaults=Path.GetFullPath(args[2]),host=Path.GetFullPath(args[3]);
if(Directory.Exists(root))throw new InvalidOperationException("Use a fresh disposable fixture directory.");
Directory.CreateDirectory(root);
File.WriteAllText(Path.Combine(root,"DISPOSABLE-WEBSITE-CONFIG-TESTS.txt"),"No live game installation. Copied plugin bytes are inspected only as version metadata.");
void Require(bool condition,string message){if(!condition)throw new InvalidOperationException(message);}
string Sha(byte[] value)=>Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();
var cases=JsonSerializer.Deserialize<Case[]>(File.ReadAllText(Path.Combine(presets,"cases.json")))!;
var results=new List<object>();
foreach(var item in cases)
{
    string game=Path.Combine(root,Path.GetFileNameWithoutExtension(item.name));
    string config=Path.Combine(game,"BepInEx/config"),plugins=Path.Combine(game,"BepInEx/plugins/SuikodenRandomizer");
    Directory.CreateDirectory(config);Directory.CreateDirectory(plugins);
    File.Copy(host,Path.Combine(plugins,"SuikodenRandomizer.dll"));
    foreach(string file in SettingsCatalog.FileNames)File.Copy(Path.Combine(defaults,file),Path.Combine(config,file));
    foreach(string file in new[]{SettingsCatalog.S1File,SettingsCatalog.S2File})
    {
        var ini=IniDocument.Parse(File.ReadAllText(Path.Combine(config,file)));
        ini.Set("Shuffle","JoiningEquipment","Donor");
        File.WriteAllText(Path.Combine(config,file),ini.Render()+"\n# Keep this user's existing preference\n[Probe]\nSentinel = preserve-me\n");
    }
    string selected=item.game=="GSD1"?SettingsCatalog.S1File:SettingsCatalog.S2File;
    string id=item.game=="GSD1"?"s1":"s2";
    var before=SettingsCatalog.FileNames.ToDictionary(name=>name,name=>File.ReadAllBytes(Path.Combine(config,name)));
    var workspace=SettingsWorkspace.Load(game,()=>false);
    var textBefore=workspace.Documents.ToDictionary(pair=>pair.Key,pair=>pair.Value.Render());
    workspace.StagePreset(File.ReadAllText(Path.Combine(presets,item.name)));
    Require(workspace.Get(id+".joiningEquipment")==item.expectedInventoryPolicy,"Inventory policy changed: "+item.name);
    Require(workspace.Get(id+".joiningWeaponLevel")==item.joiningWeaponLevel,"Independent weapon choice changed.");
    Require(workspace.Get(id+".seed")==item.seed && workspace.Get(id+".mode")==item.mode,"Selected seed/mode changed.");
    Require(workspace.Documents[selected].Get("Probe","Sentinel")=="preserve-me","Partial import removed an existing field.");
    Require(workspace.Validate().Count==0,"Packaged validator rejected website settings.");
    foreach(string file in SettingsCatalog.FileNames)
    {
        Require(File.ReadAllBytes(Path.Combine(config,file)).SequenceEqual(before[file]),"Import wrote a file before Apply.");
        if(file!=selected)Require(workspace.Documents[file].Render()==textBefore[file],"Import changed another config document.");
    }
    var saved=workspace.SaveChanges();
    Require(saved.ChangedFiles.SequenceEqual(new[]{selected}),"Apply changed another config.");
    foreach(string file in SettingsCatalog.FileNames.Where(file=>file!=selected))
        Require(File.ReadAllBytes(Path.Combine(config,file)).SequenceEqual(before[file]),"Apply changed another config's bytes.");
    var restored=SettingsWorkspace.Load(game,()=>false);
    Require(restored.Get(id+".joiningEquipment")==item.expectedInventoryPolicy,"Inventory policy did not survive save/reload.");
    Require(restored.Get(id+".seed")==item.seed,"Literal seed did not survive save/reload.");
    Require(saved.BackupDirectory is not null && File.ReadAllBytes(Path.Combine(saved.BackupDirectory,selected)).SequenceEqual(before[selected]),"Original config backup differs.");
    results.Add(new{item.name,item.game,item.mode,item.joiningEquipment,exactImportPassed=true,onlySelectedConfigWritten=true,unknownFieldsPreserved=true,originalBackupVerified=true,saveReloadPassed=true});
}
var assemblies=new[]{typeof(SettingsWorkspace).Assembly,typeof(SuikodenRandomizer.Core.Avatars.AvatarShuffleProfile).Assembly,typeof(SuikodenRandomizer.Core.Suikoden2.Gsd2AvatarProfile).Assembly}
    .Select(assembly=>new{file=Path.GetFileName(assembly.Location),sha256=Sha(File.ReadAllBytes(assembly.Location))});
File.WriteAllText(args[4],JsonSerializer.Serialize(new{schema="stars-website-launcher-preset-import-v1",status="passed",sourceCommit=args.Length>5?args[5]:null,actualPackagedAssemblies=assemblies,results,
    scope="Actual packaged launcher-core StagePreset, settings validator and workspace. Unified DLL inspected only as file-version metadata.",nativeGameExecuted=false,liveGameModified=false},new JsonSerializerOptions{WriteIndented=true})+"\n");
Console.WriteLine($"Passed {results.Count} actual packaged-launcher imports, including legacy partial presets, merge, backups, Apply and reload.");

internal sealed record Case(string name,string game,string mode,string seed,string joiningWeaponLevel,string? joiningEquipment,string expectedInventoryPolicy);
