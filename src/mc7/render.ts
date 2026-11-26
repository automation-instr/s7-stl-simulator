/**
 * Render a decoded MC7 stream (src/mc7/stream.ts) as display STL.
 *
 * Fidelity rules (see docs/MC7.md): the compiled binary is the ground truth.
 * Absolute operands render exactly as compiled; symbolic names come from the
 * symbol table by address (never assumed). Anything not understood renders as
 * RAW hex, never silently dropped.
 */
import { Instr } from './decode';
import { streamBlock, StreamEntry } from './stream';
import { S7Project } from './project';

export interface RenderCtx {
  /** absolute address ("M 10.3", "DB 10", "T 5") -> symbolic name, or null */
  symbolFor(addr: string): string | null;
  /** symbolic name for a block ("FC 217" -> "MFUNC_X"), or null */
  blockName(kind: string, num: number): string | null;
  /** field path inside a DB at byte/bit ("DB10".field), or null */
  dbField(db: number, byte: number, bit?: number): string | null;
  /** own-interface parameter name for a PARAMETER operand (2*(index+1)), or null */
  paramName?(operand: number): string | null;
}

export interface RenderLine {
  off: number;
  label?: string;
  text: string;
  comment?: string;
  cls: 'instr' | 'call' | 'param' | 'raw' | 'note' | 'bld';
}

const NULL_CTX: RenderCtx = { symbolFor: () => null, blockName: () => null, dbField: () => null };

function s5t(v: number): string {
  const base = [10, 100, 1000, 10000][(v >> 12) & 3];
  const n = ((v >> 8) & 0xf) * 100 + ((v >> 4) & 0xf) * 10 + (v & 0xf);
  const ms = n * base;
  if (ms % 3600000 === 0) return `S5T#${ms / 3600000}H`;
  if (ms % 60000 === 0) return `S5T#${ms / 60000}M`;
  if (ms % 1000 === 0) return `S5T#${ms / 1000}S`;
  return `S5T#${ms}MS`;
}

function f32(v: number): string | null {
  const b = new ArrayBuffer(4); new DataView(b).setUint32(0, v >>> 0);
  const f = new DataView(b).getFloat32(0);
  if (!isFinite(f)) return null;
  const a = Math.abs(f);
  if (f !== 0 && (a < 1e-6 || a > 1e12)) return null;
  return String(Math.round(f * 1e6) / 1e6);
}

