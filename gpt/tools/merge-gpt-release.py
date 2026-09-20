#!/usr/bin/env python3
"""
Port this project's own features onto a new ChatGPT release.

ChatGPT ships a whole rebuilt tree every time (v32, v35, ...), and each one is
better than the last at the things it is good at: models, the helicopter, the
emergency system, the offline cache. What it never has is the work done here —
the chase, the damage model, the air base, Dev mode, the phone layout.

Doing that by hand once was a long afternoon. Doing it twice was the signal to
write it down. Every port below is anchor-based, so it either applies cleanly
or says loudly that the anchor has moved — which is exactly what you want to
hear when their tree has changed underneath you.

    python3 tools/merge-gpt-release.py <path-to-their-tree> <output-dir>

IMPORTANT: some ports are deliberately absent because a later release solved
the same problem better. v35 made RUNWAY a set of live getters off AIRPORT,
which is a cleaner answer than this project's refreshRunways(), so that port
was retired rather than re-applied. Check their changelog before assuming a
port is still needed.
"""
import os, re, shutil, subprocess, sys

MINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class Port:
    def __init__(self, name):
        self.name = name
        self.notes = []
    def ok(self, msg): self.notes.append(('ok', msg))
    def skip(self, msg): self.notes.append(('skip', msg))
    def fail(self, msg): self.notes.append(('FAIL', msg))

def read(p): return open(p, encoding='utf-8').read()
def write(p, s): open(p, 'w', encoding='utf-8').write(s)

def slice_between(text, start, end, what):
    i = text.index(start)
    j = text.index(end, i)
    return text[i:j]

def port_files(dst, rep):
    """Files that are ours alone — copied wholesale."""
    for rel in ['tests/selftest.js', 'tests/playtest.js', 'src/game/pursuer.js']:
        src = os.path.join(MINE, rel)
        if not os.path.exists(src):
            rep.skip(f'{rel} not in this tree'); continue
        os.makedirs(os.path.dirname(os.path.join(dst, rel)), exist_ok=True)
        shutil.copy2(src, os.path.join(dst, rel))
        rep.ok(rel)

def port_notify(dst, rep):
    """sim.notify — their tree calls hud.notify directly and drops the forwarder."""
    p = os.path.join(dst, 'src/main.js'); s = read(p)
    if re.search(r'\n  notify\(text', s): return rep.skip('already present')
    m = re.search(r"\n  speak\(text[^\n]*\{\n(?:[^\n]*\n)*?  \}\n", s)
    if not m: return rep.fail('speak() anchor not found')
    write(p, s[:m.end()] + """
  /** A one-line message on screen. Missions and the self-test call this. */
  notify(text, kind = 'info', seconds) {
    this.hud.notify(text, kind, seconds);
  }
""" + s[m.end():])
    rep.ok('sim.notify restored')

def port_hardpoint_parts(dst, rep):
    """Name each hard point. Their own partId is undefined without this."""
    p = os.path.join(dst, 'src/aircraft/types.js'); s = read(p)
    if "part: 'nose'" in s: return rep.skip('already named')
    subs = [
      ("what: shape.power.kind === 'jet' ? 'The nose struck the ground' : 'The propeller struck the ground',",
       "what: shape.power.kind === 'jet' ? 'The nose struck the ground' : 'The propeller struck the ground',\n        part: 'nose', partId: 'nose',"),
      ("what: 'The left wing tip hit the ground' }", "what: 'The left wing tip hit the ground', part: 'leftWing', partId: 'leftWing' }"),
      ("what: 'The right wing tip hit the ground' }", "what: 'The right wing tip hit the ground', part: 'rightWing', partId: 'rightWing' }"),
      ("what: 'The tail struck the ground' }", "what: 'The tail struck the ground', part: 'tail', partId: 'tail' }"),
      ("what: 'The belly hit the ground' }", "what: 'The belly hit the ground', part: 'fuselage', partId: 'fuselage' }"),
    ]
    n = 0
    for old, new in subs:
        if old in s: s = s.replace(old, new, 1); n += 1
    write(p, s)
    rep.ok(f'{n}/5 hard points named') if n == 5 else rep.fail(f'only {n}/5 matched')

PORTS = [
    ('files ours alone', port_files),
    ('sim.notify', port_notify),
    ('hard-point part names', port_hardpoint_parts),
]


