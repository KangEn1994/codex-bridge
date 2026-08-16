# Changelog

All notable changes to Codex Bridge will be documented in this file.

The project follows semantic versioning where practical. While the project is below `1.0.0`, configuration and integration details may change between minor releases.

## [Unreleased]

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
