# 在 Windows 上交叉编译 / 检查后端（目标 aarch64-unknown-linux-musl）。
#
#     .\build-backend.ps1                 # cargo build --release，产物见下方提示
#     .\build-backend.ps1 -Action clippy  # 对目标平台跑 clippy（含只在 Linux 下编译的代码）
#
# 输出写到 <仓库>\build-logs\backend-<Action>.log，最后一行是 BUILD_EXIT:<退出码>，
# 方便后台运行时用循环等待。退出码同样作为脚本退出码返回。
param(
    [ValidateSet('build', 'clippy')]
    [string]$Action = 'build',
    [string]$LogFile
)

. "$PSScriptRoot\toolchain-env.ps1"

if (-not $LogFile) { $LogFile = Join-Path $LogDir "backend-$Action.log" }
$Target = 'aarch64-unknown-linux-musl'

Push-Location (Join-Path $RepoRoot 'backend')
try {
    & cargo $Action --target $Target --release *> $LogFile
    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
"BUILD_EXIT:$exitCode" | Out-File -Encoding ASCII -Append $LogFile

if ($Action -eq 'build' -and $exitCode -eq 0) {
    Write-Host "产物: $(Join-Path $RepoRoot "backend\target\$Target\release\udx710")"
}
Write-Host "日志: $LogFile (退出码 $exitCode)"
exit $exitCode
