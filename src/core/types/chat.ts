export const VIEW_TYPE_AGENT = 'obsidian-agent-view';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: ToolCallInfo[];
  contentBlocks?: ContentBlock[];
  durationSeconds?: number;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
}

export type ContentBlock =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; toolId: string }
  | { type: 'thinking'; content: string };

export type StreamChunk =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; content: string; isError?: boolean }
  | { type: 'error'; content: string }
  | { type: 'done' }
  | { type: 'usage'; usage: UsageInfo };

export interface UsageInfo {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost?: {
    input: number;
    output: number;
    total: number;
  };
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview: string;
}
