# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [1.5.0](https://github.com/appkitstudio/llamacpp-cli/compare/v1.4.1...v1.5.0) (2026-01-13)


### Features

* add multi-server monitor with optimized metrics collection ([9deaf2b](https://github.com/appkitstudio/llamacpp-cli/commit/9deaf2b12280304a0941b0da82a0838d2a80bf6a))
* add real-time monitoring TUI with GPU/CPU metrics ([5f762f5](https://github.com/appkitstudio/llamacpp-cli/commit/5f762f542817e405fd05c1fe3282a4621456c068))

## [1.4.1](https://github.com/appkitstudio/llamacpp-cli/compare/v1.4.0...v1.4.1) (2026-01-09)


### Bug Fixes

* downgrade chalk to v4 for CommonJS compatibility ([0fb11d8](https://github.com/appkitstudio/llamacpp-cli/commit/0fb11d886039c3dea4846833f0e2cc5e264c1115))

## [1.4.0](https://github.com/appkitstudio/llamacpp-cli/compare/v1.3.3...v1.4.0) (2026-01-09)


### ⚠ BREAKING CHANGES

* ** Default models directory changed from ~/models to ~/.llamacpp/models

Changes:
- New default: ~/.llamacpp/models (keeps all llamacpp data in one place)
- Interactive prompt when models directory doesn't exist
- New 'config' command to view/change global settings
- Users can customize models directory and switch anytime

Commands:
- `llamacpp config` - View current configuration
- `llamacpp config --models-dir <path>` - Change models directory
- All commands (ls, pull, server create) now use configured directory

Interactive Setup:
- When models directory is missing, user is prompted to:
  1. Accept default path (press Enter)
  2. Specify custom path (type path and press Enter)
- Configuration is saved and persists across sessions
- Directory is created automatically after confirmation

Benefits:
- No more errors on fresh installs
- All llamacpp data in one place (~/.llamacpp/)
- Flexible for users who want custom locations
- Better onboarding experience

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>

### Features

* add configurable models directory with interactive setup ([975a81b](https://github.com/appkitstudio/llamacpp-cli/commit/975a81b217837b4238c4301f216e18e59f144cbe))

## [1.3.3](https://github.com/appkitstudio/llamacpp-cli/compare/v1.3.2...v1.3.3) (2026-01-09)


### Bug Fixes

* auto-create ~/models directory when downloading models ([a9f54c1](https://github.com/appkitstudio/llamacpp-cli/commit/a9f54c119a41e29fa42003f3c1af0a732f5db9ea))

## [1.3.2](https://github.com/appkitstudio/llamacpp-cli/compare/v1.3.1...v1.3.2) (2026-01-09)


### Bug Fixes

* read version from package.json instead of hardcoded value ([c9f3113](https://github.com/appkitstudio/llamacpp-cli/commit/c9f31133621a339f244073da918e1eec47f81e9c))

## [1.3.1](https://github.com/appkitstudio/llamacpp-cli/compare/v1.3.0...v1.3.1) (2026-01-09)


### Bug Fixes

* improve bin script resilience and add custom flags support ([9884ceb](https://github.com/appkitstudio/llamacpp-cli/commit/9884cebdebad2d20a00fd3b077f0b2d61aecdc8d))

## [1.3.0](https://github.com/appkitstudio/llamacpp-cli/compare/v1.2.0...v1.3.0) (2025-12-30)


### Features

* add server config command with host parameter support ([11faf4c](https://github.com/appkitstudio/llamacpp-cli/commit/11faf4c4031696be8e49efb6dbe73f4c5f5bee50))

## [1.2.0](https://github.com/appkitstudio/llamacpp-cli/compare/v1.1.1...v1.2.0) (2025-12-09)


### Features

* add 'show' command to display server configuration and status details ([1f615eb](https://github.com/appkitstudio/llamacpp-cli/commit/1f615ebe369ae9d61b087a79fc17787e4a56d3b5))
* add support for one-shot message mode in 'run' command ([853d62a](https://github.com/appkitstudio/llamacpp-cli/commit/853d62ab9ef9ec8c4e45213f00453d7b28648124))
* implement 'create' command for server management and update related documentation ([39996e2](https://github.com/appkitstudio/llamacpp-cli/commit/39996e26f412dd593d9c253322a90d17907dfff4))

## [1.1.1](https://github.com/appkitstudio/llamacpp-cli/compare/v1.1.0...v1.1.1) (2025-12-09)


### Bug Fixes

* update command syntax to include 'server' prefix for consistency ([22dfdfd](https://github.com/appkitstudio/llamacpp-cli/commit/22dfdfd62026503a19ff0a6d91da88954f71d1ff))

## [1.1.0](https://github.com/appkitstudio/llamacpp-cli/compare/v1.0.0...v1.1.0) (2025-12-09)


### Features

* enhance logging and server status features ([1411e76](https://github.com/appkitstudio/llamacpp-cli/commit/1411e7677d01b2d04096d3d271ae95bb517e59b2))

## 1.0.0 (2025-12-04)


### Features

* refactored and added commands ([0e58ae1](https://github.com/appkitstudio/llamacpp-cli/commit/0e58ae1c619a519b484ae3c78863b4932672865c))
