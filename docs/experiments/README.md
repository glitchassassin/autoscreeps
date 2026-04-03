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

The sample scenario imports `random_1x2`, assigns `E2N2` to `baseline`, and assigns `E3N2` to `candidate`.

## Run A Mirrored Random 1x1 Duel

This generates a local map file by fetching a random `1x1` map from `maps.screepspl.us`, placing one copy on the `W` side and one on the `E` side, using `W0` and `E0` as the two separating highway columns, walling the touching room edges, and assigning one matching controller room to each bot.

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

```sh
nvm use
cd tools/autoscreeps-cli
node src/cli.ts experiment run duel \
  --scenario ../../experiments/scenarios/duel-mirrored-random-1x1.yaml \
  --baseline-source git:main \
  --baseline-package bots/basic \
  --candidate-source workspace \
  --candidate-package bots/basic
```

Each run also creates a spectator login for monitoring the world in the browser client:

- username: `spectator`
- password: `passw0rd`

The runner gives that account a preset badge, marks it as banned, and uses the admin-utils spawn whitelist so only the experiment users can claim rooms.

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

Run history is written to `.autoscreeps/runs/` at the repository root.

## Change The Compared Bots

Each side of the duel has two inputs:

- `--*-source`: `workspace` or `git:<ref>`
- `--*-package`: repo-relative package path, such as `bots/basic`

That lets you compare:

- `git:main` vs `workspace`
- two different git refs
- two different bot package paths
