# Private Server Ops

This stack runs the local Screeps server, MongoDB, Redis, and a browser-based manual review client. Use `docker compose` to manage the stack.

## Prerequisites

- Docker with `docker compose`
- A local `.env` file based on `.env.sample`
- A valid Steam Web API key in `STEAM_KEY`
- A valid local Screeps `package.nw` path in `SCREEPS_PACKAGE_NW_PATH`

## Reset The Stack

To wipe the local world state and service volumes:

```sh
docker compose down -v
```

This removes MongoDB, Redis, Screeps server data, and the cached npm packages used by the browser client.

## Service URLs

- Private server: `http://localhost:21025`
- CLI port: `localhost:21026`
- Browser client: `http://localhost:8080/(http://localhost:21025)/`

The trailing `/` in the browser client URL is required.

## Login Notes

- The stack enables `screepsmod-auth`, so the private server supports username/password auth.
- The browser client uses the Steam Screeps client assets from your local `package.nw`.
- The client runs with `--internal_backend http://screeps:21025`, so browser URLs can keep using `http://localhost:21025` while the client container resolves the Screeps server by its Docker hostname internally.
- If you need a Steam Web API key, get it from `https://steamcommunity.com/dev/apikey`.

## First Checks

- Open `http://localhost:21025` and confirm it redirects to `/web`
- Open `http://localhost:8080/(http://localhost:21025)/` and confirm the browser client loads
- Run `docker compose ps` and confirm `screeps`, `mongo`, `redis`, and `client` are up
