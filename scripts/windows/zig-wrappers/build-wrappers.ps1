# 用本机 zig 编译 zigcc.exe / zigar.exe（交叉编译用的转发器，源码见同目录 .c 文件）。
# 只需运行一次；.exe 不进版本库。
$ErrorActionPreference = 'Stop'

if (-not (Get-Command zig -ErrorAction SilentlyContinue)) {
    throw '未找到 zig。请先安装 zig 并加入 PATH（https://ziglang.org/download/）。'
}

foreach ($name in 'zigcc', 'zigar') {
    $source = Join-Path $PSScriptRoot "$name.c"
    $output = Join-Path $PSScriptRoot "$name.exe"
    # 保持这组参数：同时加 -s（去符号）和 GUI 子系统参数时，编出的转发器在 cc-rs 调用下
    # 会以 0xc0000142 启动失败（未单独区分是哪一个导致的）。
    & zig cc -O2 -o $output $source
    if ($LASTEXITCODE -ne 0) { throw "编译 $name.c 失败" }
    Write-Host "已生成 $output"
}
