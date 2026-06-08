# Pastey

Pastey is a small Jolt app prototype for public and encrypted pastes.

It is intentionally separate from the Jolt protocol repo. Pastey talks to a
local Jolt daemon through a scoped app session and uses `.jolt` paths under
`/pastes`.

## Run as a Desktop App

Pastey is desktop-first. Run Jolt Console first and let it start the local Jolt
daemon. Pastey does not own the daemon lifecycle; it connects to the local daemon
and asks Jolt Console for scoped `/pastes/*` permission.

Build the desktop app:

```sh
cd ../jolt-apps/pastey
npm install
npm run desktop:build
```

The Linux AppImage is written to:

```text
src-tauri/target/release/bundle/appimage/Pastey_0.1.0_amd64.AppImage
```

Launch it while Jolt Console is running, then approve Pastey's app session
request in Jolt Console.

For desktop development:

```sh
npm run desktop:dev
```

To target a non-default daemon port:

```sh
JOLT_DAEMON_URL=http://127.0.0.1:9864 npm run desktop:dev
```

## Web Dev Fallback

The Vite web app remains useful for development:

```sh
npm run dev
```

Open:

```text
http://127.0.0.1:5174
```

In web dev mode the Vite proxy forwards:

- `/jolt-api/*` to `http://127.0.0.1:9862/app/v1/*`
- `/jolt-daemon/status` to `http://127.0.0.1:9862/api/v1/status`

Pastey uses the daemon status endpoint only to discover the local identity for
the initial session request. Publishing, encrypted publishing, decrypting,
listing, resolving, fetching, and pinning use bearer-token app APIs.

To target a different daemon port:

```sh
VITE_JOLT_DAEMON_URL=http://127.0.0.1:9864 npm run dev
```

## Private Paste Demo

Card 053 can be verified with three local identities:

1. Start Alice, Bob, and Carol daemons with separate data directories and API
   ports.
2. Start one Pastey client per daemon, for example:

   ```sh
   JOLT_DAEMON_URL=http://127.0.0.1:9862 npm run desktop:dev
   JOLT_DAEMON_URL=http://127.0.0.1:9864 npm run desktop:dev
   JOLT_DAEMON_URL=http://127.0.0.1:9866 npm run desktop:dev
   ```

   The Vite fallback can also be used with separate ports:

   ```sh
   VITE_JOLT_DAEMON_URL=http://127.0.0.1:9862 npm run dev -- --port 5174
   VITE_JOLT_DAEMON_URL=http://127.0.0.1:9864 npm run dev -- --port 5175
   VITE_JOLT_DAEMON_URL=http://127.0.0.1:9866 npm run dev -- --port 5176
   ```

3. Approve each Pastey session in Jolt Console.
4. In Bob's Pastey, copy Bob's local identity address.
5. In Alice's Pastey, choose `Encrypted`, paste Bob's `.jolt` identity into
   recipients, write a paste, and publish it.
6. Open Alice's paste address in Bob's Pastey with `Encrypted` selected. Bob
   should read the plaintext.
7. Open the same address in Carol's Pastey with `Encrypted` selected. Carol
   should fetch ciphertext but see a decryption failure.

Relays and caches only handle encrypted object bytes; plaintext is returned by
the local daemon only after capability and recipient-key checks pass.

## Current Scope

Supported:

- show local daemon status
- request and use a scoped app session
- publish text under `/pastes/{slug}`
- publish encrypted text under `/pastes/{slug}` for recipient `.jolt` identities
- list local published paste paths
- fetch by `.jolt` address or CID
- decrypt encrypted paste addresses through the local daemon
- pin local paste content to the configured home relay

Not yet supported:

- editing recipient access after publish
- local key management UI

Pinning is optional. Publishing, opening public pastes, and opening private
pastes do not require a home relay. If a home relay is configured in Jolt, Pastey
can ask Jolt to pin local paste content for availability.
