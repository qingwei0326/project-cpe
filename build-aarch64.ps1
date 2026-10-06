$ErrorActionPreference = 'Stop'
# Cross-build aarch64-unknown-linux-musl using the locally available `zig` as the
# C-compiler/linker/ar driver (the project's configured aarch64-unknown-linux-musl-gcc
# is not present). The wrappers zigcc.exe / zigar.exe are native executables that
# forward to `zig cc -target aarch64-linux-musl` / `zig ar` via CreateProcessW using
# the full UTF-16 zig path from ZIG_EXE (rustc/cc cannot spawn a .cmd, and msvcrt
# execvp can't resolve zig's Chinese-char install path).
$log = 'C:\wb-pj\build-aarch64.log'
$zig = (Get-Command zig).Source
$env:ZIG_EXE = $zig
$cc  = 'C:\wb-pj\zigcc.exe'
$ar  = 'C:\wb-pj\zigar.exe'
$env:CC_AARCH64_UNKNOWN_LINUX_MUSL = $cc
$env:AR_AARCH64_UNKNOWN_LINUX_MUSL = $ar
$env:CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER = $cc
$env:CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_RUSTFLAGS = '-C linker-flavor=gcc -C target-feature=+crt-static -C link-self-contained=no'
$env:CFLAGS_AARCH64_UNKNOWN_LINUX_MUSL = ''
Set-Location 'C:\wb-pj\backend'
$out = & cargo build --target aarch64-unknown-linux-musl --release 2>&1 | Out-String
$out | Out-File -Encoding ASCII $log
"BUILD_EXIT:$LASTEXITCODE" | Out-File -Encoding ASCII -Append $log
