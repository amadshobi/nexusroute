# NexusRoute (`gn`)

The Ultra-Lightweight Bun-Native Local LLM Edge Gateway & Multi-Agent Telemetry Console.

## Features
- **Local Edge Gateway (`:4010`)**: High-performance HTTP/SSE reverse proxy with deterministic caching and privacy sanitization.
- **Multi-Agent Telemetry**: Direct ingestion from active edge traffic.
- **Minimalist Web Console**: Vite SPA dark-mode control center designed for mobile and desktop developer workflows.
- **Model Governance**: Dynamic whitelisting and cascade routing.

## Usage
```bash
# Start Gateway
gn gateway start

# Check Status
gn gateway status

# Web Console
# Open http://localhost:4010/dashboard
```

Part of the independent ecosystem extracted from Goblin Vault.
