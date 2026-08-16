using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace CodexBridge.Tray
{
    internal sealed class PairingRequestInfo
    {
        public string Id = "";
        public string DeviceName = "";
        public string RemoteAddress = "";
        public string UserAgent = "";
        public DateTime ExpiresAt;
    }

    internal sealed class PairingApprovalMonitor : IDisposable
    {
        private readonly Func<int> apiPort;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private readonly HashSet<string> prompted = new HashSet<string>(StringComparer.Ordinal);
        private readonly string logPath;
        private readonly System.Threading.Timer timer;
        private int polling;
        private bool disposed;

        public event Action<PairingRequestInfo> RequestReceived;

        public PairingApprovalMonitor(Func<int> apiPort)
        {
            this.apiPort = apiPort;
            string configDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex-bridge");
            Directory.CreateDirectory(configDirectory);
            logPath = Path.Combine(configDirectory, "tray.log");
            timer = new System.Threading.Timer(delegate { QueuePoll(); }, null, Timeout.Infinite, Timeout.Infinite);
        }

        public void Start()
        {
            timer.Change(750, 1500);
        }

        public Task DecideAsync(string requestId, bool allow)
        {
            return Task.Run(delegate
            {
                string url = LocalApiUrl() + "/api/pair/requests/" + Uri.EscapeDataString(requestId) + "/decision";
                byte[] payload = Encoding.UTF8.GetBytes(json.Serialize(new Dictionary<string, object>
                {
                    { "decision", allow ? "approve" : "deny" }
                }));
                var request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = "POST";
                request.ContentType = "application/json";
                request.ContentLength = payload.Length;
                request.Timeout = 5000;
                request.ReadWriteTimeout = 5000;
                request.UserAgent = "CodexBridge.Tray/0.6";
                request.Headers[HttpRequestHeader.Authorization] = "Bearer " + ReadHostToken();
                using (Stream stream = request.GetRequestStream()) stream.Write(payload, 0, payload.Length);
                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    if ((int)response.StatusCode < 200 || (int)response.StatusCode >= 300)
                        throw new InvalidOperationException("The computer could not save the pairing decision.");
                }
            });
        }

        private void QueuePoll()
        {
            if (disposed || Interlocked.Exchange(ref polling, 1) != 0) return;
            Task.Run(delegate
            {
                try { Poll(); }
                catch (Exception error) { Log("pairing_monitor_error", error.Message); }
                finally { Interlocked.Exchange(ref polling, 0); }
            });
        }

        private void Poll()
        {
            var request = (HttpWebRequest)WebRequest.Create(LocalApiUrl() + "/api/pair/requests");
            request.Method = "GET";
            request.Timeout = 1200;
            request.ReadWriteTimeout = 1200;
            request.UserAgent = "CodexBridge.Tray/0.6";
            request.Headers[HttpRequestHeader.Authorization] = "Bearer " + ReadHostToken();
            string body;
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream())) body = reader.ReadToEnd();
            var root = json.DeserializeObject(body) as Dictionary<string, object>;
            object rawItems;
            if (root == null || !root.TryGetValue("data", out rawItems)) return;
            var items = rawItems as object[];
            if (items == null) return;
            foreach (object rawItem in items)
            {
                var item = rawItem as Dictionary<string, object>;
                if (item == null) continue;
                string id = ReadString(item, "id");
                if (string.IsNullOrWhiteSpace(id) || !prompted.Add(id)) continue;
                DateTime expiresAt;
                DateTime.TryParse(ReadString(item, "expiresAt"), out expiresAt);
                var info = new PairingRequestInfo
                {
                    Id = id,
                    DeviceName = ReadString(item, "deviceName"),
                    RemoteAddress = NormalizeAddress(ReadString(item, "remoteAddress")),
                    UserAgent = ReadString(item, "userAgent"),
                    ExpiresAt = expiresAt
                };
                Action<PairingRequestInfo> handler = RequestReceived;
                Log("pairing_request_detected", info.Id + " " + info.DeviceName + " " + info.RemoteAddress);
                if (handler != null) handler(info);
            }
            if (prompted.Count > 256) prompted.Clear();
        }

        private string LocalApiUrl()
        {
            return "http://127.0.0.1:" + apiPort();
        }

        private string ReadHostToken()
        {
            string path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex-bridge", "config.json");
            if (!File.Exists(path)) throw new InvalidOperationException("Host pairing token is not ready.");
            var value = json.DeserializeObject(File.ReadAllText(path)) as Dictionary<string, object>;
            string token = value == null ? "" : ReadString(value, "token");
            if (token.Length < 20) throw new InvalidOperationException("Host pairing token is invalid.");
            return token;
        }

        private static string ReadString(Dictionary<string, object> value, string key)
        {
            object item;
            return value.TryGetValue(key, out item) && item != null ? Convert.ToString(item) : "";
        }

        private static string NormalizeAddress(string value)
        {
            const string prefix = "::ffff:";
            return value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ? value.Substring(prefix.Length) : value;
        }

        private void Log(string eventName, string detail)
        {
            try
            {
                File.AppendAllText(
                    logPath,
                    DateTime.Now.ToString("o") + " " + eventName + " " +
                    (detail ?? "").Replace("\r", " ").Replace("\n", " ") + Environment.NewLine,
                    Encoding.UTF8);
            }
            catch { }
        }

        public void Dispose()
        {
            disposed = true;
            timer.Dispose();
        }
    }
}
