// Claude Code runtime via @anthropic-ai/claude-agent-sdk.
//
// Each user message runs query() with streaming partial messages enabled;
// continuing a conversation passes the provider-native session id as `resume`.
// Abort goes through an AbortController per app session.

import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  createCompleteMessage,
  createNormalizedMessage,
  type IProviderRuntime,
  type ProviderRuntimeContext,
  type ProviderRuntimeWriter,
  type RunOptions,
} from '../types.js';

interface ActiveQuery {
  abortController: AbortController;
}

const active = new Map<string, ActiveQuery>();

interface SDKContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface SDKStreamEvent {
  type: string;
  delta?: { type?: string; text?: string; thinking?: string; partial_json?: string };
}

export const claudeRuntime: IProviderRuntime = {
  async run(
    command: string,
    options: RunOptions & { cwd?: string },
    writer: ProviderRuntimeWriter,
    context: ProviderRuntimeContext,
    appSessionId: string,
  ): Promise<void> {
    const abortController = new AbortController();
    active.set(appSessionId, { abortController });

    const providerSessionId = context.resolveProviderSessionId(appSessionId);

    const sdkOptions: Options = {
      abortController,
      includePartialMessages: true,
      permissionMode: options.permissionMode ?? 'default',
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(providerSessionId ? { resume: providerSessionId } : {}),
    };

    const turn: TurnState = { streamOpen: false, textStreamed: false };
    let completed = false;

    const endStream = () => {
      if (turn.streamOpen) {
        writer.send(createNormalizedMessage(appSessionId, 'claude', 'stream_end'));
        turn.streamOpen = false;
      }
    };

    const finish = (fields: Parameters<typeof createCompleteMessage>[2]) => {
      if (completed) return;
      completed = true;
      endStream();
      writer.send(createCompleteMessage(appSessionId, 'claude', fields));
    };

    try {
      const stream = query({ prompt: command, options: sdkOptions });

      for await (const message of stream as AsyncIterable<SDKMessage>) {
        handleSdkMessage(message, appSessionId, writer, turn, endStream);
        if (message.type === 'result') {
          const success = message.subtype === 'success';
          finish({
            success,
            exitCode: success ? 0 : 1,
            isError: !success,
            content: success
              ? undefined
              : (message as { errors?: string[] }).errors?.join('\n') ?? 'Agent run failed',
          });
        }
      }

      finish({ success: true, exitCode: 0 });
    } catch (err) {
      const aborted =
        abortController.signal.aborted ||
        (err instanceof Error && err.name === 'AbortError');
      if (!aborted) {
        writer.send(
          createNormalizedMessage(appSessionId, 'claude', 'error', {
            content: err instanceof Error ? err.message : String(err),
            isError: true,
          }),
        );
      }
      finish({ success: false, aborted, exitCode: aborted ? null : 1, isError: !aborted });
    } finally {
      active.delete(appSessionId);
    }
  },

  abort(appSessionId: string): boolean {
    const entry = active.get(appSessionId);
    if (!entry) return false;
    entry.abortController.abort();
    return true;
  },
};

interface TurnState {
  streamOpen: boolean;
  textStreamed: boolean;
}

function handleSdkMessage(
  message: SDKMessage,
  appSessionId: string,
  writer: ProviderRuntimeWriter,
  turn: TurnState,
  endStream: () => void,
): void {
  switch (message.type) {
    case 'system': {
      if (message.subtype === 'init') writer.setSessionId(message.session_id);
      break;
    }
    case 'stream_event': {
      const event = (message as { event?: SDKStreamEvent }).event;
      if (event?.type === 'message_start') {
        turn.textStreamed = false;
      } else if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
        turn.streamOpen = true;
        turn.textStreamed = true;
        writer.send(
          createNormalizedMessage(appSessionId, 'claude', 'stream_delta', { content: event.delta.text }),
        );
      }
      break;
    }
    case 'assistant': {
      endStream();
      const content = (message.message?.content ?? []) as SDKContentBlock[];
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          if (turn.textStreamed) continue;
          writer.send(
            createNormalizedMessage(appSessionId, 'claude', 'assistant', {
              content: block.text,
              model: message.message?.model,
            }),
          );
        } else if (block.type === 'thinking' && block.thinking) {
          writer.send(createNormalizedMessage(appSessionId, 'claude', 'thinking', { content: block.thinking }));
        } else if (block.type === 'tool_use') {
          writer.send(
            createNormalizedMessage(appSessionId, 'claude', 'tool_use', {
              toolName: block.name,
              toolId: block.id,
              toolInput: block.input,
            }),
          );
        }
      }
      turn.textStreamed = false;
      break;
    }
    case 'user': {
      const content = message.message?.content;
      if (!Array.isArray(content)) break;
      for (const block of content as ToolResultBlock[]) {
        if (block.type !== 'tool_result') continue;
        const text =
          typeof block.content === 'string'
            ? block.content
            : (block.content ?? [])
                .filter((p) => p.type === 'text' && p.text)
                .map((p) => p.text)
                .join('\n');
        writer.send(
          createNormalizedMessage(appSessionId, 'claude', 'tool_result', {
            toolId: block.tool_use_id,
            toolResult: { content: text, isError: block.is_error },
            isError: block.is_error,
          }),
        );
      }
      break;
    }
    default:
      break;
  }
}

interface ToolResultBlock {
  type: string;
  tool_use_id?: string;
  content?: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
}
