import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { translateOpenAIToCommandCode } from "./request-translator";
import { createTranslatorState, parseCommandCodeEvent } from "./response-translator";

export interface CommandCodeModel {
  id: string;
  name: string;
}

export const COMMANDCODE_DEFAULT_MODELS: CommandCodeModel[] = [
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  { id: "moonshotai/Kimi-K2.6", name: "Kimi K2.6" },
  { id: "moonshotai/Kimi-K2.5", name: "Kimi K2.5" },
  { id: "zai-org/GLM-5.1", name: "GLM 5.1" },
  { id: "zai-org/GLM-5", name: "GLM 5" },
  { id: "MiniMaxAI/MiniMax-M2.7", name: "MiniMax M2.7" },
  { id: "MiniMaxAI/MiniMax-M2.5", name: "MiniMax M2.5" },
  { id: "Qwen/Qwen3.6-Max-Preview", name: "Qwen 3.6 Max Preview" },
  { id: "Qwen/Qwen3.6-Plus", name: "Qwen 3.6 Plus" },
  { id: "stepfun/Step-3.5-Flash", name: "Step 3.5 Flash" },
];

export class CommandCodeAdapter {
  public readonly id = "commandcode";
  public readonly name = "Command Code";
  public readonly baseUrl = "https://api.commandcode.ai/alpha/generate";

  getApiKey(): string {
    if (process.env.COMMANDCODE_API_KEY) return process.env.COMMANDCODE_API_KEY;

    // 1. Try ~/.9router/db/data.sqlite (VansRouter active connection)
    const vansDb = join(homedir(), ".9router", "db", "data.sqlite");
    if (existsSync(vansDb)) {
      try {
        const { Database } = require("bun:sqlite");
        const db = new Database(vansDb, { readonly: true });
        const row: any = db
          .query("SELECT data FROM providerConnections WHERE provider = 'commandcode' AND isActive = 1 LIMIT 1")
          .get();
        db.close();
        if (row && row.data) {
          const parsed = JSON.parse(row.data);
          if (parsed.apiKey) return parsed.apiKey;
        }
      } catch {}
    }

    // 2. Try ~/.commandcode/auth.json
    const p1 = join(homedir(), ".commandcode", "auth.json");
    if (existsSync(p1)) {
      try {
        const data = JSON.parse(readFileSync(p1, "utf8"));
        if (data.apiKey) return data.apiKey;
      } catch {}
    }

    // 3. Try ~/.omp/agent/auth.json
    const p2 = join(homedir(), ".omp", "agent", "auth.json");
    if (existsSync(p2)) {
      try {
        const data = JSON.parse(readFileSync(p2, "utf8"));
        const key =
          data["command-code"]?.key ||
          data.commandcode?.key ||
          data.commandcode?.access ||
          (typeof data.commandcode === "string" ? data.commandcode : "");
        if (key) return key;
      } catch {}
    }

    return "";
  }

  isAvailable(): boolean {
    return Boolean(this.getApiKey());
  }

  getModels(): CommandCodeModel[] {
    const modelsPath = join(homedir(), ".omp", "agent", "commandcode-models.json");
    if (existsSync(modelsPath)) {
      try {
        const raw = readFileSync(modelsPath, "utf8");
        const data = JSON.parse(raw);
        const list = Array.isArray(data) ? data : data.models || [];
        if (list.length > 0) {
          return list.map((m: any) => ({
            id: m.id,
            name: m.name || m.id,
          }));
        }
      } catch {}
    }
    return COMMANDCODE_DEFAULT_MODELS;
  }

  isCommandCodeModel(modelName: string): boolean {
    const clean = modelName.toLowerCase().replace(/^(commandcode|cmc)\//, "");
    const models = this.getModels();
    return models.some((m) => m.id.toLowerCase() === clean);
  }

  /**
   * Execute chat completion against api.commandcode.ai/alpha/generate
   * and stream back as OpenAI-compatible SSE chunks.
   */
  async execute(openAiBody: any, signal?: AbortSignal): Promise<Response> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: {
            message: "CommandCode API Key not found in ~/.commandcode/auth.json or environment",
            type: "auth_error",
          },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    }

    const payload = translateOpenAIToCommandCode(openAiBody);
    const modelUsed = openAiBody.model || payload.model;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "CommandCode-CLI/0.25.7",
      "x-command-code-version": "0.25.7",
      "x-cli-environment": "cli",
      "x-session-id": randomUUID(),
      Accept: "text/event-stream",
    };

    const upstreamRes = await fetch(this.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });

    if (!upstreamRes.ok || !upstreamRes.body) {
      const errText = await upstreamRes.text().catch(() => "");
      return new Response(errText || "Upstream CommandCode error", {
        status: upstreamRes.status,
        headers: { "content-type": "application/json" },
      });
    }

    // Transform NDJSON stream into OpenAI SSE chunks
    const state = createTranslatorState(modelUsed);
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";

    const transformStream = new TransformStream({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const events = parseCommandCodeEvent(line, state);
          for (const ev of events) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
          }
        }
      },
      flush(controller) {
        if (buffer.trim()) {
          const events = parseCommandCodeEvent(buffer, state);
          for (const ev of events) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      },
    });

    return new Response(upstreamRes.body.pipeThrough(transformStream), {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "x-nexus-provider": "commandcode",
      },
    });
  }
}

export const defaultCommandCodeAdapter = new CommandCodeAdapter();
