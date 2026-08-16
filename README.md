# Codex Bridge

![Codex Bridge](public/codex-bridge-c.svg)

Codex Bridge 是一个非官方的 Android/PWA 移动伴侣，用手机查看并继续运行在自己 Windows 电脑上的 Codex 任务。手机不保存 Codex 登录凭据，也不直接调用 OpenAI；请求由配对后的 Windows Host 转交给本机 Codex App Server。

> [!IMPORTANT]
> 本项目与 OpenAI 无隶属、合作或背书关系。Codex 和 OpenAI 是其各自权利人的商标。

## 功能

- 读取 Codex Desktop 中的工作区、历史任务和回合内容
- 从手机继续同一个任务，并实时查看增量输出和过程更新
- 新建任务、创建文件夹、选择模型、推理强度与权限模式
- 发送图片、引用电脑文件/文件夹、处理 Bridge 发起的审批
- 排队发送、取消排队、停止正在执行的手机任务
- Android 扫码配对、原生通知和支持双指缩放的图片查看器
- 通过可信异地组网直连，或自建 HTTPS/WSS Relay

## 架构

```text
Android / PWA
      │
      ├── trusted overlay HTTP/WS ─────────────┐
      │                                        │
      └── HTTPS/WSS ── self-hosted Relay ──────┤
                                               ▼
                                         Windows Host
                                               │
                                               ├── Codex App Server
                                               ├── ~/.codex history
                                               └── Codex Desktop integration
```

桌面版和 Bridge 是两个 App Server 客户端。Bridge 会识别桌面正在执行的回合并避免并发写入；手机消息可以进入持久化队列，等桌面回合完成后再发送。

## 安全边界

Codex Bridge 面向单用户、自托管场景，不是多租户服务：

- 配对令牌具有读取任务、发送消息和触发本机 Codex 操作的能力，应当像密码一样保护。
- 当前没有端到端加密。HTTPS Relay 会在服务器端终止 TLS，因此 Relay 管理者能够接触转发的数据。
- Android 允许 HTTP，是为了兼容已经提供链路加密的可信异地组网；不要把 HTTP Host 端口直接暴露到公网。
- 全新安装默认仅监听 `127.0.0.1`。局域网或异地组网访问必须显式指定 `-ListenAddress 0.0.0.0`。

完整威胁模型和漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## 环境要求

- Windows 10/11
- Node.js 22.13 或更高版本
- 已安装并登录、能够正常运行任务的 Codex Desktop
- Android 8.0 或更高版本（使用 APK 时）
- PowerShell 5.1 或更高版本

## Windows Host

克隆仓库后进入项目目录：

```powershell
git clone https://github.com/momo-888/codex-bridge.git
cd codex-bridge
npm ci
npm run typecheck
npm test
```

### 仅本机运行

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup.ps1
```

配对页位于 `http://127.0.0.1:43110/setup`。该模式不会接受其他设备的连接。

### 可信异地组网或局域网

下面示例假设电脑在组网中的地址是 `100.64.0.10`：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup.ps1 `
  -ListenAddress 0.0.0.0 `
  -PublicHost 100.64.0.10
```

只允许可信私有网络访问 TCP `43110`，不要在路由器上将该端口映射到公网。

### 已有 HTTPS 反向代理

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup.ps1 `
  -ListenAddress 0.0.0.0 `
  -PublicUrl "https://bridge.example.com"
```

`PublicUrl` 只声明手机应该访问的外部地址；证书、DNS 和反向代理仍需自行配置。

如果希望配对页显示一个由你维护的正式 APK 下载地址，可在 Host 环境中设置 `CODEX_BRIDGE_APK_URL`。默认不会从源码目录分发本地 APK。

### 常用命令

```powershell
.\scripts\start-codex-bridge.ps1
.\scripts\stop-codex-bridge.ps1
.\scripts\uninstall-startup.ps1
```

运行日志位于项目的 `.logs`；本地配置、令牌、队列和诊断记录位于 `%USERPROFILE%\.codex-bridge`，这些目录均不会提交到 Git。

## 自建 Relay

Relay 需要独立的 Host Token 和 Phone Token，两个值都至少包含 32 个随机字符。示例配置位于 [`deploy/relay/.env.example`](deploy/relay/.env.example)。

生成部署包和随机令牌：

```powershell
.\scripts\prepare-relay-deployment.ps1 -PublicUrl "https://bridge.example.com"
```

将 `.deploy/codex-bridge-relay.tar.gz`、`%USERPROFILE%\.codex-bridge\relay-server.env` 和 `deploy/relay/install-server.sh` 复制到 Linux 服务器后，以 root 执行安装脚本。Nginx 示例中的 `bridge.example.com` 必须替换成自己的域名。

电脑只会向 Relay 建立出站 WSS 连接，家庭网络无需开放入站端口。验证部署：

```powershell
node .\scripts\verify-public-relay.mjs https://bridge.example.com
```

## Android

首次构建会在忽略目录 `.tools` 中准备 Android 工具链。普通开发包使用 Android Debug 签名：

```powershell
.\scripts\build-android.ps1 -BridgeUrl "https://bridge.example.com"
```

输出位于 `outputs/android/CodexBridge-debug.apk`，不会进入 Git 历史。

正式发布必须提供自己的签名密钥：

```powershell
$env:CODEX_BRIDGE_KEYSTORE_PATH = "C:\secure\release.keystore"
$env:CODEX_BRIDGE_KEYSTORE_PASSWORD = "..."
$env:CODEX_BRIDGE_KEY_ALIAS = "..."
$env:CODEX_BRIDGE_KEY_PASSWORD = "..."
.\scripts\build-android.ps1 -Variant Release -BridgeUrl "https://bridge.example.com"
```

构建脚本会输出 APK 路径和 SHA-256。推荐将正式 APK 作为 GitHub Release 附件发布，不要提交到仓库。

## 开发与验证

```powershell
npm run dev
npm run host
npm run typecheck
npm run lint
npm test
npm run icons
```

按需生成当前 Codex 版本的协议类型和 JSON Schema：

```powershell
.\scripts\generate-protocol.ps1
```

结果位于忽略目录 `.tmp-appserver-schema`，不提交一次性生成快照。调整 App Server 兼容逻辑时，应在 Pull Request 中说明测试使用的 Codex 版本。

## 当前限制

- Windows Host 与 Codex Desktop 集成目前仅支持 Windows。
- 公网 Relay 不提供端到端加密。
- Desktop 正在执行的回合仍归 Desktop 所有，相关审批需要在电脑端完成。
- App Server 协议会随 Codex 更新；升级 Codex 后应执行完整回归测试。

## 参与贡献

请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。提交问题时不要上传真实配对码、令牌、个人目录截图或 Codex 私密对话。

## 许可证

本项目采用 [Apache License 2.0](LICENSE)。第三方说明见 [NOTICE](NOTICE)。
