# ADR 0002: Browser Client for Manual Review

- Status: Accepted
- Date: 2026-03-26

## Context

We want a convenient way to manually inspect the private server during development runs, scenario setup, and post-run analysis.

The native Screeps client has known performance and stability issues, especially on macOS, and it is awkward to include in a reproducible Docker-based local stack.

## Decision

We will add a browser-based manual review client to the Docker Compose stack using `screepers-steamless-client`.

The service will:

- run in its own container
- run `screepers-steamless-client` via `npx` from a standard Node container
- mount the local Screeps `package.nw` bundle from a host path configured with `SCREEPS_PACKAGE_NW_PATH`
- expose the client on port `8080`
- bind directly to `0.0.0.0` inside the container without `socat` or similar forwarding

## Why

- It avoids relying on the native Screeps desktop client for routine manual inspection.
- It works around performance and stability issues in the native client.
- It fits our Docker-first local development model better than a manually managed desktop app.
- It still uses the official client assets from a real Screeps installation.
- The Screepers fork is more up to date than the older npm package line and supports direct host binding in containers.
- Using `npx` keeps the stack simpler by removing the need for a custom client image and Dockerfile.
- It gives us a lightweight manual review path while we build automation and observability tooling.

## Consequences

### Positive

- Manual review becomes easier on machines where the native client performs poorly.
- The client is part of the same local stack as the server.
- We can open the server in a regular browser instead of a dedicated desktop wrapper.
- The container setup stays simple because it no longer needs a loopback forwarding shim or a custom image build.

### Negative

- The service still depends on assets from a local Steam Screeps install.
- The client container needs a host mount to `package.nw`.
- This is primarily a manual review tool, not part of the automated experiment loop.

## Alternatives Considered

### Native Screeps client

Rejected for routine use because of performance and stability problems, especially on macOS.

### Older `screeps-steamless-client` package line

Rejected for this stack because the older line required extra forwarding inside the container, while `screepers-steamless-client` supports direct host binding and is more actively maintained.

### No manual client in the stack

Rejected because browser-based manual inspection is useful for scenario debugging and validating instrumentation.
