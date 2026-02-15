import type { ReactNode } from 'react';

/**
 * Parse ANSI escape codes and return styled React elements
 */

interface AnsiSegment {
  text: string;
  color?: string;
}

// Map ANSI color codes to Tailwind classes
const ansiColorMap: Record<string, string> = {
  '30': 'text-black',
  '31': 'text-red-400',      // Red
  '32': 'text-green-400',    // Green
  '33': 'text-yellow-400',   // Yellow
  '34': 'text-blue-400',     // Blue
  '35': 'text-purple-400',   // Magenta
  '36': 'text-cyan-400',     // Cyan
  '37': 'text-gray-300',     // White
  '90': 'text-gray-500',     // Bright Black (Gray)
  '91': 'text-red-300',      // Bright Red
  '92': 'text-green-300',    // Bright Green
  '93': 'text-yellow-300',   // Bright Yellow
  '94': 'text-blue-300',     // Bright Blue
  '95': 'text-purple-300',   // Bright Magenta
  '96': 'text-cyan-300',     // Bright Cyan
  '97': 'text-white',        // Bright White
};

/**
 * Parse a line with ANSI escape codes into segments
 */
export function parseAnsiLine(line: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];

  // Regex to match ANSI escape codes: \x1b[XXm or \u001b[XXm
  const ansiRegex = /[\x1b\u001b]\[(\d+)m/g;

  let lastIndex = 0;
  let currentColor: string | undefined;
  let match: RegExpExecArray | null;

  // Check if line has any ANSI codes at all
  const hasAnsiCodes = ansiRegex.test(line);
  ansiRegex.lastIndex = 0; // Reset regex after test

  // If no ANSI codes, return the whole line as a single segment
  if (!hasAnsiCodes) {
    if (line) {
      segments.push({ text: line, color: undefined });
    }
    return segments;
  }

  while ((match = ansiRegex.exec(line)) !== null) {
    const startIndex = match.index;
    const code = match[1];

    // Add text before this escape code (if any)
    if (startIndex > lastIndex) {
      const text = line.substring(lastIndex, startIndex);
      if (text) {
        segments.push({ text, color: currentColor });
      }
    }

    // Update current color
    if (code === '0') {
      // Reset code
      currentColor = undefined;
    } else {
      currentColor = ansiColorMap[code];
    }

    lastIndex = ansiRegex.lastIndex;
  }

  // Add remaining text after last escape code
  if (lastIndex < line.length) {
    const text = line.substring(lastIndex);
    if (text) {
      segments.push({ text, color: currentColor });
    }
  }

  return segments;
}

/**
 * Render ANSI-colored line as React elements
 */
export function renderAnsiLine(line: string, key: string | number): ReactNode {
  const segments = parseAnsiLine(line);

  if (segments.length === 0) {
    return null;
  }

  // If only one segment with no color, return plain text
  if (segments.length === 1 && !segments[0].color) {
    return segments[0].text;
  }

  // Return colored segments
  return (
    <>
      {segments.map((segment, i) => (
        <span key={`${key}-${i}`} className={segment.color || 'text-gray-300'}>
          {segment.text}
        </span>
      ))}
    </>
  );
}

/**
 * Strip ANSI escape codes from a string (for filtering/searching)
 */
export function stripAnsiCodes(text: string): string {
  return text.replace(/[\x1b\u001b]\[\d+m/g, '');
}
