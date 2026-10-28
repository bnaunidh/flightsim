"""
Turn a downloaded aircraft model into the game's real-model file.

  python3 tools/real-models/process.py <id> [<id> ...]      (ids from models.py)
  python3 tools/real-models/process.py <id> --view out.png  (also draw the roles)

What it does, in order:
  1. flattens the source file (gltfio.py): every triangle in world space;
  2. drops what the game must not ship or does not need (models.py `drop`:
     ground shadow planes, cartoon eyes, cabin interiors, the source's own
     landing gear and lights -- the game draws its own, and they move);
  3. turns it into the game's axes (-Z forward, +Y up, +X right) and fits it
     to the game's own airframe of that type (ref/<id>.json, written from the
     real roster by ref.mjs): overall length nose to tail, span tip to tip,
     fuselage depth at mid-cabin; nose tip on the game's nose, centreline on
     the game's centreline;
  4. sorts every triangle into a ROLE -- skin_l / skin_r (fuselage, painted
     with the game's own livery at run time), fin, wing, cowl, lip, duct,
     core, glass, window, dark, metal -- from the source's material names
     where they say (models.py `roles`) and from where it sits on the game's
     airframe where they do not;
  5. writes assets/models/real/<id>.glb: one node per role, factors only, NO
     IMAGES. Every texture of the source is thrown away -- the airline and
     maker liveries some of them wear (Lion Air, QantasLink, Qatar...) never
     reach the game; the paint is the game's own parody livery system.

Only reads model and image data; runs nothing from the source files.
"""
import json, os, struct, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from gltfio import flatten  # noqa: E402
from models import MODELS, INBOX  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'models', 'real')

ROLES = ['skin_l', 'skin_r', 'fin', 'wing', 'cowl', 'lip', 'duct', 'core', 'glass', 'window', 'dark', 'metal', 'prop']

ROT = {
    'none': np.eye(3),
    'y180': np.diag([-1.0, 1.0, -1.0]),
    # source: length along +x (nose at +x), up +y  -> nose to -z
    'x+nose': np.array([[0, 0, 1.0], [0, 1.0, 0], [-1.0, 0, 0]]),
    # source: length along x, nose at -x
    'x-nose': np.array([[0, 0, -1.0], [0, 1.0, 0], [1.0, 0, 0]]),
}


def ref_of(i):
    return json.load(open(os.path.join(HERE, 'ref', f'{i}.json')))


class Profile:
    """The game's fuselage section by station: top, bottom, half width, centre."""

    def __init__(self, ref):
        p = np.array(ref['profile'], dtype=np.float64)
        self.z, self.top, self.bot, self.w, self.yc = p.T

    def at(self, z):
        return (np.interp(z, self.z, self.top), np.interp(z, self.z, self.bot), np.interp(z, self.z, self.w))


