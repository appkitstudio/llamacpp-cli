#!/usr/bin/env node

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import * as fs from 'fs/promises';
import * as path from 'path';
import { RouterConfig } from '../types/router-config';
import { ServerConfig } from '../types/server-config';
import { readJson, fileExists, getConfigDir, getServersDir } from '../utils/file-utils';
import { RouterLogger, RequestTimer, RouterLogEntry } from './router-logger';
import type {
  AnthropicMessagesRequest,
} from '../types/anthropic-types';

interface ErrorResponse {
  error: string;
  details?: string;
}

interface ModelInfo {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

interface ModelsResponse {
  object: 'list';
  data: ModelInfo[];
}

// ---------------------------------------------------------------------------
// Helpers for Qwen3-Coder model quirk fixes
// ---------------------------------------------------------------------------

interface ParsedBlock {
  type: string;      // 'text' | 'thinking' | 'tool_use'
  content: string;   // accumulated text / thinking
  name?: string;     // tool_use: tool name
  id?: string;       // tool_use: id
  input?: Record<string, string>; // tool_use: parsed parameters
}

interface ParsedToolCall {
  name: string;
  input: Record<string, string>;
}

/**
 * Parse Qwen3-Coder XML tool calls from text content.
 * Handles: <tool_call><function=NAME\n<parameter=P>V</parameter></function></tool_call>
 * Returns extracted tool calls and cleaned text (XML removed).
 */
function parseXmlToolCalls(text: string): { toolCalls: ParsedToolCall[]; cleanText: string; skippedNames: string[] } {
  const toolCalls: ParsedToolCall[] = [];
  const skippedNames: string[] = [];
  const toolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let match;
  while ((match = toolCallRegex.exec(text)) !== null) {
    const inner = match[1];
    const funcMatch = /<function=(\w+)/.exec(inner);
    if (!funcMatch) continue;
    const name = funcMatch[1];
    const input: Record<string, string> = {};
    const paramRegex = /<parameter=(\w+)>([\s\S]*?)<\/parameter>/g;
    let paramMatch;
    while ((paramMatch = paramRegex.exec(inner)) !== null) {
      input[paramMatch[1]] = paramMatch[2].trim();
    }
    // Skip malformed tool calls with no parameters (model generation failure)
    if (Object.keys(input).length === 0) {
      skippedNames.push(name);
      continue;
    }
    toolCalls.push({ name, input });
  }
  const cleanText = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
  return { toolCalls, cleanText, skippedNames };
}

function generateToolUseId(): string {
  return 'toolu_' + Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

/**
 * Count how many consecutive recent user messages contained only error tool_results.
 * Used to detect infinite error-feedback loops: if >= 2, stop sending error feedback and strip.
 */
function countConsecutiveErrorCycles(requestBody: string): number {
  try {
    const body = JSON.parse(requestBody);
    const messages: any[] = body.messages ?? [];
    let count = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant') continue; // skip assistant turns
      if (msg.role !== 'user') break;
      const content: any[] = Array.isArray(msg.content) ? msg.content : [];
      const toolResults = content.filter((c: any) => c.type === 'tool_result');
      if (toolResults.length === 0) break; // non-tool user message, stop
      if (toolResults.every((c: any) => c.is_error)) {
        count++;
      } else {
        break; // mixed or all-success results, stop counting
      }
    }
    return count;
  } catch {
    return 0;
  }
}

function emitSseEvent(res: http.ServerResponse, eventType: string, data: object): void {
  res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Emit a fully reconstructed SSE stream from parsed block state.
 * Used when the original stream needs modification (XML tool calls or thinking-only).
 */
function emitReconstructedSseStream(
  res: http.ServerResponse,
  messageStartData: any,
  blocks: ParsedBlock[],
  stopReason: string,
  outputTokens: number
): void {
  if (messageStartData) {
    emitSseEvent(res, 'message_start', messageStartData);
  }
  let idx = 0;
  for (const block of blocks) {
    if (block.type === 'text') {
      if (!block.content) continue;
      emitSseEvent(res, 'content_block_start', { type: 'content_block_start', index: idx, content_block: { type: 'text', text: '' } });
      emitSseEvent(res, 'content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text: block.content } });
      emitSseEvent(res, 'content_block_stop', { type: 'content_block_stop', index: idx });
    } else if (block.type === 'thinking') {
      if (!block.content) continue;
      emitSseEvent(res, 'content_block_start', { type: 'content_block_start', index: idx, content_block: { type: 'thinking', thinking: '' } });
      emitSseEvent(res, 'content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'thinking_delta', thinking: block.content } });
      emitSseEvent(res, 'content_block_stop', { type: 'content_block_stop', index: idx });
    } else if (block.type === 'tool_use') {
      emitSseEvent(res, 'content_block_start', { type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
      emitSseEvent(res, 'content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) } });
      emitSseEvent(res, 'content_block_stop', { type: 'content_block_stop', index: idx });
    }
    idx++;
  }
  emitSseEvent(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } });
  emitSseEvent(res, 'message_stop', { type: 'message_stop' });
}

interface BufferedSseResult {
  rawEvents: string[];
  messageStartData: any;
  stopReason: string;
  blocks: ParsedBlock[];
  outputTokens: number;
}

/**
 * Make a backend HTTP request, buffer the full SSE stream, and return parsed state.
 * Used for the initial request AND for retries when the model generates malformed output.
 */
function bufferSseRequest(options: http.RequestOptions, requestBody: string): Promise<BufferedSseResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let sseBuffer = '';
      const rawEvents: string[] = [];
      let messageStartData: any = null;
      let messageDeltaData: any = null;
      const parsedBlocks: Record<number, ParsedBlock> = {};
      let outputTokens = 0;

      res.on('data', (chunk: Buffer) => {
        sseBuffer += chunk.toString();
        const parts = sseBuffer.split('\n\n');
        sseBuffer = parts.pop() ?? '';
        for (const part of parts) {
          if (!part.trim()) continue;
          rawEvents.push(part);
          let dataStr = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('data: ')) dataStr = line.slice(6);
          }
          try {
            const data = JSON.parse(dataStr);
            if (data.type === 'message_start') messageStartData = data;
            else if (data.type === 'content_block_start') {
              const idx: number = data.index ?? 0;
              parsedBlocks[idx] = { type: data.content_block?.type ?? 'text', content: '', name: data.content_block?.name, id: data.content_block?.id };
            } else if (data.type === 'content_block_delta') {
              const block = parsedBlocks[data.index];
              if (block) {
                if (data.delta?.type === 'text_delta') block.content += data.delta.text ?? '';
                else if (data.delta?.type === 'thinking_delta') block.content += data.delta.thinking ?? '';
              }
            } else if (data.type === 'message_delta') {
              messageDeltaData = data;
              outputTokens = data.usage?.output_tokens ?? 0;
            }
          } catch { /* non-JSON SSE (ping etc.) */ }
        }
      });

      res.on('end', () => {
        if (sseBuffer.trim()) rawEvents.push(sseBuffer);
        resolve({
          rawEvents,
          messageStartData,
          stopReason: messageDeltaData?.delta?.stop_reason ?? 'end_turn',
          blocks: Object.values(parsedBlocks),
          outputTokens,
        });
      });

      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

/**
 * Apply Qwen3 model quirk fixes to a buffered SSE result.
 * Returns the action to take (what to emit) without actually emitting anything.
 */
function classifyBufferedResult(result: BufferedSseResult): {
  action: 'fix1' | 'fix2' | 'fix3' | 'fix4' | 'raw';
  newBlocks?: ParsedBlock[];
  stopReason?: string;
  skippedNames?: string[];
} {
  const { blocks, stopReason } = result;
  const textBlocks = blocks.filter(b => b.type === 'text');
  const thinkingBlocks = blocks.filter(b => b.type === 'thinking');
  const allText = textBlocks.map(b => b.content).join('');
  const { toolCalls, cleanText, skippedNames } = parseXmlToolCalls(allText);

  if (toolCalls.length > 0) {
    const newBlocks: ParsedBlock[] = [
      ...blocks.filter(b => b.type !== 'text'),
      ...(cleanText ? [{ type: 'text', content: cleanText }] : []),
      ...toolCalls.map(tc => ({ type: 'tool_use', content: '', id: generateToolUseId(), name: tc.name, input: tc.input })),
    ];
    return { action: 'fix1', newBlocks, stopReason: 'tool_use' };
  }

  if (allText && !cleanText) {
    return { action: 'fix3', skippedNames };
  }

  // fix4: text + malformed tool calls — emit text and empty tool_use blocks for error feedback
  if (cleanText && skippedNames.length > 0) {
    const newBlocks: ParsedBlock[] = [
      ...blocks.filter(b => b.type !== 'text'),
      { type: 'text', content: cleanText },
      ...skippedNames.map(name => ({ type: 'tool_use', content: '', id: generateToolUseId(), name, input: {} })),
    ];
    return { action: 'fix4', newBlocks, stopReason: 'tool_use', skippedNames };
  }

  if (stopReason === 'end_turn' && thinkingBlocks.length > 0 && !textBlocks.some(b => b.content)) {
    const thinkingText = thinkingBlocks.map(b => b.content).join('\n');
    const newBlocks: ParsedBlock[] = [...thinkingBlocks, { type: 'text', content: thinkingText }];
    return { action: 'fix2', newBlocks, stopReason: 'end_turn' };
  }

  return { action: 'raw' };
}

/**
 * Router HTTP server - proxies requests to backend llama.cpp servers
 */
class RouterServer {
  private config!: RouterConfig;
  private server!: http.Server;
  private logger!: RouterLogger;

  async initialize(): Promise<void> {
    // Load router config
    const configPath = path.join(getConfigDir(), 'router.json');
    if (!(await fileExists(configPath))) {
      throw new Error('Router configuration not found');
    }
    this.config = await readJson<RouterConfig>(configPath);

    // Initialize logger with logging setting
    this.logger = new RouterLogger(this.config.logging);

    // Rotate log file if needed
    await this.logger.rotateIfNeeded();

    // Create HTTP server
    this.server = http.createServer(async (req, res) => {
      await this.handleRequest(req, res);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.error('[Router] Received SIGTERM, shutting down gracefully...');
      this.server.close(() => {
        console.error('[Router] Server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', async () => {
      console.error('[Router] Received SIGINT, shutting down gracefully...');
      this.server.close(() => {
        console.error('[Router] Server closed');
        process.exit(0);
      });
    });
  }

  async start(): Promise<void> {
    await this.initialize();

    this.server.listen(this.config.port, this.config.host, () => {
      console.error(`[Router] Listening on http://${this.config.host}:${this.config.port}`);
      console.error(`[Router] PID: ${process.pid}`);
    });
  }

  /**
   * Main request handler
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      // Route based on path
      const url = req.url || '/';
      const method = req.method || 'GET';

      if (url === '/' && method === 'GET') {
        // Root endpoint - return simple status
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'llamacpp-router' }));
      } else if (url === '/health' && method === 'GET') {
        await this.handleHealth(req, res);
      } else if (url.startsWith('/props') && method === 'GET') {
        await this.handleProps(req, res, url);
      } else if (url === '/v1/models' && method === 'GET') {
        await this.handleModels(req, res);
      } else if (url.startsWith('/v1/models/') && method === 'GET') {
        const modelId = url.slice('/v1/models/'.length).split('?')[0]; // Strip query params
        await this.handleModelRetrieve(req, res, decodeURIComponent(modelId));
      } else if (url.startsWith('/v1/messages/count_tokens') && method === 'POST') {
        await this.handleCountTokens(req, res);
      } else if (url.startsWith('/v1/messages') && method === 'POST') {
        await this.handleAnthropicMessages(req, res);
      } else if (url.startsWith('/v1/chat/completions') && method === 'POST') {
        await this.handleChatCompletions(req, res);
      } else if (url.startsWith('/v1/embeddings') && method === 'POST') {
        await this.handleEmbeddings(req, res);
      } else {
        this.sendError(res, 404, 'Not Found', `Unknown endpoint: ${url}`);
      }
    } catch (error) {
      console.error('[Router] Error handling request:', error);
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message);
    }
  }

  /**
   * Health check endpoint
   */
  private async handleHealth(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }));
  }

  /**
   * Proxy llama.cpp's /props to a backend server. Pass ?model=<name> to
   * select which backend; otherwise picks the first running server.
   * Used by clients (e.g. lcode) to discover the loaded n_ctx.
   */
  private async handleProps(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: string,
  ): Promise<void> {
    const query = new URL(url, 'http://localhost').searchParams;
    const requestedModel = query.get('model');

    const servers = await this.getAllServers();
    const running = servers.filter((s) => s.status === 'running');
    const target = requestedModel
      ? await this.findServerForModel(requestedModel)
      : running[0] ?? null;

    if (!target || target.status !== 'running') {
      this.sendError(res, 404, 'Not Found',
        requestedModel
          ? `No running server for model: ${requestedModel}`
          : 'No running servers');
      return;
    }

    const host = target.host === '0.0.0.0' ? '127.0.0.1' : target.host;
    const backendReq = http.request({
      hostname: host,
      port: target.port,
      path: '/props',
      method: 'GET',
      timeout: this.config.requestTimeout,
    }, (backendRes) => {
      res.writeHead(backendRes.statusCode || 200, {
        'Content-Type': backendRes.headers['content-type'] ?? 'application/json',
      });
      backendRes.pipe(res);
    });
    backendReq.on('error', (err) => {
      if (!res.headersSent) {
        this.sendError(res, 502, 'Bad Gateway', `Backend /props failed: ${err.message}`);
      }
    });
    backendReq.on('timeout', () => {
      backendReq.destroy();
      if (!res.headersSent) {
        this.sendError(res, 504, 'Gateway Timeout', 'Backend /props did not respond in time');
      }
    });
    backendReq.end();
  }

  /**
   * List models endpoint - aggregate from all running servers
   */
  private async handleModels(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const servers = await this.getAllServers();
    const runningServers = servers.filter(s => s.status === 'running');

    const models: ModelInfo[] = runningServers.flatMap(server => {
      const created = Math.floor(new Date(server.createdAt).getTime() / 1000);
      const entries: ModelInfo[] = [{ id: server.modelName, object: 'model', created, owned_by: 'llamacpp' }];
      if (server.alias) {
        entries.push({ id: server.alias, object: 'model', created, owned_by: 'llamacpp' });
      }
      return entries;
    });

    const response: ModelsResponse = {
      object: 'list',
      data: models,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  /**
   * Retrieve specific model endpoint - OpenAI compatible
   * Returns success for any model to allow Claude Code to work with both local and cloud models
   */
  private async handleModelRetrieve(req: http.IncomingMessage, res: http.ServerResponse, modelId: string): Promise<void> {
    const servers = await this.getAllServers();
    const server = servers.find(s => s.modelName === modelId && s.status === 'running');

    // Return model info for both local models and unknown models (like claude-haiku)
    // This allows Claude Code to use both local and cloud model names
    const modelInfo: ModelInfo = {
      id: modelId,
      object: 'model',
      created: server ? Math.floor(new Date(server.createdAt).getTime() / 1000) : Math.floor(Date.now() / 1000),
      owned_by: server ? 'llamacpp' : 'anthropic',
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(modelInfo));
  }

  /**
   * Count tokens endpoint - Anthropic token counting API
   * Uses rough estimation since we can't proxy to llama.cpp for this
   */
  private async handleCountTokens(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      // Parse request body
      const body = await this.readBody(req);
      const request = JSON.parse(body);

      // Estimate token count (rough approximation: ~4 chars per token)
      let totalChars = 0;
      if (request.system) {
        totalChars += typeof request.system === 'string' ? request.system.length : JSON.stringify(request.system).length;
      }
      if (request.messages) {
        for (const msg of request.messages) {
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          totalChars += content.length;
        }
      }

      const estimatedTokens = Math.ceil(totalChars / 4);

      // Return Anthropic-compatible token count response
      const response = {
        input_tokens: estimatedTokens
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (error) {
      console.error('[Router] Error counting tokens:', error);
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message);
    }
  }

  /**
   * Anthropic Messages API endpoint - proxy directly to llama.cpp's /v1/messages
   */
  private async handleAnthropicMessages(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const timer = new RequestTimer();
    let modelName = 'unknown';
    let statusCode = 500;
    let errorMsg: string | undefined;
    let promptPreview: string | undefined;

    try {
      // Parse request body
      const body = await this.readBody(req);
      let anthropicRequest: AnthropicMessagesRequest;
      try {
        anthropicRequest = JSON.parse(body);
      } catch (error) {
        statusCode = 400;
        errorMsg = 'Invalid JSON in request body';
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: errorMsg } }));
        await this.logRequest(modelName, '/v1/messages', statusCode, timer.elapsed(), errorMsg);
        return;
      }

      // Extract model name and prompt preview
      modelName = anthropicRequest.model || 'unknown';
      if (anthropicRequest.messages && anthropicRequest.messages.length > 0) {
        const userMsg = anthropicRequest.messages.find(m => m.role === 'user');
        if (userMsg && typeof userMsg.content === 'string') {
          promptPreview = userMsg.content.slice(0, 50);
        }
      }

      // Validate required fields
      if (!anthropicRequest.model) {
        statusCode = 400;
        errorMsg = 'Missing "model" field in request';
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: errorMsg } }));
        await this.logRequest(modelName, '/v1/messages', statusCode, timer.elapsed(), errorMsg, undefined, promptPreview);
        return;
      }

