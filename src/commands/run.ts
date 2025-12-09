import chalk from 'chalk';
import * as readline from 'readline';
import { stateManager } from '../lib/state-manager';
import { startCommand } from './start';
import { statusChecker } from '../lib/status-checker';
import { ServerConfig } from '../types/server-config';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

export async function runCommand(modelIdentifier: string): Promise<void> {
  await stateManager.initialize();

  // 1. Find or start server
  let server = await stateManager.findServer(modelIdentifier);

  if (!server) {
    // Try to resolve as a model name and start it
    console.log(chalk.blue(`🚀 No running server found. Starting ${modelIdentifier}...\n`));
    try {
      await startCommand(modelIdentifier, {});
      server = await stateManager.findServer(modelIdentifier);
      if (!server) {
        throw new Error('Failed to start server');
      }
      console.log(); // Add blank line after start output
    } catch (error) {
      throw new Error(`Failed to start server: ${(error as Error).message}`);
    }
  }

  // 2. Verify server is running
  const status = await statusChecker.checkServer(server);
  if (!status.isRunning) {
    throw new Error(`Server exists but is not running. Start it with: llamacpp server start ${server.id}`);
  }

  // 3. Start REPL
  console.log(chalk.green(`💬 Connected to ${server.modelName} (port ${server.port})`));
  console.log(chalk.dim(`Type your message and press Enter. Use /exit to quit, /clear to reset history, /help for commands.\n`));

  const conversationHistory: ChatMessage[] = [];
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('You: '),
  });

  // Handle graceful shutdown
  const cleanup = () => {
    rl.close();
    console.log(chalk.dim('\n\nGoodbye!'));
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  rl.prompt();

  rl.on('line', async (input: string) => {
    const line = input.trim();

    // Handle special commands
    if (line === '/exit' || line === '/quit') {
      cleanup();
      return;
    }

    if (line === '/clear') {
      conversationHistory.length = 0;
      console.log(chalk.dim('✓ Conversation history cleared\n'));
      rl.prompt();
      return;
    }

    if (line === '/help') {
      console.log(chalk.bold('\nAvailable commands:'));
      console.log(chalk.dim('  /exit, /quit  - Exit the chat'));
      console.log(chalk.dim('  /clear        - Clear conversation history'));
      console.log(chalk.dim('  /help         - Show this help message\n'));
      rl.prompt();
      return;
    }

    if (!line) {
      rl.prompt();
      return;
    }

    // Add user message to history
    conversationHistory.push({
      role: 'user',
      content: line,
    });

    // Send to API and stream response
    try {
      await streamChatCompletion(server, conversationHistory);
      console.log(); // Blank line after response
    } catch (error) {
      console.error(chalk.red(`\n❌ Error: ${(error as Error).message}\n`));
    }

    rl.prompt();
  });

  rl.on('close', () => {
    cleanup();
  });
}

async function streamChatCompletion(
  server: ServerConfig,
  messages: ChatMessage[]
): Promise<void> {
  const url = `http://localhost:${server.port}/v1/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: server.modelName,
      messages: messages,
      stream: true,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed (${response.status}): ${errorText}`);
  }

  if (!response.body) {
    throw new Error('Response body is null');
  }

  // Display assistant prefix
  process.stdout.write(chalk.magenta('Assistant: '));

  let fullResponse = '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter((line) => line.trim().startsWith('data:'));

      for (const line of lines) {
        const data = line.replace(/^data:\s*/, '').trim();

        if (data === '[DONE]') {
          continue;
        }

        if (!data) {
          continue;
        }

        try {
          const parsed: ChatCompletionChunk = JSON.parse(data);
          const content = parsed.choices[0]?.delta?.content;

          if (content) {
            process.stdout.write(content);
            fullResponse += content;
          }
        } catch (parseError) {
          // Skip malformed JSON chunks
          continue;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Add assistant response to history
  if (fullResponse) {
    messages.push({
      role: 'assistant',
      content: fullResponse,
    });
  }
}
