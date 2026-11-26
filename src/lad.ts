/**
 * STL -> LAD (ladder) conversion, view-only.
 *
 * Scope (honest): pure bit-logic networks convert to rungs: A/AN/O/ON contacts,
 * one level of A(/O( parentheses, bare O, = / S / R coils, FP/FN edge elements,
 * L S5T#.. + timer op as a timer box, L a + T b as a MOVE box.
 * Anything else (jumps, labels, CALL, OPN, XOR, word logic, SET/CLR/NOT,
 * compares, multi-value expressions) makes that NETWORK fall back to STL text.
 * The simulator keeps running the STL; this is only a display.
 */

export interface LadContact { kind: 'no' | 'nc'; op: string }            // --| |-- / --|/--
export interface LadEdge { kind: 'p' | 'n'; op: string }                 // --(P)-- / --(N)-- mid element
export type LadElem = LadContact | LadEdge | LadGroup;
export interface LadGroup { kind: 'or'; branches: LadElem[][] }          // parallel branches
export interface LadCoil { kind: '=' | 'S' | 'R'; op: string }
export interface LadTimerBox { kind: 'timer'; timerOp: string; timer: string; tv: string }
export interface LadMoveBox { kind: 'move'; src: string; dst: string }
export type LadOut = LadCoil | LadTimerBox | LadMoveBox;
export interface LadRung { chain: LadElem[]; out: LadOut }
export interface LadNetwork { n: number; title: string; rungs: LadRung[]; stl: string[]; convertible: boolean; note?: string }

const CONTACT: Record<string, 'no' | 'nc'> = { A: 'no', AN: 'nc' };
const TIMER_OPS = new Set(['SD', 'SE', 'SP', 'SF', 'SS', 'SI', 'SV', 'SA', 'ZR', 'ZV']);
// display names for counter ops
const CNT_DISP: Record<string, string> = { ZV: 'CU', ZR: 'CD' };

/** Split source lines into networks (NETWORK markers or blank-line groups). */
export function splitNetworks(src: string): { n: number; title: string; lines: string[] }[] {
  const out: { n: number; title: string; lines: string[] }[] = [];
  let cur: string[] = [], title = '', n = 0, sawNetworkKw = false;
  const flush = () => { if (cur.length) { n++; out.push({ n, title, lines: cur }); } cur = []; title = ''; };
  for (const raw of src.split('\n')) {
    const t = raw.replace(/\/\/.*$/, '').trim();
    if (/^(ORGANIZATION_BLOCK|FUNCTION_BLOCK|FUNCTION|DATA_BLOCK|VAR\w*|END_VAR|BEGIN|END_\w+|VERSION|AUTHOR|FAMILY|NAME|KNOW_HOW_PROTECT)\b/i.test(t)) continue;
    if (/^NETWORK\b/i.test(t)) { sawNetworkKw = true; flush(); continue; }
    if (/^TITLE\s*=/i.test(t)) { title = t.replace(/^TITLE\s*=\s*/i, ''); continue; }
    if (!t) { if (!sawNetworkKw) flush(); continue; }
    cur.push(t);
  }
  flush();
  return out;
}

interface Parser {
  ok: boolean;
  note?: string;
}

