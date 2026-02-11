#!/usr/bin/env tsx
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { config } from './config.js';
import { parseSessionFile, findSessionFiles } from './parser.js';
import { embed, embedBatch, checkOllama } from './embedder.js';
import {
  getPool,
  closePool,
  upsertSession,
  insertChunks,
  semanticSearch,
  hybridSearch,
  getStats,
  type Chunk,
} from './db/index.js';

const program = new Command();

program
  .name('session-rag')
  .description('RAG system for Claude Code sessions')
  .version('0.1.0');

// Ingest command
program
  .command('ingest')
  .description('Ingest Claude Code sessions into the database')
  .option('-p, --path <path>', 'Path to sessions directory', config.sources.claudeCode)
  .option('-f, --file <file>', 'Ingest a single file')
  .option('--no-embed', 'Skip embedding generation')
  .option('--limit <n>', 'Limit number of sessions to ingest', parseInt)
  .action(async (opts) => {
    console.log(chalk.blue.bold('\n🚀 Session RAG - Ingest\n'));

    // Check Ollama if embedding
    if (opts.embed !== false) {
      const spinner = ora('Checking Ollama...').start();
      const ollamaCheck = await checkOllama();
      if (!ollamaCheck.ok) {
        spinner.fail(ollamaCheck.error);
        process.exit(1);
      }
      spinner.succeed(`Ollama ready (${config.ollama.model})`);
    }

    // Find session files
    const files = opts.file ? [opts.file] : findSessionFiles(opts.path);
    let filesToProcess = files;
    if (opts.limit) {
      filesToProcess = files.slice(0, opts.limit);
    }

    console.log(chalk.gray(`Found ${files.length} session files`));
    if (opts.limit) {
      console.log(chalk.gray(`Processing ${filesToProcess.length} (limited)`));
    }

    const spinner = ora('Processing sessions...').start();
    let processed = 0;
    let skipped = 0;
    let totalChunks = 0;

    for (const file of filesToProcess) {
      try {
        // Parse session
        const session = parseSessionFile(file);
        if (!session || session.messages.length === 0) {
          skipped++;
          continue;
        }

        // Insert session
        const sessionDbId = await upsertSession({
          session_id: session.sessionId,
          source_path: session.sourcePath,
          project_name: session.projectName,
          created_at: session.createdAt,
          updated_at: session.updatedAt,
          message_count: session.messages.length,
          total_tokens: session.totalTokens,
          total_cost: session.totalCost,
          metadata: {},
        });

        // Prepare chunks
        const chunks: Chunk[] = session.messages.map((msg) => ({
          session_id: sessionDbId,
          chunk_index: msg.index,
          role: msg.role,
          content: msg.content,
          token_count: msg.tokenCount,
          tools_used: msg.toolsUsed,
          files_mentioned: msg.filesMentioned,
          created_at: msg.timestamp,
        }));

        // Generate embeddings
        if (opts.embed !== false) {
          const texts = chunks.map((c) => c.content);
          const embeddings = await embedBatch(texts, {
            onProgress: (done, total) => {
              spinner.text = `Processing ${session.sessionId.slice(0, 12)}... (${done}/${total} chunks)`;
            },
          });
          chunks.forEach((chunk, i) => {
            chunk.embedding = embeddings[i];
          });
        }

        // Insert chunks
        await insertChunks(chunks);
        
        processed++;
        totalChunks += chunks.length;
        spinner.text = `Processed ${processed}/${filesToProcess.length} sessions`;
      } catch (error) {
        console.error(`\nError processing ${file}:`, error);
        skipped++;
      }
    }

    spinner.succeed(`Ingested ${processed} sessions, ${totalChunks} chunks`);
    if (skipped > 0) {
      console.log(chalk.yellow(`Skipped ${skipped} sessions (empty or failed)`));
    }

    await closePool();
  });

// Search command
program
  .command('search <query>')
  .description('Search sessions semantically')
  .option('-n, --limit <n>', 'Number of results', '10')
  .option('-r, --role <role>', 'Filter by role (user, assistant, tool)')
  .option('-k, --keyword', 'Use hybrid search (keyword + semantic)')
  .option('--context <n>', 'Show N characters of context', '500')
  .action(async (query, opts) => {
    console.log(chalk.blue.bold('\n🔍 Session RAG - Search\n'));
    console.log(chalk.gray(`Query: "${query}"\n`));

    // Check Ollama
    const spinner = ora('Generating query embedding...').start();
    const ollamaCheck = await checkOllama();
    if (!ollamaCheck.ok) {
      spinner.fail(ollamaCheck.error);
      process.exit(1);
    }

    // Embed query
    const queryEmbedding = await embed(query);
    spinner.succeed('Query embedded');

    // Search
    const searchSpinner = ora('Searching...').start();
    const limit = parseInt(opts.limit);
    
    const results = opts.keyword
      ? await hybridSearch(queryEmbedding, query, limit)
      : await semanticSearch(queryEmbedding, limit, opts.role);

    searchSpinner.succeed(`Found ${results.length} results`);

    // Display results
    const contextLen = parseInt(opts.context);
    
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const similarity = (r.similarity * 100).toFixed(1);
      const roleColor = r.role === 'user' ? chalk.cyan : r.role === 'assistant' ? chalk.green : chalk.yellow;
      
      console.log(chalk.bold(`\n─── Result ${i + 1} (${similarity}% match) ───`));
      console.log(chalk.gray(`Session: ${r.source_session_id.slice(0, 16)}...`));
      if (r.project_name) console.log(chalk.gray(`Project: ${r.project_name}`));
      console.log(roleColor(`Role: ${r.role}`));
      console.log();
      
      // Truncate content for display
      let content = r.content;
      if (content.length > contextLen) {
        content = content.slice(0, contextLen) + chalk.gray('...');
      }
      console.log(content);
    }

    await closePool();
  });

// Stats command
program
  .command('stats')
  .description('Show database statistics')
  .action(async () => {
    console.log(chalk.blue.bold('\n📊 Session RAG - Stats\n'));
    
    const stats = await getStats();
    console.log(`Sessions:  ${chalk.green(stats.sessions)}`);
    console.log(`Chunks:    ${chalk.green(stats.chunks)}`);
    console.log(`Embedded:  ${chalk.green(stats.embedded)}`);
    
    const embeddedPct = stats.chunks > 0 
      ? ((stats.embedded / stats.chunks) * 100).toFixed(1) 
      : '0';
    console.log(`Coverage:  ${chalk.green(embeddedPct + '%')}`);

    await closePool();
  });

// Run
program.parse();
