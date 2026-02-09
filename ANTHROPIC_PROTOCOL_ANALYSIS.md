# Anthropic Protocol Translation - Ollama Analysis

This document analyzes how Ollama implements Anthropic API compatibility to enable Claude Code integration with local models.

## Summary

Ollama achieves Claude Code integration through **full protocol translation** at the server level. They don't rely on models to natively speak the Anthropic protocol - instead, they convert between Anthropic's format and OpenAI's function calling format in middleware.

## Architecture Overview

```
Claude Code
    ↓ (Anthropic Messages API)
Ollama Middleware (anthropic.go)
    ↓ (Convert to Ollama format)
Ollama Core (OpenAI-compatible)
    ↓ (Forward to model)
llama.cpp Model (with function calling support)
```

## Key Components

### 1. Launch Integration (`cmd/config/claude.go`)

**Environment Variables Set:**
```go
env := append(os.Environ(),
    "ANTHROPIC_BASE_URL=" + ollamaServerURL,  // Points to Ollama
    "ANTHROPIC_API_KEY=",                      // Empty
    "ANTHROPIC_AUTH_TOKEN=ollama",             // Auth token
)
```

**Model Routing:**
- Sets all Claude model tiers (Opus, Sonnet, Haiku) to use local models
- Supports model aliases for primary/fast models
- Routes subagent model to local model as well

### 2. Middleware Layer (`middleware/anthropic.go`)

**Request Flow:**
1. Intercepts incoming Anthropic `/v1/messages` requests
2. Parses `MessagesRequest` from request body
3. Validates required fields (model, max_tokens, messages)
4. Converts to Ollama's `ChatRequest` format
5. Replaces request body with converted format
6. Wraps response writer to convert responses back

**Response Flow:**
1. Intercepts Ollama response
2. Converts `ChatResponse` to Anthropic `MessagesResponse`
3. Handles both streaming and non-streaming responses
4. Emits proper SSE events for streaming

### 3. Protocol Translation (`anthropic/anthropic.go`)

#### Request Translation: `FromMessagesRequest()`

**System Prompt:**
- Converts to Ollama system message
- Handles both string and array formats

**Messages:**
- Converts each Anthropic message to Ollama message(s)
- **Text blocks** → Concatenated into message content
- **Image blocks** → Decoded and added to `images` array
- **Tool use blocks** → Converted to `ToolCall` objects:
  ```go
  ToolCall{
      ID: blockMap["id"],
      Function: {
          Name: blockMap["name"],
          Arguments: blockMap["input"],
      }
  }
  ```
- **Tool result blocks** → Separate message with `role: "tool"`:
  ```go
  Message{
      Role: "tool",
      Content: resultContent,
      ToolCallID: toolUseID,
  }
  ```

**Tools:**
- Converts Anthropic tool definitions to OpenAI function format:
  ```go
  Tool{
      Type: "function",
      Function: {
          Name: anthropicTool.Name,
          Description: anthropicTool.Description,
          Parameters: anthropicTool.InputSchema,
      }
  }
  ```

**Options:**
- `max_tokens` → `num_predict`
- `temperature`, `top_p`, `top_k` → Direct mapping
- `stop_sequences` → `stop`

#### Response Translation: `ToMessagesResponse()`

**Content Blocks:**
- Ollama thinking → Anthropic `thinking` block
- Ollama content → Anthropic `text` block
- Ollama tool calls → Anthropic `tool_use` blocks:
  ```go
  ContentBlock{
      Type: "tool_use",
      ID: toolCall.ID,
      Name: toolCall.Function.Name,
      Input: toolCall.Function.Arguments,
  }
  ```

**Stop Reasons:**
- Ollama `stop` → Anthropic `end_turn`
- Ollama `length` → Anthropic `max_tokens`
- Has tool calls → Anthropic `tool_use`
- Other → Anthropic `stop_sequence`

**Token Counts:**
- `PromptEvalCount` → `input_tokens`
- `EvalCount` → `output_tokens`

### 4. Streaming Support (`StreamConverter`)

The streaming converter maintains state and emits proper Anthropic SSE events:

**Event Sequence:**
1. `message_start` - Initial message with metadata
2. `content_block_start` - Start of thinking/text/tool_use block
3. `content_block_delta` - Incremental updates:
   - `thinking_delta` - Thinking content
   - `text_delta` - Text content
   - `input_json_delta` - Tool input JSON
4. `content_block_stop` - End of block
5. `message_delta` - Final stop reason and token counts
6. `message_stop` - End of stream

**State Management:**
- Tracks current content block index
- Handles transitions between thinking/text/tool blocks
- Prevents duplicate tool call emissions
- Manages token counts throughout stream

## Model Requirements

For this to work, the underlying llama.cpp model must:

