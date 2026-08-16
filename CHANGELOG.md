# Changelog

All notable changes to Codex Bridge will be documented in this file.

The project follows semantic versioning where practical. While the project is below `1.0.0`, configuration and integration details may change between minor releases.

## [Unreleased]

## [0.6.1] - 2026-08-16

### Added

- Added a first-class public relay mode to the Windows connection dialog, including HTTPS validation, relay server probing, and separate Host/Phone credentials.
- Added a download-ready `CodexBridge-Relay-Deploy.zip` artifact with Docker Compose, Windows/Linux credential generators, and deployment guidance.

### Changed

- Simplified the tray menu by grouping Bridge controls, diagnostics, and exit actions into submenus.
- Renamed the private overlay-network guidance to Linker / Tailscale and made the copied mobile address follow the active connection mode.
- Public relay mode now keeps the Windows Host bound to loopback and uses only an outbound WSS connection.

### Fixed

- Setup and uninstall now stop both installed and portable tray executable names, preventing an older tray process from retaining the single-instance lock.

## [0.6.0] - 2026-08-16

### Added

- Added approval-based direct pairing: enter the computer address on Android, approve the named device and source IP from the Windows tray, and receive the token automatically.
- Added tray controls for local-only, LAN, and private overlay-network access.
- Added download-ready Windows portable and per-user Setup packages with a bundled Node.js runtime.
- Added a unified release workflow for the Windows Setup EXE, portable ZIP, signed generic APK, and SHA-256 checksums.

### Changed

- Generic Android releases no longer embed a project-specific public relay URL.
- Downloaded Windows packages no longer require users to install Node.js or npm.

## [0.5.6] - 2026-08-16

### Fixed

- Prevented the Android release app from opening a blank screen when no default Bridge URL was embedded.
- Added a mandatory first-run connection dialog with QR pairing and manual URL options.
- Set the official Android release workflow to use the public Bridge web URL by default.

## [0.5.5] - 2026-08-16

- Initial open-source preview.

### Security

- Prepared release signing through external secrets instead of the Android debug key.
- Changed fresh Host installations to bind to loopback by default.
- Removed private QA screenshots, pairing QR codes, and committed APK artifacts from the public tree.

### Fixed

- Added `PATCH` support to the local API proxy used for run configuration and queue updates.
