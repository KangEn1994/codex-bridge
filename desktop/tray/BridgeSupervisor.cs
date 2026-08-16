using Microsoft.Win32;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace CodexBridge.Tray
{
    internal enum BridgeState
    {
        Starting,
        Online,
        Degraded,
        Offline,
        Stopped
    }

    internal sealed class BridgeSnapshot
    {
        public BridgeState State;
        public bool ApiUp;
        public bool CodexUp;
        public bool WebUp;
        public bool RelayReachable;
        public bool RelayConnected;
        public bool RelayConfigured;
        public string PublicUrl = "";
        public string Detail = "";
        public DateTime CheckedAt;
    }

    internal sealed class RelayConfiguration
    {
        public string PublicUrl = "";
        public string HostToken = "";
        public string PhoneToken = "";
        public bool IsConfigured
        {
            get
            {
                return !string.IsNullOrWhiteSpace(PublicUrl) &&
                    HostToken.Length >= 32 && PhoneToken.Length >= 32;
            }
        }
    }

    internal sealed class BridgeSupervisor : IDisposable
    {
        private readonly string projectRoot;
        private readonly string configDirectory;
        private readonly string startScript;
        private readonly string stopScript;
        private readonly string statePath;
        private readonly string logPath;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private readonly System.Threading.Timer timer;
        private int checkInProgress;
        private int recoveryInProgress;
        private int localFailureCount;
        private DateTime lastRecoveryAt = DateTime.MinValue;
        private int recoveryDelaySeconds = 15;
        private DateTime lastVersionCheckAt = DateTime.MinValue;
        private bool disposed;
        private bool enabled;

        public event Action<BridgeSnapshot> SnapshotChanged;
        public event Action<string, string> NotificationRequested;

        public BridgeSnapshot LastSnapshot { get; private set; }
        public bool Enabled { get { return enabled; } }
        public int LocalApiPort { get { return ReadLauncherConfig().ApiPort; } }
        public string CurrentListenAddress { get { return ReadLauncherConfig().ListenAddress; } }
        public string CurrentPublicUrl { get { return ReadLauncherConfig().PublicUrl; } }
        public RelayConfiguration CurrentRelayConfiguration { get { return ReadRelayConfiguration(); } }
        public string CurrentMobileUrl { get { return ReadEffectiveMobileUrl(); } }

        public BridgeSupervisor(string projectRoot)
        {
            this.projectRoot = projectRoot;
            configDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex-bridge");
            Directory.CreateDirectory(configDirectory);
            startScript = Path.Combine(projectRoot, "scripts", "start-codex-bridge.ps1");
            stopScript = Path.Combine(projectRoot, "scripts", "stop-codex-bridge.ps1");
            statePath = Path.Combine(configDirectory, "tray-state.json");
            logPath = Path.Combine(configDirectory, "tray.log");
            enabled = LoadEnabledState();
            LastSnapshot = new BridgeSnapshot { State = BridgeState.Starting, Detail = "正在检查服务…", CheckedAt = DateTime.Now };
            SystemEvents.PowerModeChanged += OnPowerModeChanged;
            timer = new System.Threading.Timer(delegate { QueueCheck(); }, null, Timeout.Infinite, Timeout.Infinite);
        }

        public void Start()
        {
            Log("tray_started", "enabled=" + enabled);
            timer.Change(250, 10000);
        }

        public Task StartBridgeAsync()
        {
            enabled = true;
            SaveEnabledState();
            PublishStarting("正在启动 Bridge…");
            return RunRecoveryAsync(false, "manual-start", true);
        }

        public Task StopBridgeAsync()
        {
            enabled = false;
            SaveEnabledState();
            PublishStarting("正在停止 Bridge…");
            return Task.Run(delegate
            {
                RunPowerShell(stopScript, "", 30000);
                localFailureCount = 0;
                Publish(new BridgeSnapshot
                {
                    State = BridgeState.Stopped,
                    PublicUrl = ReadEffectiveMobileUrl(),
                    Detail = "已由用户停止",
                    CheckedAt = DateTime.Now
                });
            });
        }

        public Task RestartBridgeAsync(string reason)
        {
            enabled = true;
            SaveEnabledState();
            PublishStarting("正在重启 Bridge…");
            return RunRecoveryAsync(true, reason, true);
        }

        public Task SaveConnectionConfigurationAsync(NetworkSettingsResult settings)
        {
            if (settings == null) throw new ArgumentNullException("settings");
            string listenAddress = settings.ListenAddress;
            string publicUrl = settings.PublicUrl;
            if (listenAddress != "127.0.0.1" && listenAddress != "0.0.0.0")
                throw new ArgumentException("Listen address must be local-only or all network adapters.");
            if (settings.Mode == ConnectionMode.Relay && listenAddress != "127.0.0.1")
                throw new ArgumentException("Public relay mode must keep the local Host bound to loopback.");
            Uri parsed;
            if (!Uri.TryCreate(publicUrl, UriKind.Absolute, out parsed) ||
                (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps) ||
                !string.IsNullOrEmpty(parsed.Query) || !string.IsNullOrEmpty(parsed.Fragment) ||
                parsed.AbsolutePath != "/")
                throw new ArgumentException("Mobile address must be a complete HTTP or HTTPS site address.");
            LauncherConfig current = ReadLauncherConfig();
            var value = new Dictionary<string, object>
            {
                { "publicUrl", publicUrl.TrimEnd('/') },
                { "apiPort", current.ApiPort },
                { "webPort", current.WebPort },
                { "listenAddress", listenAddress }
            };
            Dictionary<string, object> relayValue = null;
            string relayPath = Path.Combine(configDirectory, "relay.json");
            if (settings.Mode == ConnectionMode.Relay)
            {
                Uri relayUri;
                if (!Uri.TryCreate(settings.RelayPublicUrl, UriKind.Absolute, out relayUri) ||
                    (relayUri.Scheme != Uri.UriSchemeHttps && !relayUri.IsLoopback) ||
                    !string.IsNullOrEmpty(relayUri.Query) || !string.IsNullOrEmpty(relayUri.Fragment) ||
                    relayUri.AbsolutePath != "/")
                    throw new ArgumentException("Relay address must be an HTTPS site root URL.");
                if ((settings.RelayHostToken ?? "").Trim().Length < 32 ||
                    (settings.RelayPhoneToken ?? "").Trim().Length < 32)
                    throw new ArgumentException("Relay tokens must contain at least 32 characters.");
                relayValue = new Dictionary<string, object>
                {
                    { "publicUrl", settings.RelayPublicUrl.TrimEnd('/') },
                    { "hostToken", settings.RelayHostToken.Trim() },
                    { "phoneToken", settings.RelayPhoneToken.Trim() }
                };
            }

            WriteJsonAtomic(Path.Combine(configDirectory, "launcher.json"), value);
            if (relayValue != null) WriteJsonAtomic(relayPath, relayValue);
            else if (File.Exists(relayPath))
            {
                File.Delete(relayPath);
            }

            Log("connection_configuration_saved", settings.Mode + " " + settings.MobileUrl);
            return RestartBridgeAsync("connection-configuration-changed");
        }

        public void CheckNow()
        {
            QueueCheck();
        }

        private void QueueCheck()
        {
            if (disposed || Interlocked.Exchange(ref checkInProgress, 1) != 0) return;
            Task.Run(async delegate
            {
                try { await CheckAsync(); }
                catch (Exception ex) { Log("check_error", ex.Message); }
                finally { Interlocked.Exchange(ref checkInProgress, 0); }
            });
        }

        private async Task CheckAsync()
        {
            if (!enabled)
            {
                Publish(new BridgeSnapshot
                {
                    State = BridgeState.Stopped,
                    PublicUrl = ReadEffectiveMobileUrl(),
                    Detail = "已停止；可从托盘菜单重新启动",
                    CheckedAt = DateTime.Now
                });
                return;
            }

            LauncherConfig config = ReadLauncherConfig();
            ProbeResult api = await ProbeAsync("http://127.0.0.1:" + config.ApiPort + "/api/health", 3000);
            ProbeResult web = await ProbeAsync("http://127.0.0.1:" + config.WebPort + "/", 3000);
            bool codexUp = api.Success && JsonBoolean(api.Body, "codex");
            bool? hostRelayConnected = JsonOptionalBoolean(api.Body, "relayConnected");
            bool relayConfigured = JsonOptionalBoolean(api.Body, "relayConfigured") ?? !string.IsNullOrWhiteSpace(ReadRelayPublicUrl());
            ProbeResult relay = new ProbeResult();
            string relayUrl = ReadRelayPublicUrl();
            // The Host owns the persistent WSS socket, so its state is the
            // authoritative signal. Only probe the public endpoint when the
            // Host reports offline (or an older Host does not expose state).
            // This avoids false yellow tray states caused by transient local
            // DNS, proxy auto-detection, or NAT loopback failures while the
            // actual relay socket is still healthy.
            if (relayConfigured && hostRelayConnected != true && !string.IsNullOrWhiteSpace(relayUrl))
                relay = await ProbeAsync(relayUrl.TrimEnd('/') + "/relay/health", 5000);
            bool relayConnected = relay.Success && JsonBoolean(relay.Body, "hostConnected");

            var snapshot = new BridgeSnapshot
            {
                ApiUp = api.Success,
                CodexUp = codexUp,
                WebUp = web.Success,
                RelayReachable = !relayConfigured || hostRelayConnected == true || relay.Success,
                RelayConnected = !relayConfigured || (hostRelayConnected ?? relayConnected),
                RelayConfigured = relayConfigured,
                PublicUrl = relayConfigured ? relayUrl : config.PublicUrl,
                CheckedAt = DateTime.Now
            };

            bool localHealthy = snapshot.ApiUp && snapshot.CodexUp && snapshot.WebUp;
            if (localHealthy && snapshot.RelayConnected)
            {
                snapshot.State = BridgeState.Online;
                snapshot.Detail = relayConfigured
                    ? "电脑、Codex 和公网中继均正常"
                    : (config.ListenAddress == "0.0.0.0"
                        ? "电脑和 Codex 均正常，当前使用局域网 / Linker / Tailscale"
                        : "电脑和 Codex 均正常，当前仅本机连接");
                localFailureCount = 0;
                recoveryDelaySeconds = 15;
            }
            else if (localHealthy)
            {
                snapshot.State = BridgeState.Degraded;
                snapshot.Detail = snapshot.RelayReachable ? "本地正常，公网中继正在重连" : "本地正常，暂时无法访问公网中继";
                localFailureCount = 0;
            }
            else
            {
                localFailureCount++;
                snapshot.State = localFailureCount < 2 ? BridgeState.Starting : BridgeState.Offline;
                snapshot.Detail = BuildFailureDetail(snapshot);
            }

            BridgeState previousState = LastSnapshot.State;
            Publish(snapshot);

            if (localHealthy)
            {
                if ((previousState == BridgeState.Offline || previousState == BridgeState.Starting) && snapshot.State == BridgeState.Online)
                    Notify("Codex Bridge 已恢复", "电脑端和公网连接已经恢复正常。");
                await CheckCodexUpdateAsync();
                return;
            }

            if (localFailureCount >= 2)
            {
                bool fullRestart = snapshot.ApiUp && snapshot.WebUp && !snapshot.CodexUp;
                await RunRecoveryAsync(fullRestart, fullRestart ? "codex-offline" : "local-health-failed", false);
            }
        }

        private async Task CheckCodexUpdateAsync()
        {
            if ((DateTime.Now - lastVersionCheckAt).TotalMinutes < 10) return;
            lastVersionCheckAt = DateTime.Now;
            string current = await Task.Run(delegate { return ReadInstalledCodexVersion(); });
            if (string.IsNullOrWhiteSpace(current)) return;
            string versionPath = Path.Combine(configDirectory, "last-codex-version.txt");
            string previous = File.Exists(versionPath) ? File.ReadAllText(versionPath).Trim() : "";
            File.WriteAllText(versionPath, current, Encoding.UTF8);
            if (!string.IsNullOrWhiteSpace(previous) && !string.Equals(previous, current, StringComparison.OrdinalIgnoreCase))
            {
                Log("codex_update_detected", previous + " -> " + current);
                Notify("检测到 Codex 更新", "正在重启 Bridge 以使用新版 Codex 内核。");
                await RunRecoveryAsync(true, "codex-updated", true);
            }
        }

        private Task RunRecoveryAsync(bool fullRestart, string reason, bool force)
        {
            if (disposed || !enabled) return Task.FromResult(0);
            if (Interlocked.Exchange(ref recoveryInProgress, 1) != 0) return Task.FromResult(0);
            if (!force && (DateTime.Now - lastRecoveryAt).TotalSeconds < recoveryDelaySeconds)
            {
                Interlocked.Exchange(ref recoveryInProgress, 0);
                return Task.FromResult(0);
            }

            lastRecoveryAt = DateTime.Now;
            if (!force) recoveryDelaySeconds = Math.Min(recoveryDelaySeconds * 2, 300);
            Log("recovery_started", reason + ", fullRestart=" + fullRestart);
            PublishStarting(fullRestart ? "Codex 异常，正在重启 Bridge…" : "服务中断，正在自动拉起…");

            return Task.Run(delegate
            {
                try
                {
                    if (fullRestart) RunPowerShell(stopScript, "", 30000);
                    RunPowerShell(startScript, "-NoBrowser", 45000);
                    Log("recovery_finished", reason);
                }
                catch (Exception ex)
                {
                    Log("recovery_failed", reason + ": " + ex.Message);
                    Notify("Codex Bridge 恢复失败", "请右键托盘图标查看日志或手动重启。");
                }
                finally
                {
                    Interlocked.Exchange(ref recoveryInProgress, 0);
                    Thread.Sleep(1500);
                    QueueCheck();
                }
            });
        }

        private void OnPowerModeChanged(object sender, PowerModeChangedEventArgs args)
        {
            if (args.Mode != PowerModes.Resume || !enabled) return;
            Log("power_resume", "checking bridge after resume");
            PublishStarting("电脑已唤醒，正在恢复连接…");
            Task.Delay(3000).ContinueWith(delegate { QueueCheck(); });
        }

        private void PublishStarting(string detail)
        {
            LauncherConfig config = ReadLauncherConfig();
            Publish(new BridgeSnapshot { State = BridgeState.Starting, PublicUrl = ReadEffectiveMobileUrl(), Detail = detail, CheckedAt = DateTime.Now });
        }

        private void Publish(BridgeSnapshot snapshot)
        {
            LastSnapshot = snapshot;
            Action<BridgeSnapshot> handler = SnapshotChanged;
            if (handler != null) handler(snapshot);
        }

        private void Notify(string title, string message)
        {
            Action<string, string> handler = NotificationRequested;
            if (handler != null) handler(title, message);
        }

        private string BuildFailureDetail(BridgeSnapshot snapshot)
        {
            var missing = new List<string>();
            if (!snapshot.ApiUp) missing.Add("Host");
            else if (!snapshot.CodexUp) missing.Add("Codex 内核");
            if (!snapshot.WebUp) missing.Add("手机网页");
            return (localFailureCount < 2 ? "正在确认：" : "异常：") + string.Join("、", missing.ToArray());
        }

        private LauncherConfig ReadLauncherConfig()
        {
            var result = new LauncherConfig { ApiPort = 43110, WebPort = 3000, PublicUrl = "http://127.0.0.1:43110", ListenAddress = "127.0.0.1" };
            string path = Path.Combine(configDirectory, "launcher.json");
            try
            {
                if (!File.Exists(path)) return result;
                var value = json.DeserializeObject(File.ReadAllText(path)) as Dictionary<string, object>;
                if (value == null) return result;
                result.ApiPort = DictionaryInt(value, "apiPort", result.ApiPort);
                result.WebPort = DictionaryInt(value, "webPort", result.WebPort);
                result.PublicUrl = DictionaryString(value, "publicUrl", result.PublicUrl);
                result.ListenAddress = DictionaryString(value, "listenAddress", result.ListenAddress);
            }
            catch (Exception ex) { Log("launcher_config_error", ex.Message); }
            return result;
        }

        private string ReadRelayPublicUrl()
        {
            RelayConfiguration relay = ReadRelayConfiguration();
            return relay.IsConfigured ? relay.PublicUrl : "";
        }

        private RelayConfiguration ReadRelayConfiguration()
        {
            var result = new RelayConfiguration();
            try
            {
                string path = Path.Combine(configDirectory, "relay.json");
                if (!File.Exists(path)) return result;
                var value = json.DeserializeObject(File.ReadAllText(path)) as Dictionary<string, object>;
                if (value == null) return result;
                result.PublicUrl = DictionaryString(value, "publicUrl", "").TrimEnd('/');
                result.HostToken = DictionaryString(value, "hostToken", "");
                result.PhoneToken = DictionaryString(value, "phoneToken", "");
            }
            catch (Exception ex) { Log("relay_config_error", ex.Message); }
            return result;
        }

        private string ReadEffectiveMobileUrl()
        {
            RelayConfiguration relay = ReadRelayConfiguration();
            return relay.IsConfigured ? relay.PublicUrl : ReadLauncherConfig().PublicUrl;
        }

        private void WriteJsonAtomic(string path, object value)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            string temporary = path + ".tmp-" + Guid.NewGuid().ToString("N");
            try
            {
                File.WriteAllText(temporary, json.Serialize(value), new UTF8Encoding(false));
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            }
            finally
            {
                if (File.Exists(temporary)) File.Delete(temporary);
            }
        }

        private bool LoadEnabledState()
        {
            try
            {
                if (!File.Exists(statePath)) return true;
                var value = json.DeserializeObject(File.ReadAllText(statePath)) as Dictionary<string, object>;
                return value == null || !value.ContainsKey("enabled") || Convert.ToBoolean(value["enabled"]);
            }
            catch { return true; }
        }

        private void SaveEnabledState()
        {
            try { File.WriteAllText(statePath, json.Serialize(new Dictionary<string, object> { { "enabled", enabled } }), Encoding.UTF8); }
            catch (Exception ex) { Log("state_save_error", ex.Message); }
        }

        private string ReadInstalledCodexVersion()
        {
            const string command = "$p=Get-AppxPackage -Name OpenAI.Codex|Sort-Object Version -Descending|Select-Object -First 1; if($p){[string]$p.Version}else{''}";
            var info = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe"),
                Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"" + command.Replace("\"", "\\\"") + "\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using (var process = Process.Start(info))
            {
                string output = process.StandardOutput.ReadToEnd().Trim();
                if (!process.WaitForExit(10000)) { try { process.Kill(); } catch { } return ""; }
                return process.ExitCode == 0 ? output : "";
            }
        }

        private void RunPowerShell(string script, string scriptArguments, int timeoutMs)
        {
            string executable = Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe");
            string arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File \"" + script + "\"";
            if (!string.IsNullOrWhiteSpace(scriptArguments)) arguments += " " + scriptArguments;
            var info = new ProcessStartInfo
            {
                FileName = executable,
                Arguments = arguments,
                WorkingDirectory = projectRoot,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using (var process = Process.Start(info))
            {
                if (!process.WaitForExit(timeoutMs))
                {
                    try { process.Kill(); } catch { }
                    throw new TimeoutException(Path.GetFileName(script) + " 执行超时");
                }
                if (process.ExitCode != 0)
                    throw new InvalidOperationException(Path.GetFileName(script) + " 退出代码 " + process.ExitCode);
            }
        }

        private static async Task<ProbeResult> ProbeAsync(string url, int timeoutMs)
        {
            return await Task.Run(delegate
            {
                var result = new ProbeResult();
                try
                {
                    ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;
                    var request = (HttpWebRequest)WebRequest.Create(url);
                    request.Method = "GET";
                    request.Timeout = timeoutMs;
                    request.ReadWriteTimeout = timeoutMs;
                    request.UserAgent = "CodexBridge.Tray/0.1";
                    using (var response = (HttpWebResponse)request.GetResponse())
                    using (var reader = new StreamReader(response.GetResponseStream()))
                    {
                        result.StatusCode = (int)response.StatusCode;
                        result.Body = reader.ReadToEnd();
                        result.Success = result.StatusCode >= 200 && result.StatusCode < 400;
                    }
                }
                catch (WebException ex)
                {
                    result.Error = ex.Status.ToString();
                    var response = ex.Response as HttpWebResponse;
                    if (response != null) result.StatusCode = (int)response.StatusCode;
                }
                catch (Exception ex) { result.Error = ex.Message; }
                return result;
            });
        }

        private bool JsonBoolean(string body, string key)
        {
            try
            {
                var value = json.DeserializeObject(body) as Dictionary<string, object>;
                return value != null && value.ContainsKey(key) && Convert.ToBoolean(value[key]);
            }
            catch { return false; }
        }

        private bool? JsonOptionalBoolean(string body, string key)
        {
            try
            {
                var value = json.DeserializeObject(body) as Dictionary<string, object>;
                if (value == null || !value.ContainsKey(key)) return null;
                return Convert.ToBoolean(value[key]);
            }
            catch { return null; }
        }

        private static int DictionaryInt(Dictionary<string, object> value, string key, int fallback)
        {
            object item;
            return value.TryGetValue(key, out item) ? Convert.ToInt32(item) : fallback;
        }

        private static string DictionaryString(Dictionary<string, object> value, string key, string fallback)
        {
            object item;
            return value.TryGetValue(key, out item) && item != null ? Convert.ToString(item) : fallback;
        }

        private void Log(string eventName, string detail)
        {
            try
            {
                string safeDetail = (detail ?? "").Replace("\r", " ").Replace("\n", " ");
                File.AppendAllText(logPath, DateTime.Now.ToString("o") + " " + eventName + " " + safeDetail + Environment.NewLine, Encoding.UTF8);
            }
            catch { }
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            timer.Dispose();
            SystemEvents.PowerModeChanged -= OnPowerModeChanged;
            Log("tray_stopped", "");
        }

        private sealed class ProbeResult
        {
            public bool Success;
            public int StatusCode;
            public string Body = "";
            public string Error = "";
        }

        private sealed class LauncherConfig
        {
            public int ApiPort;
            public int WebPort;
            public string PublicUrl = "";
            public string ListenAddress = "127.0.0.1";
        }
    }
}
