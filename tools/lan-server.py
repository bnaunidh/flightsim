#!/usr/bin/env python3
"""
Island Flight Simulator — a LAN server, for multiplayer with no internet.

    python3 tools/lan-server.py            # http://<this Mac>:8807
    python3 tools/lan-server.py 9000       # a different port
    python3 tools/lan-server.py --local    # this computer only (for testing)
    python3 tools/lan-server.py --name="Room 12"   # what the game calls this server
    python3 tools/lan-server.py --world    # stand in for the public server's world lobbies too

Multiplayer normally finds other players through the free public PeerJS
server on the internet. A classroom with Wi-Fi but no internet cannot reach
it, so this does both jobs from one Mac:

  - serves the game over plain http, with caching off — the game's own
    files only: not the notes and prompts at the top of the folder, not
    tools/, no folder listings, no Markdown, nothing starting with a dot;
  - answers /lan/info (POST, or GET by hand), which is how the game knows it was loaded from
    here and should use this computer for matchmaking instead;
  - speaks the same signaling protocol the public server does (OPEN,
    ID-TAKEN, ID-TAKEOVER, OFFER, ANSWER, CANDIDATE, EXPIRE, HEARTBEAT) over a
    WebSocket at /peerjs, written out by hand below — Python ships no
    WebSocket server, and this project installs nothing.

Everybody who opens the address it prints is "on the same Wi-Fi" as far as
the game is concerned, so they all see the same five server slots. The game
itself still talks tab to tab over WebRTC; this server only passes the
introductions along, and it holds no names, no chat and no positions.

It is deliberately as strict as the public server was measured to be (see
src/features/multiplayer/signaling.js): a malformed offer, an empty
candidate or a LEAVE gets the socket closed. A game that works here then
works there.

Zero dependencies. Python 3.8+.
"""

import base64
import hashlib
import json
import os
import socket
import struct
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
PORT = int(ARGS[0]) if ARGS else 8807
OPTS = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
# --local: listen on this computer only. For trying it out, or a test run, without
# putting the game on the Wi-Fi.
BIND = '127.0.0.1' if '--local' in sys.argv[1:] else ''
ROOT = Path(__file__).resolve().parent.parent
WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
MAX_MESSAGE = 64 * 1024
# A socket that has said nothing for this long — not even the heartbeat the game
# sends every five seconds — is a computer that went away without closing it: a
# laptop lid, Wi-Fi gone. Its id is let go, so a lobby it was hosting can be
# claimed by the next player in line (src/features/multiplayer/lobby.js) instead
# of being held until the operating system gives up on the connection.
IDLE_TIMEOUT = 30

# Stable for this computer and port, so a reloaded tab lands on the same five slots.
NET = hashlib.sha256(f'island-flight-lan:lan:{socket.gethostname()}:{PORT}'.encode()).hexdigest()[:12]
# The World lobbies (anyone, anywhere) normally go through the public server on
# the internet. With --world, or --local (a test run on this computer), this
# server stands in for it, so a test never touches the public one.
WORLD = '--world' in sys.argv[1:] or '--local' in sys.argv[1:]
# What the Multiplayer screen says it is on ("On the LAN server"). It used to be
# the Mac's own computer name: "On MossyLog", to every child on the Wi-Fi.
NAME = ''.join(ch for ch in OPTS.get('name', '') if ch.isalnum() or ch in " '-.")[:40].strip() or 'the LAN server'

# What a class needs to play, and nothing else in the folder.
SERVED = {
    'index.html', 'sw.js', 'manifest.webmanifest', 'compare.html',
    'src', 'styles', 'icons', 'assets', 'download', 'gpt', 'tests',
}


class Peer:
    """One signaling socket, holding one id."""

    def __init__(self, sock, peer_id, token):
        self.sock = sock
        self.id = peer_id
        self.token = token
        self.lock = threading.Lock()
        self.open = True

    def send(self, obj):
        data = json.dumps(obj, separators=(',', ':')).encode()
        header = bytearray([0x81])
        n = len(data)
        if n < 126:
            header.append(n)
        elif n < 65536:
            header.append(126)
            header += struct.pack('>H', n)
        else:
            header.append(127)
            header += struct.pack('>Q', n)
        with self.lock:
            if not self.open:
                return False
            try:
                self.sock.sendall(bytes(header) + data)
                return True
            except OSError:
                self.open = False
                return False

    def close(self):
        with self.lock:
            if not self.open:
                return
            self.open = False
            try:
                self.sock.sendall(b'\x88\x02\x03\xe8')  # close, 1000
            except OSError:
                pass
            try:
                self.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


