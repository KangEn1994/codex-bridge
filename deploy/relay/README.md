# Codex Bridge Relay 部署包

这个压缩包用于在你自己的 Linux 服务器上部署 HTTPS/WSS Relay。Relay 只负责转发；Codex 和项目文件仍运行、保存在你的 Windows 电脑上。

## 1. 准备域名和 HTTPS

将一个域名解析到服务器。Relay 必须通过 HTTPS/WSS 对外服务；不要直接把 HTTP 端口暴露到公网。

## 2. 生成独立凭据

Windows PowerShell：

```powershell
cd deploy\relay
.\prepare-config.ps1 -PublicUrl "https://bridge.example.com"
```

Linux：

```bash
cd deploy/relay
chmod +x prepare-config.sh
./prepare-config.sh https://bridge.example.com
```

命令会生成：

- `.env`：供服务器上的 Relay 使用。
- `relay-client.json`：包含桌面端“公网中继”页面要填写的地址、Host Token 和 Phone Token。

这两个文件都包含高权限凭据，不要上传到 GitHub，也不要发送给他人。

## 3. 启动 Relay

服务器已安装 Docker 与 Docker Compose 时，在压缩包根目录执行：

```bash
docker compose -f deploy/relay/compose.yaml up -d --build
curl http://127.0.0.1:43120/relay/health
```

Relay 默认只映射到服务器的 `127.0.0.1:43120`。请使用 Nginx、Caddy 或其他反向代理提供 HTTPS。Nginx 示例见 `deploy/relay/nginx-http.conf`。

## 4. 连接 Windows 电脑

在 Codex Bridge 托盘菜单中打开“手机连接…”并选择“公网中继”，将 `relay-client.json` 中的三项填入，然后点击“测试服务器”和“保存并重启”。

电脑只向 Relay 建立出站 WSS 连接，家庭网络不需要开放入站端口。随后打开配对二维码，用 Android App 扫码即可。

## 更新

保留 `.env` 后，用新版部署包替换其余文件并执行：

```bash
docker compose -f deploy/relay/compose.yaml up -d --build
```
