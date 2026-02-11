#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { config } from '../config.js';

const { Client } = pg;

async function migrate() {
  // First, create the database if it doesn't exist
  const adminClient = new Client({
    connectionString: 'postgresql://localhost:5432/postgres',
  });
  
  try {
    await adminClient.connect();
    
    // Check if database exists
    const dbCheck = await adminClient.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [config.db.database]
    );
    
    if (dbCheck.rows.length === 0) {
      console.log(`Creating database: ${config.db.database}`);
      await adminClient.query(`CREATE DATABASE ${config.db.database}`);
    }
  } finally {
    await adminClient.end();
  }

  // Now connect to the session_rag database and run migrations
  const client = new Client({
    connectionString: config.db.connectionString,
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Read and execute migration files
    const migrationsDir = path.join(import.meta.dirname, '../../migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const migrationName = file.replace('.sql', '');
      
      // Check if already applied
      try {
        const check = await client.query(
          `SELECT 1 FROM _migrations WHERE name = $1`,
          [migrationName]
        );
        if (check.rows.length > 0) {
          console.log(`⏭️  Skipping ${migrationName} (already applied)`);
          continue;
        }
      } catch {
        // _migrations table doesn't exist yet, that's fine
      }

      console.log(`📦 Applying ${migrationName}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      await client.query(sql);
      console.log(`✅ Applied ${migrationName}`);
    }

    console.log('\n🎉 All migrations complete!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
