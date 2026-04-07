# AGENTS.md

## Reference Repositories

These repositories are cloned under `references/` for local source inspection.

- `references/screeps` - top-level standalone Screeps private server repository
- `references/launcher` - process launcher and bundled server scaffolding
- `references/backend-local` - local HTTP and CLI backend for the private server
- `references/storage` - default storage layer used by the standalone server
- `references/engine` - core game engine
- `references/driver` - environment bridge between the engine and host runtime
- `references/common` - shared utilities used by Screeps server modules
- `references/screepsmod-mongo` - MongoDB and Redis storage mod for private servers
- `references/screepsmod-admin-utils` - admin utilities mod for private servers

## Experimental Thinking

1. Avoid guesswork. If you are thinking "Probably..." or "Maybe..." this is a sign you need more data. Decide what data you need to achieve certainty, collect it, and then try again. Decisions should be data-driven.
2. Always work with reference to theoretical perfect metrics. For example, the theoretical maximum energy from a two-source room is `20 e/t`. Drop harvesting reduces this to `18 e/t` because the pile of energy decays at `1 e/t`. Some of this energy goes to spawning creeps, and spawn cost can also be calculated and measured. Compare these theoretical perfect metrics with observed results and look for gaps that cannot be accounted for. These signal a problem that needs to be investigated.
3. Most things in Screeps can be calculated with a high level of confidence.
