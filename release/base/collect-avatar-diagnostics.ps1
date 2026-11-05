#requires -Version 5.1
[CmdletBinding()]
param([string]$GamePath)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$stage=$null
try {
    $running=@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'Suikoden I and II*' })
    if ($running.Count -gt 0) { throw 'Close Suikoden before collecting the completed shuffle diagnostics.' }
    if ([string]::IsNullOrWhiteSpace($GamePath)) {
        Add-Type -AssemblyName System.Windows.Forms
        $dialog=New-Object System.Windows.Forms.FolderBrowserDialog
        $dialog.Description='Select the Suikoden game folder used for Story Avatars 75 Shuffle.'
        $dialog.ShowNewFolderButton=$false
        try {
            if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw 'Collection cancelled.' }
            $GamePath=$dialog.SelectedPath
        } finally { $dialog.Dispose() }
    }
    $GamePath=(Resolve-Path -LiteralPath $GamePath).ProviderPath
    if (-not (Test-Path -LiteralPath (Join-Path $GamePath 'GameAssembly.dll') -PathType Leaf)) { throw 'GameAssembly.dll is missing from the selected folder.' }
    $tag='srr-avatar-diagnostics-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)
    $stage=Join-Path ([IO.Path]::GetTempPath()) $tag
    New-Item -ItemType Directory -Path $stage | Out-Null
    $sources=@(
        @('BepInEx\LogOutput.log','LogOutput.log'),
        @('BepInEx\config\SuikodenRandomizer\avatar-shuffle\avatar-shuffle.log','avatar-shuffle.log')
    )
    $copied=New-Object 'System.Collections.Generic.List[object]'
    foreach ($pair in $sources) {
        $source=Join-Path $GamePath $pair[0]
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
        $info=Get-Item -LiteralPath $source
        if ($info.Length -gt 32MB) { throw "Log is larger than the collector's 32 MB limit: $($pair[1])" }
        $target=Join-Path $stage $pair[1]
        Copy-Item -LiteralPath $source -Destination $target
        $copied.Add([ordered]@{name=$pair[1];bytes=$info.Length;sha256=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()})
    }
    $bindingRoot=Join-Path $GamePath 'BepInEx\config\SuikodenRandomizer\avatar-shuffle\save-bindings'
    if (Test-Path -LiteralPath $bindingRoot -PathType Container) {
        $bindings=@(Get-ChildItem -LiteralPath $bindingRoot -Filter '*.json' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 200)
        if ($bindings.Count -gt 0) { New-Item -ItemType Directory -Path (Join-Path $stage 'bindings') | Out-Null }
        foreach ($file in $bindings) {
            if ($file.Length -gt 65536) { throw 'A shuffle binding exceeds its documented 64 KiB size limit.' }
            Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $stage ('bindings\'+$file.Name))
        }
    }
    # Read metadata without loading or executing the plugin. Keep this separate
    # from the collector label: running an old ZIP must remain visible.
    $plugin=Join-Path $GamePath 'BepInEx\plugins\SuikodenRandomizer\SuikodenRandomizer.dll'
    $installedVersion=$null
    $installedHash=$null
    $installedMetadataError=$null
    if (Test-Path -LiteralPath $plugin -PathType Leaf) {
        $installedHash=(Get-FileHash -LiteralPath $plugin -Algorithm SHA256).Hash.ToLowerInvariant()
        try { $installedVersion=[Reflection.AssemblyName]::GetAssemblyName($plugin).Version.ToString() }
        catch { $installedMetadataError=$_.Exception.GetType().Name }
    }
    $runtimeStartup=$null
    $runtimeLog=Join-Path $stage 'LogOutput.log'
    if (Test-Path -LiteralPath $runtimeLog -PathType Leaf) {
        $startup=Select-String -LiteralPath $runtimeLog -Pattern '\[SRR AVATAR\].*\b[0-9]+\.[0-9]+\.[0-9]+\b.*loaded' | Select-Object -Last 1
        if ($null -ne $startup) { $runtimeStartup=$startup.Line }
    }
    $manifest=[ordered]@{schema='srr-avatar-shuffle-diagnostics-v1';createdUtc=[DateTime]::UtcNow.ToString('o');collectorVersion='0.8.4';profile='combat-avatar-shuffle-v1';installedPluginAssemblyVersion=$installedVersion;installedPluginSha256=$installedHash;installedPluginMetadataError=$installedMetadataError;latestRuntimeStartup=$runtimeStartup;logs=$copied;note='Only diagnostic logs, installed plugin metadata and shuffle binding metadata are collected. Native save contents and full config files are not collected.'}
    [IO.File]::WriteAllText((Join-Path $stage 'collection.json'),($manifest|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
    $desktop=[Environment]::GetFolderPath('Desktop')
    if ([string]::IsNullOrWhiteSpace($desktop)) { $desktop=$PSScriptRoot }
    $output=Join-Path $desktop ($tag+'.zip')
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stage,$output)
    Write-Host "Created: $output"
    Write-Host 'Send this ZIP with the stage you tested and what happened on screen.'
} catch {
    Write-Host ('Collection failed: '+$_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    if ($null -ne $stage -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
