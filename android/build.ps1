param(
    [string]$OutputApk = "../../outputs/Agenda-Salon.apk",
    [string]$AndroidSdk = "$env:USERPROFILE/AppData/Local/Android/Sdk",
    [string]$JavaHome = "C:/Program Files/Android/Android Studio/jbr"
)
$ErrorActionPreference = "Stop"
$ProjectRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$BuildPath = Join-Path $ProjectRoot "build"
$ToolPath = Join-Path $AndroidSdk "build-tools/36.1.0"
$PlatformJar = Join-Path $AndroidSdk "platforms/android-36.1/android.jar"
$Java = Join-Path $JavaHome "bin/java.exe"
$Javac = Join-Path $JavaHome "bin/javac.exe"
$Jar = Join-Path $JavaHome "bin/jar.exe"
$Keytool = Join-Path $JavaHome "bin/keytool.exe"
$OutputPath = [IO.Path]::GetFullPath((Join-Path $ProjectRoot $OutputApk))
if (!$env:SALON_KEYSTORE_PATH -or !$env:SALON_KEYSTORE_PASSWORD) { throw 'Set SALON_KEYSTORE_PATH and SALON_KEYSTORE_PASSWORD locally; the original key is not distributed.' }
$KeystorePath = [IO.Path]::GetFullPath($env:SALON_KEYSTORE_PATH)
$JarTempArgument = "-J-Djava.io.tmpdir=$BuildPath/temp"
$JavaTempArgument = "-Djava.io.tmpdir=$BuildPath/temp"

function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE" }
}

foreach ($RequiredPath in @($ToolPath, $PlatformJar, $Java, $Javac, $Jar, $Keytool)) {
    if (!(Test-Path -LiteralPath $RequiredPath)) { throw "Missing local build dependency: $RequiredPath" }
}
if (!(Test-Path -LiteralPath (Join-Path $ProjectRoot "app/src/main/assets/index.html"))) {
    throw "The app frontend is missing: app/src/main/assets/index.html"
}
if (Test-Path -LiteralPath $BuildPath) {
    $ResolvedBuild = (Resolve-Path -LiteralPath $BuildPath).Path
    $ExpectedBuild = [IO.Path]::GetFullPath((Join-Path $ProjectRoot "build"))
    if ($ResolvedBuild -ne $ExpectedBuild -or !(($ResolvedBuild + "\").StartsWith($ProjectRoot + "\", [StringComparison]::OrdinalIgnoreCase))) {
        throw "Refusing to clean unexpected build directory: $ResolvedBuild"
    }
    Remove-Item -LiteralPath $ResolvedBuild -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $BuildPath, (Join-Path $BuildPath "classes"), (Join-Path $BuildPath "generated"), (Join-Path $BuildPath "dex"), (Join-Path $BuildPath "temp"), (Split-Path -Parent $KeystorePath), (Split-Path -Parent $OutputPath) | Out-Null

Invoke-Checked (Join-Path $ToolPath "aapt2.exe") @("compile", "--dir", (Join-Path $ProjectRoot "app/src/main/res"), "-o", (Join-Path $BuildPath "resources.zip"))
Invoke-Checked (Join-Path $ToolPath "aapt2.exe") @("link", "-o", (Join-Path $BuildPath "base.apk"), "-I", $PlatformJar, "--manifest", (Join-Path $ProjectRoot "app/src/main/AndroidManifest.xml"), "--java", (Join-Path $BuildPath "generated"), "-A", (Join-Path $ProjectRoot "app/src/main/assets"), "--min-sdk-version", "26", "--target-sdk-version", "36", (Join-Path $BuildPath "resources.zip"))

$Sources = @((Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "app/src/main/java") -Filter "*.java" -Recurse).FullName)
$Sources += @((Get-ChildItem -LiteralPath (Join-Path $BuildPath "generated") -Filter "*.java" -Recurse).FullName)
$SourceList = Join-Path $BuildPath "sources.txt"
$SourceArguments = $Sources | ForEach-Object { '"' + $_.Replace('\', '/') + '"' }
[IO.File]::WriteAllLines($SourceList, $SourceArguments, [Text.UTF8Encoding]::new($false))
Invoke-Checked $Javac @("--release", "8", "-encoding", "UTF-8", "-classpath", $PlatformJar, "-d", (Join-Path $BuildPath "classes"), ("@" + $SourceList))
Invoke-Checked $Jar @($JarTempArgument, "--create", "--file", (Join-Path $BuildPath "classes.jar"), "-C", (Join-Path $BuildPath "classes"), ".")
Invoke-Checked $Java @($JavaTempArgument, "-cp", (Join-Path $ToolPath "lib/d8.jar"), "com.android.tools.r8.D8", "--release", "--min-api", "26", "--lib", $PlatformJar, "--output", (Join-Path $BuildPath "dex"), (Join-Path $BuildPath "classes.jar"))
Copy-Item -LiteralPath (Join-Path $BuildPath "base.apk") -Destination (Join-Path $BuildPath "unsigned.apk")
Invoke-Checked $Jar @($JarTempArgument, "--update", "--file", (Join-Path $BuildPath "unsigned.apk"), "-C", (Join-Path $BuildPath "dex"), "classes.dex")
Invoke-Checked (Join-Path $ToolPath "zipalign.exe") @("-f", "-p", "4", (Join-Path $BuildPath "unsigned.apk"), (Join-Path $BuildPath "aligned.apk"))

if (!(Test-Path -LiteralPath $KeystorePath)) { throw 'The original signing keystore must exist' }
Invoke-Checked $Java @($JavaTempArgument, "-cp", (Join-Path $ToolPath "lib/apksigner.jar"), "com.android.apksigner.ApkSignerTool", "sign", "--ks", $KeystorePath, "--ks-key-alias", "salon-test", "--ks-pass", "env:SALON_KEYSTORE_PASSWORD", "--key-pass", "env:SALON_KEYSTORE_PASSWORD", "--out", $OutputPath, (Join-Path $BuildPath "aligned.apk"))
Invoke-Checked $Java @($JavaTempArgument, "-cp", (Join-Path $ToolPath "lib/apksigner.jar"), "com.android.apksigner.ApkSignerTool", "verify", "--verbose", $OutputPath)
Invoke-Checked (Join-Path $ToolPath "zipalign.exe") @("-c", "-p", "4", $OutputPath)
Invoke-Checked (Join-Path $ToolPath "aapt.exe") @("dump", "badging", $OutputPath)
Get-Item -LiteralPath $OutputPath | Select-Object FullName, Length
Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256