1. **Support function calling** (OpenAI format)
   - Model must be trained for tool use
   - Must output `tool_calls` in responses
   - Examples: Llama 3.1+, Qwen 2.5+, Mistral v3+

2. **Handle tool results**
   - Accept messages with `role: "tool"`
   - Understand `tool_call_id` references

3. **Generate proper stop reasons**
   - Indicate when tools should be used
   - Signal completion states correctly

## Implementation for llamacpp-cli

To add Anthropic protocol support to llamacpp-cli, we need:

### 1. Add Anthropic Middleware to Router

**File:** `src/lib/anthropic-middleware.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import { AnthropicConverter } from './anthropic-converter';

export function anthropicMiddleware(req: Request, res: Response, next: NextFunction) {
  // Parse Anthropic request
  const anthropicReq = req.body;

  // Convert to OpenAI format
  const openaiReq = AnthropicConverter.fromMessagesRequest(anthropicReq);

  // Replace request body
  req.body = openaiReq;

  // Wrap response to convert back
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    const anthropicRes = AnthropicConverter.toMessagesResponse(body);
    return originalJson(anthropicRes);
  };

  next();
}
```

### 2. Create Conversion Functions

**File:** `src/lib/anthropic-converter.ts`

Key functions to implement:
- `fromMessagesRequest()` - Convert Anthropic → OpenAI
- `toMessagesResponse()` - Convert OpenAI → Anthropic
- `convertTools()` - Convert tool definitions
- `convertMessages()` - Handle all message types
- `StreamConverter` class - Handle streaming responses

### 3. Update Router Server

**File:** `src/lib/router-server.ts`

```typescript
import { anthropicMiddleware } from './anthropic-middleware';

// Add route for Anthropic Messages API
app.post('/v1/messages', anthropicMiddleware, async (req, res) => {
  // Proxy to backend llama.cpp server
  // Response is already converted by middleware
});
```

### 4. Update Launch Integration

**File:** `src/commands/launch/claude.ts`

Already sets correct environment variables:
```typescript
const env = {
  ANTHROPIC_AUTH_TOKEN: 'llamacpp',
  ANTHROPIC_API_KEY: '',
  ANTHROPIC_BASE_URL: routerUrl,  // Points to router with middleware
};
```

## Testing Strategy

### 1. Unit Tests
- Test request/response conversion functions
- Test streaming event generation
- Test edge cases (empty messages, missing fields)

### 2. Integration Tests
- Test with real Claude Code CLI
- Verify tool use workflow end-to-end:
  1. Claude Code sends tool definitions
  2. Model generates tool call
  3. Claude Code executes tool
  4. Tool result sent back to model
  5. Model generates final response

### 3. Model Compatibility Tests
- Test with different llama.cpp models:
  - Llama 3.1 8B Instruct (has function calling)
  - Qwen 2.5 7B Instruct (has function calling)
  - Mistral 7B v0.3 (has function calling)
- Verify tool calling works correctly

## Current Limitations

### 1. Model Support
Not all GGUF models support function calling. The model must be:
- Trained for tool use
- Support OpenAI function calling format
- Available in GGUF format

### 2. Performance
- Tool use adds latency (multiple round trips)
- Local models slower than Claude API
- Context window limitations

### 3. Tool Execution
- Claude Code executes tools on client side
- Router just handles protocol translation
- No server-side tool execution

## Next Steps

1. **Implement TypeScript conversion functions**
   - Port Ollama's Go code to TypeScript
   - Maintain API compatibility

2. **Add middleware to router**
   - Intercept `/v1/messages` endpoint
   - Convert requests/responses

3. **Test with function-calling models**
   - Download Llama 3.1 or Qwen 2.5
   - Verify tool use works

4. **Document model requirements**
   - List compatible models
   - Provide setup instructions

5. **Add streaming support**
   - Implement SSE event generation
   - Handle state management

## References

- **Ollama Source:** `https://github.com/ollama/ollama`
- **Key Files:**
  - `anthropic/anthropic.go` - Protocol translation
  - `middleware/anthropic.go` - Request/response middleware
  - `cmd/config/claude.go` - Launch integration
- **Anthropic API Docs:** `https://docs.anthropic.com/en/api/messages`
- **OpenAI Function Calling:** `https://platform.openai.com/docs/guides/function-calling`

## Conclusion

Ollama's approach is elegant and complete:
1. **No model changes needed** - Translation happens at server level
2. **Full protocol compatibility** - Supports all Anthropic features
3. **Streaming support** - Proper SSE event generation
4. **Works with existing models** - Uses OpenAI function calling

For llamacpp-cli to achieve the same, we need to implement the middleware layer and conversion functions. The models must support OpenAI-style function calling, but otherwise the approach is straightforward.

The key insight: **Don't try to make models speak Anthropic protocol natively. Translate at the server level.**
