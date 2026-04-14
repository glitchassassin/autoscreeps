# Basic Screeps Bot

This subproject is a very basic Screeps bot based on the TypeScript Starter Kit shape, but built with Vite and tested with Vitest.

## What is included

- `src/main.ts` exports the Screeps `loop` entry point.
- `src/core/`, `src/world/`, `src/state/`, `src/planning/`, `src/execution/`, and `src/telemetry/` split the bot into explicit pipeline stages.
- `src/execution/roles/` contains the current creep role behavior.
- `vitest` covers memory cleanup and spawn planning.
- `vite.config.ts` can build only, or build and upload to the local private server.

## Setup

Install dependencies:

```sh
npm install
```

Copy the sample deploy config and fill in your private-server credentials:

```sh
cp screeps.sample.json screeps.json
```

The included sample targets the local private server at `http://127.0.0.1:21025`.

## Scripts

- `npm run build` - bundle the bot into `dist/main.js`
- `npm run watch` - rebuild on file changes
- `npm run test` - run Vitest once
- `npm run test:watch` - run Vitest in watch mode
- `npm run typecheck` - run TypeScript checks
- `npm run push:pserver` - build and upload to the `pserver` target in `screeps.json`
- `npm run watch:pserver` - rebuild and re-upload on changes

## Private server notes

This upload flow expects `screepsmod-auth` to be enabled on the server, which is already true in this repository's `config.yml`.