def port_damage(dst, rep):
    """The damage model: a knock hurts a part instead of always ending it."""
    p = os.path.join(dst, 'src/aircraft/physics.js'); s = read(p)
    mine = read(os.path.join(MINE, 'src/aircraft/physics.js'))
    if 'takeHit(part, severity' in s: return rep.skip('already present')

    s = s.replace("  BOUNCE: 'bounce',", "  BOUNCE: 'bounce',\n  DAMAGE: 'damage',", 1)

    anchor = "    this._tmp2 = new THREE.Vector3();"
    if anchor not in s: return rep.fail('_tmp2 anchor missing')
    s = s.replace(anchor, anchor + """
    this._hitR = new THREE.Vector3();
    this._hitV = new THREE.Vector3();
    /* Battle damage, 0..1 per part — what happens TO you, as opposed to the
       `failures` you arm on purpose. A damaged aeroplane still flies. */
    this.damage = { leftWing: 0, rightWing: 0, nose: 0, tail: 0, fuselage: 0, gear: 0 };
    this.survivableStrikes = false;
    this._hitCool = 0;""", 1)

    m = re.search(r"\n    for \(const k in this\.failures\) this\.failures\[k\] = false;", s)
    if not m: return rep.fail('reset anchor missing')
    s = s[:m.end()] + "\n    for (const k in this.damage) this.damage[k] = 0;\n    this._hitCool = 0;" + s[m.end():]

    m = re.search(r"    const lift = qS \* CL \* aeroFade;", s)
    if not m: return rep.fail('lift anchor missing')
    s = s.replace(m.group(0), """    const dmg = this.damage;
    const wingHurt = (dmg.leftWing + dmg.rightWing) / 2;
    const wingAsym = dmg.leftWing - dmg.rightWing;
    const lift = qS * CL * aeroFade * (1 - wingHurt * 0.34);""", 1)
    s = s.replace("    const drag = qS * CD;",
        "    const drag = qS * (CD + wingHurt * 0.05 + dmg.nose * 0.03 + dmg.tail * 0.02 + dmg.fuselage * 0.04);", 1)

    m = re.search(r"    const thrust = [^;]+;", s)
    if m and 'noseHurt' not in m.group(0):
        s = s.replace(m.group(0), "    const noseHurt = 1 - dmg.nose * 0.55;\n" +
                      m.group(0).replace('* rough', '* rough * noseHurt'), 1)

    anchor = "    this._t.set(Cm * qS * c * aeroFade, Cn * qS * b * aeroFade, Cl * qS * b * aeroFade);"
    if anchor not in s: return rep.fail('torque anchor missing')
    s = s.replace(anchor, """    /* A hurt tail goes soft; a lopsided wing rolls you TOWARDS the bad side.
       Sign and gain measured at one known state: full aileron is about
       6 rad/s^2 and a destroyed wing is set to roughly a third of that. */
    const tailAuth = 1 - dmg.tail * 0.62;
    Cm *= tailAuth;
    Cn *= tailAuth;
    Cl += wingAsym * 0.025;

""" + anchor, 1)

    block = slice_between(mine, "  /**\n   * Hurt a part. The one way anything damages this aeroplane.",
                          "  crash(reason, contact = null) {", 'takeHit')
    m = re.search(r"\n  crash\(reason[^)]*\) \{", s)
    if not m: return rep.fail('crash() anchor missing')
    s = s[:m.start()+1] + block + s[m.start()+1:]
    s = s.replace("    if (!(hp.part in this.damage)) return false;",
                  "    const part = hp.part || hp.partId;\n    if (!(part in this.damage)) return false;")
    s = s.replace("    this.takeHit(hp.part, severity, what || hp.what);",
                  "    this.takeHit(part, severity, what || hp.what);")

    if 'glancingBlow(hp, world, surface)' not in s:
        m = re.search(r"      if \(world\.y < surface\) \{\n", s)
        if m:
            s = s[:m.end()] + "        // The sea is not survivable. Everything else might be.\n        if (!overWater && this.glancingBlow(hp, world, surface)) continue;\n" + s[m.end():]
        m2 = re.search(r"      const hit = obstacleAt\(world\.x, world\.y, world\.z\);\n      if \(hit\) \{\n", s)
        if m2:
            s = s[:m2.end()] + "        if (this.glancingBlow(hp, world, world.y, hit.what)) continue;\n" + s[m2.end():]

    m = re.search(r"\n    this\.onGround = this\.contactCount > 0;", s)
    if m: s = s[:m.start()] + "\n    if (this._hitCool > 0) this._hitCool -= dt;\n" + s[m.start():]
    write(p, s); rep.ok('physics: damage record, effects, takeHit, glancing blows')

