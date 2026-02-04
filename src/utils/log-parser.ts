/**
 * Parse and consolidate verbose llama-server logs into compact single-line format
 */

interface CompactLogEntry {
  timestamp: string;
  method: string;
  endpoint: string;
  ip: string;
  status: number;
  userMessage: string;
  tokensIn: number;
  tokensOut: number;
  responseTimeMs: number;
}

export class LogParser {
  private buffer: string[] = [];
  private isBuffering = false;

  /**
   * Check if line is a request status line (contains method/endpoint/status, no JSON)
   * Handles both old and new formats:
   * - Old: log_server_r: request: POST /v1/chat/completions 127.0.0.1 200
   * - New: log_server_r: done request: POST /v1/messages 172.16.0.114 200
   */
  private isRequestStatusLine(line: string): boolean {
    return (
      (line.includes('log_server_r: request:') || line.includes('log_server_r: done request:')) &&
      !line.includes('{') &&
      /(?:done )?request: (POST|GET|PUT|DELETE)/.test(line)
    );
  }

  /**
   * Process log lines and output compact format
   */
  processLine(line: string, callback: (compactLine: string) => void): void {
    // Check if this is a request status line (no JSON, has method/endpoint/status)
    // Handles both old format (request:) and new format (done request:)
    if (this.isRequestStatusLine(line)) {
      // Check if this is the start of verbose format (status line before JSON)
      // or a simple single-line log
      if (this.isBuffering) {
        // We're already buffering, so this is a new request - process previous buffer
        const compactLine = this.consolidateRequest(this.buffer);
        if (compactLine) {
          callback(compactLine);
        }
        this.buffer = [];
        this.isBuffering = false;
      }

      // Start buffering (might be verbose or simple)
      this.isBuffering = true;
      this.buffer = [line];
      return;
    }

    // If we're buffering, collect lines
    if (this.isBuffering) {
      this.buffer.push(line);

      // Check if we have a complete request (found response line in verbose mode)
      if (line.includes('log_server_r: response:')) {
        const compactLine = this.consolidateRequest(this.buffer);
        if (compactLine) {
          callback(compactLine);
        }
        this.buffer = [];
        this.isBuffering = false;
      }
    }
  }

  /**
   * Flush any buffered simple format logs
   * Call this at the end of processing to handle simple logs that don't have response lines
   */
  flush(callback: (compactLine: string) => void): void {
    if (this.isBuffering && this.buffer.length > 0) {
      // If we only have one line, it's a simple format log
      if (this.buffer.length === 1) {
        const simpleLine = this.parseSimpleFormat(this.buffer[0]);
        if (simpleLine) {
          callback(simpleLine);
        }
      }
      this.buffer = [];
      this.isBuffering = false;
    }
  }

  /**
   * Parse simple single-line format (non-verbose mode)
   * Handles both old and new formats:
   * - Old: srv  log_server_r: request: POST /v1/chat/completions 127.0.0.1 200
   * - New: srv  log_server_r: done request: POST /v1/messages 172.16.0.114 200
   */
  private parseSimpleFormat(line: string): string | null {
    try {
      const timestamp = this.extractTimestamp(line);
      // Match both "request:" and "done request:" formats
      const requestMatch = line.match(/(?:done )?request: (POST|GET|PUT|DELETE) ([^\s]+) ([^\s]+) (\d+)/);
      if (!requestMatch) return null;

      const [, method, endpoint, ip, status] = requestMatch;

      // Simple format doesn't include message/token details
      return `${timestamp} ${method} ${endpoint} ${ip} ${status}`;
    } catch (error) {
      return null;
    }
  }