PEERS = {}
PEERS_LOCK = threading.Lock()


def valid(msg):
    """The shapes the public server accepts. Anything else is hung up on."""
    t = msg.get('type')
    if t == 'HEARTBEAT':
        return True
    p = msg.get('payload')
    if not isinstance(p, dict) or not isinstance(msg.get('dst'), str):
        return False
    if t == 'OFFER':
        return all(p.get(k) for k in ('sdp', 'type', 'connectionId', 'label', 'serialization'))
    if t == 'ANSWER':
        return all(p.get(k) for k in ('sdp', 'type', 'connectionId'))
    if t == 'CANDIDATE':
        c = p.get('candidate')
        return isinstance(c, dict) and bool(c.get('candidate')) and bool(p.get('type')) and bool(p.get('connectionId'))
    return False


def read_exact(sock, n):
    buf = b''
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError('closed')
        buf += chunk
    return buf


def read_message(sock):
    """One whole WebSocket message: ('text', str), ('ping', bytes) or ('close', None)."""
    parts = []
    kind = None
    total = 0
    while True:
        b1, b2 = read_exact(sock, 2)
        fin = b1 & 0x80
        opcode = b1 & 0x0F
        masked = b2 & 0x80
        n = b2 & 0x7F
        if n == 126:
            n = struct.unpack('>H', read_exact(sock, 2))[0]
        elif n == 127:
            n = struct.unpack('>Q', read_exact(sock, 8))[0]
        total += n
        # Each frame, and the message they add up to: one client must not make this hold unbounded memory.
        if n > MAX_MESSAGE or total > MAX_MESSAGE:
            return ('close', None)
        mask = read_exact(sock, 4) if masked else b'\x00\x00\x00\x00'
        data = bytearray(read_exact(sock, n))
        for i in range(n):
            data[i] ^= mask[i % 4]
        if opcode == 0x8:
            return ('close', None)
        if opcode == 0x9:
            return ('ping', bytes(data))
        if opcode == 0xA:
            continue
        if opcode in (0x1, 0x2):
            kind = opcode
            parts = [bytes(data)]
        elif opcode == 0x0:
            parts.append(bytes(data))
        if fin:
            if kind != 0x1:
                return ('close', None)
            return ('text', b''.join(parts).decode('utf-8', 'replace'))


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.webmanifest': 'application/manifest+json',
        '.json': 'application/json',
        '.css': 'text/css',
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        if os.environ.get('LAN_SERVER_VERBOSE'):
            super().log_message(fmt, *args)

    def hidden(self, path):
        """
        The folder it serves is a working copy: the dot-folders hold every
        commit's author and message, and the top level has the prompts and
        notes the game was built from. Review found all of it listed for the
        class Wi-Fi. Now only the game's own paths, no Markdown, nothing hidden.
        """
        parts = [p for p in unquote(path).split('/') if p]
        if any(p.startswith('.') for p in parts):
            return True
        if parts and parts[0] not in SERVED:
            return True
        return bool(parts) and parts[-1].lower().endswith('.md')

    def list_directory(self, path):
        # A folder without an index.html is not a page; do not list it.
        self.send_error(404)
        return None

    def do_HEAD(self):
        if self.hidden(urlparse(self.path).path):
            self.send_error(404)
            return
        super().do_HEAD()

    def lan_info(self):
        info = {'lan': True, 'net': NET, 'name': NAME, 'version': 1}
        if WORLD:
            info['world'] = True
        body = json.dumps(info).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        # The game asks with a POST, which its service worker leaves alone (it caches GETs).
        if urlparse(self.path).path == '/lan/info':
            length = int(self.headers.get('Content-Length') or 0)
            if 0 < length <= 4096:
                self.rfile.read(length)
            self.lan_info()
            return
        self.send_error(405)

    def do_GET(self):
        url = urlparse(self.path)
        # These two are this server's own, not files, so they come before the file rules.
        if url.path == '/lan/info':
            self.lan_info()
            return
        if url.path.rstrip('/') == '/peerjs' and self.headers.get('Upgrade', '').lower() == 'websocket':
            self.websocket(parse_qs(url.query))
            return
        if self.hidden(url.path):
            self.send_error(404)
            return
        super().do_GET()

    def websocket(self, query):
        key = self.headers.get('Sec-WebSocket-Key', '')
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        self.close_connection = True
        self.wfile.write(
            (
                'HTTP/1.1 101 Switching Protocols\r\n'
                'Upgrade: websocket\r\n'
                'Connection: Upgrade\r\n'
                f'Sec-WebSocket-Accept: {accept}\r\n\r\n'
            ).encode()
        )
        self.wfile.flush()
        sock = self.connection
        sock.settimeout(IDLE_TIMEOUT)
        peer_id = (query.get('id') or [''])[0]
        token = (query.get('token') or [''])[0]
        api_key = (query.get('key') or [''])[0]
        peer = Peer(sock, peer_id, token)
        if api_key != 'peerjs' or not peer_id or not token or len(peer_id) > 64:
            peer.send({'type': 'ERROR', 'payload': {'msg': 'Invalid key or id'}})
            peer.close()
            return
        old = None
        with PEERS_LOCK:
            held = PEERS.get(peer_id)
            if held and held.token != token:
                peer.send({'type': 'ID-TAKEN', 'payload': {'msg': 'ID is taken'}})
                peer.close()
                return
            old = held
            PEERS[peer_id] = peer
        if old:
            old.send({'type': 'ID-TAKEOVER'})
            old.close()
        peer.send({'type': 'OPEN'})
        try:
            while peer.open:
                kind, data = read_message(sock)
                if kind == 'close':
                    break
                if kind == 'ping':
                    with peer.lock:
                        header = bytes([0x8A, len(data)]) if len(data) < 126 else None
                        if header:
                            sock.sendall(header + data)
                    continue
                try:
                    msg = json.loads(data)
                except ValueError:
                    break
                if not isinstance(msg, dict) or not valid(msg):
                    break
                if msg.get('type') == 'HEARTBEAT':
                    continue
                dst = msg['dst']
                with PEERS_LOCK:
                    target = PEERS.get(dst)
                if target and target.send({'type': msg['type'], 'src': peer_id, 'dst': dst, 'payload': msg['payload']}):
                    continue
                # Nobody holds that id: say so at once, the way the public server does.
                peer.send({'type': 'EXPIRE', 'src': dst, 'dst': peer_id})
        except (ConnectionError, OSError):
            pass
        finally:
            peer.close()
            with PEERS_LOCK:
                if PEERS.get(peer_id) is peer:
                    del PEERS[peer_id]


