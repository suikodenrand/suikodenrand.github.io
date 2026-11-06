#requires -Version 5.1
[CmdletBinding()]
param([string]$GamePath, [ValidateSet('Install','Rollback')][string]$Mode = 'Install')

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ProgressPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $PSScriptRoot
$Package = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json
$Cache = Join-Path $env:LOCALAPPDATA 'SRR\Installer'
$LogRoot = Join-Path $Cache 'logs'
New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
$RunTag = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$Log = Join-Path $LogRoot ($RunTag + '.log')
$Workspace = $null
$Succeeded = $false
$TranscriptStarted = $false

function Hash-File([string]$Path, [string]$Algorithm = 'SHA256') {
    return (Get-FileHash -LiteralPath $Path -Algorithm $Algorithm).Hash.ToLowerInvariant()
}
function Write-VerifiedFile([string]$Source, [string]$Target) {
    $temporary = $Target + '.srr-new-' + [Guid]::NewGuid().ToString('N')
    $previous = $Target + '.srr-old-' + [Guid]::NewGuid().ToString('N')
    try {
        Copy-Item -LiteralPath $Source -Destination $temporary
        if ((Hash-File $temporary) -ne (Hash-File $Source)) { throw 'Staged file checksum mismatch.' }
        $stream = [IO.File]::Open($temporary, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        try { $stream.Flush($true) } finally { $stream.Dispose() }
        if (Test-Path -LiteralPath $Target -PathType Leaf) {
            [IO.File]::Replace($temporary, $Target, $previous)
        } else {
            [IO.File]::Move($temporary, $Target)
        }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
        if (Test-Path -LiteralPath $previous) { Remove-Item -LiteralPath $previous -Force }
    }
}
function Write-Manifest([string]$Path, [object]$Manifest) {
    $source = $Path + '.srr-manifest-' + [Guid]::NewGuid().ToString('N')
    try {
        [IO.File]::WriteAllText($source, ($Manifest | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
        Write-VerifiedFile $source $Path
    } finally {
        if (Test-Path -LiteralPath $source) { Remove-Item -LiteralPath $source -Force }
    }
}
function Assert-GameClosed {
    $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'Suikoden I and II*' })
    if ($running.Count -gt 0) { throw 'Close Suikoden completely, then run this installer again. The installer never closes the game for you.' }
}
function Resolve-GameFolder([string]$Supplied) {
    if ([string]::IsNullOrWhiteSpace($Supplied)) {
        $hint = $null
        foreach ($key in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Steam App 1932640', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Steam App 1932640')) {
            $item = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
            if ($null -ne $item -and $null -ne $item.PSObject.Properties['InstallLocation']) { $hint = $item.InstallLocation; break }
        }
        Add-Type -AssemblyName System.Windows.Forms
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $dialog.Description = 'Select your Suikoden I and II HD Remaster game folder (contains GameAssembly.dll).'
        $dialog.ShowNewFolderButton = $false
        if ($null -ne $hint -and (Test-Path -LiteralPath $hint -PathType Container)) { $dialog.SelectedPath = $hint }
        try {
            if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw 'Installation cancelled. No game files were changed.' }
            $Supplied = $dialog.SelectedPath
        } finally { $dialog.Dispose() }
    }
    $resolved = (Resolve-Path -LiteralPath $Supplied.Trim().Trim('"') -ErrorAction Stop).ProviderPath
    return [IO.Path]::GetFullPath($resolved).TrimEnd('\')
}
function Assert-Game([string]$Folder) {
    if (-not [Environment]::Is64BitProcess) { throw 'Use 64-bit Windows PowerShell. Start Install.cmd rather than opening the script with a 32-bit editor.' }
    $native = Join-Path $Folder 'GameAssembly.dll'
    if (-not (Test-Path -LiteralPath $native -PathType Leaf)) { throw 'GameAssembly.dll was not found in the selected folder.' }
    if ((Hash-File $native) -ne $Package.gameAssemblySha256) { throw 'This native game revision is not supported. No game files were changed.' }
    if ($Mode -eq 'Rollback') { return }
    foreach ($relative in @('core\0Harmony.dll','core\BepInEx.Core.dll','core\BepInEx.Unity.IL2CPP.dll','core\Il2CppInterop.Runtime.dll','interop\GSD1.dll')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Folder ('BepInEx\' + $relative)) -PathType Leaf)) { throw "Required installed reference is missing: BepInEx\$relative. Start the game with your existing BepInEx once before upgrading." }
    }
    $expectedPluginDir = [IO.Path]::GetFullPath((Join-Path $Folder 'BepInEx\plugins\SuikodenRandomizer'))
    $pluginFiles = @()
    if (Test-Path -LiteralPath (Join-Path $Folder 'BepInEx\plugins') -PathType Container) {
        $pluginFiles = @(Get-ChildItem -LiteralPath (Join-Path $Folder 'BepInEx\plugins') -Filter '*.dll' -Recurse -File)
    }
    foreach ($dll in $pluginFiles) {
        if ($dll.Name -eq 'SuikodenRandomizer.dll' -and $dll.DirectoryName -ne $expectedPluginDir) { throw "Another standalone randomizer exists at $($dll.FullName). Move that duplicate outside BepInEx\plugins first." }
        if ($dll.Name -ieq 'Suikoden_Fix.dll' -and [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($dll.FullName)).Contains('StartingPartyVirtualizerPatch')) { throw 'An old embedded randomizer was detected in Suikoden Fix. Do not combine it with the standalone randomizer.' }
    }
}
function Invoke-Tool([string]$Exe, [string[]]$Arguments, [string]$WorkingDirectory) {
    # Avoid shell interpretation. Use Win32 argv quoting, including paths with spaces.
    $quoted = @($Arguments | ForEach-Object {
        '"' + ([regex]::Replace([regex]::Replace($_, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1')) + '"'
    })
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $Exe
    $start.Arguments = $quoted -join ' '
    $start.WorkingDirectory = $WorkingDirectory
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $proc = New-Object Diagnostics.Process
    $proc.StartInfo = $start
    try {
        [void]$proc.Start()
        $stdout = $proc.StandardOutput.ReadToEndAsync()
        $stderr = $proc.StandardError.ReadToEndAsync()
        $proc.WaitForExit()
        $outText = $stdout.GetAwaiter().GetResult()
        $errText = $stderr.GetAwaiter().GetResult()
        if ($outText) { Write-Host $outText.TrimEnd() }
        if ($errText) { Write-Host $errText.TrimEnd() }
        if ($proc.ExitCode -ne 0) { throw "Tool failed with exit code $($proc.ExitCode). No update will be installed. Full output is in $Log" }
    } finally { $proc.Dispose() }
}
function Invoke-ManagedCheck([string]$Dotnet, [string]$WorkingRoot, [string]$Name, [string[]]$CheckArguments = @()) {
    # Build one graph at a time, then execute the exact produced assembly.
    # Avoid dotnet run's implicit build/restore so all gates share this policy.
    $project=Join-Path $WorkingRoot ('tests\'+$Name+'\'+$Name+'.csproj')
    Invoke-Tool $Dotnet @('build',$project,'--configuration','Release','--nologo','-m:1','-p:RestoreBuildInParallel=false','-p:BuildInParallel=false','-p:NuGetAudit=false') $WorkingRoot
    $assembly=Join-Path $WorkingRoot ('tests\'+$Name+'\bin\Release\net10.0\'+$Name+'.dll')
    if (-not (Test-Path -LiteralPath $assembly -PathType Leaf)) { throw "Missing compiled check output: $Name" }
    $arguments=@($assembly)
    if ($null -ne $CheckArguments) { $arguments += $CheckArguments }
    Invoke-Tool $Dotnet $arguments $WorkingRoot
}
function Ensure-Toolchain {
    $sdk = $Package.sdk
    $downloadDir = Join-Path $Cache 'downloads'
    $toolDir = Join-Path $Cache ('dotnet-' + $sdk.version)
    $archive = Join-Path $downloadDir ('dotnet-sdk-' + $sdk.version + '-win-x64.zip')
    New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
    $verified = (Test-Path -LiteralPath $archive -PathType Leaf) -and ((Hash-File $archive 'SHA512') -eq $sdk.sha512)
    if (-not $verified) {
        Write-Host 'Downloading the portable Microsoft build tools. Nothing is installed system-wide.'
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $part = $archive + '.' + $RunTag + '.partial'
        $client = New-Object Net.WebClient
        try {
            $client.Headers.Add('User-Agent','SuikodenRandomizer-AutoInstaller/0.8.6-Web')
            $client.DownloadFile([string]$sdk.url, $part)
            if ((Hash-File $part 'SHA512') -ne $sdk.sha512) { throw 'Microsoft SDK checksum mismatch. The downloaded tools will NOT be run.' }
            Move-Item -LiteralPath $part -Destination $archive -Force
        } finally { $client.Dispose(); if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force } }
    }
    $dotnet = Join-Path $toolDir 'dotnet.exe'
    $ready = Join-Path $toolDir 'srr-tools-ready.txt'
    if (-not (Test-Path -LiteralPath $dotnet -PathType Leaf) -or -not (Test-Path -LiteralPath $ready -PathType Leaf)) {
        Write-Host 'Preparing the private compiler cache...'
        if (Test-Path -LiteralPath $toolDir) { Remove-Item -LiteralPath $toolDir -Recurse -Force }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory($archive, $toolDir)
        [IO.File]::WriteAllText($ready, [string]$sdk.sha512)
    }
    $env:DOTNET_ROOT = $toolDir
    $env:DOTNET_ROOT_X64 = $toolDir
    $env:DOTNET_MULTILEVEL_LOOKUP = '0'
    $env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
    $env:DOTNET_NOLOGO = '1'
    $env:DOTNET_CLI_HOME = Join-Path $Cache 'cli-home'
    $env:NUGET_PACKAGES = Join-Path $Cache 'nuget'
    $env:NuGetAudit = 'false'
    return $dotnet
}
function Backup-Targets([string]$Folder, [object[]]$Plan) {
    $backup = Join-Path $Folder ('SRR-Backups\avatar-web-086-' + $RunTag)
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    $records=@()
    foreach ($entry in $Plan) {
        $target = Join-Path $Folder $entry.relativePath
        $exists = Test-Path -LiteralPath $target -PathType Leaf
        $oldHash = $null
        if ($exists) { Copy-Item -LiteralPath $target -Destination (Join-Path $backup $entry.name); $oldHash=Hash-File (Join-Path $backup $entry.name) }
        $records += [ordered]@{name=$entry.name; relativePath=$entry.relativePath; existed=$exists; oldHash=$oldHash; newHash=(Hash-File $entry.source)}
    }
    $manifest=[ordered]@{marker='SRR-WebInstaller-086-v1';status='pending';gameAssemblySha256=$Package.gameAssemblySha256;createdUtc=[DateTime]::UtcNow.ToString('o');files=$records}
    Write-Manifest (Join-Path $backup 'manifest.json') $manifest
    return $backup
}
function Restore-Backup([string]$Folder, [string]$Backup, [bool]$Recovery) {
    $manifestPath = Join-Path $Backup 'manifest.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.marker -ne 'SRR-WebInstaller-086-v1' -or $manifest.gameAssemblySha256 -ne $Package.gameAssemblySha256) { throw 'Backup identity is not valid for this installer.' }
    $allowed=@{
        'SuikodenRandomizer.dll'='BepInEx\plugins\SuikodenRandomizer\SuikodenRandomizer.dll';
        'SuikodenRandomizer.Core.dll'='BepInEx\plugins\SuikodenRandomizer\SuikodenRandomizer.Core.dll';
        'agilen.suikoden.recruitment_randomizer.cfg'='BepInEx\config\agilen.suikoden.recruitment_randomizer.cfg'
    }
    # Validate all originals before restoring either DLL.
    foreach ($entry in $manifest.files) {
        if (-not $allowed.ContainsKey([string]$entry.name) -or $allowed[[string]$entry.name] -ne $entry.relativePath) { throw 'Unexpected path in backup manifest.' }
        if ($entry.existed -and ((Hash-File (Join-Path $Backup $entry.name)) -ne $entry.oldHash)) { throw "Backup checksum mismatch: $($entry.name)" }
        $target=Join-Path $Folder $entry.relativePath
        if (-not $Recovery -and (Test-Path -LiteralPath $target)) {
            $current=Hash-File $target
            if ($current -ne $entry.newHash -and $current -ne $entry.oldHash) { throw "Installed $($entry.name) changed since this update. Rollback stopped to avoid overwriting another release." }
        }
    }
    Assert-GameClosed
    foreach ($entry in $manifest.files) {
        $target=Join-Path $Folder $entry.relativePath
        if ($entry.existed) { Write-VerifiedFile (Join-Path $Backup $entry.name) $target }
        elseif (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
    }
    $manifest.status='rolled-back'
    Write-Manifest $manifestPath $manifest
}

function New-PresetConfig([string]$Existing, [object]$Preset) {
    # BepInEx's string converter requires quotes to be escaped. The website
    # disallows literal backslashes because they cannot round-trip here.
    $seed = [string]$Preset.seed
    if ($seed.Contains('\')) { throw 'Website seeds cannot contain backslashes. Choose another seed.' }
    $values = [ordered]@{
        Shuffle = [ordered]@{
            Seed = $seed.Replace("'", "\'").Replace('"', '\"')
            Mode = [string]$Preset.mode
            Companions = $Preset.companions -join ','
        }
        Start = [ordered]@{Point = [string]$Preset.startPoint}
    }
    $newline = "`r`n"
    if ($Existing.Contains("`n") -and -not $Existing.Contains("`r`n")) { $newline = "`n" }
    $output = [Collections.Generic.List[string]]::new()
    $seenSections = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $written = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $activeValues = $null
    foreach ($line in [regex]::Split($Existing, '\r\n|\n|\r')) {
        if ($line -match '^\s*\[([^\]]+)\]\s*$') {
            $heading = [string]$Matches[1]
            if ($null -ne $activeValues) {
                foreach ($key in $activeValues.Keys) {
                    if (-not $written.Contains($key)) { $output.Add($key + ' = ' + $activeValues[$key]) }
                }
            }
            $activeValues = $null
            $written.Clear()
            if ($heading -ceq 'Shuffle' -or $heading -ceq 'Start') {
                $activeValues = $values[$heading]
                [void]$seenSections.Add($heading)
            }
        }
        if ($null -ne $activeValues -and $line -cmatch '^\s*([^=]+?)\s*=') {
            $key = [string]$Matches[1]
            if ($activeValues.Keys -ccontains $key) {
                $output.Add($key + ' = ' + $activeValues[$key])
                [void]$written.Add($key)
                continue
            }
        }
        $output.Add($line)
    }
    if ($null -ne $activeValues) {
        foreach ($key in $activeValues.Keys) {
            if (-not $written.Contains($key)) { $output.Add($key + ' = ' + $activeValues[$key]) }
        }
    }
    foreach ($heading in $values.Keys) {
        if ($seenSections.Contains($heading)) { continue }
        if ($output.Count -gt 0 -and $output[$output.Count - 1] -ne '') { $output.Add('') }
        $output.Add('[' + $heading + ']')
        foreach ($key in $values[$heading].Keys) { $output.Add($key + ' = ' + $values[$heading][$key]) }
    }
    return ($output -join $newline)
}

function Read-WebPreset {
    $path = Join-Path $PSScriptRoot 'preset.json'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'The website preset is missing. Extract the entire generated ZIP into a fresh folder.' }
    $preset = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -eq $preset -or $preset -is [array]) { throw 'The website preset must be a JSON object.' }
    foreach ($key in @('schema','runtimeVersion','seed','mode','companions','startPoint')) {
        if ($null -eq $preset.PSObject.Properties[$key]) { throw "The website preset is missing $key." }
    }
    if ($preset.schema -cne 'srr-web-preset-v2' -or $preset.runtimeVersion -cne '0.8.6') {
        throw 'The selected website preset is not supported by this installer.'
    }
    if ($preset.seed -isnot [string]) { throw 'The website seed must be text.' }
    $seed = [string]$preset.seed
    if ($seed.Length -gt 128) { throw 'Seed exceeds 128 characters.' }
    $seed = $seed.Trim().Normalize([Text.NormalizationForm]::FormC)
    if ($seed.Length -eq 0 -or $seed.Length -gt 128) { throw 'Seed must contain 1 to 128 characters.' }
    if ($seed.Contains('\')) { throw 'Website seeds cannot contain backslashes. Choose another seed.' }
    foreach ($character in $seed.ToCharArray()) {
        if ([char]::IsControl($character)) { throw 'Seed contains a control character.' }
    }
    if ($preset.mode -isnot [string] -or $preset.mode -cnotin @('Shuffle','FixedChosen','FixedRandom')) {
        throw 'The website preset specifies an unknown roster mode.'
    }
    if ($preset.startPoint -isnot [string] -or $preset.startPoint -cnotin @('Opening','BeforeViktor')) {
        throw 'The website preset specifies an unknown start point.'
    }
    if ($preset.companions -isnot [array]) { throw 'The website preset must contain a list of companions.' }
    if ($preset.mode -ceq 'FixedChosen') {
        # IDs match the 0.8.6 Core CombatCatalog used by the plugin.
        $eligible = @(0,1,2,3,4,5,6,7,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,25,26,28,29,30,31,32,33,35,36,37,38,39,40,41,42,43,45,47,48,49,51,52,53,54,55,56,59,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,80,81,91,92,95,101,102,107)
        $seen = [Collections.Generic.HashSet[int]]::new()
        if ($preset.companions.Count -ne 5) { throw 'Choose exactly five companions. Tir is included automatically.' }
        foreach ($id in $preset.companions) {
            if (($id -isnot [int] -and $id -isnot [long]) -or $id -notin $eligible -or -not $seen.Add([int]$id)) {
                throw 'Choose five distinct eligible combat companions.'
            }
        }
    } elseif ($preset.companions.Count -ne 0) {
        throw 'Only the chosen fixed roster mode accepts companion selections.'
    }
    $preset.seed = $seed
    return $preset
}

try {
    Start-Transcript -LiteralPath $Log -Force | Out-Null
    $TranscriptStarted = $true
    Write-Host 'Suikoden Randomizer 0.8.6 - Website installer'
    Write-Host 'Unite safety: combinations involving changed combat avatars are blocked. Original story and party IDs stay canonical.'
    Write-Host 'This is a build-and-install package, not a precompiled release.'
    Write-Host 'No source editing or manual SDK installation is needed. Internet is required on first installation.'
    Write-Host 'The selected roster, seed, and start point apply when you begin a New Game.'
    Write-Host ''
    Assert-GameClosed
    $GamePath=Resolve-GameFolder $GamePath
    Assert-Game $GamePath
    $Preset = $null
    if ($Mode -eq 'Install') { $Preset = Read-WebPreset }
    if ($Mode -eq 'Rollback') {
        $backupRoot=Join-Path $GamePath 'SRR-Backups'
        $candidates=@()
        if (Test-Path -LiteralPath $backupRoot) {
            $candidates=@(Get-ChildItem -LiteralPath $backupRoot -Directory -Filter 'avatar-web-086-*' | Sort-Object Name -Descending | Where-Object {
                $f=Join-Path $_.FullName 'manifest.json'
                if (-not (Test-Path -LiteralPath $f)) { return $false }
                $m=Get-Content -LiteralPath $f -Raw | ConvertFrom-Json
                return $m.marker -eq 'SRR-WebInstaller-086-v1' -and $m.status -ne 'rolled-back'
            })
        }
        if ($candidates.Count -eq 0) { throw 'No unrestored 0.8.6 website backup was found in this game folder.' }
        Restore-Backup $GamePath $candidates[0].FullName $false
        Write-Host 'The previous plugin DLLs and configuration have been restored. Native saves and shuffle bindings were not changed.'
        $Succeeded=$true
    } else {
        # Avatar profiles are isolated; no old seed or save binding is adopted.
        $payload=Join-Path $PSScriptRoot 'payload.zip'
        if ((Hash-File $payload) -ne $Package.payloadSha256) { throw 'Installer payload checksum mismatch. Extract the ZIP again.' }
        $Workspace=Join-Path $Cache ('work\' + $RunTag)
        New-Item -ItemType Directory -Path $Workspace -Force | Out-Null
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory($payload, $Workspace)
        $dotnet=Ensure-Toolchain
        Invoke-Tool $dotnet @('--version') $Workspace
        Write-Host 'Checking the canonical-avatar native API contracts and source types...'
        Invoke-ManagedCheck $dotnet $Workspace 'SuikodenRandomizer.Avatar.Contracts' @((Join-Path $GamePath 'BepInEx\interop\GSD1.dll'))
        Write-Host 'Compiling the update against your installed game and BepInEx references...'
        $project=Join-Path $Workspace 'src\SuikodenRandomizer.AvatarPlugin\SuikodenRandomizer.AvatarPlugin.csproj'
        Invoke-Tool $dotnet @('build',$project,'--configuration','Release','--nologo','-m:1','-p:RestoreBuildInParallel=false','-p:BuildInParallel=false',('-p:GamePath='+$GamePath),'-p:NuGetAudit=false') $Workspace
        foreach ($test in @('SuikodenRandomizer.Core.SmokeTests','SuikodenRandomizer.Avatar.Tests','SuikodenRandomizer.AvatarShuffle.Tests','SuikodenRandomizer.AvatarPresentation.Tests','SuikodenRandomizer.AvatarRuntime.Tests','SuikodenRandomizer.AvatarParty.Tests','SuikodenRandomizer.AvatarUnite.Tests','SuikodenRandomizer.FixedRoster.Tests')) {
            Write-Host ('Running checks: ' + $test)
            Invoke-ManagedCheck $dotnet $Workspace $test
        }
        $built=Join-Path $Workspace 'src\SuikodenRandomizer.AvatarPlugin\bin\Release'
        $plan=@()
        foreach ($name in @('SuikodenRandomizer.dll','SuikodenRandomizer.Core.dll')) {
            $file=Join-Path $built $name
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing compiled output: $name" }
            $version=[Reflection.AssemblyName]::GetAssemblyName($file).Version
            if ($version.ToString() -ne $Package.assemblyVersion) { throw "Wrong compiled version for $name`: $version" }
            $plan += [pscustomobject]@{name=$name;source=$file;relativePath=('BepInEx\plugins\SuikodenRandomizer\'+$name)}
        }
        Assert-GameClosed
        $configTarget = Join-Path $GamePath 'BepInEx\config\agilen.suikoden.recruitment_randomizer.cfg'
        if ($null -ne $Preset) {
            $oldConfig = ''
            if (Test-Path -LiteralPath $configTarget -PathType Leaf) { $oldConfig = [IO.File]::ReadAllText($configTarget) }
            $preparedConfig = Join-Path $Workspace 'web-preset-config.cfg'
            [IO.File]::WriteAllText($preparedConfig, (New-PresetConfig $oldConfig $Preset), [Text.UTF8Encoding]::new($false))
            $plan += [pscustomobject]@{name='agilen.suikoden.recruitment_randomizer.cfg';source=$preparedConfig;relativePath='BepInEx\config\agilen.suikoden.recruitment_randomizer.cfg'}
        }
        Write-Host 'Checks passed. Backing up the existing files and installing Suikoden Randomizer...'
        $backup=Backup-Targets $GamePath $plan
        try {
            foreach ($entry in $plan) {
                $target=Join-Path $GamePath $entry.relativePath
                New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
                Write-VerifiedFile $entry.source $target
                if ((Hash-File $target) -ne (Hash-File $entry.source)) { throw "Installed checksum mismatch: $($entry.name)" }
            }
            $manifestPath=Join-Path $backup 'manifest.json'
            $manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
            $manifest.status='installed'
            Write-Manifest $manifestPath $manifest
        } catch {
            $installError=$_
            try { Restore-Backup $GamePath $backup $true; Write-Host 'The update failed; the previous plugin was restored.' }
            catch { Write-Host "Automatic recovery also failed. Do not start the game until Rollback.cmd has restored the backup: $backup" }
            throw $installError
        }
        $Succeeded=$true
        Write-Host ''
        Write-Host 'Installed Suikoden Randomizer 0.8.6.'
        Write-Host ('Roster mode: ' + $Preset.mode)
        Write-Host ('Start point: ' + $Preset.startPoint)
        Write-Host ('Seed: ' + $Preset.seed)
        Write-Host 'Start a New Game to use these options. Bound saves retain their saved roster.'
        Write-Host 'Keep native saves and matching configuration together. New Game shares the native autosave.'
        Write-Host "Previous files: $backup"
        Write-Host 'Collect-Avatar-Diagnostics.cmd collects shuffle traces, bindings and installed/runtime version evidence after the game is closed.'

    }
} catch {
    Write-Host ''
    Write-Host ('SETUP DID NOT COMPLETE: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host "Diagnostic log: $Log"
    Write-Host 'There are no source-editing steps. Keep this log if setup needs troubleshooting.'
} finally {
    if ($Succeeded -and $null -ne $Workspace -and (Test-Path -LiteralPath $Workspace)) {
        try { Remove-Item -LiteralPath $Workspace -Recurse -Force } catch { Write-Host "Temporary files remain in $Workspace" }
    }
    Write-Host "Installer log: $Log"
    if ($TranscriptStarted) { try { Stop-Transcript | Out-Null } catch { } }
}
if ($Succeeded) { exit 0 } else { exit 1 }