/** Convert one network's statement lines into rungs (or mark non-convertible). */
export function convertNetwork(n: number, title: string, lines: string[]): LadNetwork {
  const fail = (note: string): LadNetwork => ({ n, title, rungs: [], stl: lines, convertible: false, note });
  // tokenize
  interface Tok { op: string; arg: string }
  const toks: Tok[] = [];
  for (const line of lines) {
    const m = /^(==[IDR]|<>[IDR]|>=[IDR]|<=[IDR]|>[IDR]|<[IDR]|=|[A-Za-z_+][A-Za-z0-9_+]*|\))\s*(.*)$/.exec(line);
    if (!m) return fail('cannot parse line: ' + line);
    let op = m[1].toUpperCase();
    let arg = m[2].trim().replace(/;$/, '');
    if ((op === 'A' || op === 'O' || op === 'AN' || op === 'ON') && arg === '(') { op += '('; arg = ''; }
    // normalize German timer mnemonics to display form
    const DE: Record<string, string> = { SI: 'SP', SV: 'SE', SS: 'SS', SA: 'SF', SE: 'SE' };
    if (TIMER_OPS.has(op) && DE[op]) op = op; // keep as written
    toks.push({ op, arg });
  }
  // group stack: each group is a list of branches; a branch is a series chain
  interface Frame { branches: LadElem[][]; chain: LadElem[] }
  const stack: Frame[] = [{ branches: [], chain: [] }];
  const top = () => stack[stack.length - 1];
  const closeChain = () => { const f = top(); if (f.chain.length) { f.branches.push(f.chain); f.chain = []; } };
  const rungs: LadRung[] = [];
  let pendingLoad: string | null = null;   // last L value, candidate for timer TV / MOVE src
  const endRung = (out: LadOut): LadNetwork | null => {
    closeChain();
    const f = top();
    if (stack.length !== 1) return fail('unbalanced parentheses');
    let chain: LadElem[];
    if (f.branches.length === 0) chain = [];
    else if (f.branches.length === 1) chain = f.branches[0];
    else chain = [{ kind: 'or', branches: f.branches }];
    rungs.push({ chain, out });
    f.branches = []; f.chain = [];
    pendingLoad = null;
    return null;
  };

  for (const tk of toks) {
    const { op, arg } = tk;
    if (op in CONTACT) {
      if (!arg) return fail(op + ' without operand');
      top().chain.push({ kind: CONTACT[op], op: arg });
      pendingLoad = null;
      continue;
    }
    if (op === 'O' || op === 'ON') {
      if (arg) { closeChain(); top().chain.push({ kind: op === 'O' ? 'no' : 'nc', op: arg }); }
      else closeChain(); // bare O: next chain is a new branch
      pendingLoad = null;
      continue;
    }
    if (op === 'AN(' || op === 'ON(') return fail(op + ' (negated group) is not convertible to LAD');
    if (op === 'A(' || op === 'O(') {
      if (op.startsWith('O')) closeChain();
      stack.push({ branches: [], chain: [] });
      pendingLoad = null;
      continue;
    }
    if (op === ')') {
      if (stack.length < 2) return fail(') without matching (');
      closeChain();
      const f = stack.pop()!;
      const g: LadGroup = { kind: 'or', branches: f.branches.length ? f.branches : [[]] };
      top().chain.push(g);
      pendingLoad = null;
      continue;
    }
    if (op === '=' || op === 'S' || op === 'R') {
      if (!arg) return fail(op + ' without operand');
      const bad = endRung({ kind: op, op: arg });
      if (bad) return bad;
      continue;
    }
    if (op === 'FP' || op === 'FN') {
      if (!arg) return fail(op + ' without operand');
      top().chain.push({ kind: op === 'FP' ? 'p' : 'n', op: arg });
      pendingLoad = null;
      continue;
    }
    if (op === 'L') {
      if (!arg) return fail('L without operand');
      pendingLoad = arg;
      continue;
    }
    if (op === 'T') {
      if (pendingLoad != null && arg) {
        // MOVE box: this consumes the whole current logic context; only valid as a standalone rung
        closeChain();
        const f = top();
        if (f.branches.length || stack.length !== 1) return fail('L/T inside bit logic (MOVE with logic) is not supported in LAD yet');
        rungs.push({ chain: [], out: { kind: 'move', src: pendingLoad, dst: arg } });
        pendingLoad = null;
        continue;
      }
      return fail('T without preceding L');
    }
    if (TIMER_OPS.has(op)) {
      if (!arg) return fail(op + ' without operand');
      const disp = CNT_DISP[op] ?? op;
      const bad = endRung({ kind: 'timer', timerOp: disp, timer: arg, tv: pendingLoad ?? '' });
      if (bad) return bad;
      continue;
    }
    if (op === 'NOP' || op === 'BLD') continue;
    // everything else is not representable in this MVP
    return fail(op + ' is not convertible to LAD yet');
  }
  closeChain();
  const f = top();
  if (stack.length !== 1) return fail('unbalanced parentheses');
  if (f.branches.length || f.chain.length || pendingLoad != null) {
    if (rungs.length === 0) return fail('network has no output (coil)');
    // trailing logic after the last coil: keep honest
    return fail('logic after the last coil is not supported in LAD yet');
  }
  if (!rungs.length) return fail('empty network');
  return { n, title, rungs, stl: lines, convertible: true };
}

export function convertAll(src: string): LadNetwork[] {
  return splitNetworks(src).map(nt => convertNetwork(nt.n, nt.title, nt.lines));
}