/** Jump targets are instruction-start offsets; labels assigned in first-use order. */
export function fmtInstr(op: string, arg: unknown, ctx: RenderCtx, st: { db: number | null; di: number | null }, lbl: (off: number) => string): { text: string; comment?: string } {
  const sym = (a: string): string | null => ctx.symbolFor(a);
  const bit = (area: string, byte: number, b: number): { text: string; comment?: string } => {
    if (area === 'DBX' || area === 'DI') {
      const open = area === 'DBX' ? st.db : st.di;
      const t = `${op} ${area === 'DBX' ? 'DBX' : 'DIX'} ${byte}.${b}`;
      if (open != null) {
        const f = ctx.dbField(open, byte, b);
        if (f) return { text: t, comment: f };
      }
      return { text: t };
    }
    const abs = `${area} ${byte}.${b}`;
    const s = area === 'L' ? null : sym(abs);
    return { text: `${op} ${s ? `"${s}"` : abs}`, comment: s ? abs : undefined };
  };
  const word = (area: string, byte: number): { text: string; comment?: string } => {
    const abs = `${area} ${byte}`;
    const s = sym(abs);
    return { text: `${op} ${s ? `"${s}"` : abs}`, comment: s ? abs : undefined };
  };
  if (arg == null) return { text: op };
  const a = arg as unknown[];
  if (!Array.isArray(a)) {
    // TAR2LD / LAR2LD numeric arg
    return { text: `${op === 'TAR2LD' ? 'TAR2 LD ' : op === 'LAR2LD' ? 'LAR2 LD ' : op + ' '}${arg}` };
  }
  switch (a[0] as string) {
    case 'M': case 'I': case 'Q': case 'L': case 'DBX': case 'DI': {
      if (op === 'L' || op === 'T') {
        // L/T with byte size: ['L', byte, 'B'|'W'|'D']
        const sz = a[2] as string;
        return { text: `${op} L${sz} ${a[1]}` };
      }
      return bit(a[0] as string, a[1] as number, a[2] as number);
    }
    case 'MB': case 'MW': case 'MD': return word(a[0] as string, a[1] as number);
    case 'DBB': case 'DBW': case 'DBD': {
      const byte = a[1] as number;
      const r = { text: `${op} ${a[0]} ${byte}` } as { text: string; comment?: string };
      if (st.db != null) { const f = ctx.dbField(st.db, byte); if (f) r.comment = f; }
      return r;
    }
    case 'DIB': case 'DIW': case 'DID': {
      const byte = a[1] as number;
      const r = { text: `${op} ${a[0]} ${byte}` } as { text: string; comment?: string };
      if (st.di != null) { const f = ctx.dbField(st.di, byte); if (f) r.comment = f; }
      return r;
    }
    case 'DB': case 'DI': {
      const n = a[1] as number;
      const nm = ctx.blockName(a[0] as string, n);
      return { text: `${op} ${a[0]} ${n}`, comment: nm ? `"${nm}"` : undefined };
    }
    case 'T': case 'C': {
      const n = a[1] as number;
      const abs = `${a[0]} ${n}`;
      const s = sym(abs);
      return { text: `${op} ${s ? `"${s}"` : abs}`, comment: s ? abs : undefined };
    }
    case 'FC': case 'FB': case 'SFC': case 'SFB': {
      if (Array.isArray(a[1])) {
        const ind = a[1] as unknown[]; // ['IND', area, off]
        return { text: `${op} ${a[0]} [${ind[1]} ${ind[2]}]` };
      }
      const n = a[1] as number;
      const nm = ctx.blockName(a[0] as string, n);
      return { text: `${op} ${nm ? `"${nm}"` : a[0] + ' ' + n}`, comment: nm ? `${a[0]} ${n}` : undefined };
    }
    case 'CONST': {
      const v = a[1] as number;
      return { text: `L ${v >= 0x8000 ? v - 0x10000 : v}` };
    }
    case 'CONST32': {
      const v = a[1] as number;
      const f = f32(v);
      const hex = '16#' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
      return { text: `L ${hex}`, comment: f != null ? `= ${f}` : undefined };
    }
    case 'S5T': return { text: `L ${s5t(a[1] as number)}` };
    case 'REL': return { text: `${op} ${lbl((a[2] as number) + 2 * (a[1] as number))}` };
    case 'REAL': {
      const v = a[1] as number;
      const f = f32(v);
      const hex = '16#' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
      return f != null ? { text: `L ${f}`, comment: `= ${hex}` } : { text: `L ${hex}` };
    }
    case 'ST': return { text: `${op} ${a[1]}` };
    case 'PAR': {
      const nm = ctx.paramName ? ctx.paramName(a[1] as number) : null;
      return { text: `${op} ${nm ? '#' + nm : 'PAR ' + a[1]}` };
    }
    case 'IND': return { text: `${op} [${a[1]} ${a[2]}]` };
  }
  return { text: `${op} ?` };
}

/** Descriptor areas for CALL FC parameter pointers (bit addresses). */
const DAREA: Record<number, string> = { 0x81: 'I', 0x83: 'M', 0x84: 'DB', 0x85: 'Q', 0x86: 'DI', 0x87: 'L' };

interface Move { dstOff: number; dstBit: number | null; src: string }

/** Walk pre/post moves of an FB call frame and pair instance offsets with the other operand. */
function fbMoves(list: Instr[], ctx: RenderCtx, st: { db: number | null; di: number | null }, lbl: (o: number) => string): { intoInst: Move[]; fromInst: Move[] } {
  const intoInst: Move[] = [], fromInst: Move[] = [];
  let lastSrc: string | null = null;                 // bare operand text of the last loaded non-instance value
  let fromOff: number | null = null, fromBit: number | null = null; // instance offset of the last loaded instance value
  const local = { db: st.db, di: st.di };
  const isDi = (area: string | null) => area === 'DI' || area === 'DIB' || area === 'DIW' || area === 'DID';
  for (const d of list) {
    const a = Array.isArray(d[1]) ? (d[1] as unknown[]) : null;
    const area = a ? (a[0] as string) : null;
    if (d[0] === 'OPN') {
      if (area === 'DB') local.db = a![1] as number;
      if (area === 'DI') local.di = a![1] as number;
      lastSrc = null; fromOff = null; continue;
    }
    if (d[0] === 'L' || d[0] === 'A' || d[0] === 'AN' || d[0] === 'O' || d[0] === 'ON') {
      const f = fmtInstr(d[0], d[1], ctx, local, lbl);
      if (isDi(area)) { fromOff = a![1] as number; fromBit = area === 'DI' ? (a![2] as number) : null; lastSrc = null; }
      else { lastSrc = f.text.replace(/^\S+\s+/, '') + (f.comment ? `  // ${f.comment}` : ''); fromOff = null; }
      continue;
    }
    if (d[0] === '=' || d[0] === 'T') {
      if (isDi(area)) {
        if (lastSrc != null) intoInst.push({ dstOff: a![1] as number, dstBit: area === 'DI' ? (a![2] as number) : null, src: lastSrc });
      } else if (fromOff != null) {
        fromInst.push({ dstOff: fromOff, dstBit: fromBit, src: fmtInstr(d[0], d[1], ctx, local, lbl).text.replace(/^\S+\s+/, '') });
      }
      lastSrc = null; fromOff = null; continue;
    }
    lastSrc = null; fromOff = null;
  }
  return { intoInst, fromInst };
}

