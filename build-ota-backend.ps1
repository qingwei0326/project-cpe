$ErrorActionPreference = 'Continue'
$zig = (Get-Command zig).Source
$env:ZIG_EXE = $zig
$env:CC_AARCH64_UNKNOWN_LINUX_MUSL = 'C:\wb-pj\zigcc.exe'
$env:AR_AARCH64_UNKNOWN_LINUX_MUSL = 'C:\wb-pj\zigar.exe'
$env:CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER = 'C:\wb-pj\zigcc.exe'
$env:CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_RUSTFLAGS = '-C linker-flavor=gcc -C target-feature=+crt-static -C link-self-contained=no'
$env:CFLAGS_AARCH64_UNKNOWN_LINUX_MUSL = ''
$root = Join-Path $env:USERPROFILE 'Desktop\project-cpe'
Set-Location (Join-Path $root 'backend')
cargo build --target aarch64-unknown-linux-musl --release *> C:\wb-pj\build-ota-backend.log
"BUILD_EXIT:$LASTEXITCODE" | Out-File -Encoding ASCII -Append C:\wb-pj\build-ota-backend.log
