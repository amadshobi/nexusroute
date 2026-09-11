/**
 * CommandCode NDJSON stream events -> OpenAI SSE chunks (data: {...}\n\n)
 *
 * CommandCode upstream emits NDJSON-style AI SDK v5 events:
 * - {"type":"text-start","id":"..."}
 * - {"type":"text-delta","text":"..."}
 * - {"type":"reasoning-start","id":"..."}
 * - {"type":"reasoning-delta","text":"..."}
 * - {"type":"tool-input-start","id":"...","toolName":"..."}
 * - {"type":"tool-input-delta","id":"...","delta":"..."}
 * - {"type":"tool-call","toolCallId":"...","toolName":"...","input":{...}}
 * - {"type":"finish-step","finishReason":"stop"|"tool-calls",...}
 * - {"type":"finish",...}
 */

export interface TranslatorState {
  responseId: string;
  created: number;
  model: string;
  chunkIndex: number;
  toolIndex: number;
  toolIndexById: Map<string, number>;
  finishReason: string | null;
}

export function createTranslatorState(model: string): TranslatorState {
  return {
    responseId: `chatcmpl-${Date.now()}`,
    created: Math.floor(Date.now() / 1000),
    model,
    chunkIndex: 0,
    toolIndex: 0,
    toolIndexById: new Map(),
    finishReason: null,
  };
}

function buildChunk(state: TranslatorState, delta: any, finishReason: string | null = null) {
  return {
    id: state.responseId,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

/**
 * Parse one NDJSON line into one or more OpenAI chat.completion.chunk objects
 */
export function parseCommandCodeEvent(line: string, state: TranslatorState): any[] {
  const cleanLine = line.trim();
  if (!cleanLine || cleanLine === "[DONE]") return [];

  let event: any;
  try {
    const raw = cleanLine.startsWith("data:") ? cleanLine.slice(5).trim() : cleanLine;
    event = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!event || typeof event !== "object") return [];

  const chunks: any[] = [];

  // First chunk emits role assistant
  if (state.chunkIndex === 0) {
    chunks.push(buildChunk(state, { role: "assistant" }, null));
    state.chunkIndex++;
  }

  switch (event.type) {
    case "text-delta": {
      const text = event.text ?? event.delta ?? "";
      if (text) {
        chunks.push(buildChunk(state, { content: text }, null));
        state.chunkIndex++;
      }
      break;
    }

    case "reasoning-delta": {
      const text = event.text ?? event.delta ?? "";
      if (text) {
        chunks.push(buildChunk(state, { reasoning_content: text }, null));
        state.chunkIndex++;
      }
      break;
    }

    case "tool-input-start": {
      const id = event.id || `call_${Date.now()}_${state.toolIndex}`;
      state.toolIndexById.set(id, state.toolIndex);
      chunks.push(
        buildChunk(
          state,
          {
            tool_calls: [
              {
                index: state.toolIndex,
                id,
                type: "function",
                function: {
                  name: event.toolName || "",
                  arguments: "",
                },
              },
            ],
          },
          null,
        ),
      );
      state.toolIndex++;
      state.chunkIndex++;
      break;
    }

    case "tool-input-delta": {
      const id = event.id;
      const idx = id && state.toolIndexById.has(id) ? state.toolIndexById.get(id)! : 0;
      const delta = event.delta || "";
      if (delta) {
        chunks.push(
          buildChunk(
            state,
            {
              tool_calls: [
                {
                  index: idx,
                  function: {
                    arguments: delta,
                  },
                },
              ],
            },
            null,
          ),
        );
        state.chunkIndex++;
      }
      break;
    }

    case "tool-call": {
      const id = event.toolCallId || event.id || `call_${Date.now()}_${state.toolIndex}`;
      let argsStr = "";
      if (typeof event.input === "string") argsStr = event.input;
      else if (event.input) argsStr = JSON.stringify(event.input);

      let idx = state.toolIndexById.get(id);
      if (idx === undefined) {
        idx = state.toolIndex++;
        state.toolIndexById.set(id, idx);
      }

      chunks.push(
        buildChunk(
          state,
          {
            tool_calls: [
              {
                index: idx,
                id,
                type: "function",
                function: {
                  name: event.toolName || "tool",
                  arguments: argsStr,
                },
              },
            ],
          },
          null,
        ),
      );
      state.chunkIndex++;
      break;
    }

    case "finish-step":
    case "finish": {
      let mappedFinish = "stop";
      const r = event.finishReason;
      if (r === "tool-calls" || r === "tool_call" || state.toolIndex > 0) {
        mappedFinish = "tool_calls";
      } else if (r === "length" || r === "max_tokens") {
        mappedFinish = "length";
      }
      state.finishReason = mappedFinish;
      chunks.push(buildChunk(state, {}, mappedFinish));
      state.chunkIndex++;
      break;
    }
  }

  return chunks;
}
