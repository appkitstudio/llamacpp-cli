# CLAUDE.md

This file provides guidance to Claude Code when working with the llamacpp-cli project.

## Project Overview

**llamacpp-cli** is a macOS CLI tool for managing local llama.cpp server instances. It provides an Ollama-like experience with model management, server lifecycle control, and launchctl integration.

## Architecture

### State Management
- **Config directory:** `~/.llamacpp/`
- **Server configs:** `~/.llamacpp/servers/<server-id>.json` (one per server)
- **Global config:** `~/.llamacpp/config.json`
- **Logs:** `~/.llamacpp/logs/<server-id>.{stdout,stderr}`

### launchctl Integration
- **Service naming:** `com.llama.<sanitized-model-name>`
- **Plist location:** `~/Library/LaunchAgents/com.llama.<id>.plist`
- **Lifecycle:** load → start → stop → unload
- **Auto-restart:** Only on crash (not on clean exit)

### Smart Defaults
Server configuration based on model file size:
- **< 1GB:** ctx-size 2048
- **1-3GB:** ctx-size 4096
- **3-6GB:** ctx-size 8192
- **> 6GB:** ctx-size 16384
- **Threads:** Half of CPU cores
- **GPU layers:** 60 (Metal auto-detects optimal)
- **Always include:** `--embeddings --jinja`

### Port Management
- **Range:** 9000-9999
- **Auto-assignment:** Find first available port
- **Verification:** Use `lsof -iTCP:<port>` to check availability
- **Override:** `--port` flag on start command

## File Structure

```
src/
├── cli.ts                   # CLI entry point (commander setup)
├── commands/                # Command implementations
│   ├── ps.ts               # List servers
│   ├── start.ts            # Start server
│   ├── stop.ts             # Stop server
│   ├── delete.ts           # Delete server
│   ├── pull.ts             # Download model
│   ├── list.ts             # List models
│   └── logs.ts             # View logs
├── lib/                    # Core logic modules
│   ├── state-manager.ts    # Config CRUD
│   ├── launchctl-manager.ts # launchd integration
│   ├── model-scanner.ts    # Model discovery
│   ├── model-downloader.ts # HF downloads
│   ├── config-generator.ts # Smart defaults
│   ├── status-checker.ts   # Server status
│   └── port-manager.ts     # Port allocation
├── types/                  # TypeScript interfaces
│   ├── server-config.ts
│   ├── global-config.ts
│   └── model-info.ts
└── utils/                  # Helper functions
    ├── file-utils.ts       # File operations
    ├── process-utils.ts    # Exec wrappers
    └── format-utils.ts     # Pretty printing
```

## Key Workflows

### Start Server
1. Resolve model filename to full path in ~/models
2. Check if server already exists → error if yes
3. Calculate smart defaults based on model size
4. Apply user overrides from flags
5. Find available port (auto or validate custom)
6. Sanitize model name to create server ID
7. Generate plist XML from template
8. Write plist to ~/Library/LaunchAgents/
9. `launchctl load <plist>`
10. `launchctl start <label>`
11. Wait 2s and verify status
12. Save server config
13. Display success message

### Stop Server
1. Find server by identifier (name/port/ID)
2. `launchctl stop <label>`
3. Wait up to 5s for clean shutdown
4. Update config status to 'stopped'
5. Show confirmation

### Delete Server
1. Find server by identifier
2. Stop if running
3. `launchctl unload <label>`
4. Delete plist file
5. Delete server config
6. Confirm deletion (model preserved)

### Status Detection
1. `launchctl list | grep com.llama.<id>`
2. Parse PID and exit code from output
3. Cross-check with `lsof -iTCP:<port>`
4. Return status object

## TypeScript Patterns

### Error Handling
- Use descriptive error messages with suggestions
- Check prerequisites before operations
- Handle missing files gracefully
- Validate inputs before execution