def port_damage_panel(dst, rep):
    """The hit-area panel — where you were hit, at a glance."""
    p = os.path.join(dst, 'src/ui/hud.js'); s = read(p)
    mine = read(os.path.join(MINE, 'src/ui/hud.js'))
    if 'hud-damage' in s: return rep.skip('already present')
    panel = slice_between(mine, "    /*\n     * The damage panel", "    this.objectiveClock", 'panel')
    setter = slice_between(mine, "  /**\n   * Show where the aeroplane is hurt.", "  setObjective(title, text) {", 'setDamage')
    a1 = "    const right = el('div', 'hud-panel hud-right');"
    a2 = "  setObjective(title, text) {"
    if a1 not in s or a2 not in s: return rep.fail('hud anchors missing')
    s = s.replace(a1, panel + a1, 1).replace(a2, setter + a2, 1)
    m = re.search(r"\n    wrap\.appendChild\(right\);", s)
    if not m: return rep.fail('wrap.appendChild(right) missing')
    s = s[:m.end()] + "\n    wrap.appendChild(this.damagePanel);" + s[m.end():]
    write(p, s)
    css = read(os.path.join(dst, 'styles/main.css'))
    mycss = read(os.path.join(MINE, 'styles/main.css'))
    css += "\n" + slice_between(mycss, "/* ---- Damage: where you were hit", "/* ---- Mayday", 'damage css')
    write(os.path.join(dst, 'styles/main.css'), css)
    rep.ok('hit-area panel + styles')

def port_chase(dst, rep):
    """spawnPursuer/clearPursuer and the Shake the Tail mission."""
    p = os.path.join(dst, 'src/main.js'); s = read(p)
    mine = read(os.path.join(MINE, 'src/main.js'))
    if 'spawnPursuer' in s: return rep.skip('already present')
    block = slice_between(mine, "  /**\n   * A flight of three, close enough to see.",
                          "  /**\n   * Was that a survivable arrival?", 'pursuer methods')
    m = re.search(r"\n  quitToMenu\(", s)
    if not m: return rep.fail('quitToMenu anchor missing')
    s = s[:m.start()+1] + block + s[m.start()+1:]
    s = re.sub(r"(\n  quitToMenu\([^)]*\) \{\n)", r"\1    this.clearPursuer();\n", s, count=1)
    m = list(re.finditer(r"^import .*?;$", s, re.M))[-1]
    s = s[:m.end()] + "\nimport { Pursuer } from './game/pursuer.js';" + s[m.end():]
    m = re.search(r"\n    this\.crate = null;", s)
    if m: s = s[:m.end()] + "\n    this.traffic = [];\n    this.pursuers = [];\n    this.pursuer = null;" + s[m.end():]
    write(p, s)
    pm = os.path.join(dst, 'src/game/missions.js'); ms = read(pm)
    if "id: 'tail'" not in ms:
        mymis = read(os.path.join(MINE, 'src/game/missions.js'))
        tail = mymis[mymis.index("  /*\n   * Shake the Tail."):mymis.rindex("\n];")]
        # Their tree dropped the module-level `const ELEV = RUNWAY.elev`, because
        # v35 made RUNWAY a set of live getters and a snapshot would go stale.
        # Read it live, which is what their design wants anyway.
        if not re.search(r"^const ELEV", ms, re.M):
            tail = tail.replace('ELEV +', 'RUNWAY.elev +')
        i = ms.rindex("\n];")
        ms = ms[:i] + "\n" + tail + ms[i:]
        if "import { Pursuer }" not in ms:
            ms = ms.replace("import { UNITS } from '../aircraft/physics.js';",
                            "import { UNITS } from '../aircraft/physics.js';\nimport { Pursuer } from './pursuer.js';", 1)
        write(pm, ms)
    rep.ok('chase wired + tail mission')

def port_airbase(dst, rep):
    p = os.path.join(dst, 'src/world/maps.js'); s = read(p)
    if "id: 'airbase'" in s: return rep.skip('already present')
    mine = read(os.path.join(MINE, 'src/world/maps.js'))
    block = slice_between(mine, "  /**\n   * Ironhead Air Base.", "  {\n    id: 'sfo',", 'airbase')
    if "  {\n    id: 'sfo'," not in s: return rep.fail('sfo anchor missing')
    write(p, s.replace("  {\n    id: 'sfo',", block + "  {\n    id: 'sfo',", 1))
    ps = os.path.join(dst, 'src/world/scenery.js'); ss = read(ps)
    if 'addAirBase' not in ss:
        mysc = read(os.path.join(MINE, 'src/world/scenery.js'))
        fn = slice_between(mysc, "/**\n * A military air base:", "export class Scenery {", 'addAirBase')
        ss = ss.replace("export class Scenery {", fn + "export class Scenery {", 1)
        # Their constructor is one long minified-ish line, so match the call
        # anywhere rather than at the start of a line.
        m = re.search(r"scene\.add\(this\.group\);", ss)
        if m: ss = ss[:m.start()] + "\n    this.base = addAirBase(this.group, cfg.base);\n    " + ss[m.start():]
        else: rep.fail('scene.add(this.group) not found in Scenery')
        write(ps, ss)
    rep.ok('Ironhead Air Base + scenery')

