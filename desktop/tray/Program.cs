using System;
using System.IO;
using System.Threading;
using System.Windows.Forms;

namespace CodexBridge.Tray
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            bool createdNew;
            using (var mutex = new Mutex(true, "Local\\CodexBridge.Tray", out createdNew))
            {
                if (!createdNew)
                {
                    return;
                }

                string projectRoot = ResolveProjectRoot(args);
                if (!File.Exists(Path.Combine(projectRoot, "scripts", "start-codex-bridge.ps1")))
                {
                    MessageBox.Show("找不到 Codex Bridge 启动脚本：\r\n" + projectRoot,
                        "Codex Bridge", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new TrayApplicationContext(projectRoot));
                GC.KeepAlive(mutex);
            }
        }

        private static string ResolveProjectRoot(string[] args)
        {
            for (int index = 0; index < args.Length - 1; index++)
            {
                if (string.Equals(args[index], "--project-root", StringComparison.OrdinalIgnoreCase))
                    return Path.GetFullPath(Environment.ExpandEnvironmentVariables(args[index + 1]));
            }

            string inferred = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory);
            if (File.Exists(Path.Combine(inferred, "scripts", "start-codex-bridge.ps1"))) return inferred;
            inferred = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", ".."));
            if (File.Exists(Path.Combine(inferred, "scripts", "start-codex-bridge.ps1"))) return inferred;
            return Environment.CurrentDirectory;
        }
    }
}