### Async/Await
- All file operations are async
- All command handlers are async
- Use `execAsync` wrapper for shell commands

### Type Safety
- Strict TypeScript mode enabled
- Define interfaces in `types/`
- Export types for reuse
- Use type guards for validation

## Dependencies

**Production:**
- `commander` - CLI framework
- `cli-table3` - Pretty tables
- `chalk` - Terminal colors

**Dev:**
- `typescript` - TypeScript compiler
- `tsx` - TypeScript executor
- `@types/node` - Node.js types
- `@types/cli-table3` - Table types

## Development Commands

```bash
# Development mode (runs TypeScript directly)
npm run dev -- <command>

# Build TypeScript to JavaScript
npm run build

# Run compiled version
npm start -- <command>

# Clean build output
npm run clean
```

## External Dependencies

**Required on user system:**
- `llama-server` - From llama.cpp (via Homebrew)
- `launchctl` - Built into macOS
- `lsof` - Built into macOS

**Optional:**
- `huggingface-cli` - For model downloads (pip install)

## Important Notes

### ID Sanitization
Model filenames are sanitized to create server IDs:
```typescript
// "llama-3.2-3b-instruct-q4_k_m.gguf" → "llama-3-2-3b-instruct-q4-k-m"
function sanitizeId(modelName: string): string {
  return modelName
    .replace(/\.gguf$/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
}
```

### Plist Template
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>{LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>/opt/homebrew/bin/llama-server</string>
      <string>--model</string>
      <string>{MODEL_PATH}</string>
      <string>--port</string>
      <string>{PORT}</string>
      <string>--threads</string>
      <string>{THREADS}</string>
      <string>--ctx-size</string>
      <string>{CTX_SIZE}</string>
      <string>--gpu-layers</string>
      <string>{GPU_LAYERS}</string>
      <string>--embeddings</string>
      <string>--jinja</string>
    </array>
    <key>RunAtLoad</key>
    <false/>
    <key>KeepAlive</key>
    <dict>
      <key>Crashed</key>
      <true/>
      <key>SuccessfulExit</key>
      <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>{STDOUT_PATH}</string>
    <key>StandardErrorPath</key>
    <string>{STDERR_PATH}</string>
    <key>WorkingDirectory</key>
    <string>/tmp</string>
    <key>ThrottleInterval</key>
    <integer>10</integer>
  </dict>
</plist>
```

### launchctl Status Parsing
Output format: `PID\tExitCode\tLabel`
```
26580   -       com.llama.llama-3-2-3b    # Running (PID 26580)
-       0       com.llama.qwen2-7b        # Stopped cleanly
-       -9      com.llama.Meta-Llama-3-1  # Killed
```

## Edge Cases

1. **Orphaned processes** - Server running but no config
2. **Stale configs** - Config says running but server dead
3. **Port conflicts** - Auto-assign next available
4. **Missing binary** - Check llama-server exists
5. **Corrupted models** - Detect during startup
6. **Permission errors** - Ensure LaunchAgents dir exists

## Testing Strategy

**Manual testing checklist:**
- [ ] Start server with smart defaults
- [ ] Start server with custom flags
- [ ] Stop server by name/port
- [ ] Delete server and verify cleanup
- [ ] Download model from HF
- [ ] List models in ~/models
- [ ] View logs (stdout/stderr)
- [ ] Handle port conflicts
- [ ] Detect crashed servers
- [ ] Survive restarts

## Common Pitfalls

- Always use absolute paths (no relative paths)
- Sanitize user inputs before using in shell commands
- Close file handles after operations
- Don't block on tail -f (use spawn for streaming)
- Verify launchctl operations succeeded
- Handle SIGINT gracefully during downloads

## Reference Files

**Similar projects:**
- `/Users/dweaver/Projects/ai/claude-assist/projects/xerro-service/` - CLI patterns, launchctl integration
- `/Users/dweaver/Library/LaunchAgents/com.llama.main.plist` - Existing plist format
