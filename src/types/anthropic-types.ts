// Anthropic Messages API Types
// Based on https://docs.anthropic.com/en/api/messages

// ============================================================================
// Request Types
// ============================================================================

export interface AnthropicMessagesRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessageParam[];
  system?: string | AnthropicContentBlock[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  metadata?: AnthropicMetadata;
}

export interface AnthropicMessageParam {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';

  // For text blocks
  text?: string;

  // For image blocks
  source?: {
    type: 'base64' | 'url';
    media_type?: string;
    data?: string;
    url?: string;
  };

  // For tool_use blocks
  id?: string;
  name?: string;
  input?: Record<string, any>;

  // For tool_result blocks
  tool_use_id?: string;
  content?: string | AnthropicContentBlock[];
  is_error?: boolean;
}

export interface AnthropicTool {
  type?: 'custom';
  name: string;
  description?: string;
  input_schema?: Record<string, any>;
}

export interface AnthropicToolChoice {
  type: 'auto' | 'any' | 'tool' | 'none';
  name?: string;
  disable_parallel_tool_use?: boolean;
}

export interface AnthropicMetadata {
  user_id?: string;
}

// ============================================================================
// Response Types
// ============================================================================

export interface AnthropicMessagesResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicContentBlock[];
  stop_reason?: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  stop_sequence?: string;
  usage: AnthropicUsage;
}

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
}

// ============================================================================
// Streaming Event Types
// ============================================================================

export interface AnthropicMessageStartEvent {
  type: 'message_start';
  message: AnthropicMessagesResponse;
}

export interface AnthropicContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block: AnthropicContentBlock;
}

export interface AnthropicContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta: AnthropicDelta;
}

export interface AnthropicDelta {
  type: 'text_delta' | 'input_json_delta';
  text?: string;
  partial_json?: string;
}

export interface AnthropicContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

export interface AnthropicMessageDeltaEvent {
  type: 'message_delta';
  delta: {
    stop_reason?: string;
    stop_sequence?: string;
  };
  usage: AnthropicUsage;
}

export interface AnthropicMessageStopEvent {
  type: 'message_stop';
}

export interface AnthropicPingEvent {
  type: 'ping';
}

export interface AnthropicStreamErrorEvent {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

export type AnthropicStreamEvent =
  | AnthropicMessageStartEvent
  | AnthropicContentBlockStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | AnthropicMessageStopEvent
  | AnthropicPingEvent
  | AnthropicStreamErrorEvent;

// ============================================================================
// Error Types
// ============================================================================

export interface AnthropicError {
  type: string;
  message: string;
}

export interface AnthropicErrorResponse {
  type: 'error';
  error: AnthropicError;
  request_id?: string;
}

// ============================================================================
// OpenAI Types (for conversion)
// ============================================================================

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, any>;
  };
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string[];
  stream?: boolean;
  tools?: OpenAITool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

export interface OpenAIChatResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIChatStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
}
