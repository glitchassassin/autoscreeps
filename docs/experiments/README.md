# Running Experiments

Use `tools/autoscreeps-cli` to run local Screeps experiments against the Docker-based private server.

## Before You Start

- Follow the stack prerequisites in `docs/ops/private-server.md`
- Install the CLI dependencies:

```sh
nvm use
cd tools/autoscreeps-cli
npm install
```

## Run The Sample Duel

This compares the committed `main` version of `bots/basic` against the current workspace version of the same package:

```sh
nvm use
cd tools/autoscreeps-cli
node src/cli.ts experiment run duel \
  --scenario ../../experiments/scenarios/duel-basic.yaml \
  --baseline-source git:main \
  --baseline-package bots/basic \
  --candidate-source workspace \
  --candidate-package bots/basic
```

The sample scenario generates a local map file by fetching a random `1x1` map from `maps.screepspl.us`, placing one copy on the `W` side and one on the `E` side, using `W0` and `E0` as the two separating highway columns, walling the touching room edges, and assigning one matching controller room to each bot.

By default the runner picks a room with:

- a controller
- exactly two sources
- the highest plains-tile count among matching rooms

If there is a tie, it breaks that tie by preferring the more central room and then the lexicographically earlier room name. The mirrored sector always uses the corresponding room from the other side.

You can override the generated-map room picker in the scenario:

```yaml
mapGenerator:
  type: mirrored-random-1x1
  roomSelectionStrategy:
    type: center-most-controller
```

Each run also creates a spectator login for monitoring the world in the browser client:

- username: `spectator`
- password: `passw0rd`

The runner gives that account a preset badge, marks it as banned, and uses the admin-utils spawn whitelist so only the experiment users can claim rooms.

## Configure Early Termination

Scenarios can declare terminal conditions under `run.terminalConditions`.

```yaml
run:
  tickDuration: 250
  maxTicks: 2000
  pollIntervalMs: 1000
  maxWallClockMs: 900000
  maxStalledPolls: 60
  terminalConditions:
    win:
      - type: any-owned-controller-level-at-least
        level: 2
    fail:
      - type: no-owned-controllers
```

- `any-owned-controller-level-at-least` matches when a bot owns any controller at or above the requested RCL.
- `no-owned-controllers` matches when a bot no longer owns any controllers.
- The runner only stops early after every bot has reached a terminal outcome.
- If `maxTicks` is reached first, any bot without a terminal outcome is recorded as `timed_out`.

Recorded runs persist the configured terminal conditions and termination reason in `run.json`, and persist each bot's terminal outcome alongside final world metrics in `metrics.json`.

## Inspect Results

- List recorded runs:

```sh
nvm use
cd tools/autoscreeps-cli
node src/cli.ts experiment list
```

- Show one recorded run:

```sh
nvm use
cd tools/autoscreeps-cli
node src/cli.ts experiment show <run-id>
```

- Watch the newest run and auto-switch if a newer run begins:

```sh
nvm use
cd tools/autoscreeps-cli
node src/cli.ts experiment watch
```

- Watch one specific run without auto-switching:

```sh
nvm use
cd tools/autoscreeps-cli
node src/cli.ts experiment watch <run-id>
```

Run history is written to `.autoscreeps/runs/` at the repository root.

## Change The Compared Bots

Each side of the duel has two inputs:

- `--*-source`: `workspace` or `git:<ref>`
- `--*-package`: repo-relative package path, such as `bots/basic`

That lets you compare:

- `git:main` vs `workspace`
- two different git refs
- two different bot package paths
