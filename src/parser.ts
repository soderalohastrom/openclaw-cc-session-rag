import fs from 'fs';
import path from 'path';
import { config } from './config.js';

// Claude Code JSONL message types
interface ClaudeUserMessage {
  type: 'user';
  timestamp: string;
  content: string;
}

interface ClaudeToolUse {
  type: 'tool_use';
  timestamp: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

interface ClaudeToolResult {
  type: 'tool_result';
  timestamp: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_output: {
    output?: string;
    preview?: string;
    truncated?: boolean;
  };
}

interface ClaudeAssistantMessage {
  type: 'assistant';
  timestamp: string;
  content: string;
}

type ClaudeMessage = ClaudeUserMessage | ClaudeToolUse | ClaudeToolResult | ClaudeAssistantMessage;

export interface ParsedSession {
  sessionId: string;
  sourcePath: string;
  projectName?: string;
  createdAt?: Date;
  updatedAt?: Date;
  messages: ParsedMessage[];
  totalTokens: number;
  totalCost: number;
}

export interface ParsedMessage {
  index: number;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  timestamp?: Date;
  tokenCount?: number;
  toolsUsed: string[];
  filesMentioned: string[];
}

// Extract text content from message
function extractContent(message: ClaudeMessage): { text: string; tools: string[]; role: ParsedMessage['role'] } {
  const tools: string[] = [];
  
  switch (message.type) {
    case 'user':
      return { text: message.content, tools: [], role: 'user' };
    
    case 'assistant':
      return { text: message.content, tools: [], role: 'assistant' };
    
    case 'tool_use':
      tools.push(message.tool_name);
      const inputDesc = message.tool_input?.description || message.tool_input?.command || '';
      return { 
        text: `[Tool: ${message.tool_name}] ${inputDesc}`.trim(), 
        tools, 
        role: 'tool' 
      };
    
    case 'tool_result':
      const output = message.tool_output?.output || message.tool_output?.preview || '';
      // Truncate long tool outputs
      const truncatedOutput = output.length > 1000 ? output.slice(0, 1000) + '...' : output;
      return { 
        text: `[Tool Result: ${message.tool_name}]\n${truncatedOutput}`.trim(), 
        tools: [message.tool_name], 
        role: 'tool' 
      };
    
    default:
      return { text: '', tools: [], role: 'system' };
  }
}

// Extract file paths mentioned in content
function extractFilePaths(content: string): string[] {
  const patterns = [
    /(?:^|\s)(\/[\w\-./]+\.\w+)/g,           // Unix absolute paths
    /(?:^|\s)(\.\/[\w\-./]+)/g,               // Relative paths
    /(?:^|\s)(~\/[\w\-./]+)/g,                // Home-relative paths
    /`([^`]+\.\w{1,5})`/g,                    // Paths in backticks
    /"filePath":\s*"([^"]+)"/g,               // filePath in JSON
  ];
  
  const files = new Set<string>();
  for (const pattern of patterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const file = match[1];
      // Filter out common false positives
      if (file && !file.includes('http') && !file.startsWith('.com')) {
        files.add(file);
      }
    }
  }
  
  return Array.from(files);
}

// Parse a single session file
export function parseSessionFile(filePath: string): ParsedSession | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    
    if (lines.length === 0) return null;
    
    const sessionId = path.basename(filePath, '.jsonl');
    const messages: ParsedMessage[] = [];
    let firstTimestamp: Date | undefined;
    let lastTimestamp: Date | undefined;
    
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as ClaudeMessage;
        
        // Track timestamps
        if (parsed.timestamp) {
          const ts = new Date(parsed.timestamp);
          if (!firstTimestamp) firstTimestamp = ts;
          lastTimestamp = ts;
        }
        
        // Extract content
        const { text, tools, role } = extractContent(parsed);
        
        // Skip empty or very short content
        if (!text || text.length < 10) continue;
        
        // Skip consecutive tool_use/tool_result pairs - just keep results
        if (parsed.type === 'tool_use') continue;
        
        messages.push({
          index: messages.length,
          role,
          content: text,
          timestamp: parsed.timestamp ? new Date(parsed.timestamp) : undefined,
          tokenCount: Math.ceil(text.length / 4), // rough estimate
          toolsUsed: tools,
          filesMentioned: extractFilePaths(text),
        });
      } catch {
        // Skip malformed lines
        continue;
      }
    }
    
    if (messages.length === 0) return null;
    
    // Try to extract project name from first tool result's path
    let projectName: string | undefined;
    for (const msg of messages) {
      if (msg.filesMentioned.length > 0) {
        const firstPath = msg.filesMentioned[0];
        const match = firstPath.match(/\/([^/]+)\/(?:src|app|lib|node_modules)/);
        if (match) {
          projectName = match[1];
          break;
        }
      }
    }
    
    return {
      sessionId,
      sourcePath: filePath,
      projectName,
      createdAt: firstTimestamp,
      updatedAt: lastTimestamp,
      messages,
      totalTokens: messages.reduce((sum, m) => sum + (m.tokenCount || 0), 0),
      totalCost: 0, // Claude Code doesn't expose cost in transcripts
    };
  } catch (error) {
    console.error(`Failed to parse ${filePath}:`, error);
    return null;
  }
}

// Find all session files
export function findSessionFiles(basePath?: string): string[] {
  const searchPath = basePath || config.sources.claudeCode;
  
  if (!fs.existsSync(searchPath)) {
    console.error(`Path not found: ${searchPath}`);
    return [];
  }
  
  const files: string[] = [];
  
  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  }
  
  walk(searchPath);
  return files;
}
