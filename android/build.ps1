param(
    [string]$OutputApk = "../../../outputs/Agenda-Salon-1.1.2/Agenda-Salon-1.1.2.apk",
    [string]$AndroidSdk = "$env:USERPROFILE/AppData/Local/Android/Sdk",
    [string]$JavaHome = "C:/Program Files/Android/Android Studio/jbr"
)
$ErrorActionPreference = 'Stop'
$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $AndroidSdk
$env:ANDROID_SDK_ROOT = $AndroidSdk
if (!$env:SALON_KEYSTORE_PATH -or !$env:SALON_KEYSTORE_PASSWORD) { throw 'Set SALON_KEYSTORE_PATH and SALON_KEYSTORE_PASSWORD locally.' }
$GradleCommand = Get-Command gradle -ErrorAction SilentlyContinue
$GradlePath = if ($GradleCommand) { $GradleCommand.Source } else {
    Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE '.gradle/wrapper/dists/gradle-9.4.1-bin') -Filter gradle.bat -Recurse | Select-Object -First 1 -ExpandProperty FullName
}
if (!$GradlePath) { throw 'Gradle 9.4.1 is required.' }
& $GradlePath -p $PSScriptRoot :app:assembleRelease --offline --no-daemon --console=plain
if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
$Unsigned = Join-Path $PSScriptRoot 'app/build/outputs/apk/release/app-release-unsigned.apk'
$OutputPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $OutputApk))
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null
$ApkSigner = Join-Path $AndroidSdk 'build-tools/36.1.0/apksigner.bat'
& $ApkSigner sign --out $OutputPath --v4-signing-enabled false --ks $env:SALON_KEYSTORE_PATH --ks-key-alias geometrie-roti --ks-pass env:SALON_KEYSTORE_PASSWORD --key-pass env:SALON_KEYSTORE_PASSWORD $Unsigned
if ($LASTEXITCODE -ne 0) { throw 'Signing failed.' }
$Verification = & $ApkSigner verify --verbose --print-certs $OutputPath
if ($LASTEXITCODE -ne 0 -or !($Verification -match '^Signer #1 certificate SHA-256 digest: 95c79cbc9e68e31611c477f8cc27050a682b4ee616a5c25d6cbc40005f1d2bf6$') -or $Verification -match '^Signer #2 ') { throw 'Wrong signing identity.' }
& (Join-Path $AndroidSdk 'build-tools/36.1.0/zipalign.exe') -c -p 4 $OutputPath
if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed.' }
$Badging = & (Join-Path $AndroidSdk 'build-tools/36.1.0/aapt2.exe') dump badging $OutputPath
if ($LASTEXITCODE -ne 0 -or !($Badging -match "^package: name='ro.caiuspoputa.agendasalon' versionCode='37' versionName='1.1.2'") -or !($Badging -match "^application-label:'Agenda Salon'$")) { throw 'Wrong APK identity.' }
Get-Item -LiteralPath $OutputPath | Select-Object FullName,Length
Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256