def slice_depth(parts, xc, zs):
    """Top and bottom of the skin on the centreline (x = xc) at stations zs: the median over them."""
    tops, bots = [], []
    for z0 in zs:
        ys = []
        for q in parts:
            v = q['P'][q['I']]
            x, z = v[:, :, 0] - xc, v[:, :, 2] - z0
            # barycentric of the point (0, 0) in each triangle's xz projection
            d = (x[:, 1] - x[:, 0]) * (z[:, 2] - z[:, 0]) - (x[:, 2] - x[:, 0]) * (z[:, 1] - z[:, 0])
            ok = np.abs(d) > 1e-12
            dd = np.where(ok, d, 1)
            l1 = ((0 - x[:, 0]) * (z[:, 2] - z[:, 0]) - (x[:, 2] - x[:, 0]) * (0 - z[:, 0])) / dd
            l2 = ((x[:, 1] - x[:, 0]) * (0 - z[:, 0]) - (0 - x[:, 0]) * (z[:, 1] - z[:, 0])) / dd
            l0 = 1 - l1 - l2
            hit = ok & (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
            if hit.any():
                y = v[hit, 0, 1] * l0[hit] + v[hit, 1, 1] * l1[hit] + v[hit, 2, 1] * l2[hit]
                ys.append(y)
        if ys:
            ys = np.concatenate(ys)
            tops.append(ys.max())
            bots.append(ys.min())
    if not tops:
        return None, None
    return float(np.median(tops)), float(np.median(bots))


def refine_engines(parts, seeds, cfg, log):
    """Each engine where the source actually drew it.

    Seeded at the game's engine, then measured off the source's own nacelle:
    its width and its bottom from the lower half (the wing and pylon are
    above it, so they cannot widen it), its front and back from what lies
    inside that radius. The game's engine stays the seed if nothing is found.
    """
    allc = []
    for q in parts:
        v = q['P'][q['I']]
        allc.append(v.mean(1))
    C = np.concatenate(allc) if allc else np.zeros((0, 3))
    V = np.concatenate([q['P'] for q in parts])
    out = []
    for e in seeds:
        R, L = e['radius'], e['length']
        zf, za = e['z'] - L / 2, e['z'] + L / 2
        if e.get('kind') == 'prop':
            # a turboprop's z is its propeller's plane; the nacelle runs aft of it (fleet/aircraft-core.js)
            zf, za = e['z'], e['z'] + L
        e2 = dict(e, zf=zf, za=za)
        if e.get('kind') == 'prop':
            e2['prop'] = e.get('propRadius', R * 3)
        if cfg.get('refineEngines', True):
            box = (np.abs(V[:, 0] - e['x']) < 2.0 * R) & (V[:, 1] < e['y'] + 0.25 * R) & (V[:, 1] > e['y'] - 2.0 * R) \
                & (V[:, 2] > zf - 0.25 * L) & (V[:, 2] < za + 0.1 * L)
            if e.get('kind') == 'prop':
                box &= V[:, 2] > zf + 0.3  # behind the propeller disc
            pts = V[box]
            if len(pts) > 20:
                x0, x1 = np.percentile(pts[:, 0], [1, 99])
                Rm = (x1 - x0) / 2
                if 0.5 * R < Rm < 1.6 * R:
                    cx = (x0 + x1) / 2
                    cy = np.percentile(pts[:, 1], 1) + Rm
                    near = (np.hypot(V[:, 0] - cx, V[:, 1] - cy) < Rm * 1.02) & (V[:, 1] < cy - 0.15 * Rm) & (V[:, 2] > zf - 0.6 * L) & (V[:, 2] < za + 0.6 * L)
                    zs = V[near, 2]
                    if len(zs) > 20:
                        zf2 = float(np.percentile(zs, 0.5))
                        za2 = min(float(np.percentile(zs, 99.5)), zf2 + cfg.get('engLen', 1.6) * L)
                        e2.update(x=float(cx), y=float(cy), radius=float(Rm), zf=zf2, za=za2)
        log.append(f"engine {e['id']}: x {e2['x']:.2f} y {e2['y']:.2f} r {e2['radius']:.2f} z {e2['zf']:.1f}..{e2['za']:.1f} (game x {e['x']} y {e['y']} r {e['radius']} z {zf:.1f}..{za:.1f})")
        out.append(e2)
    return out


def components(P, I):
    """Connected pieces of a mesh (vertices welded by position): a label per triangle."""
    key = np.round(P / 1e-4).astype(np.int64)
    _, weld = np.unique(key, axis=0, return_inverse=True)
    weld = weld.reshape(-1)
    parent = np.arange(weld.max() + 1)

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for a_, b_, c_ in weld[I]:
        ra, rb, rc = find(a_), find(b_), find(c_)
        parent[rb] = ra
        parent[find(rc)] = ra
    roots = np.array([find(x) for x in range(len(parent))])
    return roots[weld[I[:, 0]]]


def _in_box(lo, hi, box, absx):
    """A piece's bounds (lo, hi) inside box (x0, x1, y0, y1, z0, z1); absx: |x| (a piece across the centreline from 0)."""
    x0, x1 = lo[0], hi[0]
    if absx:
        x0, x1 = (0.0 if lo[0] < 0 < hi[0] else min(abs(lo[0]), abs(hi[0]))), max(abs(lo[0]), abs(hi[0]))
    b = box
    return x0 >= b[0] and x1 <= b[1] and lo[1] >= b[2] and hi[1] <= b[3] and lo[2] >= b[4] and hi[2] <= b[5]


def select_pieces(parts, rule):
    """[(part index, triangle mask, side)] of the connected pieces wholly inside rule['box'] (source axes, after rot).
    rule: box, absX (default True: both sides), maxW (widest a piece may be across x)."""
    out = []
    for k, q in enumerate(parts):
        if rule.get('mats') and q['mat'] not in rule['mats']:
            continue
        if 'lab' not in q:
            q['lab'] = components(q['P'], q['I'])
        lab = q['lab']
        v = q['P'][q['I']]
        ul, inv = np.unique(lab, return_inverse=True)
        lo = np.full((len(ul), 3), 1e9)
        hi = np.full((len(ul), 3), -1e9)
        np.minimum.at(lo, inv, v.min(1))
        np.maximum.at(hi, inv, v.max(1))
        for i in range(len(ul)):
            if rule.get('maxW') and hi[i, 0] - lo[i, 0] > rule['maxW']:
                continue
            if _in_box(lo[i], hi[i], rule['box'], rule.get('absX', True)):
                out.append((k, inv == i, 1 if lo[i, 0] + hi[i, 0] >= 0 else -1))
    return out


def drop_pieces(parts, rules, log):
    """models.py `dropPieces`: whole connected pieces inside a box are left out (the source's pylons and racks)."""
    n = 0
    for rule in rules:
        gone = {}
        for k, m, _ in select_pieces(parts, rule):
            gone[k] = gone[k] | m if k in gone else m
        for k, m in gone.items():
            q = parts[k]
            q['I'] = q['I'][~m]
            q['lab'] = q['lab'][~m]
            n += int(m.sum())
    if n:
        log.append(f'dropped pieces: {n} triangles')


def _rotate(P, p0, u, phi):
    """Rodrigues: P rotated by phi about the axis through p0 along unit u."""
    v = P - p0
    c, s = np.cos(phi), np.sin(phi)
    return p0 + v * c + np.cross(u, v) * s + u[None, :] * (v @ u)[:, None] * (1 - c)


def _section(V, x):
    """Where triangles V (n, 3, 3) cross the plane at this x: the crossing points (m, 3) and their segment midpoints/lengths."""
    d = V[:, :, 0] - x
    cross = (d.max(1) > 0) & (d.min(1) < 0)
    pts, mids, lens = [], [], []
    for t in np.where(cross)[0]:
        q = []
        for i in range(3):
            k = (i + 1) % 3
            if (d[t, i] > 0) != (d[t, k] > 0):
                q.append(V[t, i] + (V[t, k] - V[t, i]) * (d[t, i] / (d[t, i] - d[t, k])))
        if len(q) == 2:
            pts += q
            mids.append((q[0] + q[1]) / 2)
            lens.append(np.linalg.norm(q[1] - q[0]))
    if not pts:
        return np.zeros((0, 3)), np.zeros((0, 3)), np.zeros(0)
    return np.array(pts), np.array(mids), np.array(lens)


def straighten_hinges(parts, rules, log):
    """models.py `hinges`: control surfaces the source drew deflected (the A-10's flaps,
    split ailerons and elevators all hang down), turned back to neutral.

    Each rule picks the pieces of one surface (wholly inside its box, each side on
    its own). Cut across at three stations along the span: the hinge is the nose of
    the surface's section (its front-most points), the axis is fitted through the
    three, and the chord to put it back on runs from the leading edge of the
    surface ahead (searched in rule['le'] = (z0, z1)) to the hinge. Every piece
    that spans most of the surface turns until its own section's centre lies on
    that chord (a split aileron's two halves together, the nose box on its own);
    the small ones (horns, fairings, end caps) turn with the biggest; plus
    rule['trim'] degrees."""
    for rule in rules:
        sel = select_pieces(parts, rule)
        trim = np.radians(rule.get('trim', 0.0))
        for side in (-1, 1):
            grp = [(k, m) for k, m, s in sel if s == side]
            if not grp:
                continue
            tris = [parts[k]['P'][parts[k]['I'][m]] for k, m in grp]
            spans = [np.ptp(t[:, :, 0]) for t in tris]
            big = [i for i, sp in enumerate(spans) if sp >= 0.5 * max(spans)]
            allT = np.concatenate([tris[i] for i in big])
            x0, x1 = allT[:, :, 0].min(), allT[:, :, 0].max()
            piv, wants = [], []
            for f in (0.25, 0.5, 0.75):
                xs = x0 + (x1 - x0) * f
                pts, _, _ = _section(allT, xs)
                if len(pts) < 3:
                    continue
                zf = pts[:, 2].min()
                nose = pts[pts[:, 2] < zf + 0.06]
                p = np.array([xs, nose[:, 1].mean(), zf + 0.5 * min(0.1, np.ptp(nose[:, 1]))])
                # the leading edge of what is ahead, at this station
                le = None
                for k, q in enumerate(parts):
                    mk = np.ones(len(q['I']), bool)
                    for k2, m2 in grp:
                        if k2 == k:
                            mk &= ~m2
                    if not mk.any():
                        continue
                    T = q['P'][q['I'][mk]]
                    T = T[(T[:, :, 0].min(1) < xs) & (T[:, :, 0].max(1) > xs)]
                    if not len(T):
                        continue
                    sp, _, _ = _section(T, xs)
                    sp = sp[(sp[:, 2] > rule['le'][0]) & (sp[:, 2] < rule['le'][1]) & (np.abs(sp[:, 1] - p[1]) < 0.5)]
                    if len(sp) and (le is None or sp[:, 2].min() < le[2]):
                        le = sp[np.argmin(sp[:, 2])]
                piv.append(p)
                if le is not None:
                    wants.append(np.arctan2(p[1] - le[1], p[2] - le[2]))
            if len(piv) < 2 or not wants:
                log.append(f'hinge {rule.get("name", "?")} {"LR"[side > 0]}: no hinge or leading edge found, left as drawn')
                continue
            piv = np.array(piv)
            A_ = np.stack([piv[:, 0], np.ones(len(piv))], 1)
            (dy, cy), *_ = np.linalg.lstsq(A_, piv[:, 1], rcond=None)
            (dz, cz), *_ = np.linalg.lstsq(A_, piv[:, 2], rcond=None)
            u = np.array([1.0, dy, dz])
            u /= np.linalg.norm(u)
            xm = (x0 + x1) / 2
            p0 = np.array([xm, cy + dy * xm, cz + dz * xm])
            want = float(np.median(wants)) + trim

            def turn_for(T):
                _, mids, lens = _section(T, xm)
                if not len(lens):
                    return None
                cen = (mids * lens[:, None]).sum(0) / lens.sum()
                have = np.arctan2(cen[1] - p0[1], cen[2] - p0[2])

                def miss(a):
                    c2 = _rotate(cen[None, :], p0, u, a)[0]
                    return abs(np.arctan2(c2[1] - p0[1], c2[2] - p0[2]) - want)
                return min((have - want, want - have), key=miss)
            turns = {}
            for i in big:
                turns[i] = turn_for(tris[i])
            known = [i for i in big if turns[i] is not None]
            if not known:
                continue
            main = max(known, key=lambda i: len(tris[i]))
            desc = []
            for i, (k, m) in enumerate(grp):
                phi = turns.get(i)
                if phi is None:
                    phi = turns[main]
                q = parts[k]
                ix = np.unique(q['I'][m])
                q['P'] = q['P'].copy()
                q['P'][ix] = _rotate(q['P'][ix], p0, u, phi)
                if q['N'] is not None:
                    q['N'] = q['N'].copy()
                    q['N'][ix] = _rotate(q['N'][ix], np.zeros(3), u, phi)
                if i in big:
                    desc.append(f'{np.degrees(phi):+.1f}')
            log.append(f'hinge {rule.get("name", "?")} {"LR"[side > 0]}: turned {", ".join(desc)} deg ({sum(int(m.sum()) for _, m in grp)} triangles, {len(grp)} pieces)')
            if os.environ.get('HINGE_DEBUG'):
                log.append(f'   axis {u.round(3)} p0 {p0.round(3)} chord {np.degrees(want):.1f} deg, pivots {piv.round(2).tolist()}')


def _others_section(parts, grp, xs):
    """The section at xs of every triangle not in grp [(part, mask)]."""
    out = []
    for k, q in enumerate(parts):
        mk = np.ones(len(q['I']), bool)
        for k2, m2 in grp:
            if k2 == k:
                mk &= ~m2
        if not mk.any():
            continue
        T = q['P'][q['I'][mk]]
        T = T[(T[:, :, 0].min(1) < xs) & (T[:, :, 0].max(1) > xs)]
        if len(T):
            sp, _, _ = _section(T, xs)
            if len(sp):
                out.append(sp)
    return np.concatenate(out) if out else np.zeros((0, 3))


def _loop_of(pts, i0):
    """Section points come in pairs (one segment each); the ones joined to point i0 through shared ends."""
    key = np.round(pts / 1e-4).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    parent = np.arange(inv.max() + 1)

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for a in range(0, len(inv) - 1, 2):
        ra, rb = find(inv[a]), find(inv[a + 1])
        parent[rb] = ra
    roots = np.array([find(x) for x in inv])
    return pts[roots == roots[i0]]


def wedge_surfaces(parts, rules, log):
    """models.py `wedges`: a control surface the source drew deflected and in pieces (the
    A-10's split ailerons, open as speed brakes), left out and drawn again closed and
    neutral: a plain wedge from the rear face of the wing ahead of it to a straight
    trailing edge on that wing's chord line, as long as the source's surface is."""
    for rule in rules:
        for side in (-1, 1):
            grp = [(k, m) for k, m, s in select_pieces(parts, rule) if s == side]
            if not grp:
                continue
            V = np.concatenate([parts[k]['P'][parts[k]['I'][m]] for k, m in grp])
            ax_ = np.abs(V[:, :, 0])
            a0, a1 = ax_.min() + 0.005, ax_.max() - 0.005
            rows = []
            for a in np.linspace(a0 + 0.08, a1 - 0.08, 11):
                xs = side * a
                sp = _others_section(parts, grp, xs)
                seg = sp.reshape(-1, 2, 3)
                seg = seg[((seg[:, :, 2] > rule['le'][0]) & (seg[:, :, 2] < rule['le'][1])).all(1)]
                sp = seg.reshape(-1, 3)
                if len(sp) < 6:
                    continue
                # the wing's own outline: the loop of the section that holds the leading edge (a
                # hinge bracket or a cap left behind the wing is a loop of its own)
                sp = _loop_of(sp, np.argmin(sp[:, 2]))
                le = sp[np.argmin(sp[:, 2])]
                zr = sp[:, 2].max()
                rear = sp[sp[:, 2] > zr - rule.get('face', 0.04)]
                top = rear[np.argmax(rear[:, 1])]
                bot = rear[np.argmin(rear[:, 1])]
                mid = (top + bot) / 2
                g, _, _ = _section(V, xs)
                if not len(g):
                    continue
                L = float(np.max(np.linalg.norm(g[:, 1:] - mid[1:], axis=1)))
                rows.append([a, le[1], le[2], top[1], top[2], bot[1], bot[2], L])
            st = []
            if len(rows) >= 3:
                R_ = np.array(rows)
                # stations where the rear face is not the run of the rest (a bracket, the tip's cap) are left out
                ok = np.abs(R_[:, 4] - np.median(R_[:, 4])) < 0.03
                R_ = R_[ok] if ok.sum() >= 2 else R_
                A_ = np.stack([R_[:, 0], np.ones(len(R_))], 1)
                coef = np.linalg.lstsq(A_, R_[:, 1:], rcond=None)[0]
                for a in (a0, a1):
                    leY, leZ, tY, tZ, bY, bZ, L = np.array([a, 1.0]) @ coef
                    xs = side * a
                    mid = np.array([(tY + bY) / 2, (tZ + bZ) / 2])
                    if rule.get('teBelowLe') is not None:
                        # the trailing edge level with the leading edge, less this: in line with the
                        # flaps' trailing edge inboard (the line from the leading edge through the
                        # rear face's middle rides up a cambered wing's, and stood the surface up)
                        ty = leY - rule['teBelowLe']
                        te = np.array([xs, ty, mid[1] + np.sqrt(max(L * L - (ty - mid[0]) ** 2, 0.0))])
                    else:
                        d = mid - np.array([leY, leZ])
                        d /= np.linalg.norm(d)
                        te = np.array([xs, mid[0] + d[0] * L, mid[1] + d[1] * L])
                    st.append((np.array([xs, tY, tZ]), np.array([xs, bY, bZ]), te))
                    if os.environ.get('HINGE_DEBUG'):
                        log.append(f'   end {xs:.2f}: top {st[-1][0].round(2)} bot {st[-1][1].round(2)} te {st[-1][2].round(2)} ({len(R_)} stations)')
            if len(st) < 2:
                log.append(f'wedge {rule.get("name", "?")} {"LR"[side > 0]}: no wing ahead found, left as drawn')
                continue
            # drop the source's pieces
            gone = {}
            for k, m in grp:
                gone[k] = gone[k] | m if k in gone else m
            for k, m in gone.items():
                parts[k]['I'] = parts[k]['I'][~m]
                parts[k]['lab'] = parts[k]['lab'][~m]
            (T0, B0, E0), (T1, B1, E1) = st  # inboard station first
            P = np.array([T0, B0, E0, T1, B1, E1])
            tris = [(0, 3, 5), (0, 5, 2), (1, 2, 5), (1, 5, 4), (0, 2, 1), (3, 4, 5)]
            hints = [np.array([0, 1, 0]), np.array([0, 1, 0]), np.array([0, -1, 0]), np.array([0, -1, 0]),
                     np.array([-side, 0, 0]), np.array([side, 0, 0])]
            I = []
            for t, h in zip(tris, hints):
                v = P[list(t)]
                n = np.cross(v[1] - v[0], v[2] - v[0])
                I.append(t if n @ h >= 0 else (t[0], t[2], t[1]))
            I = np.array(I, dtype=np.int64)
            parts.append(dict(P=P, N=None, I=I, mat='synth', node=f'synth:{rule.get("name", "wedge")}', lab=np.arange(len(I))))
            log.append(f'wedge {rule.get("name", "?")} {"LR"[side > 0]}: {sum(int(m.sum()) for _, m in grp)} triangles drawn again as a neutral wedge, '
                       f'chord {np.linalg.norm(st[0][2][1:] - (st[0][0][1:] + st[0][1][1:]) / 2):.2f}..{np.linalg.norm(st[1][2][1:] - (st[1][0][1:] + st[1][1][1:]) / 2):.2f}')


def bend_surfaces(parts, rules, log):
    """models.py `bends`: a flap the source drew deflected as part of the wing's own piece
    (the A-10's inboard flaps: the wing's skin runs on round the lowered flap), bent back.
    Within rule['x'] (|x|), everything behind the cut (z > rule['cut']) turns about the
    spanwise line where the cut meets the upper surface, until the flap's upper side
    carries on the line of the wing's upper surface ahead of the cut."""
    for rule in rules:
        x0, x1 = rule['x']
        cut = rule['cut']
        for side in (-1, 1):
            xs = side * rule.get('at', (x0 + x1) / 2)
            seg = _others_section(parts, [], xs).reshape(-1, 2, 3)

            def upper(z):
                """The upper surface's height at z: the highest segment of the section across it."""
                s_ = seg[(seg[:, :, 2].min(1) <= z) & (seg[:, :, 2].max(1) >= z)]
                if not len(s_):
                    return None
                t = (z - s_[:, 0, 2]) / np.where(np.abs(s_[:, 1, 2] - s_[:, 0, 2]) > 1e-9, s_[:, 1, 2] - s_[:, 0, 2], 1)
                return float((s_[:, 0, 1] + (s_[:, 1, 1] - s_[:, 0, 1]) * np.clip(t, 0, 1)).max())
            yp = upper(cut)
            ya = upper(cut - rule.get('ahead', 0.25))
            pts = seg.reshape(-1, 3)
            if yp is not None:  # the outline the upper surface at the cut is on (not a plate tucked under it)
                pts = _loop_of(pts, np.argmin(np.abs(pts[:, 2] - cut) + np.abs(pts[:, 1] - yp)))
            behind = pts[pts[:, 2] > cut + 0.02]
            if yp is None or ya is None or not len(behind):
                log.append(f'bend {rule.get("name", "?")} {"LR"[side > 0]}: nothing to bend')
                continue
            piv = np.array([xs, yp, cut])
            up = np.array([xs, ya, cut - rule.get('ahead', 0.25)])
            te = behind[np.argmax(behind[:, 2])]
            want = np.arctan2(piv[1] - up[1], piv[2] - up[2])
            have = np.arctan2(te[1] - piv[1], te[2] - piv[2])
            u = np.array([1.0, 0, 0])
            p0 = np.array([0.0, piv[1], piv[2]])

            # turning about +x by phi takes a direction at angle a (atan2(y, z)) to a - phi
            phi = (have - want) * rule.get('k', 1.0)
            n = 0
            for q in parts:
                if rule.get('mats') and q['mat'] not in rule['mats']:
                    continue
                used = np.unique(q['I'])
                Pu = q['P'][used]
                m = (np.sign(Pu[:, 0]) == side) & (np.abs(Pu[:, 0]) >= x0) & (np.abs(Pu[:, 0]) <= x1) & (Pu[:, 2] > cut)
                if not m.any():
                    continue
                ix = used[m]
                q['P'] = q['P'].copy()
                q['P'][ix] = _rotate(q['P'][ix], p0, u, phi)
                if q['N'] is not None:
                    q['N'] = q['N'].copy()
                    q['N'][ix] = _rotate(q['N'][ix], np.zeros(3), u, phi)
                n += int(m.sum())
            log.append(f'bend {rule.get("name", "?")} {"LR"[side > 0]}: {n} vertices turned {np.degrees(phi):+.1f} deg about z {piv[2]:.2f}'
                       f' (upper surface {np.degrees(want):.1f} deg, flap {np.degrees(have):.1f} deg)')


def fix_winding(P, N, I, log, node):
    """Turn round any piece wound against its own normals.

    A source drawn double-sided can have a whole piece wound inside out (the
    A321's right engine and most of its right wing): its normals point out,
    its triangles face in. The game draws these one-sided, so from outside
    that nacelle was see-through, and the engine sort (which reads which way a
    face is wound) called its cowl the duct. Each connected piece is put the
    way its normals say, by area, so the odd sliver does not flip a piece."""
    if N is None or not len(I):
        return I
    v = P[I]
    fn = np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0])
    area = np.linalg.norm(fn, axis=1) / 2
    vn = N[I].mean(1)
    sgn = np.sign((fn * vn).sum(1))
    lab = components(P, I)
    ul, inv = np.unique(lab, return_inverse=True)
    score = np.zeros(len(ul))
    np.add.at(score, inv, sgn * area)
    flip = (score < 0)[inv]
    if flip.any():
        log.append(f'winding: {node}: {int(flip.sum())} of {len(I)} triangles turned the way their normals face')
        I = I.copy()
        I[flip] = I[flip][:, [0, 2, 1]]
    return I


