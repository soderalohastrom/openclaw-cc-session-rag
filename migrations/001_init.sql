-- session-rag: Initial schema
-- PostgreSQL + pgvector for Claude Code session RAG

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Sessions table: one row per Claude Code session file
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT UNIQUE NOT NULL,           -- ses_482618f79ffe... (from filename)
    source_path TEXT NOT NULL,                  -- original .jsonl path
    project_name TEXT,                          -- extracted project name if available
    created_at TIMESTAMPTZ,                     -- session start time
    updated_at TIMESTAMPTZ,                     -- last message time
    message_count INT DEFAULT 0,
    total_tokens INT DEFAULT 0,
    total_cost NUMERIC(10,4) DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,         -- flexible extras
    ingested_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chunks table: conversation turns, embedded for similarity search
CREATE TABLE IF NOT EXISTS chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,                   -- order in conversation
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
    content TEXT NOT NULL,                      -- the actual text
    embedding vector(768),                      -- nomic-embed-text dimensions
    token_count INT,
    tools_used TEXT[],                          -- tool names if assistant used tools
    files_mentioned TEXT[],                     -- file paths extracted from content
    created_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    UNIQUE(session_id, chunk_index)
);

-- Indexes for fast similarity search
CREATE INDEX IF NOT EXISTS chunks_embedding_idx 
    ON chunks USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Index for hybrid search (keyword + vector)
CREATE INDEX IF NOT EXISTS chunks_content_fts_idx 
    ON chunks USING gin (to_tsvector('english', content));

-- Index for filtering by role
CREATE INDEX IF NOT EXISTS chunks_role_idx ON chunks(role);

-- Index for session lookups
CREATE INDEX IF NOT EXISTS chunks_session_idx ON chunks(session_id);

-- Helper view: session summaries
CREATE OR REPLACE VIEW session_summaries AS
SELECT 
    s.id,
    s.session_id,
    s.project_name,
    s.created_at,
    s.message_count,
    s.total_tokens,
    s.total_cost,
    COUNT(c.id) as chunk_count,
    COUNT(c.id) FILTER (WHERE c.embedding IS NOT NULL) as embedded_count
FROM sessions s
LEFT JOIN chunks c ON s.id = c.session_id
GROUP BY s.id;

-- Migration tracking
CREATE TABLE IF NOT EXISTS _migrations (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO _migrations (name) VALUES ('001_init') ON CONFLICT DO NOTHING;
