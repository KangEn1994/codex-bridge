# Codex Bridge Tray

`CodexBridge.Tray.exe` is the Windows tray host and outer supervisor for Codex Bridge.

It monitors the local Host API, Codex app-server, mobile web process, and public relay. It starts missing components, performs a full Bridge restart when the Codex child becomes unavailable, and checks again after Windows resumes from sleep. Repeated recoveries are rate-limited.

Build it with:

```powershell
.\scripts\build-tray.ps1
```

The executable is written to `desktop\tray\bin\CodexBridge.Tray.exe`, outside the web build's disposable `dist` directory. `scripts\install-startup.ps1` registers `scripts\run-tray.ps1` as the current user's logon task. The runner restarts the tray executable within three seconds after an unexpected exit; an intentional tray exit writes a stop signal first. No separate .NET runtime or SDK installation is required because the build uses the .NET Framework compiler included with Windows.