def cut_fin_root(P, N, I, role, prof, hump, fin, cfg):
    """Split the triangles that cross the fin's root line, so the tail colour
    ends on a line instead of in teeth.

    A source's fin fillet is long slivers from the fuselage's crown to well up
    the fin; sorted whole, some went to the fin and some to the fuselage, and
    the 777's and A350's tails stood on a row of white teeth -- in the chase
    view, which looks straight at them. The line is the game's fuselage top
    plus `finAbove`, as the fin sort uses; only the fin and the side-facing
    fillet are cut, never the crown."""
    v = P[I]
    c = v.mean(1)
    fn = np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0])
    fn = fn / np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)
    above = cfg.get('finAbove', 0.25)

    def cut_y(z):
        top = prof.at(z)[0]
        if hump is not None:
            inh = (z >= hump.z[0] - 0.5) & (z <= hump.z[-1] + 0.5)
            top = np.where(inh, np.maximum(top, hump.at(z)[0]), top)
        return top + above
    finz = fin.get('rootZ', 1e9) - cfg.get('finAhead', 3.0)
    fin_t = max(0.35, fin.get('thickness', 0.4) * 1.6)
    f = P[:, 1] - cut_y(P[:, 2])
    fv = f[I]
    straddle = (fv.max(1) > 1e-4) & (fv.min(1) < -1e-4)
    zone = (c[:, 2] > finz) & (np.abs(c[:, 0]) < fin_t)
    # Side-facing bits at the root that fell to neither (the A350's root fairing went to
    # the wing, grey teeth under the red): the fin's above the line, the fuselage's below.
    side_bits = zone & (role == 'wing') & (np.abs(fn[:, 0]) > 0.55) & (fv.min(1) < 1.0)
    if side_bits.any():
        role = role.copy()
        role[side_bits] = np.where(fv[side_bits].min(1) >= 0, 'fin', 'skin')
    fillet = (role == 'skin') & (np.abs(fn[:, 0]) > 0.3) & (fv.max(1) > 0.1)
    todo = np.where(straddle & zone & ((role == 'fin') | fillet))[0]
    if not len(todo):
        return P, N, I, role, 0
    Ps, Ns = [P], [N] if N is not None else None
    nxt = len(P)
    newI, newR = [], []
    for t in todo:
        a = I[t]
        s = fv[t] > 0
        # the lone vertex first, the winding kept
        k = [i for i in range(3) if s[i] != s[(i + 1) % 3] and s[i] != s[(i + 2) % 3]][0]
        i0, i1, i2 = a[k], a[(k + 1) % 3], a[(k + 2) % 3]
        def mid(u, w):
            tt = f[u] / (f[u] - f[w])
            p = P[u] + (P[w] - P[u]) * tt
            nn = None
            if N is not None:
                nn = N[u] + (N[w] - N[u]) * tt
                nn = nn / max(np.linalg.norm(nn), 1e-12)
            return p, nn
        p01, n01 = mid(i0, i1)
        p02, n02 = mid(i0, i2)
        Ps.append(np.stack([p01, p02]))
        if Ns is not None:
            Ns.append(np.stack([n01, n02]))
        j01, j02 = nxt, nxt + 1
        nxt += 2
        lone_up = f[i0] > 0
        r_lone, r_rest = ('fin', 'skin') if lone_up else ('skin', 'fin')
        newI += [[i0, j01, j02], [j01, i1, i2], [j01, i2, j02]]
        newR += [r_lone, r_rest, r_rest]
    keep = np.ones(len(I), bool)
    keep[todo] = False
    P2 = np.concatenate(Ps)
    N2 = np.concatenate(Ns) if Ns is not None else None
    I2 = np.concatenate([I[keep], np.array(newI, dtype=I.dtype)])
    R2 = np.concatenate([role[keep], np.array(newR, dtype=object)])
    return P2, N2, I2, R2, len(P2) - len(P)