      if (!anthropicRequest.max_tokens || anthropicRequest.max_tokens <= 0) {
        statusCode = 400;
        errorMsg = 'max_tokens is required and must be positive';
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: errorMsg } }));
        await this.logRequest(modelName, '/v1/messages', statusCode, timer.elapsed(), errorMsg, undefined, promptPreview);
        return;
      }

      if (!anthropicRequest.messages || anthropicRequest.messages.length === 0) {
        statusCode = 400;
        errorMsg = 'messages is required and must be non-empty';
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: errorMsg } }));
        await this.logRequest(modelName, '/v1/messages', statusCode, timer.elapsed(), errorMsg, undefined, promptPreview);
        return;
      }

      // Inject tool call guidance when tools are present (Qwen3-Coder workaround:
      // the model sometimes generates tool calls with no parameters when context is long)
      if (anthropicRequest.tools && anthropicRequest.tools.length > 0) {
        const guidance = 'When using tools, always include ALL required parameters with their complete values. Never omit parameters from tool calls.';
        if (typeof anthropicRequest.system === 'string' && anthropicRequest.system) {
          anthropicRequest.system = guidance + '\n\n' + anthropicRequest.system;
        } else if (Array.isArray(anthropicRequest.system)) {
          anthropicRequest.system = [{ type: 'text', text: guidance }, ...anthropicRequest.system];
        } else {
          anthropicRequest.system = guidance;
        }
      }

      // Find server for model
      const server = await this.findServerForModel(modelName);
      if (!server) {
        statusCode = 404;
        errorMsg = `No server found for model: ${modelName}`;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: errorMsg } }));
        await this.logRequest(modelName, '/v1/messages', statusCode, timer.elapsed(), errorMsg, undefined, promptPreview);
        return;
      }

      // Check if server is running
      if (server.status !== 'running') {
        statusCode = 503;
        errorMsg = `Server for model ${modelName} is not running (status: ${server.status})`;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: errorMsg } }));
        await this.logRequest(modelName, '/v1/messages', statusCode, timer.elapsed(), errorMsg, undefined, promptPreview);
        return;
      }

      // Proxy request directly to llama.cpp's /v1/messages endpoint
      const backendHost = server.host === '0.0.0.0' ? '127.0.0.1' : server.host;
      const backendUrl = `http://${backendHost}:${server.port}/v1/messages`;

      // Proxy the request as-is (no conversion needed)
      await this.proxyAnthropicRequest(
        backendUrl,
        anthropicRequest,
        res,
        timer,
        modelName,
        promptPreview,
        server
      );
    } catch (error) {
      console.error('[Router] Error handling Anthropic messages request:', error);
      statusCode = 500;
      errorMsg = (error as Error).message;
      if (!res.headersSent) {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: errorMsg } }));
      }
      await this.logRequest(modelName, '/v1/messages', statusCode, timer.elapsed(), errorMsg, undefined, promptPreview);
    }
  }

  /**
   * Proxy Anthropic Messages request directly to llama.cpp (no conversion)
   */
  private async proxyAnthropicRequest(
    backendUrl: string,
    anthropicRequest: AnthropicMessagesRequest,
    res: http.ServerResponse,
    timer: RequestTimer,
    modelName: string,
    promptPreview: string | undefined,
    server: ServerConfig
  ): Promise<void> {
    const url = new URL(backendUrl);
    const requestBody = JSON.stringify(anthropicRequest);

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
      timeout: this.config.requestTimeout,
    };

    return new Promise((resolve, reject) => {
      const backendReq = http.request(options, (backendRes) => {
        // Handle streaming vs non-streaming
        if (anthropicRequest.stream) {
          res.writeHead(backendRes.statusCode || 200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          // Buffer the full SSE stream so we can detect and fix Qwen3 model quirks before
          // forwarding to the client. Headers are sent above but NO events are emitted until
          // we've finished processing (enabling transparent retry for Fix 3).
          let sseBuffer = '';
          const rawEvents: string[] = [];
          let messageStartData: any = null;
          let messageDeltaData: any = null;
          const parsedBlocks: Record<number, ParsedBlock> = {};
          let outputTokens = 0;

          backendRes.on('data', (chunk: Buffer) => {
            sseBuffer += chunk.toString();
            const parts = sseBuffer.split('\n\n');
            sseBuffer = parts.pop() ?? '';

            for (const part of parts) {
              if (!part.trim()) continue;
              rawEvents.push(part);

              let dataStr = '';
              for (const line of part.split('\n')) {
                if (line.startsWith('data: ')) dataStr = line.slice(6);
              }

              try {
                const data = JSON.parse(dataStr);
                if (data.type === 'message_start') {
                  messageStartData = data;
                } else if (data.type === 'content_block_start') {
                  const idx: number = data.index ?? 0;
                  parsedBlocks[idx] = {
                    type: data.content_block?.type ?? 'text',
                    content: '',
                    name: data.content_block?.name,
                    id: data.content_block?.id,
                  };
                } else if (data.type === 'content_block_delta') {
                  const block = parsedBlocks[data.index];
                  if (block) {
                    if (data.delta?.type === 'text_delta') block.content += data.delta.text ?? '';
                    else if (data.delta?.type === 'thinking_delta') block.content += data.delta.thinking ?? '';
                  }
                } else if (data.type === 'message_delta') {
                  messageDeltaData = data;
                  outputTokens = data.usage?.output_tokens ?? 0;
                }
              } catch {
                // Non-JSON SSE data (e.g. ping) — still buffered in rawEvents
              }
            }
          });

          backendRes.on('end', async () => {
            if (sseBuffer.trim()) rawEvents.push(sseBuffer);

            const firstResult: BufferedSseResult = {
              rawEvents,
              messageStartData,
              stopReason: messageDeltaData?.delta?.stop_reason ?? 'end_turn',
              blocks: Object.values(parsedBlocks),
              outputTokens,
            };

            let classified = classifyBufferedResult(firstResult);
            let finalResult = firstResult;

            if (classified.action === 'fix3') {
              const skipped = classified.skippedNames ?? [];
              // Only retry for single empty call glitches (random sampling failure).
              // If 2+ empty calls were generated the model is in a stuck pattern — retry
              // would just double the wait time with the same degenerate result.
              if (skipped.length === 1) {
                console.error(`[Router] Retrying single malformed XML call (attempted: ${skipped.join(', ')})`);
                try {
                  const retryResult = await bufferSseRequest(options, requestBody);
                  const retryClassified = classifyBufferedResult(retryResult);
                  if (retryClassified.action !== 'fix3') {
                    classified = retryClassified;
                    finalResult = retryResult;
                    console.error(`[Router] Retry succeeded (action: ${retryClassified.action})`);
                  } else {
                    console.error(`[Router] Retry also malformed, giving up`);
                  }
                } catch (err) {
                  console.error('[Router] Retry request failed:', err);
                }
              } else {
                console.error(`[Router] Skipping retry — model stuck generating ${skipped.length} malformed calls (${skipped.join(', ')})`);
              }
            }

            if (classified.action === 'fix1') {
              console.error(`[Router] Converting ${classified.newBlocks!.filter(b => b.type === 'tool_use').length} XML tool call(s) to tool_use blocks`);
              emitReconstructedSseStream(res, finalResult.messageStartData, classified.newBlocks!, classified.stopReason!, finalResult.outputTokens);
            } else if (classified.action === 'fix2') {
              console.error('[Router] Injecting fallback text block (thinking-only response detected)');
              emitReconstructedSseStream(res, finalResult.messageStartData, classified.newBlocks!, classified.stopReason!, finalResult.outputTokens);
            } else if (classified.action === 'fix3') {
              const skipped = classified.skippedNames ?? [];
              const errorCycles = countConsecutiveErrorCycles(requestBody);
              if (errorCycles >= 2) {
                // Already tried error feedback twice — model is stuck, strip to avoid infinite loop
                console.error(`[Router] Stripping fix3 after ${errorCycles} error cycles (${skipped.join(', ')})`);
                const newBlocks: ParsedBlock[] = finalResult.blocks.filter(b => b.type === 'thinking');
                emitReconstructedSseStream(res, finalResult.messageStartData, newBlocks, finalResult.stopReason, finalResult.outputTokens);
              } else {
                // Send empty tool_use blocks so Claude Code returns parameter errors for model self-correction
                console.error(`[Router] Forwarding ${skipped.length} empty tool_use block(s) for error feedback [cycle ${errorCycles + 1}] (${skipped.join(', ')})`);
                const emptyToolBlocks: ParsedBlock[] = skipped.map(name => ({
                  type: 'tool_use',
                  content: '',
                  name,
                  id: generateToolUseId(),
                  input: {},
                }));
                const newBlocks: ParsedBlock[] = [
                  ...finalResult.blocks.filter(b => b.type === 'thinking'),
                  ...emptyToolBlocks,
                ];
                emitReconstructedSseStream(res, finalResult.messageStartData, newBlocks, 'tool_use', finalResult.outputTokens);
              }
            } else if (classified.action === 'fix4') {
              // Text + malformed tool calls
              const skipped = classified.skippedNames ?? [];
              const errorCycles = countConsecutiveErrorCycles(requestBody);
              if (errorCycles >= 2) {
                // Already tried error feedback twice — strip malformed calls, return just the text
                console.error(`[Router] Stripping fix4 malformed call(s) after ${errorCycles} error cycles (${skipped.join(', ')})`);
                const textOnlyBlocks = classified.newBlocks!.filter(b => b.type !== 'tool_use');
                emitReconstructedSseStream(res, finalResult.messageStartData, textOnlyBlocks, 'end_turn', finalResult.outputTokens);
              } else {
                console.error(`[Router] Text + ${skipped.length} malformed tool call(s), forwarding empty tool_use for error feedback [cycle ${errorCycles + 1}] (${skipped.join(', ')})`);
                emitReconstructedSseStream(res, finalResult.messageStartData, classified.newBlocks!, 'tool_use', finalResult.outputTokens);
              }
            } else {
              // Raw passthrough
              for (const event of finalResult.rawEvents) {
                res.write(event + '\n\n');
              }
            }

            res.end();
            await this.logRequest(modelName, '/v1/messages', backendRes.statusCode || 200, timer.elapsed(), undefined, `${server.host}:${server.port}`, promptPreview);
            resolve();
          });
        } else {
          // Non-streaming: collect full response then apply fixes
          let responseData = '';

          backendRes.on('data', (chunk) => {
            responseData += chunk.toString();
          });

          backendRes.on('end', async () => {
            let finalResponse = responseData;

            try {
              const responseObj = JSON.parse(responseData);
              if (Array.isArray(responseObj.content)) {
                const textBlocks = responseObj.content.filter((c: any) => c.type === 'text');
                const allText = textBlocks.map((c: any) => c.text ?? '').join('');
                const { toolCalls, cleanText, skippedNames } = parseXmlToolCalls(allText);

                if (toolCalls.length > 0) {
                  // Fix 1: XML tool calls
                  console.error(`[Router] Converting ${toolCalls.length} XML tool call(s) to tool_use blocks`);
                  const newContent: any[] = responseObj.content.filter((c: any) => c.type !== 'text');
                  if (cleanText) newContent.push({ type: 'text', text: cleanText });
                  for (const tc of toolCalls) {
                    newContent.push({ type: 'tool_use', id: generateToolUseId(), name: tc.name, input: tc.input });
                  }
                  responseObj.content = newContent;
                  responseObj.stop_reason = 'tool_use';
                  finalResponse = JSON.stringify(responseObj);
                } else if (allText && !cleanText) {
                  const errorCycles = countConsecutiveErrorCycles(requestBody);
                  // Fix 3: error feedback with loop detection
                  if (errorCycles >= 2) {
                    console.error(`[Router] Stripping fix3 after ${errorCycles} error cycles (${skippedNames.join(', ')})`);
                    responseObj.content = responseObj.content.filter((c: any) => c.type !== 'text');
                    finalResponse = JSON.stringify(responseObj);
                  } else {
                    console.error(`[Router] Forwarding ${skippedNames.length} empty tool_use block(s) for error feedback [cycle ${errorCycles + 1}] (${skippedNames.join(', ')})`);
                    const emptyToolUseBlocks = skippedNames.map(name => ({
                      type: 'tool_use',
                      id: generateToolUseId(),
                      name,
                      input: {},
                    }));
                    responseObj.content = [
                      ...responseObj.content.filter((c: any) => c.type !== 'text'),
                      ...emptyToolUseBlocks,
                    ];
                    responseObj.stop_reason = 'tool_use';
                    finalResponse = JSON.stringify(responseObj);
                  }
                } else if (cleanText && skippedNames.length > 0) {
                  const errorCycles = countConsecutiveErrorCycles(requestBody);
                  // Fix 4: text + malformed tool calls with loop detection
                  if (errorCycles >= 2) {
                    console.error(`[Router] Stripping fix4 malformed call(s) after ${errorCycles} error cycles (${skippedNames.join(', ')})`);
                    responseObj.content = [
                      ...responseObj.content.filter((c: any) => c.type !== 'text'),
                      { type: 'text', text: cleanText },
                    ];
                    finalResponse = JSON.stringify(responseObj);
                  } else {
                    console.error(`[Router] Text + ${skippedNames.length} malformed tool call(s), forwarding empty tool_use for error feedback [cycle ${errorCycles + 1}] (${skippedNames.join(', ')})`);
                    const emptyToolUseBlocks = skippedNames.map(name => ({
                      type: 'tool_use',
                      id: generateToolUseId(),
                      name,
                      input: {},
                    }));
                    responseObj.content = [
                      ...responseObj.content.filter((c: any) => c.type !== 'text'),
                      { type: 'text', text: cleanText },
                      ...emptyToolUseBlocks,
                    ];
                    responseObj.stop_reason = 'tool_use';
                    finalResponse = JSON.stringify(responseObj);
                  }
                } else {
                  // Fix 2: Thinking-only
                  const hasText = responseObj.content.some((c: any) => c.type === 'text' && c.text);
                  const thinkingBlocks = responseObj.content.filter((c: any) => c.type === 'thinking');
                  if (!hasText && thinkingBlocks.length > 0) {
                    console.error('[Router] Injecting fallback text block (thinking-only response detected)');
                    const thinkingText = thinkingBlocks.map((c: any) => c.thinking ?? '').join('\n');
                    responseObj.content.push({ type: 'text', text: thinkingText });
                    finalResponse = JSON.stringify(responseObj);
                  }
                }
              }
            } catch {
              // Not valid JSON or unexpected shape — forward original
            }

            res.writeHead(backendRes.statusCode || 200, { 'Content-Type': 'application/json' });
            res.end(finalResponse);
            await this.logRequest(modelName, '/v1/messages', backendRes.statusCode || 200, timer.elapsed(), undefined, `${server.host}:${server.port}`, promptPreview);
            resolve();
          });
        }
      });

      backendReq.on('error', async (error) => {
        console.error('[Router] Proxy request failed:', error);
        const statusCode = 502;
        const errorMsg = `Backend request failed: ${error.message}`;
        if (!res.headersSent) {
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: errorMsg } }));
        }
        await this.logRequest(modelName, '/v1/messages', statusCode, timer.elapsed(), errorMsg, `${server.host}:${server.port}`, promptPreview);
        reject(error);
      });

      backendReq.on('timeout', async () => {
        console.error('[Router] Proxy request timed out');
        backendReq.destroy();
        const statusCode = 504;
        const errorMsg = 'Request timeout';
        if (!res.headersSent) {
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: errorMsg } }));
        }
        await this.logRequest(modelName, '/v1/messages', statusCode, timer.elapsed(), errorMsg, `${server.host}:${server.port}`, promptPreview);
        reject(new Error('Request timeout'));
      });

      backendReq.write(requestBody);
      backendReq.end();
    });
  }

  /**
   * Chat completions endpoint - route to backend server
   */
  private async handleChatCompletions(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const timer = new RequestTimer();
    let modelName = 'unknown';
    let statusCode = 500;
    let errorMsg: string | undefined;
    let promptPreview: string | undefined;

    try {
      // Parse request body
      const body = await this.readBody(req);
      let requestData: any;
      try {
        requestData = JSON.parse(body);
      } catch (error) {
        statusCode = 400;
        errorMsg = 'Invalid JSON in request body';
        this.sendError(res, statusCode, 'Bad Request', errorMsg);
        await this.logRequest(modelName, '/v1/chat/completions', statusCode, timer.elapsed(), errorMsg);
        return;
      }

      // Extract model name and prompt preview
      modelName = requestData.model || 'unknown';
      promptPreview = this.extractPromptPreview(requestData);

      if (!requestData.model) {
        statusCode = 400;
        errorMsg = 'Missing "model" field in request';
        this.sendError(res, statusCode, 'Bad Request', errorMsg);
        await this.logRequest(modelName, '/v1/chat/completions', statusCode, timer.elapsed(), errorMsg, undefined, promptPreview);
        return;
      }

      // Find server for model
      const server = await this.findServerForModel(modelName);
      if (!server) {
        statusCode = 404;
        errorMsg = `No server found for model: ${modelName}`;
        this.sendError(res, statusCode, 'Not Found', errorMsg);
        await this.logRequest(modelName, '/v1/chat/completions', statusCode, timer.elapsed(), errorMsg, undefined, promptPreview);
        return;
      }

      if (server.status !== 'running') {
        statusCode = 503;
        errorMsg = `Server for model "${modelName}" is not running`;
        this.sendError(res, statusCode, 'Service Unavailable', errorMsg);
        await this.logRequest(modelName, '/v1/chat/completions', statusCode, timer.elapsed(), errorMsg, `${server.host}:${server.port}`, promptPreview);
        return;
      }

      // Proxy request to backend
      // Always use 127.0.0.1 as destination (0.0.0.0 is only valid as bind address)
      const backendHost = server.host === '0.0.0.0' ? '127.0.0.1' : server.host;
      const backendUrl = `http://${backendHost}:${server.port}/v1/chat/completions`;
      await this.proxyRequest(backendUrl, requestData, req, res);

      // Log success
      statusCode = 200;
      await this.logRequest(modelName, '/v1/chat/completions', statusCode, timer.elapsed(), undefined, `${server.host}:${server.port}`, promptPreview);
    } catch (error) {
      errorMsg = (error as Error).message;
      await this.logRequest(modelName, '/v1/chat/completions', statusCode, timer.elapsed(), errorMsg, undefined, promptPreview);
      throw error;
    }
  }

  /**
   * Embeddings endpoint - route to backend server
   */
  private async handleEmbeddings(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const timer = new RequestTimer();
    let modelName = 'unknown';
    let statusCode = 500;
    let errorMsg: string | undefined;
    let promptPreview: string | undefined;

    try {
      // Parse request body
      const body = await this.readBody(req);
      let requestData: any;
      try {
        requestData = JSON.parse(body);
      } catch (error) {
        statusCode = 400;
        errorMsg = 'Invalid JSON in request body';
        this.sendError(res, statusCode, 'Bad Request', errorMsg);
        await this.logRequest(modelName, '/v1/embeddings', statusCode, timer.elapsed(), errorMsg);
        return;
      }

      // Extract model name and prompt preview
      modelName = requestData.model || 'unknown';
      promptPreview = this.extractPromptPreview(requestData);

      if (!requestData.model) {
        statusCode = 400;
        errorMsg = 'Missing "model" field in request';
        this.sendError(res, statusCode, 'Bad Request', errorMsg);
        await this.logRequest(modelName, '/v1/embeddings', statusCode, timer.elapsed(), errorMsg, undefined, promptPreview);
        return;
      }

      // Find server for model
      const server = await this.findServerForModel(modelName);
      if (!server) {
        statusCode = 404;
        errorMsg = `No server found for model: ${modelName}`;
        this.sendError(res, statusCode, 'Not Found', errorMsg);
        await this.logRequest(modelName, '/v1/embeddings', statusCode, timer.elapsed(), errorMsg, undefined, promptPreview);
        return;
      }

      if (server.status !== 'running') {
        statusCode = 503;
        errorMsg = `Server for model "${modelName}" is not running`;
        this.sendError(res, statusCode, 'Service Unavailable', errorMsg);
        await this.logRequest(modelName, '/v1/embeddings', statusCode, timer.elapsed(), errorMsg, `${server.host}:${server.port}`, promptPreview);
        return;
      }

      // Check if server has embeddings enabled
      if (!server.embeddings) {
        statusCode = 400;
        errorMsg = `Server for model "${modelName}" does not have embeddings enabled`;
        this.sendError(res, statusCode, 'Bad Request', errorMsg);
        await this.logRequest(modelName, '/v1/embeddings', statusCode, timer.elapsed(), errorMsg, `${server.host}:${server.port}`, promptPreview);
        return;
      }

      // Proxy request to backend
      // Always use 127.0.0.1 as destination (0.0.0.0 is only valid as bind address)
      const backendHost = server.host === '0.0.0.0' ? '127.0.0.1' : server.host;
      const backendUrl = `http://${backendHost}:${server.port}/v1/embeddings`;
      await this.proxyRequest(backendUrl, requestData, req, res);

      // Log success
      statusCode = 200;
      await this.logRequest(modelName, '/v1/embeddings', statusCode, timer.elapsed(), undefined, `${server.host}:${server.port}`, promptPreview);
    } catch (error) {
      errorMsg = (error as Error).message;
      await this.logRequest(modelName, '/v1/embeddings', statusCode, timer.elapsed(), errorMsg, undefined, promptPreview);
      throw error;
    }
  }

  /**
   * Proxy a request to a backend server
   */
  private async proxyRequest(
    backendUrl: string,
    requestData: any,
    originalReq: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const url = new URL(backendUrl);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const requestBody = JSON.stringify(requestData);

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
      timeout: this.config.requestTimeout,
    };

    return new Promise((resolve, reject) => {
      const proxyReq = httpModule.request(options, (proxyRes) => {
        // Forward status and headers
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);

        // Stream response
        proxyRes.pipe(res);

        proxyRes.on('end', () => {
          resolve();
        });
      });

      proxyReq.on('error', (error) => {
        console.error('[Router] Proxy request failed:', error);
        if (!res.headersSent) {
          this.sendError(res, 502, 'Bad Gateway', 'Failed to connect to backend server');
        }
        reject(error);
      });

      proxyReq.on('timeout', () => {
        console.error('[Router] Proxy request timed out');
        proxyReq.destroy();
        if (!res.headersSent) {
          this.sendError(res, 504, 'Gateway Timeout', 'Backend server did not respond in time');
        }
        reject(new Error('Request timeout'));
      });

      // Send request body
      proxyReq.write(requestBody);
      proxyReq.end();
    });
  }

  /**
   * Read request body as string
   */
  private async readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }

  /**
   * Send error response
   */
  private sendError(res: http.ServerResponse, statusCode: number, error: string, details?: string): void {
    if (res.headersSent) return;

    const response: ErrorResponse = { error };
    if (details) response.details = details;

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  /**
   * Get all server configurations
   */
  private async getAllServers(): Promise<ServerConfig[]> {
    const serversDir = getServersDir();
    try {
      const files = await fs.readdir(serversDir);
      const configFiles = files.filter(f => f.endsWith('.json'));

      const servers: ServerConfig[] = [];
      for (const file of configFiles) {
        const filePath = path.join(serversDir, file);
        try {
          const config = await readJson<ServerConfig>(filePath);
          servers.push(config);
        } catch (error) {
          console.error(`[Router] Failed to load server config ${file}:`, error);
        }
      }

      return servers;
    } catch (error) {
      console.error('[Router] Failed to read servers directory:', error);
      return [];
    }
  }

  /**
   * Helper method to log a request
   */
  private async logRequest(
    model: string,
    endpoint: string,
    statusCode: number,
    durationMs: number,
    error?: string,
    backend?: string,
    prompt?: string
  ): Promise<void> {
    const entry: RouterLogEntry = {
      timestamp: RequestTimer.now(),
      model,
      endpoint,
      method: 'POST',
      status: statusCode >= 200 && statusCode < 300 ? 'success' : 'error',
      statusCode,
      durationMs,
      error,
      backend,
      prompt,
    };

    await this.logger.logRequest(entry);
  }

  /**
   * Extract prompt preview from request data (first 50 chars)
   */
  private extractPromptPreview(requestData: any): string | undefined {
    try {
      // For chat completions, get the last user message
      if (requestData.messages && Array.isArray(requestData.messages)) {
        const lastUserMessage = [...requestData.messages]
          .reverse()
          .find((msg: any) => msg.role === 'user');

        if (lastUserMessage?.content) {
          const content = typeof lastUserMessage.content === 'string'
            ? lastUserMessage.content
            : JSON.stringify(lastUserMessage.content);
          return content.substring(0, 50).replace(/\n/g, ' ');
        }
      }

      // For embeddings, get the input text
      if (requestData.input) {
        const input = typeof requestData.input === 'string'
          ? requestData.input
          : Array.isArray(requestData.input)
          ? requestData.input[0]
          : JSON.stringify(requestData.input);
        return input.substring(0, 50).replace(/\n/g, ' ');
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Find a server by model name
   */
  private async findServerForModel(modelName: string): Promise<ServerConfig | null> {
    const servers = await this.getAllServers();

    // 1. Check aliases first (exact match, case-sensitive)
    const aliasMatch = servers.find(s => s.alias === modelName);
    if (aliasMatch) return aliasMatch;

    // 2. Check aliases with case-insensitive matching
    const aliasMatchCaseInsensitive = servers.find(
      s => s.alias && s.alias.toLowerCase() === modelName.toLowerCase()
    );
    if (aliasMatchCaseInsensitive) return aliasMatchCaseInsensitive;

    // Normalize a model name for flexible matching (lowercase, no extension, normalize separators)
    const normalize = (name: string): string => {
      return name
        .toLowerCase()
        .replace(/\.gguf$/i, '')
        .replace(/[_-]/g, '-');  // Normalize underscores and hyphens to hyphens
    };

    const normalizedRequest = normalize(modelName);

    // 3. Try exact model name match
    const exactMatch = servers.find(s => s.modelName === modelName);
    if (exactMatch) return exactMatch;

    // 4. Try case-insensitive model name match
    const caseInsensitiveMatch = servers.find(
      s => s.modelName.toLowerCase() === modelName.toLowerCase()
    );
    if (caseInsensitiveMatch) return caseInsensitiveMatch;

    // 5. Try adding .gguf extension if not present
    if (!modelName.endsWith('.gguf')) {
      const withExtension = modelName + '.gguf';
      const extensionMatch = servers.find(
        s => s.modelName.toLowerCase() === withExtension.toLowerCase()
      );
      if (extensionMatch) return extensionMatch;
    }

    // 6. Try normalized matching (handles case, extension, and underscore/hyphen variations)
    const normalizedMatch = servers.find(
      s => normalize(s.modelName) === normalizedRequest
    );
    if (normalizedMatch) return normalizedMatch;

    return null;
  }
}

// Main entry point
async function main() {
  try {
    const server = new RouterServer();
    await server.start();
  } catch (error) {
    console.error('[Router] Failed to start:', error);
    process.exit(1);
  }
}

// Only run if this is the main module
if (require.main === module) {
  main();
}

export { RouterServer };
