# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [1.12.1](https://github.com/appkitstudio/llamacpp-cli/compare/v1.12.0...v1.12.1) (2026-02-06)


### Features

* add monitor detail image to documentation ([9acf4ec](https://github.com/appkitstudio/llamacpp-cli/commit/9acf4ec74c84e9bc78d429add8c90865c2437066))


### Bug Fixes

* correct GitHub image URLs to use appkitstudio repository ([5f19e51](https://github.com/appkitstudio/llamacpp-cli/commit/5f19e511cf6c0195839f7a5e75661377d9ded287))
* include web UI dist files in npm package ([54fd673](https://github.com/appkitstudio/llamacpp-cli/commit/54fd673d1042a3f4bf233c79a22b61690d81d4b8))

## [1.12.0](https://github.com/appkitstudio/llamacpp-cli/compare/v1.11.0...v1.12.0) (2026-02-06)


### Features

* add filtering functionality for models and servers in the admin interface ([fb8eb57](https://github.com/appkitstudio/llamacpp-cli/commit/fb8eb573311470b7e4e20a204af1df81bafef86d))
* add Router and RouterLogs pages with functionality to manage router service ([6efda90](https://github.com/appkitstudio/llamacpp-cli/commit/6efda906f224997476a75507f97916b2b00e4cbf))
* filter health check logs and improve log viewer UX ([ab42b2b](https://github.com/appkitstudio/llamacpp-cli/commit/ab42b2bd7c42c4f146ae51b9bc9060685844301e))
* initialize web application with React, TypeScript, and Tailwind CSS ([f30e0d7](https://github.com/appkitstudio/llamacpp-cli/commit/f30e0d7f106b7633ed716083e35abf098efbb10b))

## [1.10.1](https://github.com/appkitstudio/llamacpp-cli/compare/v1.10.0...v1.10.1) (2026-02-04)


### Features

* increase max context size limit from 128k to 2M ([c3a810c](https://github.com/appkitstudio/llamacpp-cli/commit/c3a810c782f9fd2146bfb9cfb8ac3dcbbf8b8abf))


### Bug Fixes

* support both old and new llama.cpp log formats in log parser ([002c97e](https://github.com/appkitstudio/llamacpp-cli/commit/002c97e0f67cba51bc31c34980a9cb91c5e09cd9))

## [1.10.0](https://github.com/appkitstudio/llamacpp-cli/compare/v1.9.0...v1.10.0) (2026-02-02)


### Features

* add Config screen TUI for editing server configuration ([0555eb8](https://github.com/appkitstudio/llamacpp-cli/commit/0555eb87b25fd9c0496ddf04bf59433ae0e9dc48))
* add Models management TUI for displaying and deleting models ([45b312f](https://github.com/appkitstudio/llamacpp-cli/commit/45b312f160e476a8effd0ad92a7f88e2b533f9c5))
* add splash screen with ASCII logo on TUI startup ([9a2bbba](https://github.com/appkitstudio/llamacpp-cli/commit/9a2bbbac80c8736548a71d38230a69b3745198ea))
* add Start/Stop controls and UI improvements to TUI ([2409c8e](https://github.com/appkitstudio/llamacpp-cli/commit/2409c8e283f37050f2b4faccbaef82bf6db2ac39))
* enhance TUI with interactive dashboard and deprecate old commands ([464c224](https://github.com/appkitstudio/llamacpp-cli/commit/464c224aefc2592442f80e72a076ec792a9d36dc))


### Code Refactoring

* simplify TUI code for clarity and maintainability ([2b50d52](https://github.com/appkitstudio/llamacpp-cli/commit/2b50d5288b2ecd5bed4619518f50d74bd43c6b76))

## [1.9.0](https://github.com/appkitstudio/llamacpp-cli/compare/v1.8.0...v1.9.0) (2026-01-27)


### Features

* add unified router endpoint for automatic model routing ([6db0892](https://github.com/appkitstudio/llamacpp-cli/commit/6db0892adca753c021c7d9be6b69231c983170a1))

## [1.9.0] (2026-01-26)

### Features

* **router**: add unified router endpoint for automatic model routing ([#TBD])

  The router provides a single OpenAI-compatible endpoint that automatically routes requests to the correct backend server based on model name. Perfect for LLM clients that don't support multiple endpoints.

  **Key features:**
  - Single endpoint (default: http://localhost:9100) for all models
  - Automatic routing based on `model` field in requests
  - Zero-config model discovery from running servers
  - Aggregated `/v1/models` endpoint
  - Native Node.js HTTP proxy (no external dependencies)
  - Streaming support for chat completions
  - Comprehensive error handling (404, 503, 502, 504)

  **Commands:**
  - `llamacpp router start` - Start router service
  - `llamacpp router stop` - Stop router service
  - `llamacpp router status` - Show status and available models
  - `llamacpp router restart` - Restart router
  - `llamacpp router config` - Update configuration (port, host, timeout, health-interval)

  **Usage:**
  ```python
  from openai import OpenAI

  client = OpenAI(base_url="http://localhost:9100/v1", api_key="not-needed")
  response = client.chat.completions.create(
      model="llama-3.2-3b-instruct-q4_k_m.gguf",
      messages=[{"role": "user", "content": "Hello!"}]
  )
  ```

## [1.7.0](https://github.com/appkitstudio/llamacpp-cli/compare/v1.6.0...v1.7.0) (2026-01-23)


### Features

* add log management commands and auto-rotation for server logs ([e670a53](https://github.com/appkitstudio/llamacpp-cli/commit/e670a53a712d04267f06327af730dc2429e4ab43))

## [1.6.0](https://github.com/appkitstudio/llamacpp-cli/compare/v1.5.0...v1.6.0) (2026-01-17)


### Features

* add full-hour downsampling functions and enhance multi-server monitor UI with dynamic server ID width ([ae2862a](https://github.com/appkitstudio/llamacpp-cli/commit/ae2862acba905cddf60f0e7c30f6a7867391a5e2))
* add GPU memory tracking to server monitoring ([bc59c6a](https://github.com/appkitstudio/llamacpp-cli/commit/bc59c6a74580e428ab674167146caea47d8a32c1))
* enhance monitoring functionality with server status updates and improved resource tracking ([45fb833](https://github.com/appkitstudio/llamacpp-cli/commit/45fb833da5efe023a2271e7bd12d780a71474629))
* enhance multi-server monitor UI with improved navigation and selection indicators ([9e57cfb](https://github.com/appkitstudio/llamacpp-cli/commit/9e57cfb8ce93a2c561981598cf75f0e4ff1a477d))
* enhance server monitoring with interactive dashboard and improved metrics display ([fba8d79](https://github.com/appkitstudio/llamacpp-cli/commit/fba8d79ee58ecd7ccfe02e319ae7bf5474b591df))
* implement per-process metrics for historical monitoring accuracy ([cc59df0](https://github.com/appkitstudio/llamacpp-cli/commit/cc59df069775031de1bfacdeb3a462a17610e4eb))
* improve historical monitoring UI with faster refresh rate and enhanced display elements ([e0ce04b](https://github.com/appkitstudio/llamacpp-cli/commit/e0ce04ba258f6d945a977c39f056ba22cb324c70))

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
