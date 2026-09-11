import { randomUUID } from "node:crypto";

/**
 * OpenAI Chat Completions -> CommandCode /alpha/generate request translator
 *
 * Upstream `/alpha/generate` wrapper envelope:
 * {
 *   threadId: string,
 *   memory: string,
 *   config: { workingDir, date, environment, structure, isGitRepo, ... },
 *   params: {
 *     model: string,
 *     messages: [...],
 *     system?: string,
 *     tools?: [...],
 *     stream: boolean,
 *     temperature?: number,
 *     max_tokens?: number
 *   }
 * }
 */

export interface CommandCodeContentBlock {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  input?: any;
  output?: any;
}

export interface CommandCodeMessage {
  role: "user" | "assistant";
  content: CommandCodeContentBlock[];
}

function flattenText(content: any): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return String(content);
}

function convertToolCallsToBlocks(toolCalls: any[]): CommandCodeContentBlock[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.map((tc) => {
    let inputObj: any = {};
    if (typeof tc.function?.arguments === "string") {
      try {
        inputObj = JSON.parse(tc.function.arguments);
      } catch {
        inputObj = { raw: tc.function.arguments };
      }
    } else if (tc.function?.arguments) {
      inputObj = tc.function.arguments;
    }
    return {
      type: "tool-call",
      toolCallId: tc.id || `call_${Date.now()}`,
      toolName: tc.function?.name || "unknown",
      input: inputObj,
    };
  });
}

export function translateOpenAIToCommandCode(body: any): any {
  const messages: CommandCodeMessage[] = [];
  const systemParts: string[] = [];

  const rawMessages: any[] = Array.isArray(body.messages) ? body.messages : [];

  for (const m of rawMessages) {
    if (!m) continue;
    const role = m.role;

    if (role === "system") {
      const sysText = flattenText(m.content);
      if (sysText) systemParts.push(sysText);
      continue;
    }

    if (role === "tool") {
      let outputVal = m.content;
      try {
        if (typeof m.content === "string") {
          outputVal = JSON.parse(m.content);
        }
      } catch {}

      messages.push({
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: m.tool_call_id || m.name || `tool_${Date.now()}`,
            toolName: m.name || "tool",
            output: outputVal,
          },
        ],
      });
      continue;
    }

    if (role === "user") {
      const blocks: CommandCodeContentBlock[] = [];
      if (typeof m.content === "string") {
        blocks.push({ type: "text", text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const p of m.content) {
          if (typeof p === "string") {
            blocks.push({ type: "text", text: p });
          } else if (p && typeof p === "object") {
            if (p.type === "text" || p.text) {
              blocks.push({ type: "text", text: p.text || "" });
            }
          }
        }
      }
      messages.push({
        role: "user",
        content: blocks.length > 0 ? blocks : [{ type: "text", text: "" }],
      });
      continue;
    }

    if (role === "assistant") {
      const blocks: CommandCodeContentBlock[] = [];
      const text = flattenText(m.content);
      if (text) {
        blocks.push({ type: "text", text });
      }
      if (Array.isArray(m.tool_calls)) {
        blocks.push(...convertToolCallsToBlocks(m.tool_calls));
      }
      messages.push({
        role: "assistant",
        content: blocks.length > 0 ? blocks : [{ type: "text", text: "" }],
      });
      continue;
    }
  }

  // Convert tools to Anthropic format
  let tools: any[] | undefined = undefined;
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    tools = body.tools
      .map((t: any) => {
        const fn = t.function || t;
        if (!fn?.name) return null;
        return {
          name: fn.name,
          description: fn.description || "",
          input_schema: fn.parameters || { type: "object", properties: {} },
        };
      })
      .filter(Boolean);
  }

  const rawModel = body.model || "deepseek/deepseek-v4-flash";
  const normalizedModel = rawModel.replace(/^(commandcode|cmc)\//, "");

  const today = new Date().toISOString().slice(0, 10);

  return {
    threadId: randomUUID(),
    memory: "",
    config: {
      workingDir: process.cwd(),
      date: today,
      environment: process.platform,
      structure: [],
      isGitRepo: false,
      currentBranch: "",
      mainBranch: "",
      gitStatus: "",
      recentCommits: [],
    },
    params: {
      model: normalizedModel,
      system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
      messages,
      tools,
      stream: true,
      temperature: body.temperature ?? 0.3,
      max_tokens: body.max_tokens ?? 8192,
    },
  };
}
