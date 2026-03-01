/**
 * ConversationStore - Persists chat conversations to vault storage.
 *
 * Uses a split-file approach (inspired by Claudian):
 * - `{id}.meta.json` — Small metadata file (title, dates, counts)
 * - `{id}.jsonl` — Append-only message log (one JSON per line)
 *
 * This allows fast listing (only read meta files) and efficient
 * message appending (no need to rewrite entire conversation).
 */

import type { App } from 'obsidian';
import type { ChatMessage, ConversationMeta, StoredConversationMeta, Conversation } from '../types';
import { generateId } from '../../utils/id';

/** Default storage directory relative to vault root. */
const SESSIONS_DIR = '.obsidian-agent/sessions';

export class ConversationStore {
  private baseDir: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private app: App, baseDir?: string) {
    this.baseDir = baseDir ?? SESSIONS_DIR;
  }

  // ── Directory management ─────────────────────────────────────────────

  /** Ensure the sessions directory exists. */
  async ensureBaseDir(): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(this.baseDir))) {
      // Create intermediate folders
      const parts = this.baseDir.split('/').filter(Boolean);
      let current = '';
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (!(await adapter.exists(current))) {
          await adapter.mkdir(current);
        }
      }
    }
  }

  // ── Path helpers ─────────────────────────────────────────────────────

  private getMetaPath(id: string): string {
    return `${this.baseDir}/${id}.meta.json`;
  }

  private getMessagesPath(id: string): string {
    return `${this.baseDir}/${id}.jsonl`;
  }

  // ── Create ───────────────────────────────────────────────────────────

  /** Create a new empty conversation and persist its metadata. */
  async createConversation(seed?: { title?: string }): Promise<Conversation> {
    const now = Date.now();
    const id = generateId();
    const title = seed?.title ?? 'New chat';

    const conv: Conversation = {
      id,
      title,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };

    // Persist initial metadata
    await this.saveMeta({
      id,
      title,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      preview: '',
    });

    return conv;
  }

  // ── Load ─────────────────────────────────────────────────────────────

  /** Load a full conversation (meta + all messages). */
  async loadConversation(id: string): Promise<Conversation | null> {
    const adapter = this.app.vault.adapter;
    const metaPath = this.getMetaPath(id);

    if (!(await adapter.exists(metaPath))) {
      return null;
    }

    try {
      // Load metadata
      const metaContent = await adapter.read(metaPath);
      const meta: StoredConversationMeta = JSON.parse(metaContent);

      // Load messages
      const messages = await this.loadMessages(id);

      return {
        id: meta.id,
        title: meta.title,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        messages,
      };
    } catch {
      return null;
    }
  }

  /** Load only messages from the JSONL file. */
  private async loadMessages(id: string): Promise<ChatMessage[]> {
    const adapter = this.app.vault.adapter;
    const messagesPath = this.getMessagesPath(id);

    if (!(await adapter.exists(messagesPath))) {
      return [];
    }

    try {
      const content = await adapter.read(messagesPath);
      const lines = content.split(/\r?\n/).filter(l => l.trim());
      const messages: ChatMessage[] = [];

      for (const line of lines) {
        try {
          messages.push(JSON.parse(line) as ChatMessage);
        } catch {
          // Skip malformed lines
        }
      }

      return messages;
    } catch {
      return [];
    }
  }

  // ── Save ─────────────────────────────────────────────────────────────

  /** Save metadata (overwrites the meta file). */
  async saveMeta(meta: StoredConversationMeta): Promise<void> {
    await this.ensureBaseDir();
    const adapter = this.app.vault.adapter;
    await adapter.write(this.getMetaPath(meta.id), JSON.stringify(meta, null, 2));
  }

  /** Save entire conversation (rewrites both files). Used for full sync. */
  async saveConversation(conv: Conversation): Promise<void> {
    await this.ensureBaseDir();
    const adapter = this.app.vault.adapter;

    // Save metadata
    const meta: StoredConversationMeta = {
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      messageCount: conv.messages.length,
      preview: this.extractPreview(conv.messages),
    };
    await adapter.write(this.getMetaPath(conv.id), JSON.stringify(meta, null, 2));

    // Save all messages as JSONL
    const lines = conv.messages.map(m => JSON.stringify(m));
    await adapter.write(this.getMessagesPath(conv.id), lines.join('\n') + (lines.length > 0 ? '\n' : ''));
  }

  /**
   * Append a single message to a conversation's JSONL file.
   * Uses a write queue to prevent interleaved writes.
   * Callers will see write errors; the queue itself stays alive for subsequent writes.
   */
  async appendMessage(conversationId: string, message: ChatMessage): Promise<void> {
    await this.ensureBaseDir();
    const messagesPath = this.getMessagesPath(conversationId);
    const line = JSON.stringify(message) + '\n';

    // Serialize writes to avoid interleaving.
    // The `op` promise rejects on failure (caller sees it),
    // but `this.writeQueue` always resolves so subsequent writes aren't blocked.
    const op = this.writeQueue.then(async () => {
      const adapter = this.app.vault.adapter;
      if (await adapter.exists(messagesPath)) {
        const existing = await adapter.read(messagesPath);
        const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
        await adapter.write(messagesPath, existing + separator + line);
      } else {
        await adapter.write(messagesPath, line);
      }
    });
    this.writeQueue = op.catch(() => { /* keep queue alive */ });

    await op;
  }

  /**
   * Update metadata after a new message is appended.
   * Call this after appendMessage to keep meta in sync.
   */
  async updateMetaAfterMessage(
    conversationId: string,
    opts: { title?: string; messageCount: number; latestMessage?: ChatMessage },
  ): Promise<void> {
    const adapter = this.app.vault.adapter;
    const metaPath = this.getMetaPath(conversationId);

    let meta: StoredConversationMeta;
    try {
      const content = await adapter.read(metaPath);
      meta = JSON.parse(content);
    } catch {
      return; // Meta file missing or corrupted; skip update
    }

    meta.updatedAt = Date.now();
    meta.messageCount = opts.messageCount;

    if (opts.title) {
      meta.title = opts.title;
    }

    if (opts.latestMessage?.role === 'user' && !meta.preview) {
      meta.preview = opts.latestMessage.content.substring(0, 80);
    }

    await adapter.write(metaPath, JSON.stringify(meta, null, 2));
  }

  // ── List ─────────────────────────────────────────────────────────────

  /** List all conversations by reading meta files. Sorted by updatedAt desc. */
  async listConversations(): Promise<ConversationMeta[]> {
    const adapter = this.app.vault.adapter;

    if (!(await adapter.exists(this.baseDir))) {
      return [];
    }

    const listing = await adapter.list(this.baseDir);
    const metas: ConversationMeta[] = [];

    for (const filePath of listing.files) {
      if (!filePath.endsWith('.meta.json')) continue;

      try {
        const content = await adapter.read(filePath);
        const stored: StoredConversationMeta = JSON.parse(content);
        metas.push({
          id: stored.id,
          title: stored.title,
          createdAt: stored.createdAt,
          updatedAt: stored.updatedAt,
          messageCount: stored.messageCount,
          preview: stored.preview,
        });
      } catch {
        // Skip malformed meta files
      }
    }

    // Sort by most recent first
    metas.sort((a, b) => b.updatedAt - a.updatedAt);
    return metas;
  }

  // ── Delete ───────────────────────────────────────────────────────────

  /** Delete a conversation (both meta and messages files). */
  async deleteConversation(id: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    const metaPath = this.getMetaPath(id);
    const messagesPath = this.getMessagesPath(id);

    if (await adapter.exists(metaPath)) {
      await adapter.remove(metaPath);
    }
    if (await adapter.exists(messagesPath)) {
      await adapter.remove(messagesPath);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /** Extract a short preview from the first user message. */
  private extractPreview(messages: ChatMessage[]): string {
    const firstUser = messages.find(m => m.role === 'user');
    if (!firstUser) return '';
    const text = firstUser.content;
    return text.length > 80 ? text.substring(0, 80) + '…' : text;
  }

  /** Generate a title from the first user message. */
  static generateTitle(firstMessage: string): string {
    // Take up to 50 chars from first line, trim; handle \r\n
    const firstLine = firstMessage.split(/\r?\n/)[0].trim();
    if (!firstLine) return 'New chat';
    if (firstLine.length <= 50) return firstLine;
    return firstLine.substring(0, 47) + '...';
  }
}
