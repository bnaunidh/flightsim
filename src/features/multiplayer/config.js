/**
 * Where the game's online lobby server is — the one line the owner edits
 * after deploying server/ (server/README.md).
 *
 * Empty means "there is none": the world lobbies then run tab to tab through
 * the public PeerJS server, as they always have. Set it to the Worker's
 * address, e.g. 'https://island-lobby.<subdomain>.workers.dev', and the
 * world lobbies go through Cloudflare instead — and still fall back to tab
 * to tab, silently, whenever that address does not answer.
 *
 * It is a public address, not a secret. Nothing else about the server (no
 * key, no account) is anywhere in the game.
 *
 * For a test, ?lobby=https://... in the page's address overrides it for that
 * tab — on a copy served from this computer (localhost) only, never on the
 * published game, so nobody can hand players a link to a server of their
 * own (transport.js lobbyServerUrl).
 */
export const LOBBY_SERVER_URL = '';
