import pg from 'pg';
import { config } from '../config.js';

// Convert embedding array to pgvector format
function toVectorString(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

const { Pool } = pg;

let pool: pg.Pool | null = null;

export async function getPool(): Promise<pg.Pool> {
  if (!pool) {
    pool = new Pool({
      connectionString: config.db.connectionString,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// Session operations
export interface Session {
  id: string;
  session_id: string;
  source_path: string;
  project_name?: string;
  created_at?: Date;
  updated_at?: Date;
  message_count: number;
  total_tokens: number;
  total_cost: number;
  metadata: Record<string, unknown>;
}

export async function upsertSession(session: Omit<Session, 'id'>): Promise<string> {
  const pool = await getPool();
  const result = await pool.query(
    `INSERT INTO sessions (session_id, source_path, project_name, created_at, updated_at, message_count, total_tokens, total_cost, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (session_id) DO UPDATE SET
       source_path = EXCLUDED.source_path,
       project_name = EXCLUDED.project_name,
       updated_at = EXCLUDED.updated_at,
       message_count = EXCLUDED.message_count,
       total_tokens = EXCLUDED.total_tokens,
       total_cost = EXCLUDED.total_cost,
       metadata = EXCLUDED.metadata,
       ingested_at = NOW()
     RETURNING id`,
    [
      session.session_id,
      session.source_path,
      session.project_name,
      session.created_at,
      session.updated_at,
      session.message_count,
      session.total_tokens,
      session.total_cost,
      JSON.stringify(session.metadata),
    ]
  );
  return result.rows[0].id;
}

// Chunk operations
export interface Chunk {
  id?: string;
  session_id: string;
  chunk_index: number;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  embedding?: number[];
  token_count?: number;
  tools_used?: string[];
  files_mentioned?: string[];
  created_at?: Date;
  metadata?: Record<string, unknown>;
}

export async function insertChunks(chunks: Chunk[]): Promise<void> {
  if (chunks.length === 0) return;
  
  const pool = await getPool();
  
  // Build bulk insert
  const values: unknown[] = [];
  const placeholders: string[] = [];
  
  chunks.forEach((chunk, i) => {
    const offset = i * 10;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10})`
    );
    values.push(
      chunk.session_id,
      chunk.chunk_index,
      chunk.role,
      chunk.content,
      chunk.embedding ? toVectorString(chunk.embedding) : null,
      chunk.token_count,
      chunk.tools_used || [],
      chunk.files_mentioned || [],
      chunk.created_at,
      JSON.stringify(chunk.metadata || {})
    );
  });

  await pool.query(
    `INSERT INTO chunks (session_id, chunk_index, role, content, embedding, token_count, tools_used, files_mentioned, created_at, metadata)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (session_id, chunk_index) DO UPDATE SET
       content = EXCLUDED.content,
       embedding = EXCLUDED.embedding,
       token_count = EXCLUDED.token_count,
       tools_used = EXCLUDED.tools_used,
       files_mentioned = EXCLUDED.files_mentioned,
       metadata = EXCLUDED.metadata`,
    values
  );
}

// Search operations
export interface SearchResult {
  session_id: string;
  source_session_id: string;
  project_name: string | null;
  chunk_index: number;
  role: string;
  content: string;
  similarity: number;
  created_at: Date | null;
}

export async function semanticSearch(
  embedding: number[],
  limit = 10,
  roleFilter?: string
): Promise<SearchResult[]> {
  const pool = await getPool();
  
  let query = `
    SELECT 
      c.session_id,
      s.session_id as source_session_id,
      s.project_name,
      c.chunk_index,
      c.role,
      c.content,
      1 - (c.embedding <=> $1) AS similarity,
      c.created_at
    FROM chunks c
    JOIN sessions s ON c.session_id = s.id
    WHERE c.embedding IS NOT NULL
  `;
  
  const params: unknown[] = [toVectorString(embedding)];
  
  if (roleFilter) {
    query += ` AND c.role = $2`;
    params.push(roleFilter);
  }
  
  query += ` ORDER BY c.embedding <=> $1 LIMIT $${params.length + 1}`;
  params.push(limit);
  
  const result = await pool.query(query, params);
  return result.rows;
}

export async function hybridSearch(
  embedding: number[],
  keyword: string,
  limit = 10
): Promise<SearchResult[]> {
  const pool = await getPool();
  
  const result = await pool.query(
    `SELECT 
      c.session_id,
      s.session_id as source_session_id,
      s.project_name,
      c.chunk_index,
      c.role,
      c.content,
      (
        0.7 * (1 - (c.embedding <=> $1)) +
        0.3 * COALESCE(ts_rank(to_tsvector('english', c.content), plainto_tsquery($2)), 0)
      ) AS similarity,
      c.created_at
    FROM chunks c
    JOIN sessions s ON c.session_id = s.id
    WHERE c.embedding IS NOT NULL
      AND to_tsvector('english', c.content) @@ plainto_tsquery($2)
    ORDER BY similarity DESC
    LIMIT $3`,
    [toVectorString(embedding), keyword, limit]
  );
  
  return result.rows;
}

// Stats
export async function getStats(): Promise<{
  sessions: number;
  chunks: number;
  embedded: number;
}> {
  const pool = await getPool();
  const result = await pool.query(`
    SELECT 
      (SELECT COUNT(*) FROM sessions) as sessions,
      (SELECT COUNT(*) FROM chunks) as chunks,
      (SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL) as embedded
  `);
  return result.rows[0];
}
