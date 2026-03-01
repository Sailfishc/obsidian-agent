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

/** Persisted metadata record stored as {id}.meta.json. */
export type StoredConversationMeta = ConversationMeta;

/** A file attached as context to a user query. */
export interface ContextFile {
  /** Vault-relative path. */
  path: string;
  /** Plain-text content read from the vault. */
  content: string;
}

/** Optional context passed alongside a user query. */
export interface QueryContext {
  /** Vault-relative path of the currently active file, if any. */
  activeFilePath?: string | null;
  /** All context files to inject (active + manually added), already read by the caller. */
  contextFiles?: ContextFile[];
}
