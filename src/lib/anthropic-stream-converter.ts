import type {
  OpenAIChatStreamChunk,
  AnthropicStreamEvent,
  AnthropicMessageStartEvent,
  AnthropicContentBlockStartEvent,
  AnthropicContentBlockDeltaEvent,
  AnthropicContentBlockStopEvent,
  AnthropicMessageDeltaEvent,
  AnthropicMessageStopEvent,
} from '../types/anthropic-types.js';

/**
 * StreamConverter manages state for converting OpenAI streaming responses to Anthropic format.
 *
 * It tracks the current state of content blocks and emits proper Anthropic SSE events.
 */
export class AnthropicStreamConverter {
  private id: string;
  private model: string;
  private firstChunk: boolean = true;
  private contentIndex: number = 0;
  private inputTokens: number;
  private outputTokens: number = 0;
  private estimatedInputTokens: number;

  // State tracking
  private textStarted: boolean = false;
  private currentTextContent: string = '';
  private toolCallsInProgress = new Map<number, ToolCallState>();
  private toolCallsSent = new Set<string>();

  constructor(id: string, model: string, estimatedInputTokens: number) {
    this.id = id;
    this.model = model;
    this.estimatedInputTokens = estimatedInputTokens;
    this.inputTokens = estimatedInputTokens;
  }

  /**
   * Process an OpenAI streaming chunk and return Anthropic events.
   */
  process(chunk: OpenAIChatStreamChunk): AnthropicStreamEvent[] {
    const events: AnthropicStreamEvent[] = [];

    // First chunk: emit message_start
    if (this.firstChunk) {
      this.firstChunk = false;
      events.push(this.createMessageStartEvent());
    }

    const choice = chunk.choices[0];
    if (!choice) {
      return events;
    }

    const delta = choice.delta;

    // Handle text content
    if (delta.content) {
      if (!this.textStarted) {
        this.textStarted = true;
        events.push(this.createContentBlockStartEvent('text'));
      }

      this.currentTextContent += delta.content;
      events.push(this.createTextDeltaEvent(delta.content));
    }

    // Handle tool calls
    if (delta.tool_calls) {
      for (const toolCallDelta of delta.tool_calls) {
        const index = toolCallDelta.index;
        const tcEvents = this.processToolCallDelta(toolCallDelta);
        events.push(...tcEvents);
      }
    }

    // Handle completion
    if (choice.finish_reason) {
      // Close any open content blocks
      if (this.textStarted) {
        events.push(this.createContentBlockStopEvent(this.contentIndex));
        this.contentIndex++;
      }

      // Close any open tool calls
      for (const [index, state] of this.toolCallsInProgress.entries()) {
        if (state.started && !state.completed) {
          events.push(this.createContentBlockStopEvent(state.blockIndex));
          state.completed = true;
        }
      }

      // Emit message_delta with stop reason
      const stopReason = this.mapFinishReason(choice.finish_reason);
      events.push(this.createMessageDeltaEvent(stopReason));

      // Emit message_stop
      events.push(this.createMessageStopEvent());
    }

    return events;
  }

  private processToolCallDelta(
    toolCallDelta: NonNullable<OpenAIChatStreamChunk['choices'][0]['delta']['tool_calls']>[0]
  ): AnthropicStreamEvent[] {
    const events: AnthropicStreamEvent[] = [];
    const index = toolCallDelta.index;

    // Get or create tool call state
    let state = this.toolCallsInProgress.get(index);
    if (!state) {
      state = {
        id: '',
        name: '',
        arguments: '',
        started: false,
        completed: false,
        blockIndex: -1,
      };
      this.toolCallsInProgress.set(index, state);
    }

    // Accumulate tool call data
    if (toolCallDelta.id) {
      state.id = toolCallDelta.id;
    }
    if (toolCallDelta.function?.name) {
      state.name = toolCallDelta.function.name;
    }
    if (toolCallDelta.function?.arguments) {
      state.arguments += toolCallDelta.function.arguments;
    }

    // Start tool call block when we have id and name
    if (!state.started && state.id && state.name) {
      // Close text block if open
      if (this.textStarted) {
        events.push(this.createContentBlockStopEvent(this.contentIndex));
        this.contentIndex++;
        this.textStarted = false;
      }

      state.started = true;
      state.blockIndex = this.contentIndex;
      events.push(this.createToolUseStartEvent(state.id, state.name));
    }

    // Emit input_json_delta if we have arguments
    if (state.started && toolCallDelta.function?.arguments) {
      events.push(this.createInputJsonDeltaEvent(
        state.blockIndex,
        toolCallDelta.function.arguments
      ));
    }

    return events;
  }

  // ============================================================================
  // Event Creation Methods
  // ============================================================================

  private createMessageStartEvent(): AnthropicMessageStartEvent {
    return {
      type: 'message_start',
      message: {
        id: this.id,
        type: 'message',
        role: 'assistant',
        model: this.model,
        content: [],
        usage: {
          input_tokens: this.inputTokens,
          output_tokens: 0,
        },
      },
    };
  }

  private createContentBlockStartEvent(type: 'text'): AnthropicContentBlockStartEvent {
    return {
      type: 'content_block_start',
      index: this.contentIndex,
      content_block: {
        type: 'text',
        text: '',
      },
    };
  }

  private createToolUseStartEvent(id: string, name: string): AnthropicContentBlockStartEvent {
    return {
      type: 'content_block_start',
      index: this.contentIndex,
      content_block: {
        type: 'tool_use',
        id,
        name,
        input: {},
      },
    };
  }

  private createTextDeltaEvent(text: string): AnthropicContentBlockDeltaEvent {
    return {
      type: 'content_block_delta',
      index: this.contentIndex,
      delta: {
        type: 'text_delta',
        text,
      },
    };
  }

  private createInputJsonDeltaEvent(
    index: number,
    partialJson: string
  ): AnthropicContentBlockDeltaEvent {
    return {
      type: 'content_block_delta',
      index,
      delta: {
        type: 'input_json_delta',
        partial_json: partialJson,
      },
    };
  }

  private createContentBlockStopEvent(index: number): AnthropicContentBlockStopEvent {
    return {
      type: 'content_block_stop',
      index,
    };
  }

  private createMessageDeltaEvent(stopReason: string): AnthropicMessageDeltaEvent {
    return {
      type: 'message_delta',
      delta: {
        stop_reason: stopReason,
      },
      usage: {
        input_tokens: this.inputTokens,
        output_tokens: this.outputTokens,
      },
    };
  }

  private createMessageStopEvent(): AnthropicMessageStopEvent {
    return {
      type: 'message_stop',
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private mapFinishReason(finishReason: string | null): string {
    const hasToolCalls = this.toolCallsInProgress.size > 0;

    if (hasToolCalls) {
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
}

// ============================================================================
// Internal Types
// ============================================================================

interface ToolCallState {
  id: string;
  name: string;
  arguments: string;
  started: boolean;
  completed: boolean;
  blockIndex: number;
}
