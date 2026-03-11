# Screen Shade - Chrome Web Store パッケージ作成スクリプト
# 使い方: powershell -ExecutionPolicy Bypass -File zip.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --- 1. バージョン同期 ---
Write-Host "`n=== バージョン同期 ===" -ForegroundColor Cyan

$packageJson = Get-Content "package.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $packageJson.version
Write-Host "package.json version: $version"

# manifest.json にバージョンを同期
$manifestPath = "manifest.json"
$manifestRaw = Get-Content $manifestPath -Raw -Encoding UTF8
$manifest = $manifestRaw | ConvertFrom-Json
if ($manifest.version -ne $version) {
    $manifestRaw = $manifestRaw -replace '"version":\s*"[^"]*"', ('"version": "' + $version + '"')
    [System.IO.File]::WriteAllText($manifestPath, $manifestRaw, [System.Text.UTF8Encoding]::new($false))
    Write-Host "  manifest.json -> $version"
} else {
    Write-Host "  manifest.json OK"
}

# --- 2. 依存関係のインストール ---
Write-Host "`n=== npm install ===" -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { Write-Error "npm install failed"; exit 1 }

# --- 3. アイコン生成 ---
Write-Host "`n=== generate-icons ===" -ForegroundColor Cyan
node scripts/generate-icons.js
if ($LASTEXITCODE -ne 0) { Write-Error "icon generation failed"; exit 1 }

# --- 4. スクリーンショット生成 ---
Write-Host "`n=== generate-screenshots ===" -ForegroundColor Cyan
node scripts/generate-screenshots.js
if ($LASTEXITCODE -ne 0) { Write-Error "screenshot generation failed"; exit 1 }

# --- 5. ZIP ファイル作成 ---
Write-Host "`n=== ZIP ===" -ForegroundColor Cyan

$zipName = "screen-shade-v$version.zip"

# 古い ZIP を削除
if (Test-Path $zipName) {
    Remove-Item $zipName -Force
    Write-Host "  removed old $zipName"
}

# 一時ディレクトリの作成
$tempDir = "temp-build"
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item $tempDir -ItemType Directory | Out-Null

# 拡張機能に必要なファイルのみコピー
$filesToCopy = @(
    "manifest.json",
    "popup.html",
    "popup.js",
    "popup.css"
)

foreach ($file in $filesToCopy) {
    Copy-Item $file "$tempDir\$file"
    Write-Host "  + $file"
}

# ディレクトリをコピー
$dirsToCopy = @(
    "scripts",
    "css",
    "images"
)

foreach ($dir in $dirsToCopy) {
    if (Test-Path $dir) {
        Copy-Item $dir "$tempDir\$dir" -Recurse
        Write-Host "  + $dir/"
    }
}

# 不要なファイルを除外（ビルド専用スクリプト、一時ファイル等）
$excludePatterns = @(
    "generate-icons.js",
    "generate-screenshots.js",
    ".DS_Store",
    "*.swp",
    "*~"
)

foreach ($pattern in $excludePatterns) {
    Get-ChildItem "$tempDir" -Recurse -Filter $pattern -ErrorAction SilentlyContinue |
        Remove-Item -Force
}

# ZIP 作成
Compress-Archive -Path "$tempDir\*" -DestinationPath $zipName -Force
Write-Host "`n  created: $zipName"

# 一時ディレクトリの削除
Remove-Item $tempDir -Recurse -Force

# --- 6. 完了 ---
$zipSize = (Get-Item $zipName).Length
$zipSizeKB = [math]::Round($zipSize / 1024, 2)

Write-Host "`n=== Done ===" -ForegroundColor Green
Write-Host "  file: $zipName"
Write-Host "  size: $zipSizeKB KB"
Write-Host "`n  Upload at: https://chrome.google.com/webstore/devconsole" -ForegroundColor Blue
Write-Host ""
