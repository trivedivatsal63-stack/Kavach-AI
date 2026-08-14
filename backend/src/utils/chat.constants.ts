// Shared by the general Chat page and RAG Studio — both are "conversations"
// distinguished by mode. Kept separate from rag.constants.ts since these
// apply to non-RAG chat too.

export const CONVERSATION_MODE = {
  CHAT: "chat",
  RAG: "rag",
} as const;

export type ConversationMode =
  (typeof CONVERSATION_MODE)[keyof typeof CONVERSATION_MODE];

export const MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
} as const;

export type MessageRole = (typeof MESSAGE_ROLE)[keyof typeof MESSAGE_ROLE];

// Mirrors the existing /rag/chat question-length cap.
export const MAX_MESSAGE_CHARS = 4000;

// The underlying model (qwen2.5-1.5b) has a 2048-token window
// (MODEL_MAX_CONTEXT_TOKENS in rag.constants.ts) shared by BOTH modes — same
// deployment, not RAG-specific. That window is tight, so prior-turn history
// gets a hard, separately-tuned budget per mode rather than "whatever's
// left":
//  - RAG mode: retrieved chunks are the primary value: history must not
//    starve them out, so it gets a small, fixed allowance.
//  - Chat mode: no retrieval competing for the budget, so history can use
//    most of what's left after the system prompt + new question.
export const RAG_HISTORY_TOKEN_BUDGET = 250;
export const CHAT_HISTORY_TOKEN_BUDGET = 1200;

// How many of a conversation's most recent messages get loaded to build
// history for the next turn. A generous cap — trimHistoryToTokenBudget()
// does the real work of fitting them into the token budget above; this just
// bounds the size of the DB read itself for a very long conversation.
export const MAX_HISTORY_MESSAGES = 40;