def engine_parts(r, outward, n, c, R, mid):
    """Which part of a nacelle a triangle is, by which way it faces, not only how far out it is:
    banding by radius alone sawtoothed the intake lip of every big fan."""
    core = (r < 0.55 * R) & (c[:, 2] > mid)
    inward = outward < -0.25
    fanface = (n[:, 2] < -0.75) & (r < 0.92 * R)
    return np.where(core, 'core', np.where(inward | fanface, 'duct', 'cowl'))


def tri_data(P, I):
    v = P[I]
    c = v.mean(1)
    n = np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0])
    area = np.linalg.norm(n, axis=1) / 2
    n = n / np.maximum(2 * area[:, None], 1e-12)
    return v, c, n, area


def fit(cfg, ref, P_all, body_mask_fn):
    """Scale and place: (sx, sy, sz) and offset so the source sits on the game's airframe."""
    lo, hi = P_all.min(0), P_all.max(0)
    b = ref['bounds']
    L = b['max'][2] - b['min'][2]
    sz = L / (hi[2] - lo[2])
    span = cfg.get('span') or ref['realSpan']
    sx = span / (hi[0] - lo[0])
    return sx, sz, lo, hi


def process(mid, view=None):
    cfg = MODELS[mid]
    ref = ref_of(cfg.get('ref', mid))
    prims, j, _ = flatten(os.path.join(INBOX, cfg['src']))
    R = ROT[cfg.get('rot', 'none')]
    roles_by_mat = cfg.get('roles', {})
    drop_mats = set(cfg.get('drop', []))
    log = []

    # 1-2: gather, drop, rotate
    parts = []
    for p in prims:
        name = p['mat']
        if p['skinned'] and cfg.get('dropSkinned', True):
            continue
        if name in drop_mats or any(name.startswith(d.rstrip('*')) for d in drop_mats if d.endswith('*')):
            continue
        if cfg.get('keep') and name not in cfg['keep']:
            continue
        if any(s in p['node'] for s in cfg.get('dropNodes', [])):
            continue
        P = p['pos'] @ R.T
        N = p['nrm'] @ R.T if p['nrm'] is not None else None
        I = fix_winding(P, N, p['idx'], log, p['node'])
        parts.append(dict(P=P, N=N, I=I, mat=name, node=p['node']))
    # the fit is measured on the source as drawn (a dropped centreline pylon is not the belly's depth)
    fit_parts = [dict(q) for q in parts]
    if cfg.get('dropPieces'):
        drop_pieces(parts, cfg['dropPieces'], log)
    if cfg.get('hinges'):
        straighten_hinges(parts, cfg['hinges'], log)
    if cfg.get('wedges'):
        wedge_surfaces(parts, cfg['wedges'], log)
    if cfg.get('bends'):
        bend_surfaces(parts, cfg['bends'], log)
    for q in parts:
        q.pop('lab', None)
    allP = np.concatenate([q['P'] for q in parts])
    # A ground plane or a stray far vertex would wreck the fit: optional clip box (source units, after rotation).
    lo, hi = allP.min(0), allP.max(0)

    # 3: fit. Length and span from the game's numbers; depth from the fuselage.
    #
    # 'free' (the default): x from the span, y from the fuselage's depth, z
    #   from the length, each on its own -- right for a source drawn to the
    #   real proportions, where the three come out within a few per cent.
    # 'wing': the fuselage keeps its own section (x = y, from the depth) and
    #   only the wings outboard of it are stretched or squeezed to the span;
    #   the engines move with the wing but keep their round section.
    # plugs: [(f0, f1), ...] stretch only those stretches of the fuselage
    #   (fractions of the source's length, nose 0) to make up the length, as
    #   the real stretched versions were built -- for a source that is a
    #   shorter variant of the type.
    b = ref['bounds']
    Lgame = b['max'][2] - b['min'][2]
    span = cfg.get('span') or ref['realSpan']
    Ls = hi[2] - lo[2]
    # The centreline: the middle of the forward fuselage (a source's wings are not always level-tipped).
    fwd = allP[(allP[:, 2] > lo[2] + Ls * 0.05) & (allP[:, 2] < lo[2] + Ls * 0.2)]
    xc = (fwd[:, 0].min() + fwd[:, 0].max()) / 2 if len(fwd) else (hi[0] + lo[0]) / 2
    prof = Profile(ref)
    hump = Profile({'profile': ref['humpProfile']}) if ref.get('humpProfile') else None
    fus = ref['fus']
    # The source's deepest section, and its belly at mid-cabin, on the centreline.
    # Station by station along the cabin: the game's depth there (the hump or
    # the bubble included) over the source's; the median, so a belly fairing
    # or a wing root in the slice does not pull it.
    fr = np.linspace(*cfg.get('depthAt', (0.15, 0.75)), 13)
    Lz = Lgame / Ls  # first guess at the length scale, to find the game's station
    ratios = []
    for f in fr:
        t_, b_ = slice_depth(fit_parts, xc, [lo[2] + Ls * f])
        if t_ is None or t_ - b_ <= 0:
            continue
        zg = b['min'][2] + Lgame * f
        gt, gb, _ = prof.at(zg)
        if hump is not None and hump.z[0] <= zg <= hump.z[-1]:
            gt = max(gt, hump.at(zg)[0])
        ratios.append((gt - gb) / (t_ - b_))
    sy = float(np.median(ratios)) * cfg.get('depthK', 1.0)
    src_depth = (fus['top'] - fus['bottom']) / sy
    game_depth = fus['top'] - fus['bottom']
    mode = cfg.get('fit', 'free')
    plugs = cfg.get('plugs')
    if plugs:
        sz_body = sy
        if cfg.get('bodyZFrom'):
            # the length scale the source has as the type it was drawn as (the A320 from the A321
            # download: the wing, engines and tail as long as the A321's, only the cabin shorter)
            rb = ref_of(cfg['bodyZFrom'])['bounds']
            sz_body = (rb['max'][2] - rb['min'][2]) / Ls
        extra = Lgame - Ls * sz_body
        lens = [(f1 - f0) * Ls for f0, f1 in plugs]
        anchor = cfg.get('plugAnchor')
        if anchor and len(plugs) == 2:
            # the source's point at fraction fa lands on the game's z: the first plug makes up the difference
            fa, za_ = anchor
            e1 = (za_ - b["min"][2]) - fa * Ls * sz_body
            adds = [e1, extra - e1]
        else:
            adds = [extra * l_ / sum(lens) for l_ in lens]
        ks, kg = [0.0], [0.0]
        cur = 0.0
        for (f0, f1), add in zip(plugs, adds):
            a_, b2 = f0 * Ls, f1 * Ls
            kg.append(kg[-1] + (a_ - cur) * sz_body); ks.append(a_)
            kg.append(kg[-1] + (b2 - a_) * sz_body + add); ks.append(b2)
            cur = b2
        kg.append(kg[-1] + (Ls - cur) * sz_body); ks.append(Ls)
        sz_plug = max(adds)
        zmap = lambda z: b['min'][2] + np.interp(z - lo[2], ks, kg)
        sz = sz_body
        log.append(f'plugs {plugs}: body z {sz_body:.4f}, adds {[round(x, 2) for x in adds]} m')
    else:
        sz = Lgame / Ls if not cfg.get('szFromDepth') else sy
        zmap = lambda z: b['min'][2] + (z - lo[2]) * sz
    half_src = max(hi[0] - xc, xc - lo[0])
    if mode == 'wing' or plugs:
        sxb = sy  # the fuselage keeps its section
        r0 = fus['halfWidth'] * cfg.get('wingRoot', 1.25) / sxb
        sout = (span / 2 - r0 * sxb) / (half_src - r0)
        def xmap(x):
            ax = np.abs(x)
            return np.sign(x) * np.where(ax <= r0, ax * sxb, r0 * sxb + (ax - r0) * sout)
        sx = sxb
        log.append(f'wing stretch: body x {sxb:.4f}, outboard x {sout:.4f} ({sout / sxb:.3f})')
    else:
        sx = span / (2 * half_src) if cfg.get('symSpan') else span / (hi[0] - lo[0])
        xmap = lambda x: x * sx
    # Belly on the game's belly at mid-cabin (a hump or a bubble above is the source's own).
    fA, fB = cfg.get('cabinAt', (0.25, 0.35))
    zA, zB = lo[2] + Ls * fA, lo[2] + Ls * fB
    src_top, src_bot = slice_depth(fit_parts, xc, np.linspace(zA, zB, 5))
    zmid_game = float(zmap((zA + zB) / 2))
    gtop, gbot, gw = prof.at(zmid_game)
    yoff = gbot - src_bot * sy + cfg.get('lift', 0.0)
    for q in parts:
        P0 = q['P']
        q['X0'] = P0[:, 0] - xc
        P = np.empty_like(P0)
        P[:, 0] = xmap(P0[:, 0] - xc)
        P[:, 1] = P0[:, 1] * sy + yoff
        P[:, 2] = zmap(P0[:, 2])
        q['P'] = P
        if q['N'] is not None:
            n = q['N'] / np.array([sx, sy, sz])  # near enough: the stretches are gentle
            q['N'] = n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    q_ = dict(sx=sx, sy=sy, sz=sz, xmap=xmap, sxb=sx)
    log.append(f'scale x{sx:.4f} y{sy:.4f} z{sz:.4f}  (y/x {sy / sx:.3f}, z/x {sz / sx:.3f})  depth src {src_depth:.3f} game {game_depth:.2f}')

    # 4: roles
    eng = refine_engines(parts, ref['engines'] or [], cfg, log)
    if cfg.get('engSym') and len(eng) == 2:
        # a pair, measured alike: the one whose front was not pulled forward by something ahead of
        # it (the A-10's left nacelle read 0.7 m longer than its right), mirrored onto the other
        a_, b_ = sorted(eng, key=lambda e: -e['zf'])
        b_.update(x=-a_['x'], y=a_['y'], radius=a_['radius'], zf=a_['zf'], za=a_['za'])
        log.append(f"engines as a pair: both x ±{abs(a_['x']):.2f} y {a_['y']:.2f} r {a_['radius']:.2f} z {a_['zf']:.1f}..{a_['za']:.1f}")
    fin = ref.get('fin') or {}
    gear = ref.get('gear') or {}
    gp = ref.get('gearPoints') or []
    ground = min([g['pos'][1] for g in gp]) if gp else -3
    wing = ref.get('wing') or {}
    deckZ = ref['eye'][2] if ref.get('eye') else b['min'][2] + 4
    out = {r: [] for r in ROLES}
    counts = {}
    for q in parts:
        P, I = q['P'], q['I']
        v, c, n, area = tri_data(P, I)
        role = np.array(['auto'] * len(I), dtype=object)
        fixed = roles_by_mat.get(q['mat'])
        if fixed is None:
            for k, v_ in roles_by_mat.items():
                if k.endswith('*') and q['mat'].startswith(k[:-1]):
                    fixed = v_
                    break
        if fixed:
            role[:] = fixed
        auto = role == 'auto'
        if fixed == 'engine':
            role[:] = 'auto'
            auto = role == 'auto'
        if auto.any() or fixed in ('skin', 'body', 'engine'):
            top, bot, w = prof.at(c[:, 2])
            yc = (top + bot) / 2
            hy = np.maximum((top - bot) / 2, 0.05)
            d = np.sqrt((c[:, 0] / np.maximum(w, 0.05)) ** 2 + ((c[:, 1] - yc) / hy) ** 2)
            inside_len = (c[:, 2] >= prof.z[0] - 1.0) & (c[:, 2] <= prof.z[-1] + 1.5)
            body = inside_len & (d <= cfg.get('bodyD', 1.18))
            if cfg.get('noseD') and wing.get('rootZ') is not None:
                # Ahead of the wing's root there is no wing: where the download's flight deck stands
                # proud of the game's profile (its crown over the windscreen), it is fuselage too.
                # Sorted as wing, it came out as a row of wing-grey teeth over the windscreen.
                body |= inside_len & (c[:, 2] < wing['rootZ'] - 1.0) & (d <= cfg['noseD'])
            if hump is not None:
                ht, hb, hw = hump.at(c[:, 2])
                hyc = (ht + hb) / 2
                hhy = np.maximum((ht - hb) / 2, 0.05)
                dh = np.sqrt((c[:, 0] / np.maximum(hw, 0.05)) ** 2 + ((c[:, 1] - hyc) / hhy) ** 2)
                inh = (c[:, 2] >= hump.z[0] - 0.5) & (c[:, 2] <= hump.z[-1] + 0.5)
                body |= inh & (dh <= cfg.get('bodyD', 1.18))
                top = np.where(inh, np.maximum(top, ht), top)
            interior = inside_len & (d < cfg.get('interiorD', 0.0))
            finz = fin.get('rootZ', 1e9) - cfg.get('finAhead', 3.0)
            fin_t = max(0.35, fin.get('thickness', 0.4) * 1.6)
            finm = (c[:, 1] > top + cfg.get('finAbove', 0.25)) & (np.abs(c[:, 0]) < fin_t) & (c[:, 2] > finz)
            # a fin's sides face sideways; the top of a tail cone that rises above the game's faces up
            finm &= (np.abs(n[:, 0]) > 0.55) | (c[:, 1] > fin.get('rootY', -1e9) + cfg.get('finSolid', 0.8))
            engm = np.zeros(len(I), bool)
            sub = np.array(['cowl'] * len(I), dtype=object)
            for e in eng:
                L = e['length']
                zf, za = e['zf'], e['za']
                dx, dy = c[:, 0] - e['x'], c[:, 1] - e['y']
                r = np.hypot(dx, dy)
                inn = (r <= e['radius'] * cfg.get('engR', 1.12)) & (c[:, 2] >= zf - cfg.get('engFront', 0.15)) & (c[:, 2] <= za + cfg.get('engBack', 0.3))
                if cfg.get('engMats') is not None and q['mat'] not in cfg['engMats']:
                    inn = np.zeros(len(I), bool)  # only the nacelles' own materials (not the fuselage between them)
                if e.get('prop'):
                    # the propeller: a disc just ahead of the nacelle, out to the blade tips
                    pz = (c[:, 2] > zf - cfg.get('propAhead', 0.9)) & (c[:, 2] < zf + cfg.get('propBehind', 0.5))
                    pm = pz & (r <= e['prop'] * 1.12) & ~inn
                    sub = np.where(pm, 'prop', sub)
                    engm |= pm
                # facing forward and inside the lip: the fan and the intake duct
                radial = np.stack([dx, dy], 1) / np.maximum(r[:, None], 1e-6)
                outward = (n[:, 0] * radial[:, 0] + n[:, 1] * radial[:, 1])
                s = engine_parts(r, outward, n, c, e['radius'], (zf + za) / 2)
                if cfg.get('coreEnvelope') and inn.any():
                    # a nacelle that tapers to its nozzle: its outside there is inside 0.55 of the
                    # radius too, and sorted as core it came out in ragged dark teeth. Core is only
                    # what sits well inside the nacelle's own outside there: per 10 cm station and
                    # per 30 degrees round (the nacelle need not be centred on the axis measured).
                    zb = np.floor(c[:, 2] / 0.1).astype(np.int64) * 16 + np.floor((np.arctan2(dy, dx) + np.pi) / (np.pi / 6)).astype(np.int64)
                    ub, ib = np.unique(zb[inn], return_inverse=True)
                    env = np.zeros(len(ub))
                    np.maximum.at(env, ib, r[inn])
                    k_ = np.searchsorted(ub, zb).clip(0, len(ub) - 1)
                    envr = np.where(ub[k_] == zb, env[k_], np.inf)
                    s = np.where((s == 'core') & (r > cfg['coreEnvelope'] * envr), 'cowl', s)
                if e.get('prop') or cfg.get('boxEngines'):
                    s = np.where(s == 'core', 'core', 'cowl')
                if cfg.get('boxEngines'):
                    inn &= (c[:, 1] < e['y'] + 0.6 * e['radius']) & (c[:, 1] > e['y'] - 1.4 * e['radius'])  # the wing above it is wing, the gear below it gear  # a turboprop's nacelle is cowl all over (it is not round)
                sub = np.where(inn, s, sub)
                engm |= inn
            # landing gear the source models (the game draws its own, which moves)
            gearm = np.zeros(len(I), bool)
            if gear and cfg.get('gearCut', True):
                nz = gear['nose'][2]
                gearm |= (np.abs(c[:, 0]) < 1.2) & (np.abs(c[:, 2] - nz) < cfg.get('noseGearZ', 2.2)) & (c[:, 1] < bot - 0.05)
                mx, mz = abs(gear['main'][0]), gear['main'][2]
                below = c[:, 1] < min(wing.get('rootY', -1.5) - 0.25, ground + cfg.get('gearH', 2.6))
                gearm |= below & (np.abs(c[:, 2] - mz) < cfg.get('mainGearZ', 3.0)) & (np.abs(np.abs(c[:, 0]) - mx) < cfg.get('mainGearX', 1.8)) & ~engm
                gearm |= (c[:, 1] < ground + cfg.get('lowCut', 0.9)) & ~engm
            if cfg.get('gearPieces'):
                # whole pieces that hang below the airframe: legs, wheels, doors
                lab = components(P, I)
                ul, inv_ = np.unique(lab, return_inverse=True)
                big = np.full(len(ul), -1e9)
                low = np.full(len(ul), 1e9)
                lo3 = np.full((len(ul), 3), 1e9)
                hi3 = np.full((len(ul), 3), -1e9)
                np.maximum.at(big, inv_, v[:, :, 1].max(1))
                np.minimum.at(low, inv_, v[:, :, 1].min(1))
                np.minimum.at(lo3, inv_, v.min(1))
                np.maximum.at(hi3, inv_, v.max(1))
                ext = hi3 - lo3
                # entirely below the line, or a strut: slim in plan and reaching down to the wheels
                piece = (big < cfg['gearPieces']) | ((low < ground + cfg.get('strutReach', 1.6)) & (ext[:, 0] < 1.2) & (ext[:, 2] < 1.6))
                pm = piece[inv_]
                gearm |= pm & ~engm
            else:
                pm = np.zeros(len(I), bool)
            r_ = np.where(engm, sub, np.where(gearm, 'gear', np.where(finm & ~body, 'fin', np.where(body, 'skin', 'wing'))))
            r_ = np.where(interior & ~engm, 'drop', r_)
            r_ = np.where(pm, 'gear', r_)  # a whole leg or wheel, even where it passes a nacelle
            if fixed == 'engine':
                # an engine material: always engine, the nearest nacelle says which part
                ex = np.array([e['x'] for e in eng]); ey = np.array([e['y'] for e in eng])
                k = np.argmin((c[:, None, 0] - ex[None]) ** 2 + (c[:, None, 1] - ey[None]) ** 2, axis=1)
                rr = np.hypot(c[:, 0] - ex[k], c[:, 1] - ey[k])
                Rk = np.array([e['radius'] for e in eng])[k]
                mid = np.array([(e['zf'] + e['za']) / 2 for e in eng])[k]
                radial = np.stack([c[:, 0] - ex[k], c[:, 1] - ey[k]], 1) / np.maximum(rr[:, None], 1e-6)
                outward = n[:, 0] * radial[:, 0] + n[:, 1] * radial[:, 1]
                r_ = engine_parts(rr, outward, n, c, Rk, mid)
                propk = np.array([bool(e.get('prop')) for e in eng])[k]
                r_ = np.where(propk & (r_ == 'duct'), 'cowl', r_)
                r_ = np.where(sub == 'prop', 'prop', r_)
                role[:] = r_
            elif fixed in ('skin', 'body'):
                r_ = np.where(r_ == 'gear', 'gear', 'skin')
                role[:] = r_
            else:
                role[auto] = r_[auto]
        # The fin's root: cut along it, the tail colour above, the fuselage's paint below.
        if fin and not fin.get('mirror') and cfg.get('finRootCut', True) and np.isin(role, ['fin', 'skin']).any():
            P, N2, I, role, added = cut_fin_root(P, q['N'], I, role, prof, hump, fin, cfg)
            if added:
                q['P'], q['N'] = P, N2
                q['X0'] = np.concatenate([q['X0'], np.zeros(added)])
                v, c, n, area = tri_data(P, I)
                log.append(f'fin root: {q["node"]}: cut along it ({added} vertices)')
        # the windscreen: a 'glass'/'window' material near the flight deck is glass, else cabin windows
        win = role == 'window'
        if win.any() and cfg.get('deckGlass', True):
            role[win & (c[:, 2] < deckZ + cfg.get('deckGlassAft', 1.2))] = 'glass'
            if cfg.get('cabinWindows') == 'drop':
                role[role == 'window'] = 'drop'
        if cfg.get('dropProps'):
            role[role == 'prop'] = 'drop'
        for r in ('gear', 'drop', 'light'):
            keep = role != r
            role = role[keep]
            I2 = I[keep]
            c2 = c[keep]
            I, c = I2, c2
        # Engines keep their round section when the wing is stretched: each one moves out as a whole.
        if (mode == 'wing' or plugs) and len(eng):
            em = np.isin(role, ['cowl', 'lip', 'duct', 'core', 'prop'])
            if em.any():
                ex = np.array([e['x'] for e in eng])
                which = np.argmin(np.abs(c[em][:, None, 0] - ex[None, :]), axis=1)
                for k in range(len(eng)):
                    vs = np.unique(I[em][which == k])
                    if not len(vs):
                        continue
                    x0c = q['X0'][vs].mean()
                    P[vs, 0] = xmap(np.array([x0c]))[0] + (q['X0'][vs] - x0c) * sx
        sk = role == 'skin'
        role[sk & (c[:, 0] < 0)] = 'skin_l'
        role[sk & (c[:, 0] >= 0)] = 'skin_r'
        for r in ROLES:
            m = role == r
            if m.any():
                out[r].append((P, q['N'], I[m]))
                counts[r] = counts.get(r, 0) + int(m.sum())
    log.append('roles ' + ', '.join(f'{k}:{v}' for k, v in counts.items()))
    return out, log, cfg, ref


