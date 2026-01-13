# llamacpp-cli

> Manage llama.cpp servers like Ollama—but faster. Full control over llama-server with macOS launchctl integration.

CLI tool to manage local llama.cpp servers on macOS. Provides an Ollama-like experience for managing GGUF models and llama-server instances, with **significantly faster response times** than Ollama.

[![npm version](https://badge.fury.io/js/@appkit%2Fllamacpp-cli.svg)](https://www.npmjs.com/package/@appkit/llamacpp-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Status:** Beta - Stable for personal use, actively maintained

## Features

- 🚀 **Easy server management** - Start, stop, and monitor llama.cpp servers
- 🤖 **Model downloads** - Pull GGUF models from Hugging Face
- ⚙️ **Smart defaults** - Auto-configure threads, context size, and GPU layers based on model size
- 🔌 **Auto port assignment** - Automatically find available ports (9000-9999)
- 📊 **Real-time monitoring TUI** - Live server metrics with GPU/CPU usage, token generation speeds, and active slots
- 🪵 **Smart logging** - Compact one-line request format with optional full JSON details

## Why llamacpp-cli?

**TL;DR:** Much faster response times than Ollama by using llama.cpp's native server directly.

Ollama is great, but it adds a wrapper layer that introduces latency. llamacpp-cli gives you:

- **⚡️ Faster inference** - Direct llama-server means lower overhead and quicker responses
- **🎛️ Full control** - Access all llama-server flags and configuration options
- **🔧 Transparency** - Standard launchctl services, visible in Activity Monitor
- **📦 Any GGUF model** - Not limited to Ollama's model library
- **🪶 Lightweight** - No daemon overhead, just native macOS services

### Comparison

| Feature | llamacpp-cli | Ollama |
|---------|-------------|--------|
| **Response Time** | ⚡️ **Faster** (native) | Slower (wrapper layer) |
| Model Format | Any GGUF from HF | Ollama's library |
| Server Binary | llama.cpp native | Custom wrapper |
| Configuration | Full llama-server flags | Limited options |
| Service Management | macOS launchctl | Custom daemon |
| Resource Usage | Lower overhead | Higher overhead |
| Transparency | Standard Unix tools | Black box |

If you need raw speed and full control, llamacpp-cli is the better choice.

## Installation

```bash
npm install -g @appkit/llamacpp-cli
```

## Prerequisites

- macOS (uses launchctl for service management)
- [llama.cpp](https://github.com/ggerganov/llama.cpp) installed via Homebrew:
  ```bash
  brew install llama.cpp
  ```

## Quick Start

```bash
# Search for models on Hugging Face
llamacpp search "llama 3b"

# Download a model
llamacpp pull bartowski/Llama-3.2-3B-Instruct-GGUF/llama-3.2-3b-instruct-q4_k_m.gguf

# List local models
llamacpp ls

# Create and start a server (auto-assigns port, uses smart defaults)
llamacpp server create llama-3.2-3b-instruct-q4_k_m.gguf

# View running servers
llamacpp ps

# Monitor all servers (multi-server dashboard)
llamacpp server monitor

# Or monitor a specific server
llamacpp server monitor llama-3.2-3b

# Chat with your model interactively
llamacpp server run llama-3.2-3b

# Or send a single message (non-interactive)
llamacpp server run llama-3.2-3b -m "What is the capital of France?"

# Stop a server
llamacpp server stop llama-3.2-3b

# Start a stopped server
llamacpp server start llama-3.2-3b

# View logs
llamacpp server logs llama-3.2-3b -f
```

## Using Your Server

Once a server is running, it exposes an OpenAI-compatible API:

```bash
# Chat completion
curl http://localhost:9000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "What is the capital of France?"}
    ],
    "temperature": 0.7,
    "max_tokens": 100
  }'

# Text completion
curl http://localhost:9000/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Once upon a time",
    "max_tokens": 50
  }'

# Get embeddings
curl http://localhost:9000/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Hello world"
  }'

# Health check
curl http://localhost:9000/health
```

The server is fully compatible with OpenAI's API format, so you can use it with any OpenAI-compatible client library.

### Example Output

Creating a server:
```
$ llamacpp server create llama-3.2-3b-instruct-q4_k_m.gguf

✓ Server created and started successfully!

  Model:  llama-3.2-3b-instruct-q4_k_m.gguf
  Port:   9000
  Status: Running (PID 12345)

  API endpoint: http://localhost:9000
```

Viewing running servers:
```
$ llamacpp ps

┌─────────────────────────┬──────┬────────────┬──────┬──────────┬────────┐
│ SERVER ID               │ PORT │ STATUS     │ PID  │ MEMORY   │ UPTIME │
├─────────────────────────┼──────┼────────────┼──────┼──────────┼────────┤
│ llama-3-2-3b-instruct   │ 9000 │ ✅ RUNNING │ 1234 │ 594.0 MB │ 15m    │
│ qwen2-7b-instruct-q4-k  │ 9001 │ ✅ RUNNING │ 5678 │ 1.2 GB   │ 2h     │
└─────────────────────────┴──────┴────────────┴──────┴──────────┴────────┘

Total: 2 servers (2 running, 0 stopped)
```

Running interactive chat:
```
$ llamacpp server run llama-3.2-3b

Connected to llama-3.2-3b-instruct on port 9000

You: What is the capital of France?
Assistant: The capital of France is Paris...

You: exit
```

One-shot message:
```
$ llamacpp server run llama-3.2-3b -m "What is the capital of France?"
Assistant: The capital of France is Paris...
```

## Commands

### `llamacpp ls`
List all GGUF models in ~/models directory.

```bash
llamacpp ls
```

### `llamacpp search <query> [options]`
Search Hugging Face for GGUF models.

```bash
# Search for models
llamacpp search "llama 3.2"

# Limit results
llamacpp search "qwen" --limit 10

# Show files for a specific result (by index number)
llamacpp search "llama 3b" --files 1
```

**Options:**
- `-l, --limit <number>` - Max results to show (default: 20)
- `--files [number]` - Show available GGUF files for result # (e.g., --files 1)

**Tip:** Results are numbered. Use the number with `--files` to see available quantizations for that model!

### `llamacpp show <identifier> [options]`
Show details about a model or file without downloading.

```bash
# Show model info and all GGUF files
llamacpp show bartowski/Llama-3.2-3B-Instruct-GGUF

# Show info for a specific file
llamacpp show bartowski/Llama-3.2-3B-Instruct-GGUF/Llama-3.2-3B-Instruct-Q4_K_M.gguf

# Or use --file flag
llamacpp show bartowski/Llama-3.2-3B-Instruct-GGUF --file Llama-3.2-3B-Instruct-Q4_K_M.gguf
```

**Options:**
- `-f, --file <filename>` - Show details for a specific file

**Displays:** Downloads, likes, license, tags, and available GGUF files

### `llamacpp pull <identifier> [options]`
Download a GGUF model from Hugging Face.

```bash
# Option 1: Full path (recommended)
llamacpp pull bartowski/Llama-3.2-3B-Instruct-GGUF/llama-3.2-3b-instruct-q4_k_m.gguf

# Option 2: Repo + --file flag
llamacpp pull bartowski/Llama-3.2-3B-Instruct-GGUF --file llama-3.2-3b-instruct-q4_k_m.gguf
```

**Options:**
- `-f, --file <filename>` - Specific GGUF file (alternative to path)

### `llamacpp rm <model>`
Delete a model file from ~/models (and stop any associated servers).

```bash
llamacpp rm llama-3.2-3b-instruct-q4_k_m.gguf
llamacpp rm llama-3.2  # Partial name matching
```

### `llamacpp ps`
List all servers with status, memory usage, and uptime.

```bash
llamacpp ps
```

Shows:
- Server ID and model name
- Port number
- Status (running/stopped/crashed)
- Process ID (PID)
- Memory usage (RAM consumption)
- Uptime (how long server has been running)

## Server Management

### `llamacpp server create <model> [options]`
Create and start a new llama-server instance.

```bash
llamacpp server create llama-3.2-3b-instruct-q4_k_m.gguf
llamacpp server create llama-3.2-3b-instruct-q4_k_m.gguf --port 8080 --ctx-size 16384 --verbose

# Enable remote access (WARNING: security implications)
llamacpp server create llama-3.2-3b-instruct-q4_k_m.gguf --host 0.0.0.0
```

**Options:**
- `-p, --port <number>` - Port number (default: auto-assign from 9000)
- `-h, --host <address>` - Bind address (default: `127.0.0.1` for localhost only, use `0.0.0.0` for remote access)
- `-t, --threads <number>` - Thread count (default: half of CPU cores)
- `-c, --ctx-size <number>` - Context size (default: based on model size)
- `-g, --gpu-layers <number>` - GPU layers (default: 60)
- `-v, --verbose` - Enable verbose HTTP logging (default: enabled)

**⚠️ Security Warning:** Using `--host 0.0.0.0` binds the server to all network interfaces, allowing remote access from your local network and potentially the internet. Only use this if you understand the security implications and need remote access. For local development, keep the default `127.0.0.1` (localhost only).

### `llamacpp server show <identifier>`
Show detailed configuration and status information for a server.

```bash
llamacpp server show llama-3.2-3b       # By partial name
llamacpp server show 9000               # By port
llamacpp server show llama-3-2-3b       # By server ID
```

**Displays:**
- Server ID, model name, and path
- Current status (running/stopped/crashed)
- Host and port
- PID (process ID)
- Runtime info (uptime, memory usage)
- Configuration (host, threads, context size, GPU layers, verbose logging)
- Timestamps (created, last started/stopped)
- System paths (plist file, log files)
- Quick commands for common next actions

**Identifiers:** Port number, server ID, partial model name

### `llamacpp server config <identifier> [options]`
Update server configuration parameters without recreating the server.

```bash
# Update context size and restart
llamacpp server config llama-3.2-3b --ctx-size 8192 --restart

# Update threads without restarting
llamacpp server config 9000 --threads 8

# Enable remote access (WARNING: security implications)
llamacpp server config llama-3.2-3b --host 0.0.0.0 --restart

# Toggle verbose logging
llamacpp server config llama-3.2-3b --no-verbose --restart

# Update multiple parameters
llamacpp server config llama-3.2-3b --threads 8 --ctx-size 16384 --gpu-layers 40 --restart
```

**Options:**
- `-h, --host <address>` - Update bind address (`127.0.0.1` for localhost, `0.0.0.0` for remote access)
- `-t, --threads <number>` - Update thread count
- `-c, --ctx-size <number>` - Update context size
- `-g, --gpu-layers <number>` - Update GPU layers
- `-v, --verbose` - Enable verbose logging
- `--no-verbose` - Disable verbose logging
- `-r, --restart` - Automatically restart server if running

**Note:** Changes require a server restart to take effect. Use `--restart` to automatically stop and start the server with the new configuration.

**⚠️ Security Warning:** Using `--host 0.0.0.0` binds the server to all network interfaces, allowing remote access. Only use this if you understand the security implications.

**Identifiers:** Port number, server ID, partial model name

### `llamacpp server start <identifier>`
Start an existing stopped server.

```bash
llamacpp server start llama-3.2-3b       # By partial name
llamacpp server start 9000               # By port
llamacpp server start llama-3-2-3b       # By server ID
```

**Identifiers:** Port number, server ID, partial model name, or model filename

### `llamacpp server run <identifier> [options]`
Run an interactive chat session with a model, or send a single message.

```bash
# Interactive mode (REPL)
llamacpp server run llama-3.2-3b       # By partial name
llamacpp server run 9000               # By port
llamacpp server run llama-3-2-3b       # By server ID

# One-shot mode (single message and exit)
llamacpp server run llama-3.2-3b -m "What is the capital of France?"
llamacpp server run 9000 --message "Explain quantum computing in simple terms"
```

**Options:**
- `-m, --message <text>` - Send a single message and exit (non-interactive mode)

**Identifiers:** Port number, server ID, partial model name, or model filename

In interactive mode, type `exit` or press Ctrl+C to end the session.

### `llamacpp server stop <identifier>`
Stop a running server by model name, port, or ID.

```bash
llamacpp server stop llama-3.2-3b
llamacpp server stop 9000
```

### `llamacpp server rm <identifier>`
Remove a server configuration and launchctl service (preserves model file).

```bash
llamacpp server rm llama-3.2-3b
llamacpp server rm 9000
```

### `llamacpp server logs <identifier> [options]`
View server logs with smart filtering.

**Default (verbose enabled):**
```bash
llamacpp server logs llama-3.2-3b
# Output: 2025-12-09 18:02:23 POST /v1/chat/completions 127.0.0.1 200 "What is..." 305 22 1036
```

**Without `--verbose` on server:**
```bash
llamacpp server logs llama-3.2-3b
# Output: Only internal server logs (cache, slots) - no HTTP request logs
```

**More examples:**

# Full HTTP JSON request/response
llamacpp server logs llama-3.2-3b --http

# Follow logs in real-time
llamacpp server logs llama-3.2-3b --follow

# Last 100 requests
llamacpp server logs llama-3.2-3b --lines 100

# Show only errors
llamacpp server logs llama-3.2-3b --errors

# Show all messages (including debug internals)
llamacpp server logs llama-3.2-3b --verbose

# Custom filter pattern
llamacpp server logs llama-3.2-3b --filter "error|warning"
```

**Options:**
- `-f, --follow` - Follow log output in real-time
- `-n, --lines <number>` - Number of lines to show (default: 50)
- `--http` - Show full HTTP JSON request/response logs
- `--errors` - Show only error messages
- `--verbose` - Show all messages including debug internals
- `--filter <pattern>` - Custom grep pattern for filtering
- `--stdout` - Show stdout instead of stderr (rarely needed)

**Output Formats:**

Default compact format:
```
TIMESTAMP METHOD ENDPOINT IP STATUS "MESSAGE..." TOKENS_IN TOKENS_OUT TIME_MS
```

The compact format shows one line per HTTP request and includes:
- User's message (first 50 characters)
- Token counts (prompt tokens in, completion tokens out)
- Total response time in milliseconds

**Note:** Verbose logging is now enabled by default. HTTP request logs are available by default.

Use `--http` to see full request/response JSON, or `--verbose` option to see all internal server logs.

### `llamacpp server monitor [identifier]`
Real-time monitoring TUI showing server metrics, GPU/CPU usage, and active inference slots.

**Two Modes:**

**1. Multi-Server Dashboard (no identifier):**
```bash
llamacpp server monitor
```
Shows overview of all servers with system resources. Press 1-9 to drill down into individual server details.

**2. Single-Server Monitor (with identifier):**
```bash
# Monitor by partial name
llamacpp server monitor llama-3.2-3b

# Monitor by port
llamacpp server monitor 9000

# Monitor by server ID
llamacpp server monitor llama-3-2-3b
```

**Multi-Server Dashboard:**
```
┌─────────────────────────────────────────────────────────┐
│ System Resources                                         │
│ GPU: [████░░░] 65%  CPU: [███░░░] 38%  Memory: 58%     │
├─────────────────────────────────────────────────────────┤
│ Servers (3 running, 0 stopped)                          │
│ # │ Server ID      │ Port │ Status │ Slots │ tok/s    │
│───┼────────────────┼──────┼────────┼───────┼──────────┤
│ 1 │ llama-3-2-3b   │ 9000 │ ● RUN  │ 2/4   │ 245      │
│ 2 │ qwen2-7b       │ 9001 │ ● RUN  │ 1/4   │ 198      │
│ 3 │ llama-3-1-8b   │ 9002 │ ○ IDLE │ 0/4   │ -        │
└─────────────────────────────────────────────────────────┘
Press 1-9 for details | [Q] Quit
```

**Single-Server View:**
- **Server Information** - Status, uptime, model name, endpoint, slot counts
- **Request Metrics** - Active/idle slots, prompt speed, generation speed
- **Active Slots** - Per-slot token generation rates and progress
- **System Resources** - GPU/CPU/ANE utilization, memory usage, temperature

**Keyboard Shortcuts:**
- **Multi-Server Mode:**
  - `1-9` - View details for server #N
  - `ESC` - Back to list (from detail view)
  - `R` - Force refresh now
  - `+/-` - Adjust update speed
  - `Q` - Quit
- **Single-Server Mode:**
  - `R` - Force refresh now
  - `+/-` - Adjust update speed
  - `Q` - Quit

**Features:**
- **Multi-server dashboard** - Monitor all servers at once
- **Real-time updates** - Metrics refresh every 2 seconds (adjustable)
- **Token-per-second calculation** - Shows actual generation speed per slot
- **Progress bars** - Visual representation of GPU/CPU/memory usage
- **Error recovery** - Shows stale data with warnings if connection lost
- **Graceful degradation** - Works without GPU metrics (uses memory-only mode)

**Optional: GPU/CPU Metrics**

For GPU and CPU utilization metrics, install macmon:
```bash
brew install vladkens/tap/macmon
```

Without macmon, the monitor still shows:
- ✅ Server status and uptime
- ✅ Active slots and token generation speeds
- ✅ Memory usage (via built-in vm_stat)
- ❌ GPU/CPU/ANE utilization (requires macmon)

**Identifiers:** Port number, server ID, or partial model name

## Configuration

llamacpp-cli stores its configuration in `~/.llamacpp/`:

```
~/.llamacpp/
├── config.json           # Global settings
├── servers/              # Server configurations
│   └── <server-id>.json
└── logs/                 # Server logs
    ├── <server-id>.stdout
    └── <server-id>.stderr
```

## Smart Defaults

llamacpp-cli automatically configures optimal settings based on model size:

| Model Size | Context Size | Threads | GPU Layers |
|------------|--------------|---------|------------|
| < 1GB      | 2048         | Half cores | 60 |
| 1-3GB      | 4096         | Half cores | 60 |
| 3-6GB      | 8192         | Half cores | 60 |
| > 6GB      | 16384        | Half cores | 60 |

All servers include `--embeddings` and `--jinja` flags by default.

## How It Works

llamacpp-cli uses macOS launchctl to manage llama-server processes:

1. Creates a launchd plist file in `~/Library/LaunchAgents/`
2. Registers the service with `launchctl load`
3. Starts the server with `launchctl start`
4. Monitors status via `launchctl list` and `lsof`

Services are named `com.llama.<model-id>` and persist across reboots.

## Known Limitations

- **macOS only** - Relies on launchctl for service management (Linux/Windows support planned)
- **Homebrew dependency** - Requires llama.cpp installed via `brew install llama.cpp`
- **~/models convention** - Expects GGUF models in `~/models` directory
- **Single binary** - Assumes llama-server at `/opt/homebrew/bin/llama-server`
- **Port range** - Auto-assignment limited to 9000-9999 (configurable with `--port`)

## Troubleshooting

### Command not found
Make sure npm global bin directory is in your PATH:
```bash
npm config get prefix  # Should be in PATH
```

### llama-server not found
Install llama.cpp via Homebrew:
```bash
brew install llama.cpp
```

### Port already in use
llamacpp-cli will automatically find the next available port. Or specify a custom port:
```bash
llamacpp server create model.gguf --port 8080
```

### Server won't start
Check the logs for errors:
```bash
llamacpp server logs <identifier> --errors
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev -- ps

# Build for production
npm run build

# Clean build artifacts
npm run clean
```

### Releasing

This project uses [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for automated releases based on conventional commits.

**Commit Message Format:**

```bash
# Features (bumps minor version)
git commit -m "feat: add interactive chat command"
git commit -m "feat(search): add limit option for search results"

# Bug fixes (bumps patch version)
git commit -m "fix: handle port conflicts correctly"
git commit -m "fix(logs): stream logs without buffering"

# Breaking changes (bumps major version)
git commit -m "feat!: change server command structure"
git commit -m "feat: major refactor

BREAKING CHANGE: server commands now require 'server' prefix"

# Other types (no version bump, hidden in changelog)
git commit -m "chore: update dependencies"
git commit -m "docs: fix typo in README"
git commit -m "test: add unit tests for port manager"
```

**Release Commands:**

```bash
# Automatic version bump based on commits
npm run release

# Force specific version bump
npm run release:patch  # 1.0.0 → 1.0.1
npm run release:minor  # 1.0.0 → 1.1.0
npm run release:major  # 1.0.0 → 2.0.0

# First release (doesn't bump version, just tags)
npm run release:first
```

**What happens during release:**

1. Analyzes commits since last release
2. Determines version bump (feat = minor, fix = patch, BREAKING CHANGE = major)
3. Updates `package.json` version
4. Generates/updates `CHANGELOG.md`
5. Creates git commit: `chore(release): v1.2.3`
6. Creates git tag: `v1.2.3`
7. Pushes tags to GitHub
8. Publishes to npm with `--access public`

## Contributing

Contributions are welcome! If you'd like to contribute:

1. **Open an issue first** for major changes to discuss the approach
2. Fork the repository
3. Create a feature branch (`git checkout -b feature/amazing-feature`)
4. Make your changes and test with `npm run dev`
5. **Commit using conventional commits** (see [Releasing](#releasing) section)
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation
   - `chore:` for maintenance
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Development Tips

- Use `npm run dev -- <command>` to test commands without building
- Check logs with `llamacpp server logs <server> --errors` when debugging
- Test launchctl integration with `launchctl list | grep com.llama`
- All server configs are in `~/.llamacpp/servers/`
- Test interactive chat with `npm run dev -- server run <model>`

## Acknowledgments

Built on top of the excellent [llama.cpp](https://github.com/ggerganov/llama.cpp) project by Georgi Gerganov and contributors.

## License

MIT
