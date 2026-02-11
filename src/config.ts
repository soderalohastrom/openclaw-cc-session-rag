// Configuration for session-rag

export const config = {
  // Database
  db: {
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/session_rag',
    database: 'session_rag',
  },

  // Ollama embeddings
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
    dimensions: 768, // nomic-embed-text output dimensions
  },

  // Source paths for Claude Code sessions
  sources: {
    claudeCode: process.env.CLAUDE_SESSIONS_PATH || `${process.env.HOME}/.claude/transcripts`,
  },

  // Chunking settings
  chunking: {
    maxChunkTokens: 2000,      // Max tokens per chunk
    overlapTokens: 200,         // Overlap between chunks for context
    minChunkLength: 50,         // Skip very short chunks
  },
};

export type Config = typeof config;