def merge(chunks):
    """Concatenate (P, N, I) chunks into one indexed mesh, keeping only used vertices."""
    Ps, Ns, Is = [], [], []
    base = 0
    for P, N, I in chunks:
        used = np.unique(I)
        remap = -np.ones(len(P), dtype=np.int64)
        remap[used] = np.arange(len(used))
        Ps.append(P[used])
        if N is None:
            N = vertex_normals(P, I)
        Ns.append(N[used])
        Is.append(remap[I] + base)
        base += len(used)
    P, N, I = np.concatenate(Ps), np.concatenate(Ns), np.concatenate(Is)
    # Weld: one vertex per position (to a tenth of a millimetre) and normal (as the file stores it).
    key = np.concatenate([np.round(P / 1e-4).astype(np.int64), np.clip(np.round(N * 127), -127, 127).astype(np.int64)], 1)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    return P[first], N[first], inv.reshape(-1)[I]


def vertex_normals(P, I):
    v = P[I]
    n = np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0])
    N = np.zeros_like(P)
    for k in range(3):
        np.add.at(N, I[:, k], n)
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)


def write_glb(path, mid, meshes, extras):
    """meshes: {role: (P, N, I)} -> a GLB with a root node `mid` and one child per role."""
    bin_ = bytearray()
    views, accs, gmeshes, nodes, mats = [], [], [], [], []

    def add(arr, target, comp, typ, minmax=False):
        while len(bin_) % 4:
            bin_.append(0)
        off = len(bin_)
        bin_.extend(arr.tobytes())
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': arr.nbytes, 'target': target})
        a = {'bufferView': len(views) - 1, 'componentType': comp, 'count': int(arr.shape[0]), 'type': typ}
        if minmax:
            a['min'] = [float(x) for x in arr.min(0)]
            a['max'] = [float(x) for x in arr.max(0)]
        accs.append(a)
        return len(accs) - 1

    children = []
    for role, (P, N, I) in meshes.items():
        P32 = P.astype(np.float32)
        N8 = np.clip(np.round(N * 127), -127, 127).astype(np.int8)
        N8 = np.concatenate([N8, np.zeros((len(N8), 1), np.int8)], 1)  # pad to 4 bytes per vertex
        idx = I.reshape(-1).astype(np.uint16 if P.shape[0] < 65536 else np.uint32)
        pa = add(P32, 34962, 5126, 'VEC3', True)
        na = add(N8, 34962, 5120, 'VEC3')
        accs[na]['normalized'] = True
        views[accs[na]['bufferView']]['byteStride'] = 4  # int8 x3, padded to 4 bytes
        ia = add(idx.reshape(-1, 1), 34963, 5123 if idx.dtype == np.uint16 else 5125, 'SCALAR')
        accs[ia]['type'] = 'SCALAR'
        mats.append({'name': f'rm_{role}', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0.1, 'roughnessFactor': 0.5}})
        gmeshes.append({'name': role, 'primitives': [{'attributes': {'POSITION': pa, 'NORMAL': na}, 'indices': ia, 'material': len(mats) - 1}]})
        nodes.append({'name': role, 'mesh': len(gmeshes) - 1})
        children.append(len(nodes) - 1)
    nodes.append({'name': mid, 'children': children, 'extras': extras})
    j = {'asset': {'version': '2.0', 'generator': 'island-flight-sim tools/real-models/process.py'},
         'scene': 0, 'scenes': [{'nodes': [len(nodes) - 1]}], 'nodes': nodes, 'meshes': gmeshes, 'materials': mats,
         'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(bin_)}]}
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    while len(bin_) % 4:
        bin_.append(0)
    total = 12 + 8 + len(js) + 8 + len(bin_)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack('<II', len(bin_), 0x004E4942))
        f.write(bin_)
    return total


