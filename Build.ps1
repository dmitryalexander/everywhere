# Builds Everywhere.exe (Rust) and its two small Windows bridges (C#) in this folder.
# Needs: Rust (rustup, MSVC toolchain) and the .NET Framework 4 compiler that ships with Windows.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path -LiteralPath $cargoBin) { $env:PATH = $cargoBin + ';' + $env:PATH }
# Keep personal folder names out of the program: source paths embedded by the compiler
# become ~ (user folder) and everywhere (this project). Later prefixes take precedence.
$env:CARGO_ENCODED_RUSTFLAGS = ('--remap-path-prefix=' + $env:USERPROFILE + '=~') + [char]0x1f + ('--remap-path-prefix=' + $PSScriptRoot + '=everywhere')
# cargo writes progress to stderr; merge it in cmd so Windows PowerShell 5 doesn't treat it as an error.
& cmd.exe /c "cargo build --release 2>&1"
if ($LASTEXITCODE -ne 0) { throw 'Everywhere build failed.' }
# A running Everywhere keeps its program file locked: ask it to quit first.
if (Test-Path -LiteralPath '.\Everywhere.exe') {
    & .\Everywhere.exe --quit | Out-Null   # piping makes PowerShell wait for this windowed program
    for ($i = 0; $i -lt 20 -and (Get-Process -Name 'Everywhere' -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 250 }
}
Copy-Item -LiteralPath 'target\release\Everywhere.exe' -Destination 'Everywhere.exe' -Force
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:exe /optimize+ /reference:Microsoft.CSharp.dll /out:explorer-bridge.exe bridges\ExplorerBridge.cs
if ($LASTEXITCODE -ne 0) { throw 'Explorer bridge build failed.' }
& $csc /nologo /target:exe /optimize+ /out:recycle-bridge.exe bridges\RecycleBridge.cs
if ($LASTEXITCODE -ne 0) { throw 'Recycle Bin bridge build failed.' }
Write-Output 'Ready. Double-click Everywhere.exe (pin it to the taskbar if you like).'
