using Microsoft.Win32;
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace CodexBridge.Setup
{
    internal static class Uninstaller
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            if (MessageBox.Show(
                "Remove Codex Bridge from this computer?\r\n\r\nPairing settings and logs in your user profile will be kept.",
                "Uninstall Codex Bridge",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning,
                MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
            try
            {
                StopBridge();
                foreach (Process process in Process.GetProcessesByName("CodexBridge.Tray"))
                    try { process.Kill(); process.WaitForExit(5000); } catch { }
                string startup = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "Codex Bridge.lnk");
                string startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Codex Bridge");
                if (File.Exists(startup)) File.Delete(startup);
                if (Directory.Exists(startMenu)) Directory.Delete(startMenu, true);
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\CodexBridge", false);

                string appRoot = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar));
                string localBase = Path.GetFullPath(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CodexBridge"));
                if (!appRoot.StartsWith(localBase + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("The installation directory could not be validated.");
                string command = "Start-Sleep -Milliseconds 800; Remove-Item -LiteralPath '" + appRoot.Replace("'", "''") + "' -Recurse -Force";
                Process.Start(new ProcessStartInfo
                {
                    FileName = Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe"),
                    Arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -Command \"" + command.Replace("\"", "`\"") + "\"",
                    UseShellExecute = false,
                    CreateNoWindow = true
                });
            }
            catch (Exception error)
            {
                MessageBox.Show(error.Message, "Uninstall Codex Bridge", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Environment.ExitCode = 1;
            }
        }

        private static void StopBridge()
        {
            string script = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "scripts", "stop-codex-bridge.ps1");
            if (!File.Exists(script)) return;
            try
            {
                using (Process process = Process.Start(new ProcessStartInfo
                {
                    FileName = Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe"),
                    Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\"",
                    UseShellExecute = false,
                    CreateNoWindow = true
                }))
                {
                    if (process != null) process.WaitForExit(15000);
                }
            }
            catch { }
        }
    }
}
