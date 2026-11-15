using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using StarsOfDestiny.Launcher.Core;
using OpenFileDialog = ImportProbe.FileDialog;
using DialogResult = ImportProbe.DialogResult;
namespace ImportProbe;
internal sealed partial class MainForm
{
    private static IEnumerable<(string Section, string Key, string Value)> Entries(string text)
    {
        string section = "";
        foreach (string line in text.Split('\n'))
        {
            string trimmed = line.Trim();
            if (trimmed.StartsWith('[') && trimmed.EndsWith(']')) { section = trimmed[1..^1]; continue; }
            if (trimmed.StartsWith('#') || trimmed.StartsWith(';')) continue;
            int equals = trimmed.IndexOf('=');
            if (equals > 0) yield return (section, trimmed[..equals].Trim(), trimmed[(equals + 1)..].Trim());
        }
    }

    private void ImportPreset()
    {
        if (_workspace is null) return;
        using var dialog = new OpenFileDialog { Filter = "Stars of Destiny settings (*.json)|*.json" };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        try
        {
            if (new FileInfo(dialog.FileName).Length > 1024 * 1024) throw new InvalidDataException("The settings preset is too large.");
            using var json = JsonDocument.Parse(File.ReadAllText(dialog.FileName), new JsonDocumentOptions { MaxDepth = 5 });
            if (json.RootElement.GetProperty("schema").GetString() != "stars-of-destiny-settings-v1") throw new InvalidDataException("Unsupported settings preset.");
            var staged = new Dictionary<string, IniDocument>(StringComparer.OrdinalIgnoreCase);
            foreach (var file in json.RootElement.GetProperty("configFiles").EnumerateObject())
            {
                if (!_workspace.Documents.ContainsKey(file.Name) || !staged.TryAdd(file.Name, IniDocument.Parse(file.Value.GetString() ?? "")))
                    throw new InvalidDataException("The preset contains an unknown or repeated config file.");
            }
            var validation = _workspace.Documents.ToDictionary(pair => pair.Key, pair => staged.TryGetValue(pair.Key, out var imported) ? imported : pair.Value);
            var errors = SettingsCatalog.Validate(validation);
            if (errors.Count != 0) throw new InvalidDataException(string.Join(Environment.NewLine, errors));
            foreach (var file in staged)
                foreach (var entry in Entries(file.Value.Render())) _workspace.Documents[file.Key].Set(entry.Section, entry.Key, entry.Value);
            RebuildPages();
            _status.Text = "Preset loaded into the launcher. Apply settings to write it to the game.";
        }
        catch (Exception error) { ShowError(error); }
    }
}
