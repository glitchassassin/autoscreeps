# ADR 0001: Private Server Architecture

- Status: Accepted
- Date: 2026-03-26

## Context

This project needs a local Screeps private server that AI agents can reset, instrument, and run repeatedly while comparing bot variants. The stack needs to support custom mods, scripted experiments, persistent state when useful, and fast full-environment teardown when we want a fresh world.

We also want a setup that is easy to automate from the repository itself instead of relying on a manually prepared host installation.

## Decision

We will run the private server as a Docker Compose stack based on Jomik's `screeps-server` image.

The stack will use:

- `ghcr.io/jomik/screeps-server` for the Screeps server runtime
- MongoDB for durable game-state storage via `screepsmod-mongo`
- Redis for pubsub, transient runtime state, intents, and coordination used by the private server ecosystem
- `screepsmod-auth` for username/password authentication to the local server
- `screepsmod-admin-utils` for server administration, map import, tick control, and baseline observability endpoints

We will keep the Screeps server, MongoDB, and Redis in separate containers and persist their data with Docker volumes.

## Why

- Jomik's server image matches our automation goals: installation happens at image build time and server startup stays focused on launching the server with the configured mods.
- MongoDB and Redis are the best-supported storage architecture for serious private-server work in the existing Screeps mod ecosystem.
- `screepsmod-mongo` makes the world state easier to inspect, query, reset, and extend than the default LokiJS storage.
- Redis supports the pubsub and transient coordination patterns already used by the upstream server and community mods.
- `screepsmod-admin-utils` already provides useful primitives for importing maps, controlling tick rate, reading stats, and preparing scenarios.
- Docker Compose gives us a reproducible local environment that can be started, stopped, and fully wiped with predictable commands.

## Consequences

### Positive

- The stack is easy to reproduce on another machine.
- Full resets are straightforward with `docker compose down -v`.
- The server architecture aligns with the extension points and mods we already plan to use.
- MongoDB and Redis give us a better foundation for instrumentation, experiment state, and future orchestration APIs.

### Negative

- The stack is more operationally complex than the default standalone LokiJS setup.
- We now depend on three cooperating services instead of one.
- The chosen image expects a Steam Web API key for startup, even though local auth is provided by mods.

## Alternatives Considered

### Official standalone server with default LokiJS storage

Rejected because it is less suitable for rich observability, external querying, and durable experiment orchestration.

### Host-installed launcher without Docker

Rejected because it is less reproducible and harder to automate cleanly for repeated experiments.

### Custom server image from day one

Rejected for now because Jomik's image already solves the basic packaging problem. We can replace or fork it later if our custom mod workflow needs tighter integration.
