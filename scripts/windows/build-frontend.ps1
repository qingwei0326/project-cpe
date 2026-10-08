# 构建前端（pnpm run build）。缺少 node_modules 时先 pnpm install。
#
# 输出写到 <仓库>\build-logs\frontend.log，最后一行是 BUILD_EXIT:<退出码>。
param(
    [string]$LogFile
)

$RepoRoot = if ($env:UDX710_ROOT) { $env:UDX710_ROOT } else { (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
$LogDir = Join-Path $RepoRoot 'build-logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
if (-not $LogFile) { $LogFile = Join-Path $LogDir 'frontend.log' }

Push-Location (Join-Path $RepoRoot 'frontend')
try {
    "" | Out-File -Encoding ASCII $LogFile

    if (-not (Test-Path node_modules)) {
        & pnpm install *>> $LogFile
        "INSTALL_EXIT:$LASTEXITCODE" | Out-File -Encoding ASCII -Append $LogFile
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    & pnpm run build *>> $LogFile
    $exitCode = $LASTEXITCODE
    "BUILD_EXIT:$exitCode" | Out-File -Encoding ASCII -Append $LogFile
} finally {
    Pop-Location
}

Write-Host "产物: $(Join-Path $RepoRoot 'frontend\dist')"
Write-Host "日志: $LogFile (退出码 $exitCode)"
exit $exitCode
