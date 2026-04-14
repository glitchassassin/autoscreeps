---
name: screeps-runtime-state-placement
description: Decide whether Screeps bot data should live in heap, Memory, segments, or nowhere. Use when designing or reviewing persistence, caching, telemetry, route caches, health state, or performance-sensitive planning in a Screeps bot.
---

# Screeps Runtime State Placement

Treat state placement as a correctness-and-cost decision.

## Decision

- Use `Memory` as the durable source of truth.
- Use heap for fast, derived, reset-safe caches.
- Use `segments` for durable but bulky or cold data that can tolerate async loading.
- Do not persist data that is cheap, volatile, or tied only to the current tick.
- Losing heap on a global reset may hurt CPU, but must not make the bot incorrect.

## Decision Flow

1. If losing the data on a global reset would make the bot incorrect, do not store it only in heap.
2. If the data must be available on the first tick after reset, store it in `Memory`.
3. If the data is too large or too cold for `Memory`, and one-tick-later availability is acceptable, store it in `segments`.
4. If the data is derived, expensive to recompute, frequently used, and safe to lose on reset, store it in heap.
5. If the data is cheap and volatile, do not persist it.
6. Never persist live `Game` objects across ticks.

## Heap Cache Invalidation

Invalidate heap caches only during warm runtime when:

- the observed world changed
- the durable state changed
- the cache aged out
- the cache proved itself wrong

Do not add code-version invalidation. A code change already causes a global reset and wipes heap.

## Specific Examples

- `Route from source site W1N1:sourceA to the room energy sink`
  - If we lose it on a global reset, is the bot incorrect? No.
  - Must it be available on the first tick after reset? No.
  - Is it derived, somewhat expensive to compute, frequently used, and safe to lose? Yes.
  - Decision: store it in heap.

- `Creep assignment for worker-123: role=miner, siteId=local-source-A, homeRoom=W1N1`
  - If we lose it on a global reset, is the bot incorrect? Potentially yes.
  - Must it be available on the first tick after reset? Yes.
  - Is it small and hot? Yes.
  - Decision: store it in `Memory`.

- `Telemetry snapshot for tick 2500 with per-site health details`
  - If we lose it on a global reset, is the bot incorrect? No.
  - Must it be available on the first tick after reset? No.
  - Is it durable and potentially bulky? Yes.
  - Can it tolerate async loading? Yes.
  - Decision: store it in `segments`.

- `Current spawn demand summary for this tick`
  - If we lose it on a global reset, is the bot incorrect? No.
  - Must it survive reset? No.
  - Is it cheap and highly volatile? Yes.
  - Decision: do not persist it. Recompute it every tick.

## Anti-Rules

- Do not store live `Game` objects in heap across ticks.
- Do not use `segments` for same-tick control-plane state.
- Do not use `Memory` for bulky derived caches.
- Do not persist values that can be cheaply recomputed from current world state each tick.
