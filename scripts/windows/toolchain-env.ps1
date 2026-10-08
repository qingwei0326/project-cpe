# 为 aarch64-unknown-linux-musl 交叉编译准备环境（用 dot-source 引入）：
#
#     . "$PSScriptRoot\toolchain-env.ps1"
#
# 本机的 `zig` 同时充当 C 编译器、链接器和 ar。rustc / cc-rs 没法直接启动 .cmd，
# 而 msvcrt 的 execvp 也解析不了含中文的 zig 安装路径，所以通过 zig-wrappers 里的
# zigcc.exe / zigar.exe（CreateProcessW，读取 ZIG_EXE 里的完整 UTF-16 路径）转发。
#
# 仓库根目录取自脚本自身位置；需要指定别的位置时设置环境变量 UDX710_ROOT。
# 若检出路径含非 ASCII 字符导致工具链报错，可建一个 ASCII 联接点再从它运行脚本：
#     New-Item -ItemType Junction C:\udx710 -Target <仓库路径>
#     C:\udx710\scripts\windows\build-backend.ps1

$RepoRoot = if ($env:UDX710_ROOT) { $env:UDX710_ROOT } else { (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
$WrapperDir = Join-Path $PSScriptRoot 'zig-wrappers'
$ZigCc = Join-Path $WrapperDir 'zigcc.exe'
$ZigAr = Join-Path $WrapperDir 'zigar.exe'

$zigCommand = Get-Command zig -ErrorAction SilentlyContinue
if (-not $zigCommand) {
    throw '未找到 zig。请先安装 zig 并加入 PATH（https://ziglang.org/download/）。'
}
foreach ($wrapper in @($ZigCc, $ZigAr)) {
    if (-not (Test-Path $wrapper)) {
        throw "缺少 $wrapper，请先运行: $WrapperDir\build-wrappers.ps1"
    }
}

$env:ZIG_EXE = $zigCommand.Source
$env:CC_AARCH64_UNKNOWN_LINUX_MUSL = $ZigCc
$env:AR_AARCH64_UNKNOWN_LINUX_MUSL = $ZigAr
$env:CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER = $ZigCc
$env:CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_RUSTFLAGS = '-C linker-flavor=gcc -C target-feature=+crt-static -C link-self-contained=no'
$env:CFLAGS_AARCH64_UNKNOWN_LINUX_MUSL = ''

$LogDir = Join-Path $RepoRoot 'build-logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
