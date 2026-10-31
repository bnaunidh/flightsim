/**
 * The dev console: a command line for the owner, inside Dev mode.
 *
 * The owner, 2026-10-30: "in dev mode add a console where i can be like
 * /runcmd allaircraft (unlocks all aircraft)". So: a "Console" button in the
 * Dev mode panel (devActions, like every other plug-in's). Nothing here
 * exists for a player who has not been let into Dev mode.
 *
 *   /runcmd allaircraft      unlock every aircraft in the hangar
 *   /runcmd credits <n>      set your credits to n
 *   /runcmd addcredits <n>   add n credits
 *   /runcmd unlock <id>      unlock one aircraft (ids: /runcmd list)
 *   /runcmd list             every aircraft id
 *   /runcmd help             this list
 *   /clear                   clear the console
 *
 * "/runcmd" is optional ("allaircraft" works on its own). Typing in the box
 * never reaches the game's keys. Changes go to the live progression object
 * (sim.prog, which the menus share) and are saved at once.
 */

import { registerExtension } from '../game/extensions.js';
import * as Prog from '../game/progression.js';
import { AIRCRAFT } from '../aircraft/types.js';

const S = { root: null, log: null, input: null, sim: null, history: [], at: 0 };

const CSS = `
.dcon { position: fixed; left: 50%; top: 12%; transform: translateX(-50%); z-index: 120; width: min(640px, calc(100vw - 24px));
  background: rgba(8, 12, 20, 0.94); border: 1px solid rgba(160, 195, 240, 0.25); border-radius: 12px; box-shadow: 0 18px 50px rgba(0,0,0,0.5);
  font: 13px/1.45 "SF Mono", ui-monospace, Menlo, Consolas, monospace; color: #dfe8f3; }
.dcon[hidden] { display: none; }
.dcon-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid rgba(160, 195, 240, 0.15);
  font: 600 12px/1 system-ui, -apple-system, 'Segoe UI', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: #9fb2cc; }
.dcon-head button { min-width: 40px; min-height: 32px; border: 0; border-radius: 8px; background: rgba(255,255,255,0.08); color: #dfe8f3; font: inherit; cursor: pointer; }
.dcon-log { max-height: 42vh; overflow-y: auto; padding: 10px 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.dcon-log .ok { color: #7ee8b2; }
.dcon-log .err { color: #ff9a8a; }
.dcon-log .cmd { color: #58c6ff; }
.dcon-row { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid rgba(160, 195, 240, 0.15); }
.dcon-row input { flex: 1; min-height: 40px; padding: 0 10px; border-radius: 8px; border: 1px solid rgba(160, 195, 240, 0.25); background: rgba(255,255,255,0.05);
  color: #fff; font: inherit; }
.dcon-row button { min-height: 40px; padding: 0 14px; border: 0; border-radius: 8px; background: #58c6ff; color: #04111d; font: 700 13px/1 system-ui, sans-serif; cursor: pointer; }
`;

function prog(sim) {
  return (sim && sim.prog) || Prog.load();
}

function print(text, cls = '') {
  if (!S.log) return;
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = text;
  S.log.appendChild(line);
  S.log.scrollTop = S.log.scrollHeight;
}

function commit(sim, p) {
  const saved = Prog.save(p);
  if (sim && sim.menus && typeof sim.menus.syncMissionLocks === 'function') sim.menus.syncMissionLocks();
  return saved;
}

const HELP = [
  '/runcmd allaircraft      unlock every aircraft',
  '/runcmd credits <n>      set your credits',
  '/runcmd addcredits <n>   add credits',
  '/runcmd unlock <id>      unlock one aircraft',
  '/runcmd list             every aircraft id',
  '/runcmd help             this list',
  '/clear                   clear the console',
].join('\n');

