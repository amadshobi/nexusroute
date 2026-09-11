# NexusRoute (`nexus`)

The Ultra-Lightweight Bun-Native Local LLM Edge Gateway & Multi-Agent Telemetry Console.

## Features

- **Local Edge Gateway (`:4010`)**: High-performance HTTP/SSE reverse proxy with deterministic caching and privacy sanitization.
- **Multi-Agent Telemetry**: Direct ingestion from active edge traffic.
- **Minimalist Web Console**: Vite SPA dark-mode control center designed for mobile and desktop developer workflows.
- **Model Governance**: Dynamic whitelisting and cascade routing.

## Usage

```bash
# Start Gateway (foreground)
nexus start

# Check Gateway Status
nexus status

# Live Multi-Provider Quota
nexus quota

# Stream Access & Fallback Logs
nexus logs

# Web Console
# Open http://localhost:4010/dashboard
```

### Core Commands

| Command               | Description                                                    |
| --------------------- | -------------------------------------------------------------- |
| `nexus start`         | Start the hybrid edge interceptor (`:4010` → OMP + VansRouter) |
| `nexus stop`          | Stop the running gateway (systemd service or PID hint)         |
| `nexus status`        | Health check of the active gateway instance                    |
| `nexus stats`         | Real-time performance, cache hit-rate & error metrics          |
| `nexus logs`          | Audit traffic, cache state & fallback history                  |
| `nexus cache prune`   | Prune expired prompt-cache entries                             |
| `nexus quota`         | Live multi-provider quota dashboard                            |
| `nexus doctor`        | Full system & service health diagnostic                        |
| `nexus restart`       | Restart systemd user services                                  |
| `nexus record <name>` | Run gateway in JSONL fixture record mode                       |
| `nexus mock <name>`   | Replay a fixture deterministically (offline)                   |

Run `nexus <command> --help` for detailed per-command manuals.

## Legacy Alias

The `gn` binary is retained as a backward-compatible alias for `nexus`
(`gn gateway start` still works). New usage should prefer `nexus`.

Part of the independent ecosystem extracted from Goblin Vault.
