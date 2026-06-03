# Pastey

Pastey is a small Jolt app prototype for public pastes.

It is intentionally separate from the Jolt protocol repo. Pastey talks to a local Jolt daemon through HTTP and uses `.jolt` paths under `/pastes`.

## Run

Start a Jolt daemon first:

```sh
cd ../jolt
cargo run -p jolt-node -- start
```

Then run Pastey:

```sh
cd ../jolt-apps/pastey
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5174
```

By default the Vite proxy forwards `/jolt-api/*` to `http://127.0.0.1:9862/api/v1/*`.

To target a different daemon port:

```sh
VITE_JOLT_DAEMON_URL=http://127.0.0.1:9864 npm run dev
```

## Current Scope

Pastey v0 is public-only because Jolt does not yet implement encrypted access control.

Supported:

- show local daemon status
- publish text under `/pastes/{slug}`
- list local published paste paths
- fetch by `.jolt` address or CID
- pin local paste content to the configured home relay

Not yet supported:

- app sessions
- private encrypted pastes
- sharing with recipient identities
- local key management UI