/** Run one line. Exported for the tests: returns { ok, text }. */
export function runLine(sim, line) {
  const words = String(line || '').trim().replace(/^\/runcmd\b/i, '').trim().replace(/^\//, '').split(/\s+/).filter(Boolean);
  const cmd = (words[0] || '').toLowerCase();
  const arg = words[1];
  const p = prog(sim);
  const num = (s) => {
    const n = Math.round(Number(String(s || '').replace(/[,_]/g, '')));
    return Number.isFinite(n) && n >= 0 && n <= Prog.CODE_AMOUNT_MAX ? n : null;
  };
  switch (cmd) {
    case '':
    case 'help':
      return { ok: true, text: HELP };
    case 'clear':
      if (S.log) S.log.textContent = '';
      return { ok: true, text: '' };
    case 'allaircraft': {
      const before = p.unlocked.length;
      p.unlocked = [...new Set([...p.unlocked, ...AIRCRAFT.map((a) => a.id)])];
      const saved = commit(sim, p);
      return { ok: true, text: `Unlocked all ${AIRCRAFT.length} aircraft (${p.unlocked.length - before} new).${saved ? '' : ' (This browser would not save it.)'}` };
    }
    case 'unlock': {
      const t = AIRCRAFT.find((a) => a.id === String(arg || '').toLowerCase());
      if (!t) return { ok: false, text: `No aircraft "${arg || ''}". Try /runcmd list.` };
      if (!p.unlocked.includes(t.id)) p.unlocked.push(t.id);
      commit(sim, p);
      return { ok: true, text: `Unlocked ${t.name || t.id}.` };
    }
    case 'list':
      return { ok: true, text: AIRCRAFT.map((a) => `${a.id}  ${a.name || ''}`).join('\n') };
    case 'credits':
    case 'addcredits': {
      const n = num(arg);
      if (n == null) return { ok: false, text: `Give a number, e.g. /runcmd ${cmd} 5000` };
      p.credits = cmd === 'credits' ? n : Math.min(Prog.CODE_AMOUNT_MAX, (p.credits || 0) + n);
      commit(sim, p);
      return { ok: true, text: `Credits: ${Prog.formatCredits(p.credits)}.` };
    }
    default:
      return { ok: false, text: `Unknown command "${cmd}". Type /runcmd help.` };
  }
}

function build() {
  if (S.root || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.className = 'dcon';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Dev console');
  root.innerHTML = `<div class="dcon-head"><span>Dev console</span><button type="button" data-dcon-close aria-label="Close">✕</button></div>
    <div class="dcon-log" data-dcon-log></div>
    <form class="dcon-row" data-dcon-form><input type="text" data-dcon-input placeholder="/runcmd allaircraft" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"><button type="submit">Run</button></form>`;
  document.body.appendChild(root);
  S.root = root;
  S.log = root.querySelector('[data-dcon-log]');
  S.input = root.querySelector('[data-dcon-input]');
  root.querySelector('[data-dcon-close]').addEventListener('click', close);
  // Typing here is never a game key (and Esc / the arrows work like a terminal's).
  S.input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowUp' && S.history.length) { S.at = Math.max(0, S.at - 1); S.input.value = S.history[S.at] || ''; e.preventDefault(); }
    else if (e.key === 'ArrowDown' && S.history.length) { S.at = Math.min(S.history.length, S.at + 1); S.input.value = S.history[S.at] || ''; e.preventDefault(); }
  });
  S.input.addEventListener('keyup', (e) => e.stopPropagation());
  root.querySelector('[data-dcon-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    const line = S.input.value.trim();
    if (!line) return;
    S.history.push(line);
    S.at = S.history.length;
    S.input.value = '';
    print(`> ${line}`, 'cmd');
    const r = runLine(S.sim, line);
    if (r.text) print(r.text, r.ok ? 'ok' : 'err');
  });
}

export function open(sim) {
  S.sim = sim;
  build();
  if (!S.root) return;
  S.root.hidden = false;
  if (!S.log.textContent) print('Type /runcmd help for the commands.');
  S.input.focus();
}

export function close() {
  if (S.root) S.root.hidden = true;
}

export function isOpen() {
  return !!(S.root && !S.root.hidden);
}

registerExtension({
  id: 'dev-console',
  install(sim) {
    S.sim = sim;
  },
  devActions: [
    {
      label: 'Console',
      hint: '/runcmd allaircraft, credits and more',
      run(sim) { open(sim); },
    },
  ],
});
