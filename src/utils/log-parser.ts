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
   * Process log lines and output compact format
   */
  processLine(line: string, callback: (compactLine: string) => void): void {
    // Check if this is the start of an HTTP request log
    if (line.includes('log_server_r: request: POST')) {
      this.isBuffering = true;
      this.buffer = [line];
      return;
    }

    // If we're buffering, collect lines
    if (this.isBuffering) {
      this.buffer.push(line);

      // Check if we have a complete request (found response line)
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
   * Consolidate buffered request/response lines into single line
   */
  private consolidateRequest(lines: string[]): string | null {
    try {
      // Parse first line: timestamp and request info
      const firstLine = lines[0];
      const timestamp = this.extractTimestamp(firstLine);
      const requestMatch = firstLine.match(/request: (POST|GET|PUT|DELETE) (\/[^\s]+) ([^\s]+) (\d+)/);
      if (!requestMatch) return null;

      const [, method, endpoint, ip, status] = requestMatch;

      // Parse request JSON (second line)
      const requestLine = lines.find((l) => l.includes('log_server_r: request:') && l.includes('{'));
      if (!requestLine) return null;

      const requestJson = this.extractJson(requestLine);
      if (!requestJson) return null;

      const userMessage = this.extractUserMessage(requestJson);

      // Parse response JSON (last line)
      const responseLine = lines.find((l) => l.includes('log_server_r: response:'));
      if (!responseLine) return null;

      const responseJson = this.extractJson(responseLine);
      if (!responseJson) return null;

      const tokensIn = responseJson.usage?.prompt_tokens || 0;
      const tokensOut = responseJson.usage?.completion_tokens || 0;

      // Extract response time from verbose timings
      const responseTimeMs = this.extractResponseTime(responseJson);

      // Format compact line
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
   */
  private extractUserMessage(requestJson: any): string {
    const messages = requestJson.messages || [];
    const userMsg = messages.find((m: any) => m.role === 'user');
    if (!userMsg || !userMsg.content) return '';

    // Truncate to first 50 characters
    const content = userMsg.content.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
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
