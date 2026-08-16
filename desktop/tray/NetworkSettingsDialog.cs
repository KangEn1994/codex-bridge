using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace CodexBridge.Tray
{
    internal enum ConnectionMode
    {
        Local,
        Network,
        Relay
    }

    internal sealed class NetworkSettingsResult
    {
        public ConnectionMode Mode = ConnectionMode.Local;
        public string ListenAddress = "127.0.0.1";
        public string PublicUrl = "http://127.0.0.1:43110";
        public string MobileUrl = "http://127.0.0.1:43110";
        public string RelayPublicUrl = "";
        public string RelayHostToken = "";
        public string RelayPhoneToken = "";
    }

    internal sealed class NetworkAddressOption
    {
        public string Address = "";
        public string Label = "";
        public override string ToString() { return Label; }
    }

    internal sealed class NetworkSettingsDialog : Form
    {
        private readonly RadioButton localOnly;
        private readonly RadioButton networkAccess;
        private readonly RadioButton relayAccess;
        private readonly Label networkAddressLabel;
        private readonly ComboBox addresses;
        private readonly Label preview;
        private readonly Label relayUrlLabel;
        private readonly TextBox relayUrl;
        private readonly Label relayHostTokenLabel;
        private readonly TextBox relayHostToken;
        private readonly Label relayPhoneTokenLabel;
        private readonly TextBox relayPhoneToken;
        private readonly Label relayHint;
        private readonly Label relayStatus;
        private readonly Button testRelay;
        private readonly Button pairing;
        private readonly Button cancel;
        private readonly Button save;
        private readonly int apiPort;

        public NetworkSettingsResult Result { get; private set; }

        public NetworkSettingsDialog(
            string currentListenAddress,
            string currentPublicUrl,
            int apiPort,
            RelayConfiguration currentRelay)
        {
            this.apiPort = apiPort;
            Text = "Codex Bridge 手机连接";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(500, 360);
            Font = new Font("Segoe UI", 9F);
            BackColor = Color.FromArgb(246, 248, 251);

            var title = new Label
            {
                Text = "手机如何连接这台电脑",
                Font = new Font("Segoe UI Semibold", 13F, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(24, 18)
            };
            var hint = new Label
            {
                Text = "选择一种方式；只有当前方式需要的设置才会显示。",
                ForeColor = Color.FromArgb(85, 94, 108),
                Location = new Point(26, 50),
                Size = new Size(445, 28)
            };
            localOnly = new RadioButton { Text = "仅本机", Location = new Point(28, 88), AutoSize = true };
            networkAccess = new RadioButton
            {
                Text = "局域网 / 异地组网（Linker / Tailscale）",
                Location = new Point(28, 121),
                AutoSize = true
            };
            relayAccess = new RadioButton { Text = "公网中继", Location = new Point(28, 154), AutoSize = true };

            networkAddressLabel = new Label
            {
                Text = "电脑在该网络中的 IPv4 地址",
                Location = new Point(28, 199),
                AutoSize = true
            };
            addresses = new ComboBox
            {
                DropDownStyle = ComboBoxStyle.DropDownList,
                Location = new Point(28, 222),
                Size = new Size(443, 28)
            };
            foreach (NetworkAddressOption option in EnumerateAddresses()) addresses.Items.Add(option);
            preview = new Label
            {
                Location = new Point(28, 263),
                Size = new Size(443, 40),
                ForeColor = Color.FromArgb(55, 101, 157)
            };

            relayUrlLabel = new Label { Text = "中继服务器", Location = new Point(28, 199), AutoSize = true };
            relayUrl = new TextBox
            {
                Location = new Point(28, 222),
                Size = new Size(443, 25)
            };
            relayHostTokenLabel = new Label { Text = "电脑令牌（Host Token）", Location = new Point(28, 263), AutoSize = true };
            relayHostToken = new TextBox
            {
                Location = new Point(28, 286),
                Size = new Size(443, 25),
                UseSystemPasswordChar = true
            };
            relayPhoneTokenLabel = new Label { Text = "手机令牌（Phone Token）", Location = new Point(28, 327), AutoSize = true };
            relayPhoneToken = new TextBox
            {
                Location = new Point(28, 350),
                Size = new Size(443, 25),
                UseSystemPasswordChar = true
            };
            relayHint = new Label
            {
                Text = "令牌必须与中继服务器一致，且各不少于 32 个字符。Bridge 只会向中继建立出站连接。",
                Location = new Point(28, 387),
                Size = new Size(443, 38),
                ForeColor = Color.FromArgb(85, 94, 108)
            };
            testRelay = new Button { Text = "测试服务器", Location = new Point(28, 432), Size = new Size(108, 32) };
            relayStatus = new Label
            {
                Location = new Point(148, 439),
                Size = new Size(323, 25),
                ForeColor = Color.FromArgb(85, 94, 108)
            };

            pairing = new Button { Text = "打开配对二维码", Location = new Point(24, 310), Size = new Size(132, 34) };
            cancel = new Button { Text = "取消", DialogResult = DialogResult.Cancel, Location = new Point(268, 310), Size = new Size(90, 34) };
            save = new Button { Text = "保存并重启", DialogResult = DialogResult.OK, Location = new Point(368, 310), Size = new Size(108, 34) };

            Controls.Add(title);
            Controls.Add(hint);
            Controls.Add(localOnly);
            Controls.Add(networkAccess);
            Controls.Add(relayAccess);
            Controls.Add(networkAddressLabel);
            Controls.Add(addresses);
            Controls.Add(preview);
            Controls.Add(relayUrlLabel);
            Controls.Add(relayUrl);
            Controls.Add(relayHostTokenLabel);
            Controls.Add(relayHostToken);
            Controls.Add(relayPhoneTokenLabel);
            Controls.Add(relayPhoneToken);
            Controls.Add(relayHint);
            Controls.Add(testRelay);
            Controls.Add(relayStatus);
            Controls.Add(pairing);
            Controls.Add(cancel);
            Controls.Add(save);
            AcceptButton = save;
            CancelButton = cancel;

            Uri current;
            string currentHost = Uri.TryCreate(currentPublicUrl, UriKind.Absolute, out current) ? current.Host : "";
            int selectedIndex = -1;
            for (int index = 0; index < addresses.Items.Count; index++)
            {
                var option = addresses.Items[index] as NetworkAddressOption;
                if (option != null && string.Equals(option.Address, currentHost, StringComparison.OrdinalIgnoreCase)) selectedIndex = index;
            }
            if (selectedIndex >= 0) addresses.SelectedIndex = selectedIndex;
            else if (addresses.Items.Count > 0) addresses.SelectedIndex = 0;

            if (currentRelay != null && currentRelay.IsConfigured)
            {
                relayUrl.Text = currentRelay.PublicUrl;
                relayHostToken.Text = currentRelay.HostToken;
                relayPhoneToken.Text = currentRelay.PhoneToken;
                relayAccess.Checked = true;
            }
            else
            {
                localOnly.Checked = currentListenAddress != "0.0.0.0";
                networkAccess.Checked = !localOnly.Checked;
            }

            localOnly.CheckedChanged += delegate { RefreshSelection(); };
            networkAccess.CheckedChanged += delegate { RefreshSelection(); };
            relayAccess.CheckedChanged += delegate { RefreshSelection(); };
            addresses.SelectedIndexChanged += delegate { RefreshSelection(); };
            relayUrl.TextChanged += delegate { relayStatus.Text = ""; };
            testRelay.Click += async delegate { await TestRelayAsync(); };
            pairing.Click += delegate { OpenPairingPage(); };
            save.Click += delegate { BuildResult(); };
            RefreshSelection();
        }

        private void RefreshSelection()
        {
            bool isNetwork = networkAccess.Checked;
            bool isRelay = relayAccess.Checked;
            networkAddressLabel.Visible = isNetwork;
            addresses.Visible = isNetwork;
            preview.Visible = !isRelay;
            addresses.Enabled = isNetwork;

            relayUrlLabel.Visible = isRelay;
            relayUrl.Visible = isRelay;
            relayHostTokenLabel.Visible = isRelay;
            relayHostToken.Visible = isRelay;
            relayPhoneTokenLabel.Visible = isRelay;
            relayPhoneToken.Visible = isRelay;
            relayHint.Visible = isRelay;
            testRelay.Visible = isRelay;
            relayStatus.Visible = isRelay;

            if (isRelay)
            {
                ClientSize = new Size(500, 524);
                PositionFooter(474);
                return;
            }

            ClientSize = new Size(500, 360);
            PositionFooter(310);
            if (localOnly.Checked)
            {
                preview.Location = new Point(28, 205);
                preview.Text = "手机地址：http://127.0.0.1:" + apiPort + "\r\n仅用于这台电脑上的浏览器和配对页面。";
            }
            else
            {
                preview.Location = new Point(28, 263);
                NetworkAddressOption option = addresses.SelectedItem as NetworkAddressOption;
                preview.Text = option == null
                    ? "没有找到可用的 IPv4 地址。"
                    : "手机地址：http://" + option.Address + ":" + apiPort + "\r\n推荐通过 Linker / Tailscale 等可信私有网络访问。";
            }
        }

        private void PositionFooter(int y)
        {
            pairing.Location = new Point(24, y);
            cancel.Location = new Point(268, y);
            save.Location = new Point(368, y);
        }

        private void BuildResult()
        {
            if (relayAccess.Checked)
            {
                Uri parsedRelay;
                string normalizedRelay = relayUrl.Text.Trim().TrimEnd('/');
                if (!TryValidateSiteUrl(normalizedRelay, out parsedRelay))
                {
                    ShowValidation("请输入完整的 HTTPS 中继地址，例如 https://bridge.example.com。", relayUrl);
                    return;
                }
                if (parsedRelay.Scheme != Uri.UriSchemeHttps && !parsedRelay.IsLoopback)
                {
                    ShowValidation("公网中继必须使用 HTTPS。只有本机测试地址可以使用 HTTP。", relayUrl);
                    return;
                }
                if (relayHostToken.Text.Trim().Length < 32)
                {
                    ShowValidation("电脑令牌至少需要 32 个字符。", relayHostToken);
                    return;
                }
                if (relayPhoneToken.Text.Trim().Length < 32)
                {
                    ShowValidation("手机令牌至少需要 32 个字符。", relayPhoneToken);
                    return;
                }
                Result = new NetworkSettingsResult
                {
                    Mode = ConnectionMode.Relay,
                    ListenAddress = "127.0.0.1",
                    PublicUrl = "http://127.0.0.1:" + apiPort,
                    MobileUrl = normalizedRelay,
                    RelayPublicUrl = normalizedRelay,
                    RelayHostToken = relayHostToken.Text.Trim(),
                    RelayPhoneToken = relayPhoneToken.Text.Trim()
                };
                return;
            }

            NetworkAddressOption option = addresses.SelectedItem as NetworkAddressOption;
            string address = localOnly.Checked ? "127.0.0.1" : (option == null ? "" : option.Address);
            if (string.IsNullOrWhiteSpace(address))
            {
                ShowValidation("没有找到可用的网络地址。", addresses);
                return;
            }
            string directUrl = "http://" + address + ":" + apiPort;
            Result = new NetworkSettingsResult
            {
                Mode = localOnly.Checked ? ConnectionMode.Local : ConnectionMode.Network,
                ListenAddress = localOnly.Checked ? "127.0.0.1" : "0.0.0.0",
                PublicUrl = directUrl,
                MobileUrl = directUrl
            };
        }

        private async Task TestRelayAsync()
        {
            Uri parsed;
            string normalized = relayUrl.Text.Trim().TrimEnd('/');
            if (!TryValidateSiteUrl(normalized, out parsed))
            {
                ShowValidation("请先填写完整的中继地址。", relayUrl);
                return;
            }
            if (parsed.Scheme != Uri.UriSchemeHttps && !parsed.IsLoopback)
            {
                ShowValidation("公网中继必须使用 HTTPS。", relayUrl);
                return;
            }

            testRelay.Enabled = false;
            relayStatus.ForeColor = Color.FromArgb(85, 94, 108);
            relayStatus.Text = "正在连接服务器…";
            try
            {
                int status = await ProbeAsync(normalized + "/relay/health");
                relayStatus.ForeColor = Color.FromArgb(28, 132, 87);
                relayStatus.Text = "服务器可访问（HTTP " + status + "）";
            }
            catch (Exception ex)
            {
                relayStatus.ForeColor = Color.FromArgb(190, 55, 55);
                relayStatus.Text = "连接失败：" + ShortMessage(ex.Message, 48);
            }
            finally { testRelay.Enabled = true; }
        }

        private static Task<int> ProbeAsync(string url)
        {
            return Task.Run(delegate
            {
                var request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = "GET";
                request.Timeout = 7000;
                request.ReadWriteTimeout = 7000;
                request.UserAgent = "CodexBridge.Tray/0.6";
                using (var response = (HttpWebResponse)request.GetResponse())
                using (var stream = response.GetResponseStream())
                using (var reader = new StreamReader(stream))
                {
                    reader.ReadToEnd();
                    int status = (int)response.StatusCode;
                    if (status < 200 || status >= 400) throw new InvalidOperationException("HTTP " + status);
                    return status;
                }
            });
        }

        private static bool TryValidateSiteUrl(string value, out Uri parsed)
        {
            return Uri.TryCreate(value, UriKind.Absolute, out parsed) &&
                (parsed.Scheme == Uri.UriSchemeHttp || parsed.Scheme == Uri.UriSchemeHttps) &&
                string.IsNullOrEmpty(parsed.Query) && string.IsNullOrEmpty(parsed.Fragment) && parsed.AbsolutePath == "/";
        }

        private static string ShortMessage(string value, int maxLength)
        {
            string compact = (value ?? "未知错误").Replace("\r", " ").Replace("\n", " ");
            return compact.Length <= maxLength ? compact : compact.Substring(0, maxLength - 1) + "…";
        }

        private static void ShowValidation(string message, Control focus)
        {
            MessageBox.Show(message, "Codex Bridge", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            focus.Focus();
            Form form = focus.FindForm();
            if (form != null) form.DialogResult = DialogResult.None;
        }

        private void OpenPairingPage()
        {
            try
            {
                Process.Start(new ProcessStartInfo("http://127.0.0.1:" + apiPort + "/setup") { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.Message, "Codex Bridge", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private static IEnumerable<NetworkAddressOption> EnumerateAddresses()
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (NetworkInterface adapter in NetworkInterface.GetAllNetworkInterfaces()
                .Where(item => item.OperationalStatus == OperationalStatus.Up && item.NetworkInterfaceType != NetworkInterfaceType.Loopback))
            {
                foreach (UnicastIPAddressInformation unicast in adapter.GetIPProperties().UnicastAddresses)
                {
                    IPAddress address = unicast.Address;
                    string value = address.ToString();
                    if (address.AddressFamily != AddressFamily.InterNetwork || IPAddress.IsLoopback(address) ||
                        value.StartsWith("169.254.", StringComparison.Ordinal) || !seen.Add(value)) continue;
                    yield return new NetworkAddressOption { Address = value, Label = value + "  —  " + adapter.Name };
                }
            }
        }
    }

}