export function renderBlock(code: Uint8Array, proj: S7Project, ctx: RenderCtx = NULL_CTX): RenderLine[] {
  const seq = streamBlock(code, proj);
  // assign labels to jump targets in order of appearance
  const targets = new Set<number>();
  for (const e of seq) {
    if (e.kind === 'I' && Array.isArray(e.arg) && (e.arg as unknown[])[0] === 'REL') targets.add((e.arg as number[])[2] + 2 * (e.arg as number[])[1]);
  }
  const names = new Map<number, string>(); let ln = 0;
  for (const e of seq) if (e.kind === 'I' && e.off != null && targets.has(e.off)) { ln++; names.set(e.off, 'M' + String(ln).padStart(3, '0')); }
  const lbl = (o: number) => names.get(o) ?? 'M???';

  const out: RenderLine[] = [];
  const st = { db: null as number | null, di: null as number | null };
  const push = (off: number, text: string, cls: RenderLine['cls'], comment?: string) => {
    const line: RenderLine = { off, text, cls };
    if (names.has(off)) line.label = names.get(off);
    if (comment) line.comment = comment;
    out.push(line);
  };

  const pushInstr = (off: number, d: Instr, cls: RenderLine['cls'] = 'instr') => {
    if (d[0] === 'OPN' && Array.isArray(d[1])) {
      const a = d[1] as unknown[];
      if (a[0] === 'DB') st.db = a[1] as number;
      if (a[0] === 'DI') st.di = a[1] as number;
    }
    if (d[0] === 'CDB') { const t = st.db; st.db = st.di; st.di = t; }
    if (d[0] === 'BLD') { push(off, `BLD ${d[1]}`, 'bld'); return; }
    const f = fmtInstr(d[0], d[1], ctx, st, lbl);
    push(off, f.text, cls, f.comment);
  };

  for (const e of seq) {
    if (e.kind === 'I') { pushInstr(e.off, [e.op!, e.arg ?? null]); continue; }
    if (e.kind === 'RAW') { push(e.off, `? ${e.hex}  // not decoded`, 'raw'); continue; }
    if (e.kind === 'CALL') {
      const [tk, tn] = e.target!;
      const nm = ctx.blockName(tk, tn);
      push(e.off, `CALL ${nm ? `"${nm}"` : tk + ' ' + tn}`, 'call', nm ? `${tk} ${tn}` : undefined);
      // materialized scratch values from pre, and copy-back actuals from post
      const scratchVal = new Map<string, string>();
      {
        let last: string | null = null;
        for (const d of e.pre ?? []) {
          const a = Array.isArray(d[1]) ? (d[1] as unknown[]) : null;
          if (d[0] === 'OPN') { if (a && a[0] === 'DB') st.db = a[1] as number; last = null; continue; }
          if (d[0] === 'L') { const f = fmtInstr(d[0], d[1], ctx, st, lbl); last = f.text.replace(/^L /, ''); continue; }
          if (d[0] === 'T' && a && a[0] === 'L' && last != null) { scratchVal.set(`${a[1]}:${a[2]}`, last); last = null; continue; }
          last = null;
        }
      }
      const scratchAct = new Map<string, string>();
      {
        let last: string | null = null; let lastKey: string | null = null;
        for (const d of e.post ?? []) {
          const a = Array.isArray(d[1]) ? (d[1] as unknown[]) : null;
          if (d[0] === 'OPN') { if (a && a[0] === 'DB') st.db = a[1] as number; last = lastKey = null; continue; }
          if (d[0] === 'L' && a && a[0] === 'L') { lastKey = `${a[1]}:${a[2]}`; last = lastKey; continue; }
          if (d[0] === 'T' && lastKey != null) { scratchAct.set(lastKey, fmtInstr(d[0], d[1], ctx, st, lbl).text.replace(/^\S+\s+/, '')); last = lastKey = null; continue; }
          if ((d[0] === 'A' || d[0] === 'AN' || d[0] === 'O' || d[0] === 'ON') && a && a[0] === 'L') { lastKey = `${a[1]}.${a[2]}`; last = lastKey; continue; }
          if (d[0] === '=' && lastKey != null) { scratchAct.set(lastKey, fmtInstr(d[0], d[1], ctx, st, lbl).text.replace(/^\S+\s+/, '')); last = lastKey = null; continue; }
          last = lastKey = null;
        }
      }
      const ifc = proj.fcInterface(tn) ?? [];
      const ptype = new Map(ifc.map(p => [p.name, p.type]));
      for (const [pn, v] of e.params ?? []) {
        const b0 = v >>> 24, addr = v & 0xffff;
        const ty = ptype.get(pn) ?? '';
        let val: string;
        if (b0 === 0x00) {
          const n = (v >>> 8) & 0xffff;
          const kind = ty === 'BLOCK_DB' ? 'DB' : ty === 'TIMER' ? 'T' : ty === 'COUNTER' ? 'C' : '';
          const bn = kind ? ctx.blockName(kind, n) : null;
          val = kind ? (bn ? `"${bn}"` : `${kind} ${n}`) : `16#${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
          if (bn) val += `  // ${kind} ${n}`;
        } else if (DAREA[b0]) {
          const area = DAREA[b0], byte = addr >> 3, bitNo = addr & 7;
          if (area === 'L') {
            const sized = scratchVal.get(`${byte}:D`) ?? scratchVal.get(`${byte}:W`) ?? scratchVal.get(`${byte}:B`);
            const back = scratchAct.get(`${byte}.${bitNo}`) ?? scratchAct.get(`${byte}:D`) ?? scratchAct.get(`${byte}:W`) ?? scratchAct.get(`${byte}:B`);
            val = sized ?? back ?? `L ${byte}.${bitNo}`;
            if (back && sized) val = `${sized} -> ${back}`;
          } else {
            const abs = `${area} ${byte}.${bitNo}`;
            const s = ctx.symbolFor(abs);
            val = s ? `"${s}"` : abs;
            if (s) val += `  // ${abs}`;
          }
        } else {
          val = `16#${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}  // unrecognized descriptor`;
        }
        push(e.off, `      ${pn} := ${val}`, 'param');
      }
      continue;
    }
    if (e.kind === 'CALLFB') {
      const nm = ctx.blockName('FB', e.fb!);
      const inm = ctx.blockName('DB', e.inst!);
      push(e.off, `CALL ${nm ? `"${nm}"` : 'FB ' + e.fb} , ${inm ? `"${inm}"` : 'DB ' + e.inst}`, 'call',
        `${nm ? 'FB ' + e.fb + ' , ' : ''}DB ${e.inst}`);
      const fbi = proj.fbInterface(e.fb!);
      const nameAt = (off: number, bit: number | null): string | null => {
        if (!fbi) return null;
        for (const [n, o] of fbi.offsets) {
          if (o.byte !== off) continue;
          if ((o.bit ?? null) === (bit ?? null)) return n;
          if (o.bit == null && bit == null) return n;
        }
        return null;
      };
      st.di = e.inst!;
      const { intoInst, fromInst } = fbMoves([...(e.pre ?? []), ...(e.post ?? [])], ctx, st, lbl);
      const shown = new Set<string>();
      for (const mv of intoInst) {
        const n = nameAt(mv.dstOff, mv.dstBit);
        if (n && shown.has(n)) continue;
        if (n) shown.add(n);
        push(e.off, `      ${n ?? `DI ${mv.dstOff}${mv.dstBit != null ? '.' + mv.dstBit : ''}`} := ${mv.src}`, 'param');
      }
      for (const mv of fromInst) {
        const n = nameAt(mv.dstOff, mv.dstBit);
        if (n && shown.has(n)) continue;
        if (n) shown.add(n);
        push(e.off, `      ${n ?? `DI ${mv.dstOff}${mv.dstBit != null ? '.' + mv.dstBit : ''}`} := ${mv.src}`, 'param');
      }
      if (!intoInst.length && !fromInst.length && (e.pre?.length || e.post?.length)) {
        push(e.off, '      // parameter moves (unmatched form):', 'note');
        for (const d of [...(e.pre ?? []), ...(e.post ?? [])]) pushInstr(e.off, d, 'param');
      }
      continue;
    }
  }
  return out;
}
