# llamacpp-cli

CLI tool to manage local llama.cpp servers on macOS. Provides an Ollama-like experience for managing GGUF models and llama-server instances.

## Features

- 🚀 **Easy server management** - Start, stop, and monitor llama.cpp servers
- 🤖 **Model downloads** - Pull GGUF models from Hugging Face
- ⚙️ **Smart defaults** - Auto-configure threads, context size, and GPU layers based on model size
- 🔌 **Auto port assignment** - Automatically find available ports (9000-9999)
- 📊 **Status monitoring** - Real-time server status with launchctl integration
- 🪵 **Log access** - View and tail server logs

## Installation

```bash
npm install -g llamacpp-cli
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
llamacpp list

# Start a server (auto-assigns port, uses smart defaults)
llamacpp start llama-3.2-3b-instruct-q4_k_m.gguf

# View running servers
llamacpp ps

# Stop a server
llamacpp stop llama-3.2-3b

# View logs
llamacpp logs llama-3.2-3b -f
```

## Commands

### `llamacpp list`
List all GGUF models in ~/models directory.

```bash
llamacpp list
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

### `llamacpp start <model> [options]`
Start a llama-server instance.

```bash
llamacpp start llama-3.2-3b-instruct-q4_k_m.gguf
llamacpp start llama-3.2-3b-instruct-q4_k_m.gguf --port 8080 --ctx-size 16384
```

**Options:**
- `-p, --port <number>` - Port number (default: auto-assign from 9000)
- `-t, --threads <number>` - Thread count (default: half of CPU cores)
- `-c, --ctx-size <number>` - Context size (default: based on model size)
- `-g, --gpu-layers <number>` - GPU layers (default: 60)

### `llamacpp ps`
List all servers with status.

```bash
llamacpp ps
```

### `llamacpp stop <identifier>`
Stop a running server by model name, port, or ID.

```bash
llamacpp stop llama-3.2-3b
llamacpp stop 9001
```

### `llamacpp delete <identifier>`
Delete a server configuration and launchctl service.

```bash
llamacpp delete llama-3.2-3b
```

### `llamacpp logs <identifier> [options]`
View server logs.

```bash
llamacpp logs llama-3.2-3b
llamacpp logs llama-3.2-3b -f          # Follow logs
llamacpp logs llama-3.2-3b -n 100     # Last 100 lines
llamacpp logs llama-3.2-3b --errors   # Errors only
```

**Options:**
- `-f, --follow` - Follow log output in real-time
- `-n, --lines <number>` - Number of lines to show (default: 50)
- `--errors` - Show stderr instead of stdout

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
llamacpp start model.gguf --port 8080
```

### Server won't start
Check the logs for errors:
```bash
llamacpp logs <identifier> --errors
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

## License

MIT
