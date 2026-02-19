# openclaw-cc-session-rag

**Semantic search your Claude Code sessions — locally, privately, for free.**

> Every bug you fixed, every architecture decision, every clever solution — it's all in your session transcripts. This tool makes it searchable.

## The Problem

Claude Code stores every session as JSONL in `~/.claude/transcripts/`. That's hundreds of coding conversations — solutions, patterns, debugging sessions — locked in flat files. When you hit a similar problem months later, you can't search "how did I implement that webhook handler?" and get back the exact conversation.

## The Solution

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

Ingest your transcripts, embed them locally with Ollama, store vectors in PostgreSQL + pgvector, then search semantically. **Zero external API costs. Your code never leaves your machine.**

## Quick Start

```bash
git clone https://github.com/soderalohastrom/openclaw-cc-session-rag.git
cd openclaw-cc-session-rag
pnpm install

# Create database + schema
pnpm db:migrate

# Ingest your Claude Code sessions
pnpm ingest

# Search your history
pnpm search "how did I implement the webhook handler"
```

## Prerequisites

| Requirement | Install |
|-------------|---------|
| **Node.js 20+** | [nodejs.org](https://nodejs.org) |
| **PostgreSQL 15+** with pgvector | `brew install postgresql@17 pgvector` |
| **Ollama** | [ollama.ai](https://ollama.ai) + `ollama pull nomic-embed-text` |
| **Claude Code** | Sessions in `~/.claude/transcripts/` |

<details>
<summary>Linux setup (Ubuntu/Debian)</summary>

```bash
sudo apt install postgresql postgresql-contrib
# pgvector: https://github.com/pgvector/pgvector#installation

curl -fsSL https://ollama.ai/install.sh | sh
ollama pull nomic-embed-text
```
</details>

## Commands

### Ingest

```bash
# All sessions from ~/.claude/transcripts
pnpm ingest

# Specific file
pnpm ingest --file ~/.claude/transcripts/ses_abc123.jsonl

# Limit (for testing)
pnpm ingest --limit 10

# Skip embedding (text-only, faster)
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

# More results, more context
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

## How It Works

### What gets indexed

The parser extracts from each JSONL transcript:
- **User prompts** — your questions and instructions
- **Assistant responses** — Claude's answers and code
- **Tool results** — file reads, command outputs, search results
- **File paths** — automatically extracted from all content
- **Tool names** — which tools were used in each turn

### Schema

```sql
sessions (
  session_id TEXT UNIQUE,      -- ses_abc123...
  source_path TEXT,            -- ~/.claude/transcripts/...
  project_name TEXT,           -- auto-extracted from file paths
  message_count, total_tokens, created_at, updated_at
)

chunks (
  session_id UUID REFERENCES sessions,
  role TEXT,                   -- user | assistant | tool
  content TEXT,
  embedding vector(768),       -- nomic-embed-text
  tools_used TEXT[],
  files_mentioned TEXT[]
)
```

### Search modes

| Mode | Flag | How it works |
|------|------|-------------|
| **Semantic** | _(default)_ | Embeds your query, finds similar chunks by vector distance |
| **Hybrid** | `--keyword` | 70% semantic similarity + 30% keyword match (BM25) |
| **Filtered** | `--role` | Semantic search within a specific role (user/assistant/tool) |

## Configuration

Environment variables or edit `src/config.ts`:

```bash
DATABASE_URL=postgresql://localhost:5432/session_rag
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=nomic-embed-text
CLAUDE_SESSIONS_PATH=~/.claude/transcripts
```

## Embedding Models

| Model | Dims | Size | Quality |
|-------|------|------|---------|
| `nomic-embed-text` | 768 | 274MB | Good (default) |
| `mxbai-embed-large` | 1024 | 669MB | Better |
| `snowflake-arctic-embed2` | 1024 | 1.2GB | Best |

To switch: update `src/config.ts` and the vector dimension in `migrations/001_init.sql`.

## Performance

On M1 MacBook Pro with nomic-embed-text:

| Metric | Value |
|--------|-------|
| Ingestion | ~50 chunks/second |
| Search latency | <100ms for 10K chunks |
| Storage | ~1KB per chunk |

## Companion Tool: git-memory

If you want lightweight project context without a database, check out [**git-memory**](https://github.com/soderalohastrom/git-memory) — indexes your git history into CLAUDE.md for instant session bootstrapping. Pure bash, zero deps.

**git-memory** = "what happened in this repo" (fast, lightweight)
**session-rag** = "what did I do across all my coding sessions" (deep, semantic)

They complement each other nicely.

## Troubleshooting

<details>
<summary>"extension vector is not available"</summary>

pgvector not installed for your PostgreSQL version:
```bash
brew reinstall pgvector
brew services restart postgresql@17
```
</details>

<details>
<summary>"Ollama embedding failed"</summary>

Usually means the text chunk is too long or Ollama isn't running:
```bash
ollama serve  # start if not running
ollama logs   # check for errors
```
</details>

<details>
<summary>Empty search results</summary>

1. Check `pnpm stats` — are chunks embedded?
2. Try broader queries
3. Use `--keyword` for hybrid search
</details>

## License

MIT

## Author

[@soderalohastrom](https://github.com/soderalohastrom)

Built with [pgvector](https://github.com/pgvector/pgvector), [Ollama](https://ollama.ai), and [nomic-embed-text](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5). 🤙🏼

---

*Ma ka hana ka ʻike* — In working, one learns. 🌺🤙🏼
