import { randomBytes } from 'crypto';
import type {
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicMessageParam,
  AnthropicContentBlock,
  AnthropicTool,
  AnthropicUsage,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIMessage,
  OpenAITool,
  OpenAIToolCall,
} from '../types/anthropic-types.js';

// ============================================================================
// Request Conversion: Anthropic → OpenAI
// ============================================================================

export function fromMessagesRequest(req: AnthropicMessagesRequest): OpenAIChatRequest {
  const messages: OpenAIMessage[] = [];

  // Convert system prompt if present
  if (req.system) {
    const systemContent = typeof req.system === 'string'
      ? req.system
      : extractTextFromContentBlocks(req.system);

    if (systemContent) {
      messages.push({ role: 'system', content: systemContent });
    }
  }

  // Convert messages
  for (const msg of req.messages) {
    const converted = convertAnthropicMessage(msg);
    messages.push(...converted);
  }

  // Convert tools
  const tools: OpenAITool[] | undefined = req.tools?.length
    ? req.tools.map(convertAnthropicTool)
    : undefined;

  // Convert tool_choice
  let toolChoice: OpenAIChatRequest['tool_choice'] = undefined;
  if (req.tool_choice) {
    if (req.tool_choice.type === 'auto') {
      toolChoice = 'auto';
    } else if (req.tool_choice.type === 'none') {
      toolChoice = 'none';
    } else if (req.tool_choice.type === 'tool' && req.tool_choice.name) {
      toolChoice = {
        type: 'function',
        function: { name: req.tool_choice.name },
      };
    }
  }

  return {
    model: req.model,
    messages,
    temperature: req.temperature,
    top_p: req.top_p,
    max_tokens: req.max_tokens,
    stop: req.stop_sequences,
    stream: req.stream,
    tools,
    tool_choice: toolChoice,
  };
}

function convertAnthropicMessage(msg: AnthropicMessageParam): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [];
  const role = msg.role.toLowerCase() as 'user' | 'assistant';

  // Simple string content
  if (typeof msg.content === 'string') {
    messages.push({ role, content: msg.content });
    return messages;
  }

  // Complex content blocks
  let textContent = '';
  const toolCalls: OpenAIToolCall[] = [];
  const toolResults: OpenAIMessage[] = [];

  for (const block of msg.content) {
    switch (block.type) {
      case 'text':
        if (block.text) {
          textContent += block.text;
        }
        break;

      case 'image':
        // OpenAI doesn't support images in the same way
        // Skip for now (would need to convert to base64 data URL)
        break;

      case 'tool_use':
        if (block.id && block.name) {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input || {}),
            },
          });
        }
        break;

      case 'tool_result':
        if (block.tool_use_id) {
          const resultContent = typeof block.content === 'string'
            ? block.content
            : extractTextFromContentBlocks(block.content || []);

          toolResults.push({
            role: 'tool',
            content: resultContent,
            tool_call_id: block.tool_use_id,
          });
        }
        break;
    }
  }

  // Add main message if there's text or tool calls
  if (textContent || toolCalls.length > 0) {
    const message: OpenAIMessage = {
      role,
      content: textContent,
    };
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }
    messages.push(message);
  }

  // Add tool result messages
  messages.push(...toolResults);

  return messages;
}

function convertAnthropicTool(tool: AnthropicTool): OpenAITool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  };
}

function extractTextFromContentBlocks(blocks: AnthropicContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'text' && block.text)
    .map(block => block.text)
    .join('');
}

// ============================================================================
// Response Conversion: OpenAI → Anthropic
// ============================================================================

export function toMessagesResponse(
  openaiRes: OpenAIChatResponse,
  messageId?: string
): AnthropicMessagesResponse {
  const id = messageId || generateMessageId();
  const choice = openaiRes.choices[0];
  const message = choice.message;

  const content: AnthropicContentBlock[] = [];

  // Add text content
  if (message.content) {
    content.push({
      type: 'text',
      text: message.content,
    });
  }

  // Add tool calls
  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments || '{}'),
      });
    }
  }

  const stopReason = mapStopReason(choice.finish_reason, message.tool_calls?.length ?? 0);

  return {
    id,
    type: 'message',
    role: 'assistant',
    model: openaiRes.model,
    content,
    stop_reason: stopReason,
    usage: {
      input_tokens: openaiRes.usage.prompt_tokens,
      output_tokens: openaiRes.usage.completion_tokens,
    },
  };
}

function mapStopReason(
  finishReason: string | null,
  toolCallsCount: number
): AnthropicMessagesResponse['stop_reason'] {
  if (toolCallsCount > 0) {
    return 'tool_use';
  }

  switch (finishReason) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
      return 'tool_use';
    default:
      return 'end_turn';
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

export function generateMessageId(): string {
  const bytes = randomBytes(12);
  return `msg_${bytes.toString('hex')}`;
}

export function generateRequestId(): string {
  const bytes = randomBytes(12);
  return `req_${bytes.toString('hex')}`;
}

export function estimateInputTokens(req: AnthropicMessagesRequest): number {
  let totalLength = 0;

  // Count system prompt
  if (req.system) {
    if (typeof req.system === 'string') {
      totalLength += req.system.length;
    } else {
      totalLength += extractTextFromContentBlocks(req.system).length;
    }
  }

  // Count messages
  for (const msg of req.messages) {
    totalLength += msg.role.length;
    if (typeof msg.content === 'string') {
      totalLength += msg.content.length;
    } else {
      totalLength += extractTextFromContentBlocks(msg.content).length;
    }
  }

  // Count tools
  if (req.tools) {
    for (const tool of req.tools) {
      totalLength += tool.name.length;
      totalLength += tool.description?.length ?? 0;
      totalLength += JSON.stringify(tool.input_schema || {}).length;
    }
  }

  // Rough estimate: 1 token ≈ 4 characters
  return Math.max(1, Math.floor(totalLength / 4));
}

// ============================================================================
// Error Response Creation
// ============================================================================

export function createAnthropicError(statusCode: number, message: string) {
  let errorType: string;

  switch (statusCode) {
    case 400:
      errorType = 'invalid_request_error';
      break;
    case 401:
      errorType = 'authentication_error';
      break;
    case 403:
      errorType = 'permission_error';
      break;
    case 404:
      errorType = 'not_found_error';
      break;
    case 429:
      errorType = 'rate_limit_error';
      break;
    case 503:
    case 529:
      errorType = 'overloaded_error';
      break;
    default:
      errorType = 'api_error';
  }

  return {
    type: 'error',
    error: {
      type: errorType,
      message,
    },
    request_id: generateRequestId(),
  };
}
