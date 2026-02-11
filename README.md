# openclaw-cc-session-rag

Local RAG for Claude Code sessions. Semantic search your coding history with PostgreSQL + pgvector + Ollama.

**Zero external API costs. Your code never leaves your machine.**

## What This Does

Claude Code stores session transcripts as JSONL in `~/.claude/transcripts/`. This tool:

1. Parses those transcripts (user prompts, assistant responses, tool calls)
2. Chunks and embeds them locally via Ollama
3. Stores vectors in PostgreSQL with pgvector
4. Enables semantic + hybrid search across your entire coding history

```
~/.claude/transcripts/*.jsonl
        ↓
   Parser (extract turns, tools, file refs)
        ↓
   Ollama nomic-embed-text (768d vectors)
        ↓
   PostgreSQL + pgvector
        ↓
   Semantic Search CLI
```

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| **macOS/Linux** | Tested on macOS 14+, Ubuntu 22+ |
| **Node.js 20+** | `node -v` |
| **PostgreSQL 15+** | With pgvector extension |
| **Ollama** | Running locally with embedding model |
| **Claude Code** | Sessions in `~/.claude/transcripts/` |

### PostgreSQL + pgvector

```bash
# macOS
brew install postgresql@17 pgvector
brew services start postgresql@17

# Linux (Ubuntu/Debian)
sudo apt install postgresql postgresql-contrib
# pgvector: https://github.com/pgvector/pgvector#installation
```

### Ollama

```bash
# Install: https://ollama.ai
ollama pull nomic-embed-text
```

## Quick Start

```bash
git clone https://github.com/YOUR_USER/openclaw-cc-session-rag.git
cd openclaw-cc-session-rag
pnpm install

# Create database + schema
pnpm db:migrate

# Ingest your Claude Code sessions
pnpm ingest

# Search
pnpm search "how did I implement the webhook handler"
```

## Commands

### Ingest

```bash
# All sessions from ~/.claude/transcripts
pnpm ingest

# Specific file
pnpm ingest --file ~/.claude/transcripts/ses_abc123.jsonl

# Limit (for testing)
pnpm ingest --limit 10

# Skip embedding (text-only)
pnpm ingest --no-embed
```

### Search

```bash
# Semantic search
pnpm search "authentication middleware"

# Filter by role
pnpm search "fix the bug" --role assistant

# Hybrid search (keyword + semantic)
pnpm search "convex mutation" --keyword

# Adjust results
pnpm search "error handling" --limit 20 --context 1000
```

### Stats

```bash
pnpm stats
# Sessions:  42
# Chunks:    1847
# Embedded:  1847
# Coverage:  100.0%
```

## Claude Code JSONL Format

Each `~/.claude/transcripts/ses_*.jsonl` contains conversation turns:

```jsonl
{"type":"user","timestamp":"2026-02-01T...","content":"What's in this file?"}
{"type":"tool_use","timestamp":"...","tool_name":"read","tool_input":{"filePath":"./src/index.ts"}}
{"type":"tool_result","timestamp":"...","tool_name":"read","tool_output":{"preview":"import ..."}}
{"type":"assistant","timestamp":"...","content":"This file contains..."}
```

The parser extracts:
- **User messages** → stored as `role: user`
- **Assistant responses** → stored as `role: assistant`  
- **Tool results** → stored as `role: tool` (with tool name, file paths)

## Schema

```sql
-- Sessions: one per Claude Code transcript
sessions (
  id UUID PRIMARY KEY,
  session_id TEXT UNIQUE,      -- ses_abc123...
  source_path TEXT,            -- ~/.claude/transcripts/...
  project_name TEXT,           -- extracted from paths
  created_at, updated_at,
  message_count, total_tokens
)

-- Chunks: embedded conversation turns
chunks (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES sessions,
  chunk_index INT,
  role TEXT,                   -- user | assistant | tool
  content TEXT,
  embedding vector(768),       -- nomic-embed-text
  tools_used TEXT[],           -- tool names
  files_mentioned TEXT[]       -- extracted file paths
)
```

## Configuration

Edit `src/config.ts` or use environment variables:

```bash
# Database
DATABASE_URL=postgresql://localhost:5432/session_rag

# Ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=nomic-embed-text

# Claude Code transcripts
CLAUDE_SESSIONS_PATH=~/.claude/transcripts
```

## OpenClaw Integration

If you're running [OpenClaw](https://github.com/openclaw/openclaw), you can search your coding sessions directly from chat:

```bash
# Add as a skill or just call from your workspace
cd ~/clawd/projects/openclaw-cc-session-rag
pnpm search "$QUERY"
```

**Related paths:**
- `~/.openclaw/` — OpenClaw state, sessions, config
- `~/.claude/transcripts/` — Claude Code session transcripts
- `~/.claude/projects/` — Claude Code project configs

## Embedding Model Options

| Model | Dims | Size | Notes |
|-------|------|------|-------|
| `nomic-embed-text` | 768 | 274MB | Default, fast, good quality |
| `mxbai-embed-large` | 1024 | 669MB | Higher quality |
| `snowflake-arctic-embed2` | 1024 | 1.2GB | Best quality |

To switch models, update `src/config.ts` and adjust the vector dimension in `migrations/001_init.sql`.

## Performance

On M1 MacBook Pro with nomic-embed-text:
- **Ingestion:** ~50 chunks/second
- **Search latency:** <100ms for 10K chunks
- **Storage:** ~1KB per chunk (text + vector)

## Troubleshooting

### "extension vector is not available"

pgvector not installed for your PostgreSQL version:
```bash
brew reinstall pgvector
brew services restart postgresql@17
```

### "Ollama embedding failed: Internal Server Error"

Usually means the text chunk is too long. The parser already truncates, but some edge cases slip through. Check Ollama logs:
```bash
ollama logs
```

### Empty search results

1. Check `pnpm stats` — are chunks embedded?
2. Try broader queries
3. Use `--keyword` for hybrid search

## License

MIT

## Credits

Built with 🐺 by the OpenClaw community.

- [pgvector](https://github.com/pgvector/pgvector) — Open-source vector similarity for Postgres
- [Ollama](https://ollama.ai) — Run LLMs locally
- [nomic-embed-text](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) — Open embedding model
