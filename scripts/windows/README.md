# Windows 构建脚本

在 Windows 上用 `zig` 交叉编译后端（目标 `aarch64-unknown-linux-musl`）并构建前端。
macOS / Linux 请用上一级目录的 `build.sh`。

## 前置条件

- Rust 工具链，并安装目标：`rustup target add aarch64-unknown-linux-musl`
- [zig](https://ziglang.org/download/)（已验证 0.16.0），加入 `PATH`
- Node.js 与 pnpm（构建前端用）

## 用法

```powershell
# 1. 只需一次：编译 zig 转发器（zigcc.exe / zigar.exe，不进版本库）
.\scripts\windows\zig-wrappers\build-wrappers.ps1

# 2. 构建后端 -> backend\target\aarch64-unknown-linux-musl\release\udx710
.\scripts\windows\build-backend.ps1
.\scripts\windows\build-backend.ps1 -Action clippy   # 对目标平台跑 clippy

# 3. 构建前端 -> frontend\dist
.\scripts\windows\build-frontend.ps1
```

日志写到仓库根目录的 `build-logs\`（已加入 `.gitignore`），最后一行是
`BUILD_EXIT:<退出码>`，后台运行时可以循环等待它出现。

打 OTA 包用 `scripts/pack-ota.sh`（在 Git Bash 里运行），它读取上面两个产物。

## 目录

| 文件 | 作用 |
|---|---|
| `toolchain-env.ps1` | 设置交叉编译用的环境变量，被后端脚本 dot-source 引入 |
| `build-backend.ps1` | `cargo build` / `cargo clippy`，目标 aarch64-musl |
| `build-frontend.ps1` | `pnpm run build` |
| `zig-wrappers/` | zigcc / zigar 转发器的源码和编译脚本 |

## 为什么需要转发器

zig 同时充当 C 编译器、链接器和 `ar`。`rustc` 和 `cc-rs` 没法直接启动 `.cmd`，
而 msvcrt 的 `execvp` 也解析不了含中文的 zig 安装路径，所以用两个很小的原生程序
（`zigcc.c`、`zigar.c`，通过 `CreateProcessW` 读取环境变量 `ZIG_EXE` 里的完整路径）转发。
`zigcc` 还会丢掉调用方传入的 `--target`，因为 zig 不认 Rust 的三元组写法。
同目录的 `.cmd` 文件目前没有被任何脚本引用，保留作参考。

编译转发器请保持 `build-wrappers.ps1` 里的参数（`-O2`，默认控制台子系统）。实测同时加
`-s`（去符号）和 GUI 子系统参数编出的程序，在 `cc-rs` 调用下会以 `0xc0000142` 启动失败；
没有单独区分是其中哪一个导致的。

## 路径

脚本通过自身位置找到仓库根目录，不依赖固定盘符。需要指定别的位置时，设置环境变量
`UDX710_ROOT`。

如果检出路径含非 ASCII 字符后工具链仍报路径相关错误，可建一个 ASCII 联接点，再从它运行：

```powershell
New-Item -ItemType Junction C:\udx710 -Target <仓库路径>
C:\udx710\scripts\windows\build-backend.ps1
```

（在含中文的路径下已验证过 `build` 和 `clippy` 都能正常运行。）
