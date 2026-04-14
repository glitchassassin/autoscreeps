# ADR 0001: Basic Bot Runtime State Placement

- Status: Accepted
- Date: 2026-04-14

## Context

`bots/basic` is moving from a tiny worker loop toward a more explicit `sense -> plan -> spawn -> act` architecture with structured telemetry and module-level health checks.

That work will introduce more derived data such as route caches, source indexes, rolling health windows, and planner summaries. In Screeps, these data can live in several places with different cost and durability properties:

- module-scoped heap persists across warm ticks but is lost on global reset
- `Memory` is durable across resets but incurs serialization cost and should stay small
- `RawMemory.segments` are durable but asynchronous and unsuitable for same-tick control-plane state

For `bots/basic`, we need a clear state-placement policy that preserves correctness after global resets without paying unnecessary persistence cost on every tick.

This decision is intentionally scoped to `bots/basic`. Future bots or later-game architectures can revisit it with a separate ADR if their workload differs materially.

## Decision

For `bots/basic`, we will place runtime data according to these rules:

- `Memory` is the durable source of truth for small, authoritative control-plane state that must survive global reset.
- Heap is the default location for derived, performance-oriented caches that are safe to lose on global reset.
- `RawMemory.segments` are for durable but bulky or cold data that can tolerate asynchronous loading.
- We will not persist data that is cheap to recompute, highly volatile, or only relevant to the current tick.

More specifically:

- Store creep role and assignment, colony mode, site manifest, and compact health checkpoints in `Memory`.
- Store route caches, cost matrices, parsed indexes, memoized selectors, and short rolling metric windows in heap.
- Store bulky telemetry or debug payloads in `RawMemory.segments` when they need to remain in-game across resets.
- Recompute current spawn demand, current source deficits, current sink priorities, and other tick-local planner outputs each tick instead of persisting them.

We will also follow these constraints:

- Losing heap on a global reset may reduce performance temporarily, but must not make the bot incorrect.
- Live `Game` objects must never be stored across ticks.
- Heap invalidation will be driven by warm-runtime changes in world state, durable state, age, or observed cache failure.
- We will not add code-version-based heap invalidation because code changes already trigger global reset and wipe heap.

## Why

- `bots/basic` needs durable control-plane state after global reset so it can immediately resume correct staffing, planning, and health evaluation.
- The early economy architecture will repeatedly use derived pathing and planner data that is more efficient to keep in heap than to serialize through `Memory` each tick.
- `RawMemory.segments` are a better fit for bulky telemetry and cold artifacts than main `Memory`, but their asynchronous loading makes them a poor fit for hot decision state.
- The project already treats harness output as the source of truth for outcome metrics and bot telemetry as the source of truth for internal state, so the bot itself only needs compact persistent checkpoints.
- This policy keeps the bot reset-safe while preserving room to optimize CPU-heavy parts of the economy loop.

## Consequences

### Positive

- `bots/basic` can recover correctly from global resets without rebuilding essential control-plane state from scratch.
- Heap can be used aggressively for performance-sensitive derived data without promoting it to source-of-truth status.
- `Memory` stays smaller and more focused on durable state that actually needs to survive reset.
- Telemetry and debug payloads can grow without pressuring the hot control-plane state in `Memory`.
- Module health tracking can use a hybrid approach: fast rolling windows in heap plus compact durable checkpoints in `Memory`.

### Negative

- Cold-reset ticks may be slower while heap caches warm back up.
- Developers must decide deliberately whether a new data structure is authoritative or merely cached.
- Hybrid state such as health windows plus checkpoints is slightly more complex than putting everything in one store.
- Some large in-game artifacts may require segment activation and manifest management if we choose to persist them.

## Alternatives Considered

### Store most planner and cache state in `Memory`

Rejected because it would increase serialization cost and encourage durable storage of data that is only valuable as a warm-runtime optimization.

### Treat heap as the primary source of truth

Rejected because global reset would then risk semantic breakage rather than only temporary performance degradation.

### Avoid heap caches and recompute everything every tick

Rejected because it would leave obvious CPU savings on the table for pathing, indexing, and rolling module-health calculations.

### Use `RawMemory.segments` for control-plane state

Rejected because segment availability is asynchronous and therefore a poor fit for state that must be available immediately after reset or on every planning tick.
