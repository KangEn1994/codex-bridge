# Changelog

All notable changes to Codex Bridge will be documented in this file.

The project follows semantic versioning where practical. While the project is below `1.0.0`, configuration and integration details may change between minor releases.

## [Unreleased]

### Security

- Prepared release signing through external secrets instead of the Android debug key.
- Changed fresh Host installations to bind to loopback by default.
- Removed private QA screenshots, pairing QR codes, and committed APK artifacts from the public tree.

### Fixed

- Added `PATCH` support to the local API proxy used for run configuration and queue updates.

## [0.5.5] - Unreleased

- Initial open-source preview.