  /**
   * Consolidate buffered request/response lines into single line
   * Handles both old and new llama.cpp log formats
   */
  private consolidateRequest(lines: string[]): string | null {
    try {
      // Parse first line: timestamp and request info
      // Match both "request:" and "done request:" formats
      const firstLine = lines[0];
      const timestamp = this.extractTimestamp(firstLine);
      const requestMatch = firstLine.match(/(?:done )?request: (POST|GET|PUT|DELETE) (\/[^\s]+) ([^\s]+) (\d+)/);
      if (!requestMatch) return null;

      const [, method, endpoint, ip, status] = requestMatch;

      // Parse request JSON (line with JSON body)
      const requestLine = lines.find((l) => l.includes('log_server_r: request:') && l.includes('{'));

      let userMessage = '';
      if (requestLine) {
        const requestJson = this.extractJson(requestLine);
        if (requestJson) {
          userMessage = this.extractUserMessage(requestJson);
        }
      }

      // Parse response JSON (may be empty in new format)
      const responseLine = lines.find((l) => l.includes('log_server_r: response:'));
      let tokensIn = 0;
      let tokensOut = 0;
      let responseTimeMs = 0;

      if (responseLine) {
        const responseJson = this.extractJson(responseLine);
        if (responseJson) {
          tokensIn = responseJson.usage?.prompt_tokens || 0;
          tokensOut = responseJson.usage?.completion_tokens || 0;
          responseTimeMs = this.extractResponseTime(responseJson);
        }
      }

      // Format compact line (works even without response data)
      return this.formatCompactLine({
        timestamp,
        method,
        endpoint,
        ip,
        status: parseInt(status, 10),
        userMessage,
        tokensIn,
        tokensOut,
        responseTimeMs,
      });
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract timestamp from log line
   */
  private extractTimestamp(line: string): string {
    // Look for timestamp format like [2025-12-09 10:13:45]
    const match = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
    if (match) {
      return match[1];  // Return as-is: 2025-12-09 10:13:45
    }
    // If no timestamp in logs, use current time in same format
    const now = new Date();
    return now.toISOString().substring(0, 19).replace('T', ' ');  // 2025-12-09 10:13:45
  }

  /**
   * Extract JSON from log line
   */
  private extractJson(line: string): any {
    const jsonStart = line.indexOf('{');
    if (jsonStart === -1) return null;

    try {
      const jsonStr = line.substring(jsonStart);
      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  }

  /**
   * Extract first user message from request JSON
   * Handles both string content and array content formats:
   * - String: {"role":"user","content":"Hello"}
   * - Array: {"role":"user","content":[{"type":"text","text":"Hello"}]}
   */
  private extractUserMessage(requestJson: any): string {
    const messages = requestJson.messages || [];
    const userMsg = messages.find((m: any) => m.role === 'user');
    if (!userMsg || !userMsg.content) return '';

    let content: string;

    // Handle array format (e.g., Claude/Anthropic API style)
    if (Array.isArray(userMsg.content)) {
      const textPart = userMsg.content.find((p: any) => p.type === 'text');
      content = textPart?.text || '';
    } else {
      content = userMsg.content;
    }

    // Clean and truncate to first 50 characters
    content = content.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    return content.length > 50 ? content.substring(0, 47) + '...' : content;
  }

  /**
   * Extract response time from response JSON
   */
  private extractResponseTime(responseJson: any): number {
    // Check __verbose.timings first (has total time)
    const verboseTimings = responseJson.__verbose?.timings;
    if (verboseTimings) {
      const promptMs = verboseTimings.prompt_ms || 0;
      const predictedMs = verboseTimings.predicted_ms || 0;
      return Math.round(promptMs + predictedMs);
    }

    // Fallback to top-level timings
    const timings = responseJson.timings;
    if (timings) {
      const promptMs = timings.prompt_ms || 0;
      const predictedMs = timings.predicted_ms || 0;
      return Math.round(promptMs + predictedMs);
    }

    return 0;
  }

  /**
   * Format compact log line
   */
  private formatCompactLine(entry: CompactLogEntry): string {
    return [
      entry.timestamp,
      entry.method,
      entry.endpoint,
      entry.ip,
      entry.status,
      `"${entry.userMessage}"`,
      entry.tokensIn,
      entry.tokensOut,
      entry.responseTimeMs,
    ].join(' ');
  }
}

// Export singleton instance
export const logParser = new LogParser();
