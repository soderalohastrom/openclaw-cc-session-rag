import { config } from './config.js';

interface OllamaEmbeddingResponse {
  embedding: number[];
}

// Single embedding request
export async function embed(text: string): Promise<number[]> {
  const response = await fetch(`${config.ollama.baseUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollama.model,
      prompt: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama embedding failed: ${response.statusText}`);
  }

  const data = (await response.json()) as OllamaEmbeddingResponse;
  return data.embedding;
}

// Batch embedding with rate limiting
export async function embedBatch(
  texts: string[],
  options: {
    onProgress?: (done: number, total: number) => void;
    concurrency?: number;
  } = {}
): Promise<number[][]> {
  const { onProgress, concurrency = 5 } = options;
  const results: number[][] = new Array(texts.length);
  let completed = 0;

  // Process in batches for controlled concurrency
  for (let i = 0; i < texts.length; i += concurrency) {
    const batch = texts.slice(i, i + concurrency);
    const batchPromises = batch.map(async (text, j) => {
      const embedding = await embed(text);
      results[i + j] = embedding;
      completed++;
      onProgress?.(completed, texts.length);
    });
    
    await Promise.all(batchPromises);
  }

  return results;
}

// Check if Ollama is running and model is available
export async function checkOllama(): Promise<{ ok: boolean; error?: string }> {
  try {
    // Check if Ollama is running
    const response = await fetch(`${config.ollama.baseUrl}/api/tags`);
    if (!response.ok) {
      return { ok: false, error: 'Ollama not responding' };
    }

    const data = (await response.json()) as { models: Array<{ name: string }> };
    const hasModel = data.models.some(
      (m) => m.name === config.ollama.model || m.name.startsWith(config.ollama.model)
    );

    if (!hasModel) {
      return {
        ok: false,
        error: `Model ${config.ollama.model} not found. Run: ollama pull ${config.ollama.model}`,
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `Cannot connect to Ollama at ${config.ollama.baseUrl}. Is it running?`,
    };
  }
}
