using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace CodexBridge.Tray
{
    internal sealed class TrayApplicationContext : ApplicationContext
    {
        private readonly string projectRoot;
        private readonly string configDirectory;
        private readonly NotifyIcon notifyIcon;
        private readonly ContextMenuStrip menu;
        private readonly ToolStripMenuItem statusItem;
        private readonly ToolStripMenuItem startItem;
        private readonly ToolStripMenuItem stopItem;
        private readonly ToolStripMenuItem restartItem;
        private readonly Control dispatcher;
        private readonly BridgeSupervisor supervisor;
        private readonly PairingApprovalMonitor pairingMonitor;
        private Icon currentIcon;

        public TrayApplicationContext(string projectRoot)
        {
            this.projectRoot = projectRoot;
            configDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex-bridge");
            dispatcher = new Control();
            dispatcher.CreateControl();

            statusItem = new ToolStripMenuItem("● 正在检查…") { Enabled = false };
            startItem = new ToolStripMenuItem("启动 Bridge", null, async delegate { await RunActionAsync(supervisor.StartBridgeAsync); });
            stopItem = new ToolStripMenuItem("停止 Bridge", null, async delegate { await RunActionAsync(supervisor.StopBridgeAsync); });
            restartItem = new ToolStripMenuItem("重启 Bridge", null, async delegate { await RunActionAsync(delegate { return supervisor.RestartBridgeAsync("manual-restart"); }); });

            menu = new ContextMenuStrip();
            menu.Items.Add(statusItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("打开手机管理页面", null, delegate { OpenUrl(supervisor.LastSnapshot.PublicUrl); }));
            menu.Items.Add(new ToolStripMenuItem("打开配对二维码", null, delegate { OpenUrl("http://127.0.0.1:43110/setup"); }));
            menu.Items.Add(new ToolStripMenuItem("复制公网地址", null, delegate { CopyPublicUrl(); }));
            menu.Items.Add(new ToolStripMenuItem("查看详细状态", null, delegate { ShowStatus(); }));
            menu.Items.Add(new ToolStripMenuItem("打开日志目录", null, delegate { OpenPath(Path.Combine(projectRoot, ".logs")); }));
            menu.Items.Add(new ToolStripMenuItem("查看托盘守护日志", null, delegate { OpenFile(Path.Combine(configDirectory, "tray.log")); }));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(startItem);
            menu.Items.Add(stopItem);
            menu.Items.Add(restartItem);
            menu.Items.Add(new ToolStripMenuItem("立即检查", null, delegate { supervisor.CheckNow(); }));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("退出托盘（Bridge 继续运行）", null, delegate { ExitTray(false); }));
            menu.Items.Add(new ToolStripMenuItem("退出并停止 Bridge", null, async delegate
            {
                await supervisor.StopBridgeAsync();
                ExitTray(true);
            }));

            menu.Items.Insert(4, new ToolStripMenuItem("连接方式与手机地址...", null, async delegate
            {
                await ShowNetworkSettingsAsync();
            }));

            currentIcon = StatusIcon.Create(BridgeState.Starting);
            notifyIcon = new NotifyIcon
            {
                Icon = currentIcon,
                Text = "Codex Bridge - 正在检查",
                ContextMenuStrip = menu,
                Visible = true
            };
            notifyIcon.DoubleClick += delegate { OpenUrl(supervisor.LastSnapshot.PublicUrl); };

            supervisor = new BridgeSupervisor(projectRoot);
            supervisor.SnapshotChanged += OnSnapshotChanged;
            supervisor.NotificationRequested += OnNotificationRequested;
            supervisor.Start();
            pairingMonitor = new PairingApprovalMonitor(delegate { return supervisor.LocalApiPort; });
            pairingMonitor.RequestReceived += OnPairingRequestReceived;
            pairingMonitor.Start();
        }

        private void OnPairingRequestReceived(PairingRequestInfo request)
        {
            if (dispatcher.IsDisposed) return;
            dispatcher.BeginInvoke((Action)async delegate
            {
                string deviceName = string.IsNullOrWhiteSpace(request.DeviceName) ? "Android 设备" : request.DeviceName;
                string remoteAddress = string.IsNullOrWhiteSpace(request.RemoteAddress) ? "未知" : request.RemoteAddress;
                DialogResult decision = MessageBox.Show(
                    "设备：" + deviceName + "\r\n" +
                    "来源 IP：" + remoteAddress + "\r\n\r\n" +
                    "是否允许此设备控制这台电脑上的 Codex？\r\n" +
                    "请只允许你认识的设备。",
                    "Codex Bridge 连接请求",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question,
                    MessageBoxDefaultButton.Button2,
                    MessageBoxOptions.DefaultDesktopOnly);
                try
                {
                    await pairingMonitor.DecideAsync(request.Id, decision == DialogResult.Yes);
                    notifyIcon.BalloonTipTitle = decision == DialogResult.Yes ? "设备已连接" : "已拒绝连接";
                    notifyIcon.BalloonTipText = deviceName;
                    notifyIcon.BalloonTipIcon = ToolTipIcon.Info;
                    notifyIcon.ShowBalloonTip(3000);
                }
                catch (Exception ex)
                {
                    MessageBox.Show(ex.Message, "Codex Bridge", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            });
        }

        private async Task RunActionAsync(Func<Task> action)
        {
            SetActionsEnabled(false);
            try { await action(); }
            catch (Exception ex)
            {
                MessageBox.Show(ex.Message, "Codex Bridge", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                SetActionsEnabled(true);
                supervisor.CheckNow();
            }
        }

        private async Task ShowNetworkSettingsAsync()
        {
            using (var dialog = new NetworkSettingsDialog(
                supervisor.CurrentListenAddress,
                supervisor.CurrentPublicUrl,
                supervisor.LocalApiPort))
            {
                if (dialog.ShowDialog() != DialogResult.OK || dialog.Result == null) return;
                await RunActionAsync(delegate
                {
                    return supervisor.SaveNetworkConfigurationAsync(
                        dialog.Result.ListenAddress,
                        dialog.Result.PublicUrl);
                });
                try { Clipboard.SetText(dialog.Result.PublicUrl); }
                catch { }
                MessageBox.Show(
                    "手机地址已复制：\r\n" + dialog.Result.PublicUrl +
                    "\r\n\r\n请在 Android App 中输入该地址，然后在这台电脑上允许连接请求。",
                    "Codex Bridge",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
        }

        private void OnSnapshotChanged(BridgeSnapshot snapshot)
        {
            if (dispatcher.IsDisposed) return;
            dispatcher.BeginInvoke((Action)delegate
            {
                string label;
                switch (snapshot.State)
                {
                    case BridgeState.Online: label = "● 运行正常"; break;
                    case BridgeState.Degraded: label = "● 部分连接异常"; break;
                    case BridgeState.Offline: label = "● 服务离线"; break;
                    case BridgeState.Stopped: label = "● 已停止"; break;
                    default: label = "● 正在启动/检查"; break;
                }
                statusItem.Text = label + " — " + snapshot.Detail;
                startItem.Enabled = snapshot.State == BridgeState.Stopped || snapshot.State == BridgeState.Offline;
                stopItem.Enabled = snapshot.State != BridgeState.Stopped;
                restartItem.Enabled = snapshot.State != BridgeState.Stopped;

                Icon replacement = StatusIcon.Create(snapshot.State);
                notifyIcon.Icon = replacement;
                Icon previous = currentIcon;
                currentIcon = replacement;
                if (previous != null) previous.Dispose();

                string text = "Codex Bridge - " + ShortState(snapshot.State);
                notifyIcon.Text = text.Length <= 63 ? text : text.Substring(0, 63);
            });
        }

        private void OnNotificationRequested(string title, string message)
        {
            if (dispatcher.IsDisposed) return;
            dispatcher.BeginInvoke((Action)delegate
            {
                notifyIcon.BalloonTipTitle = title;
                notifyIcon.BalloonTipText = message;
                notifyIcon.BalloonTipIcon = ToolTipIcon.Info;
                notifyIcon.ShowBalloonTip(4000);
            });
        }

        private void ShowStatus()
        {
            BridgeSnapshot value = supervisor.LastSnapshot;
            string relay = !value.RelayConfigured ? "未启用（直连）" :
                (value.RelayConnected ? "已连接" : (value.RelayReachable ? "正在重连" : "不可达"));
            string message =
                "状态：" + ShortState(value.State) + "\r\n\r\n" +
                "电脑 Host：" + YesNo(value.ApiUp) + "\r\n" +
                "Codex 内核：" + YesNo(value.CodexUp) + "\r\n" +
                "手机页面：" + YesNo(value.WebUp) + "\r\n" +
                "公网中继：" + relay + "\r\n\r\n" +
                "说明：" + value.Detail + "\r\n" +
                "检查时间：" + value.CheckedAt.ToString("yyyy-MM-dd HH:mm:ss") + "\r\n" +
                "公网地址：" + value.PublicUrl;
            MessageBox.Show(message, "Codex Bridge 状态", MessageBoxButtons.OK,
                value.State == BridgeState.Offline ? MessageBoxIcon.Warning : MessageBoxIcon.Information);
        }

        private void CopyPublicUrl()
        {
            string url = supervisor.LastSnapshot.PublicUrl;
            if (string.IsNullOrWhiteSpace(url)) return;
            try { Clipboard.SetText(url); }
            catch (Exception ex) { MessageBox.Show(ex.Message, "Codex Bridge", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        }

        private static string YesNo(bool value) { return value ? "正常" : "异常"; }

        private static string ShortState(BridgeState state)
        {
            switch (state)
            {
                case BridgeState.Online: return "运行正常";
                case BridgeState.Degraded: return "部分异常";
                case BridgeState.Offline: return "服务离线";
                case BridgeState.Stopped: return "已停止";
                default: return "正在检查";
            }
        }

        private void SetActionsEnabled(bool enabled)
        {
            startItem.Enabled = enabled;
            stopItem.Enabled = enabled;
            restartItem.Enabled = enabled;
        }

        private static void OpenUrl(string url)
        {
            if (string.IsNullOrWhiteSpace(url)) return;
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
            catch (Exception ex) { MessageBox.Show(ex.Message, "Codex Bridge", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        }

        private static void OpenPath(string path)
        {
            Directory.CreateDirectory(path);
            Process.Start(new ProcessStartInfo("explorer.exe", "\"" + path + "\"") { UseShellExecute = true });
        }

        private static void OpenFile(string path)
        {
            if (!File.Exists(path)) File.WriteAllText(path, "");
            Process.Start(new ProcessStartInfo("notepad.exe", "\"" + path + "\"") { UseShellExecute = true });
        }

        private void ExitTray(bool bridgeStopped)
        {
            try { File.WriteAllText(Path.Combine(configDirectory, "tray.stop.requested"), DateTime.Now.ToString("o")); }
            catch { }
            supervisor.Dispose();
            pairingMonitor.Dispose();
            notifyIcon.Visible = false;
            notifyIcon.Dispose();
            if (currentIcon != null) currentIcon.Dispose();
            dispatcher.Dispose();
            ExitThread();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                supervisor.Dispose();
                pairingMonitor.Dispose();
                notifyIcon.Dispose();
                menu.Dispose();
                dispatcher.Dispose();
                if (currentIcon != null) currentIcon.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    internal static class StatusIcon
    {
        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern bool DestroyIcon(IntPtr handle);

        public static Icon Create(BridgeState state)
        {
            Color color;
            switch (state)
            {
                case BridgeState.Online: color = Color.FromArgb(83, 207, 139); break;
                case BridgeState.Degraded: color = Color.FromArgb(255, 183, 77); break;
                case BridgeState.Offline: color = Color.FromArgb(239, 91, 91); break;
                case BridgeState.Stopped: color = Color.FromArgb(125, 132, 145); break;
                default: color = Color.FromArgb(229, 255, 94); break;
            }

            using (Stream iconStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("CodexBridge.TrayIcon.png"))
            using (var source = iconStream == null ? null : new Bitmap(iconStream))
            using (var bitmap = new Bitmap(32, 32, System.Drawing.Imaging.PixelFormat.Format32bppArgb))
            using (Graphics graphics = Graphics.FromImage(bitmap))
            using (var foreground = new SolidBrush(color))
            using (var statusBorder = new Pen(Color.FromArgb(245, 13, 15, 18), 2f))
            {
                graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                graphics.Clear(Color.Transparent);
                if (source != null) graphics.DrawImage(source, 0, 0, 32, 32);
                graphics.DrawEllipse(statusBorder, 22, 22, 8, 8);
                graphics.FillEllipse(foreground, 23, 23, 6, 6);
                IntPtr handle = bitmap.GetHicon();
                try
                {
                    using (Icon temporary = Icon.FromHandle(handle))
                        return (Icon)temporary.Clone();
                }
                finally { DestroyIcon(handle); }
            }
        }
    }
}
