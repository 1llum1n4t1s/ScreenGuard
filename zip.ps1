#requires -Version 7.0
# スクリーンカーテン 拡張機能パッケージ生成スクリプト
# 使い方: pwsh -File zip.ps1

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# 対象自身と親階層のリンク経由の読み書きを拒否する。
function Assert-NoReparsePoint {
    param([Parameter(Mandatory)][string]$LiteralPath)
    $current = [IO.Path]::GetFullPath($LiteralPath)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "リンク経由のパスは使用できません: $current"
            }
        }
        $current = Split-Path -Path $current -Parent
    }
}

Write-Host '拡張機能パッケージを生成中...' -ForegroundColor Cyan
$scriptDir = [IO.Path]::GetFullPath($PSScriptRoot)
Assert-NoReparsePoint -LiteralPath $scriptDir
Set-Location -LiteralPath $scriptDir

# 生成前の失敗では既存 ZIP に触れない。
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw '依存関係のインストールに失敗しました。' }
pnpm sync:support --check
if ($LASTEXITCODE -ne 0) { throw '共通問い合わせ部品の同期確認に失敗しました。' }
pnpm run generate-icons
if ($LASTEXITCODE -ne 0) { throw 'アイコン生成に失敗しました。' }

$zipPath = Join-Path $scriptDir 'screen-curtain.zip'
Assert-NoReparsePoint -LiteralPath $zipPath
if ((Test-Path -LiteralPath $zipPath) -and
    (Get-Item -LiteralPath $zipPath -Force).PSIsContainer) {
    throw "ZIP の出力先がディレクトリです: $zipPath"
}

# 全入力を先に確定し、除外対象も含めて子の reparse point を拒否する。
$files = [Collections.Generic.List[IO.FileInfo]]::new()
foreach ($relativePath in @('manifest.json', 'icons', 'src')) {
    $sourcePath = Join-Path $scriptDir $relativePath
    Assert-NoReparsePoint -LiteralPath $sourcePath
    $source = Get-Item -LiteralPath $sourcePath -Force
    if ($relativePath -eq 'manifest.json' -and $source.PSIsContainer) {
        throw 'manifest.json がファイルではありません。'
    }
    if ($relativePath -ne 'manifest.json' -and -not $source.PSIsContainer) {
        throw "$relativePath がディレクトリではありません。"
    }
    $items = if ($source.PSIsContainer) {
        @(Get-ChildItem -LiteralPath $sourcePath -Recurse -Force)
    } else { @($source) }
    foreach ($item in $items) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "入力にリンクが含まれています: $($item.FullName)"
        }
        if (-not $item.PSIsContainer -and
            $item.Name -notlike '*.DS_Store' -and
            $item.Name -notlike '*.swp' -and $item.Name -notlike '*~') {
            $files.Add($item)
        }
    }
}

Write-Host 'ZIPファイルを作成中...' -ForegroundColor Cyan
$zipStream = $null
$archive = $null
try {
    # 実際の出力先を開いて書込み可否を確認する（作業コピー・削除不要）。
    $zipStream = [IO.File]::Open($zipPath, [IO.FileMode]::Create,
        [IO.FileAccess]::Write, [IO.FileShare]::None)
    $archive = [IO.Compression.ZipArchive]::new($zipStream,
        [IO.Compression.ZipArchiveMode]::Create, $true)
    foreach ($file in $files) {
        $entryName = [IO.Path]::GetRelativePath($scriptDir, $file.FullName).Replace('\', '/')
        $entry = $archive.CreateEntry($entryName, [IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $null
        $inputStream = $null
        try {
            $inputStream = [IO.File]::OpenRead($file.FullName)
            $entryStream = $entry.Open()
            $inputStream.CopyTo($entryStream)
        } finally {
            if ($entryStream) { $entryStream.Dispose() }
            if ($inputStream) { $inputStream.Dispose() }
        }
    }
} finally {
    try {
        if ($archive) { $archive.Dispose() }
    } finally {
        if ($zipStream) { $zipStream.Dispose() }
    }
}

$fileSizeKB = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1KB, 2)
Write-Host "ZIPファイルを作成しました: screen-curtain.zip ($fileSizeKB KB)" -ForegroundColor Green
Write-Host 'パッケージが正常に作成されました!' -ForegroundColor Green
