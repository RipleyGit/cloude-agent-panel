// Parses Claude Code transcript files (~/.claude/projects/<slug>/<sessionId>.jsonl)
// into NormalizedMessage history.
//
// Transcript line shapes we care about:
//   { type: 'summary', summary: string }
//   { type: 'user', message: { role:'user', content: string | ContentPart[] }, timestamp, sessionId, cwd }
//   { type: 'assistant', message: { content: ContentPart[], model }, timestamp }
// ContentPart: {type:'text',text} | {type:'thinking',thinking} | {type:'tool_use',id,name,input}
//              | {type:'tool_result',tool_use_id,content,is_error}

import fs from 'node:fs';
import readline from 'node:readline';
import {
  createNormalizedMessage,
  type NormalizedMessage,
} from '../types.js';

interface TranscriptContentPart {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
}

interface TranscriptLine {
  type?: string;
  subtype?: string;
  summary?: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    content?: string | TranscriptContentPart[];
  };
}

export interface TranscriptMeta {
  providerSessionId: string | null;
  cwd: string | null;
  title: string | null;
}

function toolResultText(content: TranscriptContentPart['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n');
  }
  return '';
}

export function normalizeTranscriptLine(
  line: TranscriptLine,
  appSessionId: string,
): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  const base = { timestamp: line.timestamp };

  if (line.type === 'user' && line.message) {
    const content = line.message.content;
    if (typeof content === 'string') {
      out.push(
        createNormalizedMessage(appSessionId, 'claude', 'user', { content, ...base }),
      );
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === 'text' && part.text) {
          out.push(
            createNormalizedMessage(appSessionId, 'claude', 'user', {
              content: part.text,
              ...base,
            }),
          );
        } else if (part.type === 'tool_result') {
          out.push(
            createNormalizedMessage(appSessionId, 'claude', 'tool_result', {
              toolId: part.tool_use_id,
              toolResult: { content: toolResultText(part.content), isError: part.is_error },
              isError: part.is_error,
              ...base,
            }),
          );
        }
      }
    }
  } else if (line.type === 'assistant' && line.message) {
    const content = line.message.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === 'text' && part.text) {
          out.push(
            createNormalizedMessage(appSessionId, 'claude', 'assistant', {
              content: part.text,
              model: line.message.model,
              ...base,
            }),
          );
        } else if (part.type === 'thinking' && part.thinking) {
          out.push(
            createNormalizedMessage(appSessionId, 'claude', 'thinking', {
              content: part.thinking,
              ...base,
            }),
          );
        } else if (part.type === 'tool_use') {
          out.push(
            createNormalizedMessage(appSessionId, 'claude', 'tool_use', {
              toolName: part.name,
              toolId: part.id,
              toolInput: part.input,
              ...base,
            }),
          );
        }
      }
    }
  }

  return out;
}

async function* readLines(filePath: string): AsyncGenerator<TranscriptLine> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const text of rl) {
    const trimmed = text.trim();
    if (!trimmed) continue;
    try {
      yield JSON.parse(trimmed) as TranscriptLine;
    } catch {
      // skip malformed lines
    }
  }
}

export async function readTranscriptMeta(filePath: string): Promise<TranscriptMeta> {
  let providerSessionId: string | null = null;
  let cwd: string | null = null;
  let title: string | null = null;
  let firstUserText: string | null = null;

  for await (const line of readLines(filePath)) {
    if (!providerSessionId && line.sessionId) providerSessionId = line.sessionId;
    if (!cwd && line.cwd) cwd = line.cwd;
    if (!title && line.type === 'summary' && line.summary) title = line.summary;
    if (
      !firstUserText &&
      line.type === 'user' &&
      typeof line.message?.content === 'string' &&
      line.message.content.trim()
    ) {
      firstUserText = line.message.content.trim();
    }
    if (providerSessionId && cwd && (title || firstUserText)) break;
  }

  if (!title && firstUserText) {
    title = firstUserText.length > 60 ? `${firstUserText.slice(0, 60)}…` : firstUserText;
  }
  return { providerSessionId, cwd, title };
}

export async function fetchHistory(
  filePath: string,
  appSessionId: string,
  limit = 200,
): Promise<NormalizedMessage[]> {
  const messages: NormalizedMessage[] = [];
  for await (const line of readLines(filePath)) {
    messages.push(...normalizeTranscriptLine(line, appSessionId));
  }
  return limit > 0 ? messages.slice(-limit) : messages;
}