def lan_addresses():
    """This computer's addresses on the local network. No packet is sent to find them."""
    found = []
    for probe in ('10.255.255.255', '192.168.255.255', '172.31.255.255'):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect((probe, 1))
            ip = s.getsockname()[0]
            if ip and not ip.startswith('127.') and ip not in found:
                found.append(ip)
        except OSError:
            pass
        finally:
            s.close()
    return found


def main():
    try:
        server = ThreadingHTTPServer((BIND, PORT), Handler)
    except OSError as err:
        print(f'Could not use port {PORT} ({err.strerror}). Try another: python3 tools/lan-server.py 9000')
        sys.exit(1)
    server.daemon_threads = True
    addrs = lan_addresses()
    print('Island Flight Simulator — LAN server')
    print(f'  Serving the game from {ROOT}')
    print(f'  On this computer:   http://localhost:{PORT}')
    if BIND:
        print('  (--local: nobody else on the Wi-Fi can reach it.)')
    elif addrs:
        for ip in addrs:
            print(f'  Tell your friends:  http://{ip}:{PORT}')
    else:
        print('  (Could not find this computer\'s Wi-Fi address — check it is connected to the Wi-Fi.)')
    print(f'  The game calls it "{NAME}" (change it with --name="Room 12").')
    print('  Multiplayer uses this computer for matchmaking, so it works with no internet.')
    if WORLD:
        print('  The World lobbies use this computer too (--world/--local), not the public server.')
    print('  Everyone must open the address above (not the website) to see each other.')
    print('  Press Ctrl+C to stop.')
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')


if __name__ == '__main__':
    main()
