#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

/* GUI-subsystem wrapper (no console window needed for a build driver).
   Forwards to: "<ZIG_EXE>" cc -target aarch64-linux-musl <user-args...>
   It DROPS any --target=... / -target <triple> the caller (rustc / cc-rs)
   supplies, because (a) they would duplicate ours and (b) zig cannot parse
   the Rust triple "aarch64-unknown-linux-musl" (it needs "aarch64-linux-musl").
   Uses CreateProcessW with the full UTF-16 zig path from ZIG_EXE so we avoid
   msvcrt execvp's ANSI PATH lookup (fails on the Chinese-char install path). */
int WINAPI WinMain(HINSTANCE hInst, HINSTANCE hPrev, LPSTR lpCmd, int nShow) {
    (void)hInst; (void)hPrev; (void)lpCmd; (void)nShow;
    int argc = 0;
    wchar_t **argv = CommandLineToArgvW(GetCommandLineW(), &argc);

    wchar_t zigPath[MAX_PATH];
    DWORD len = GetEnvironmentVariableW(L"ZIG_EXE", zigPath, MAX_PATH);
    if (len == 0 || len >= MAX_PATH) {
        fwprintf(stderr, L"ZIG_EXE not set or too long\n");
        LocalFree(argv);
        return 127;
    }
    size_t cap = wcslen(zigPath) + 64;
    for (int i = 1; i < argc; i++) cap += wcslen(argv[i]) * 2 + 4;
    wchar_t *cmd = (wchar_t *)malloc(cap * sizeof(wchar_t));
    int p = swprintf(cmd, cap, L"\"%ls\" cc -target aarch64-linux-musl", zigPath);
    for (int i = 1; i < argc; i++) {
        wchar_t *a = argv[i];
        if (wcsncmp(a, L"--target=", 9) == 0) continue;       /* drop --target=X */
        if (wcscmp(a, L"-target") == 0) { i++; continue; }    /* drop -target X */
        if (wcscmp(a, L"--target") == 0) { i++; continue; }   /* drop --target X */
        p += swprintf(cmd + p, cap - p, L" \"%ls\"", a);
    }

    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    ZeroMemory(&pi, sizeof(pi));
    si.cb = sizeof(si);
    if (!CreateProcessW(zigPath, cmd, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) {
        fwprintf(stderr, L"CreateProcessW failed %lu\n", GetLastError());
        free(cmd);
        LocalFree(argv);
        return 127;
    }
    WaitForSingleObject(pi.hProcess, INFINITE);
    DWORD code = 0;
    GetExitCodeProcess(pi.hProcess, &code);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    free(cmd);
    LocalFree(argv);
    return (int)code;
}
