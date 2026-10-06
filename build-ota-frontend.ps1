$ErrorActionPreference = 'Continue'
$root = Join-Path $env:USERPROFILE 'Desktop\project-cpe'
Set-Location (Join-Path $root 'frontend')
if (-not (Test-Path node_modules)) {
    pnpm install *> C:\wb-pj\build-ota-frontend-install.log
    "INSTALL_EXIT:$LASTEXITCODE" | Out-File -Encoding ASCII -Append C:\wb-pj\build-ota-frontend-install.log
}
pnpm run build *> C:\wb-pj\build-ota-frontend.log
"BUILD_EXIT:$LASTEXITCODE" | Out-File -Encoding ASCII -Append C:\wb-pj\build-ota-frontend.log
