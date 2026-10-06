$ErrorActionPreference = 'Stop'
$zig = (Get-Command zig).Source
$env:ZIG_EXE = $zig
$env:CC_AARCH64_UNKNOWN_LINUX_MUSL = 'C:\wb-pj\zigcc.exe'
$env:AR_AARCH64_UNKNOWN_LINUX_MUSL = 'C:\wb-pj\zigar.exe'
$env:CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER = 'C:\wb-pj\zigcc.exe'
$env:CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_RUSTFLAGS = '-C linker-flavor=gcc -C target-feature=+crt-static -C link-self-contained=-crt'
$env:CFLAGS_AARCH64_UNKNOWN_LINUX_MUSL = ''
Set-Location 'C:\wb-pj\backend'
$b = 'C:\wb-pj\backend\target\aarch64-unknown-linux-musl\release\udx710'
$before = (Get-Item $b -ErrorAction SilentlyContinue).LastWriteTime
& cargo build --target aarch64-unknown-linux-musl --release *> 'C:\wb-pj\build-raw.log'
$ec = $LASTEXITCODE
$after = (Get-Item $b).LastWriteTime
$raw = [System.IO.File]::ReadAllText('C:\wb-pj\build-raw.log')
[System.IO.File]::WriteAllText('C:\wb-pj\build-readable.txt', $raw)
"EXIT=$ec BEFORE=$before AFTER=$after" | Out-File -Encoding ASCII 'C:\wb-pj\build-stats.txt'
