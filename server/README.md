# The lobby server (Cloudflare)

This folder is the game's **online lobby server**: a small program that runs
on Cloudflare's network and passes the players' positions to each other. It
is not part of the game that players download — nothing in `server/` is served
to a browser, and it is not in the offline cache (`sw.js`).

Today the game's multiplayer works tab-to-tab (WebRTC through the free PeerJS
server). That is fine on one Wi-Fi, but between a school network and a home
network it often cannot connect at all, and one player's browser has to be
"the host". This server fixes both: every player opens one ordinary secure
WebSocket (port 443, the same as any website) to a room that lives on
Cloudflare, and the room relays. When the server is not set up, or cannot be
reached, the game falls back to the tab-to-tab way by itself — nothing breaks.

## What it costs

Nothing, for a class. Cloudflare's **free plan** includes Workers (100,000
requests a day), Durable Objects with SQLite storage, and WebSockets, which is
everything this uses. A lobby of eight players flying for an hour is a few
hundred requests. No card is needed for the free plan.

## Setting it up — for the owner's dad (about 15 minutes, once)

Claude never does any of this: it needs your login, and no key or account id
ever goes into the repository. You will need **Node.js** on your Mac (you
already have it: `/opt/homebrew/bin/node`) and a free Cloudflare account.

### Option A — from the terminal (simplest)

1. **Make a free Cloudflare account** at https://dash.cloudflare.com/sign-up
   (email + password; no card). Verify the email.
2. **Open a terminal in this folder:**
   ```sh
   cd ~/Desktop/island-flight-sim/server
   ```
3. **Log in** — this opens your browser to approve, and stores the login on
   your Mac only (nothing is written into the repo):
   ```sh
   npx wrangler login
   ```
   (`npx` downloads wrangler, Cloudflare's command-line tool, into a cache the
   first time. Say yes when it asks.)
4. **Deploy:**
   ```sh
   npx wrangler deploy
   ```
   The first run may ask you to enable Workers / pick a `workers.dev`
   subdomain — accept the defaults. At the end it prints the address, like
   ```
   https://island-lobby.<your-subdomain>.workers.dev
   ```
   That is the lobby URL. Open `<that address>/health` in a browser: you
   should see `{"ok":true,...}`.
5. **Tell the game the address.** Open
   `src/features/multiplayer/config.js` and set
   ```js
   export const LOBBY_SERVER_URL = 'https://island-lobby.<your-subdomain>.workers.dev';
   ```
   Commit and push the game as usual. That is the only line in the game that
   knows about the server, and it is a public address, not a secret.

To update the server later (after a `git pull`), repeat step 4.

### Option B — connect the GitHub repository (deploys by itself on push)

1. Same account as above. In the Cloudflare dashboard go to **Workers &
   Pages → Create → Workers → Import a repository**, and connect GitHub
   (Cloudflare asks GitHub for permission; approve it for this repository).
2. Pick the `island-flight-sim` repository and the branch you deploy from.
3. Set the **root directory** to `server` (the build/deploy command can stay
   `npx wrangler deploy`). Cloudflare reads `wrangler.toml` from there.
4. Save and deploy. The address is shown on the Worker's page; put it in
   `config.js` as in step 5 above.

From then on every push to that branch redeploys the server.

### Checking it works

- `https://<address>/health` → `{"ok":true,"v":4,"max":16,...}`
- `https://<address>/lobbies` → `[]` (empty until somebody is in a lobby)
- In the game: Multiplayer → the **World lobbies** row says "Over Cloudflare"
  instead of "Over the internet" when the server is being used.

### Settings you can change (no code)

All in `wrangler.toml` under `[vars]`, then `npx wrangler deploy` again:

| setting | default | what it is |
| --- | --- | --- |
| `MAX_PLAYERS` | 16 | the room's own cap. The game's current protocol has seats for 7 besides the (absent) host; the smaller number applies. |
| `TICK_HZ` | 15 | how often positions go out to each player |
| `SPEED_CAP_MPS` | 900 | a position update faster than this is not believed |
| `CONNECTS_PER_MIN` | 120 | joins a minute from one address. A whole classroom is one address (the school's), so this is a class's worth. |
| `LIST_PER_MIN` | 600 | lobby-list reads a minute from one address (each tab on the lobby screen reads it every 4 s: thirty tabs) |
| `ALLOWED_ORIGIN` | `*` | set to the game's address (e.g. `https://bnaunidh.github.io`) to stop other sites reading the list |

## What the server does, in one breath

Rooms (`Lobby` Durable Objects, one per lobby id) accept WebSockets, check each
player's `hello` (protocol version, a username from the game's lists, not
kicked), give them a seat, and relay everybody's position snapshots to
everybody else at a capped tick, bundled — dropping any snapshot that claims
to be outside the world, faster than any aeroplane in the hangar, or a jump
nothing could have flown (a respawn after a crash is recognised and let
through). Chat is the game's preset lines by index; anything with free text
goes through `filter.js` first. Events and snapshots are rate-limited; a
socket that keeps tripping the limits is closed and its key kept out for ten
minutes (strikes wear off, so a lot of crashing is never "keeps tripping"; an
address kicked three times inside those ten minutes is kept out too). A `Directory` object keeps the lobby list that `/lobbies` serves.
There is no host, so no player can be the host that leaves — and no host-only
features (the races, PvP hits — they are a claim the host judges —, the host's
AI traffic, admin powers) run in a cloud lobby this round.

## Testing without Cloudflare

```sh
node tests/features/cf-lobby.mjs
```
runs the same `worker.js` and `lobby.js` under a node stand-in for the
Durable Object runtime (`tests/features/cf-lobby.fakes.js`): joins, relay
and bundling at the tick, the caps, the sanity checks, the chat filter, the
rate limits, the lobby list, and the game's own client falling back to
tab-to-tab when the server is away. Nothing is installed.

## Privacy

The server sees each player's IP address (as any website does), their chosen
call sign from the lists, their colour, and their aeroplane's position. It
stores none of it beyond the moment (a kicked player's key and address are
held in memory for the ten minutes they are kept out): the Directory keeps head-counts, not
names; there are no logs of positions or chat. No account, email or real name
is ever sent to it — the game has none.