def cluster(P, N, I, cell, smooth=0):
    """Vertex clustering: every vertex snapped to the middle of its cell, triangles that collapse dropped,
    normals recomputed per face -- flat, or (smooth = a crease angle in degrees) smoothed where faces
    meet within that angle."""
    key = np.floor(P / cell).astype(np.int64)
    _, rep, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    # the cell's vertex: the mean of what fell in it
    cnt = np.bincount(inv)
    Pc = np.stack([np.bincount(inv, P[:, k]) / cnt for k in range(3)], 1)
    J = inv[I]
    ok = (J[:, 0] != J[:, 1]) & (J[:, 1] != J[:, 2]) & (J[:, 0] != J[:, 2])
    J = J[ok]
    # unique triangles only (two faces of a thin part can collapse onto each other)
    J = np.unique(np.sort(J, 1), axis=0, return_index=True)[1]
    J = inv[I][ok][np.sort(J)]
    v = Pc[J]
    fa = np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0])  # twice the area, along the normal
    fn = fa / np.maximum(np.linalg.norm(fa, axis=1, keepdims=True), 1e-12)
    Pf = v.reshape(-1, 3)
    if smooth:
        # Smooth where faces meet within `smooth` degrees, a crease elsewhere: each corner's
        # normal is the area-weighted sum of the faces round its vertex that face its way.
        # (Flat-shaded, a wing of 3 cm facets read as lumpy from the chase camera.)
        cosk = np.cos(np.radians(smooth))
        corner_v = J.reshape(-1)
        corner_f = np.repeat(np.arange(len(J)), 3)
        order = np.argsort(corner_v, kind='stable')
        cv, cf = corner_v[order], corner_f[order]
        starts = np.flatnonzero(np.r_[True, cv[1:] != cv[:-1]])
        sizes = np.diff(np.r_[starts, len(cv)])
        # every (corner, neighbour face) pair at the same vertex
        rep = np.repeat(sizes, sizes)
        grp_start = np.repeat(starts, sizes)
        a_idx = np.repeat(np.arange(len(cv)), rep)
        off = np.arange(len(a_idx)) - np.repeat(np.cumsum(rep) - rep, rep)
        b_idx = np.repeat(grp_start, rep) + off
        fa_, fb_ = cf[a_idx], cf[b_idx]
        w = ((fn[fa_] * fn[fb_]).sum(1) >= cosk)[:, None] * fa[fb_]
        acc = np.zeros((len(cv), 3))
        np.add.at(acc, a_idx, w)
        Nc = np.empty_like(acc)
        Nc[order] = acc
        Nf = Nc / np.maximum(np.linalg.norm(Nc, axis=1, keepdims=True), 1e-12)
    else:
        # flat-shaded output: three vertices per face, each with the face's normal
        Nf = np.repeat(fn, 3, axis=0)
    If = np.arange(len(Pf)).reshape(-1, 3)
    key2 = np.concatenate([np.round(Pf / 1e-4).astype(np.int64), np.clip(np.round(Nf * 127), -127, 127).astype(np.int64)], 1)
    _, first, inv2 = np.unique(key2, axis=0, return_index=True, return_inverse=True)
    return Pf[first], Nf[first], inv2.reshape(-1)[If]


