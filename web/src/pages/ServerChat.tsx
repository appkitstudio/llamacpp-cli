import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStreamingChat, useServers } from '../hooks/useApi';
import { ArrowLeft, Send, Loader2, Trash2, AlertCircle } from 'lucide-react';

export function ServerChat() {
  const { port } = useParams<{ port: string }>();
  const navigate = useNavigate();
  const { data: serversData } = useServers();

  // Find server by port
  const server = serversData?.servers.find(s => s.port === parseInt(port || '0'));
  const modelName = server?.modelName || '';

  const { messages, setMessages, isStreaming, error, sendMessage, tokensPerSecond } = useStreamingChat(modelName);
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load messages from localStorage on mount
  useEffect(() => {
    if (!port) return;
    const storageKey = `chat_history_port_${port}`;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setMessages(parsed);
      } catch (e) {
        console.error('Failed to parse stored messages:', e);
      }
    }
  }, [port, setMessages]);

  // Save messages to localStorage when they change
  useEffect(() => {
    if (!port || messages.length === 0) return;
    const storageKey = `chat_history_port_${port}`;
    localStorage.setItem(storageKey, JSON.stringify(messages));
  }, [messages, port]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-focus input on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isStreaming) return;

    const message = inputText.trim();
    setInputText('');
    await sendMessage(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleClearHistory = () => {
    if (confirm('Clear chat history?')) {
      setMessages([]);
      if (port) {
        const storageKey = `chat_history_port_${port}`;
        localStorage.removeItem(storageKey);
      }
    }
  };

  // Show loading if server not found yet
  if (!server) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="text-neutral-500">Loading server...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 bg-white">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/servers')}
            className="p-2 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded-md transition-colors"
            title="Back to servers"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">
              {server.modelName.replace('.gguf', '')}
            </h1>
            <p className="text-sm text-neutral-600">localhost:{server.port}</p>
          </div>
        </div>
        <button
          onClick={handleClearHistory}
          disabled={messages.length === 0 || isStreaming}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-neutral-600 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Clear history"
        >
          <Trash2 className="w-4 h-4" />
          Clear History
        </button>
      </div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto px-6 py-4 bg-neutral-50">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-neutral-500 text-base">
                Start a conversation with {server.modelName.replace('.gguf', '')}
              </p>
              <p className="text-sm text-neutral-400 mt-2">
                Type your message below
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-neutral-900 text-white'
                      : 'bg-white text-neutral-900 border border-neutral-200'
                  }`}
                >
                  <p className="text-sm font-medium mb-1 opacity-70">
                    {msg.role === 'user' ? 'You' : 'Assistant'}
                  </p>
                  <div className="text-sm">
                    {msg.role === 'assistant' ? (
                      <div className="prose prose-sm max-w-none prose-neutral prose-p:my-2 prose-headings:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-pre:my-2 prose-code:text-xs prose-code:bg-neutral-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-strong:font-semibold prose-strong:text-neutral-900">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {isStreaming && (
              <div className="flex justify-start">
                <div className="bg-white border border-neutral-200 rounded-lg px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-4 h-4 animate-spin text-neutral-600" />
                    {tokensPerSecond !== null && (
                      <span className="text-xs text-neutral-600">
                        {tokensPerSecond.toFixed(1)} tok/s
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-900">Error</p>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t border-neutral-200 bg-white px-6 py-4">
        <form onSubmit={handleSubmit} className="flex items-end gap-3">
          <div className="flex-1">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
              placeholder="Type your message... (Enter to send, Shift+Enter for new line)"
              className="w-full px-4 py-3 border border-neutral-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              rows={3}
            />
          </div>
          <button
            type="submit"
            disabled={!inputText.trim() || isStreaming}
            className="flex items-center justify-center w-12 h-12 bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Send message"
          >
            {isStreaming ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </form>
        <p className="text-xs text-neutral-500 mt-2">
          Press Enter to send • Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