def port_devmode(dst, rep):
    p = os.path.join(dst, 'src/game/progression.js'); s = read(p)
    if 'DEV_CODE' in s: return rep.skip('already present')
    mine = read(os.path.join(MINE, 'src/game/progression.js'))
    const = slice_between(mine, "/**\n * Dev mode.", "export const DEV_CODE = 'DEV1234';", 'dev const') + "export const DEV_CODE = 'DEV1234';"
    funcs = slice_between(mine, "/** Is the workbench open? */", "export function costOf(aircraftId) {", 'dev funcs')
    if 'export const MILITARY_CODE' not in s: return rep.fail('MILITARY_CODE anchor missing')
    i = s.index('export const MILITARY_CODE'); j = s.index('\n', s.index(';', i))
    s = s[:j+1] + "\n" + const + "\n" + s[j+1:]
    if 'export function costOf(aircraftId) {' in s:
        s = s.replace('export function costOf(aircraftId) {', funcs + 'export function costOf(aircraftId) {', 1)
    s = s.replace('    militaryUnlocked: false,', '    militaryUnlocked: false,\n    devUnlocked: false,', 1)
    write(p, s); rep.ok('Dev mode')

def port_css_and_small(dst, rep):
    mycss = read(os.path.join(MINE, 'styles/main.css'))
    css = read(os.path.join(dst, 'styles/main.css'))
    if 'PHONE LAYOUT' not in css:
        css += "\n" + mycss[mycss.index("/* =========================================================================\n   PHONE LAYOUT"):]
        write(os.path.join(dst, 'styles/main.css'), css)
        rep.ok('phone layout')
    else: rep.skip('phone layout already there')

    p = os.path.join(dst, 'src/world/weather.js'); s = read(p)
    if 'effectiveCondition' not in s:
        m = re.search(r"\n  temporaryCondition\(", s)
        if m:
            s = s[:m.start()] + """
  /** The weather actually in force — a temporary condition beats the base. */
  get effectiveCondition() {
    return this._tempCond ? this._tempCond.id : this.condition;
  }
""" + s[m.start():]
            s = s.replace("if (this.condition === 'stormy') {", "if (this.effectiveCondition === 'stormy') {", 1)
            write(p, s); rep.ok('lightning during temporary storms')
        else: rep.fail('temporaryCondition anchor missing')

    p = os.path.join(dst, 'src/flight/camera.js'); s = read(p)
    if '_tmp3' not in s:
        m = re.search(r"const aim = this\._tmp2?\.copy\(this\.lookAt\);", s)
        if m:
            s = s.replace(m.group(0), "const aim = this._tmp3.copy(this.lookAt);")
            s = s.replace("    this._tmp2 = new THREE.Vector3();",
                          "    this._tmp2 = new THREE.Vector3();\n    this._tmp3 = new THREE.Vector3();", 1)
            write(p, s); rep.ok('look-behind aliasing')
        else: rep.skip('their camera differs; look-behind not patched')

PORTS += [
    ('damage model', port_damage),
    ('damage panel', port_damage_panel),
    ('chase', port_chase),
    ('air base', port_airbase),
    ('dev mode', port_devmode),
    ('css + small fixes', port_css_and_small),
]

def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(2)
    theirs, dst = sys.argv[1], sys.argv[2]
    if os.path.exists(dst): shutil.rmtree(dst)
    shutil.copytree(theirs, dst, ignore=shutil.ignore_patterns('.git', '__MACOSX', '.DS_Store'))
    print(f'base: {theirs}\nout:  {dst}\n')
    bad = 0
    for name, fn in PORTS:
        rep = Port(name)
        try: fn(dst, rep)
        except Exception as e: rep.fail(f'{type(e).__name__}: {e}')
        for kind, msg in rep.notes:
            print(f'  [{kind:4}] {name}: {msg}')
            if kind == 'FAIL': bad += 1
    print(f'\n{"PORTS FAILED — anchors moved, fix before trusting this tree" if bad else "all scripted ports applied"}')
    sys.exit(1 if bad else 0)

if __name__ == '__main__':
    main()
