using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Windows.Forms;

namespace CodexBridge.Tray
{
    internal sealed class NetworkSettingsResult
    {
        public string ListenAddress = "127.0.0.1";
        public string PublicUrl = "http://127.0.0.1:43110";
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
        private readonly ComboBox addresses;
        private readonly Label preview;
        private readonly int apiPort;

        public NetworkSettingsResult Result { get; private set; }

        public NetworkSettingsDialog(string currentListenAddress, string currentPublicUrl, int apiPort)
        {
            this.apiPort = apiPort;
            Text = "Codex Bridge 连接设置";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            ClientSize = new Size(440, 330);
            Font = new Font("Segoe UI", 9F);
            BackColor = Color.FromArgb(246, 248, 251);

            var title = new Label
            {
                Text = "选择手机连接这台电脑的方式",
                Font = new Font("Segoe UI Semibold", 13F, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(24, 22)
            };
            var hint = new Label
            {
                Text = "局域网和可信异地组网（如 Tailscale、ZeroTier）不需要公网中继。",
                ForeColor = Color.FromArgb(85, 94, 108),
                Location = new Point(26, 55),
                Size = new Size(388, 38)
            };
            localOnly = new RadioButton { Text = "仅本机", Location = new Point(28, 103), AutoSize = true };
            networkAccess = new RadioButton { Text = "局域网 / 可信异地组网", Location = new Point(28, 136), AutoSize = true };
            addresses = new ComboBox
            {
                DropDownStyle = ComboBoxStyle.DropDownList,
                Location = new Point(48, 171),
                Size = new Size(365, 28)
            };
            foreach (NetworkAddressOption option in EnumerateAddresses()) addresses.Items.Add(option);
            preview = new Label
            {
                Location = new Point(28, 215),
                Size = new Size(385, 42),
                ForeColor = Color.FromArgb(55, 101, 157)
            };
            var save = new Button { Text = "保存并重启", DialogResult = DialogResult.OK, Location = new Point(278, 278), Size = new Size(135, 34) };
            var cancel = new Button { Text = "取消", DialogResult = DialogResult.Cancel, Location = new Point(178, 278), Size = new Size(90, 34) };

            Controls.Add(title);
            Controls.Add(hint);
            Controls.Add(localOnly);
            Controls.Add(networkAccess);
            Controls.Add(addresses);
            Controls.Add(preview);
            Controls.Add(save);
            Controls.Add(cancel);
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
            localOnly.Checked = currentListenAddress != "0.0.0.0";
            networkAccess.Checked = !localOnly.Checked;
            localOnly.CheckedChanged += delegate { RefreshSelection(); };
            networkAccess.CheckedChanged += delegate { RefreshSelection(); };
            addresses.SelectedIndexChanged += delegate { RefreshSelection(); };
            save.Click += delegate { BuildResult(); };
            RefreshSelection();
        }

        private void RefreshSelection()
        {
            addresses.Enabled = networkAccess.Checked;
            NetworkAddressOption option = addresses.SelectedItem as NetworkAddressOption;
            string address = localOnly.Checked ? "127.0.0.1" : (option == null ? "" : option.Address);
            preview.Text = string.IsNullOrEmpty(address)
                ? "没有找到可用的 IPv4 地址。"
                : "手机地址：http://" + address + ":" + apiPort;
        }

        private void BuildResult()
        {
            NetworkAddressOption option = addresses.SelectedItem as NetworkAddressOption;
            string address = localOnly.Checked ? "127.0.0.1" : (option == null ? "" : option.Address);
            if (string.IsNullOrWhiteSpace(address))
            {
                MessageBox.Show("没有找到可用的网络地址。", "Codex Bridge", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                DialogResult = DialogResult.None;
                return;
            }
            Result = new NetworkSettingsResult
            {
                ListenAddress = localOnly.Checked ? "127.0.0.1" : "0.0.0.0",
                PublicUrl = "http://" + address + ":" + apiPort
            };
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