def run(mid, view=None):
    out, log, cfg, ref = process(mid)
    meshes = {r: merge(ch) for r, ch in out.items() if ch}
    if cfg.get('cluster'):
        before = sum(len(m[2]) for m in meshes.values())
        meshes = {r: cluster(*m, cfg['cluster'], cfg.get('smooth', 0)) for r, m in meshes.items()}
        meshes = {r: m for r, m in meshes.items() if len(m[2])}
        print(f'    clustered at {cfg["cluster"] * 100:.0f} cm: {before} -> {sum(len(m[2]) for m in meshes.values())} triangles')
    allP = np.concatenate([m[0] for m in meshes.values()])
    lo, hi = allP.min(0), allP.max(0)
    tris = sum(len(m[2]) for m in meshes.values())
    extras = {
        'realModel': 1, 'id': mid, 'credit': cfg['credit'], 'license': 'CC BY 4.0',
        'changes': 'repainted to the game\'s parody liveries (all source textures removed), landing gear and interior removed, refitted to the game\'s airframe',
        'length': round(float(hi[2] - lo[2]), 3), 'span': round(float(hi[0] - lo[0]), 3), 'triangles': int(tris),
    }
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'{mid}.glb')
    size = write_glb(path, mid, meshes, extras)
    b = ref['bounds']
    L = b['max'][2] - b['min'][2]
    span = cfg.get('span') or ref['realSpan']
    print(f'{mid}: {tris} tris, {size / 1024:.0f} KB, length {hi[2] - lo[2]:.2f} (game {L:.2f}), span {hi[0] - lo[0]:.2f} (real {span}), '
          f'z {lo[2]:.2f}..{hi[2]:.2f} y {lo[1]:.2f}..{hi[1]:.2f}')
    for line in log:
        print('   ', line)
    if view:
        from view import sheet
        COL = {'skin_l': (0.95, 0.95, 0.97), 'skin_r': (0.85, 0.88, 0.95), 'fin': (0.2, 0.4, 0.9), 'wing': (0.7, 0.72, 0.76),
               'cowl': (0.95, 0.6, 0.2), 'lip': (0.9, 0.9, 0.5), 'duct': (0.2, 0.2, 0.25), 'core': (0.5, 0.5, 0.5),
               'glass': (0.1, 0.8, 0.9), 'window': (0.1, 0.1, 0.5), 'dark': (0.15, 0.15, 0.15), 'metal': (0.6, 0.6, 0.6), 'prop': (0.3, 0.3, 0.3)}
        prims = [dict(pos=m[0], idx=m[2], mat=r) for r, m in meshes.items()]
        # the game's gear contact points as small markers
        sheet(prims, view, label=f'{mid} roles', colours=COL)


if __name__ == '__main__':
    args = sys.argv[1:]
    view = None
    if '--view' in args:
        k = args.index('--view')
        view = args[k + 1]
        args = args[:k] + args[k + 2:]
    for mid in args:
        run(mid, view.replace('%', mid) if view else None)
