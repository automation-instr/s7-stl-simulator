/**
 * S7 project model for the MC7 viewer: interfaces, symbols, DB offsets.
 * Interfaces come from the block's own subblocks (type 5 for FC, type 4 for FB),
 * so compiled-only blocks still describe their parameters.
 * Semantics validated on the MORE PLC ground truth; see docs/MC7.md.
 */

export interface IfaceParam { name: string; section: 'IN' | 'IN_OUT' | 'OUT' | 'TEMP' | 'STAT'; type: string }

/** Parse FC interface text (VAR_INPUT/VAR_IN_OUT/VAR_OUTPUT/VAR_TEMP). Order preserved. */
export function parseFcInterface(txt: string): IfaceParam[] {
  const out: IfaceParam[] = [];
  let cur: IfaceParam['section'] | null = null;
  for (let line of txt.split('\n')) {
    line = line.split('//')[0].trim();
    if (line.startsWith('VAR_INPUT')) cur = 'IN';
    else if (line.startsWith('VAR_IN_OUT')) cur = 'IN_OUT';
    else if (line.startsWith('VAR_OUTPUT')) cur = 'OUT';
    else if (line.startsWith('VAR_TEMP')) cur = 'TEMP';
    else if (line.startsWith('END_VAR')) cur = null;
    else if (cur) {
      const m = /^(\w+)\s*:\s*(\w+)/.exec(line);
      if (m) out.push({ name: m[1].toUpperCase(), section: cur, type: m[2].toUpperCase() });
    }
  }
  return out;
}

const SZ: Record<string, number> = {
  BOOL: 0, BYTE: 1, CHAR: 1, WORD: 2, INT: 2, DATE: 2, S5TIME: 2, TIMER: 2, COUNTER: 2, BLOCK_DB: 2,
  DWORD: 4, DINT: 4, REAL: 4, TIME: 4, DATE_AND_TIME: 8,
};

export interface FbOffset { byte: number; bit: number | null; size: number | null }

/** Parse FB interface text and compute instance-data offsets (S7 alignment). */
export function parseFbInterface(txt: string): { params: IfaceParam[]; offsets: Map<string, FbOffset> } {
  const params: IfaceParam[] = [];
  const offsets = new Map<string, FbOffset>();
  let cur: IfaceParam['section'] | null = null;
  let byte = 0, bit = 0;
  const lines = txt.split('\n');
  let i = 0;
  const put = (nm: string, ty: string) => {
    const z = SZ[ty] ?? 2;
    if (z === 0) {
      offsets.set(nm, { byte, bit, size: null });
      bit += 1;
      if (bit === 8) { bit = 0; byte += 1; }
    } else {
      if (bit) { bit = 0; byte += 1; }
      if (z >= 2 && byte % 2) byte += 1;
      offsets.set(nm, { byte, bit: null, size: z });
      byte += z;
    }
  };
  while (i < lines.length) {
    const line = lines[i].split('//')[0].trim(); i += 1;
    if (line.startsWith('VAR_INPUT')) cur = 'IN';
    else if (line.startsWith('VAR_IN_OUT')) cur = 'IN_OUT';
    else if (line.startsWith('VAR_OUTPUT')) cur = 'OUT';
    else if (line.startsWith('VAR_TEMP')) cur = 'TEMP';
    else if (line.startsWith('VAR')) cur = 'STAT';
    else if (line.startsWith('END_VAR')) {
      if (bit) { bit = 0; byte += 1; }
      if (byte % 2) byte += 1;
      cur = null;
    } else if (cur && cur !== 'TEMP') {
      const m = /^(\w+)\s*:\s*(\w+)/.exec(line);
      if (m) {
        const nm = m[1].toUpperCase(), ty = m[2].toUpperCase();
        if (ty === 'STRUCT') {
          if (bit) { bit = 0; byte += 1; }
          if (byte % 2) byte += 1;
          while (i < lines.length) {
            const l2 = lines[i].split('//')[0].trim(); i += 1;
            if (l2.startsWith('END_STRUCT')) break;
            const m2 = /^(\w+)\s*:\s*(\w+)/.exec(l2);
            if (m2) {
              const nm2 = nm + '.' + m2[1].toUpperCase(), ty2 = m2[2].toUpperCase();
              params.push({ name: nm2, section: cur, type: ty2 });
              put(nm2, ty2);
            }
          }
          if (bit) { bit = 0; byte += 1; }
          if (byte % 2) byte += 1;
          params.push({ name: nm, section: cur, type: 'STRUCT' });
          continue;
        }
        params.push({ name: nm, section: cur, type: ty });
        put(nm, ty);
      }
    }
  }
  return { params, offsets };
}

/** Project snapshot: the shape the PWA builds in-browser from the offline DBF/DBT files. */
export interface ProjectSnapshot {
  blocks: Record<string, { code?: string; interface?: string }>;
  dbs: Record<string, { declaration?: string; instanceOf?: string }>;
  symbols: Record<string, string>;
}

export class S7Project {
  constructor(public snap: ProjectSnapshot) {}
  private ifcCache = new Map<string, IfaceParam[]>();
  private fbCache = new Map<string, { params: IfaceParam[]; offsets: Map<string, FbOffset> }>();

  blockCode(key: string): Uint8Array | null {
    const h = this.snap.blocks[key]?.code;
    if (!h) return null;
    const u = new Uint8Array(h.length / 2);
    for (let i = 0; i < u.length; i++) u[i] = parseInt(h.substr(i * 2, 2), 16);
    return u;
  }
  fcInterface(fc: number): IfaceParam[] | null {
    const key = 'FC' + fc;
    if (this.ifcCache.has(key)) return this.ifcCache.get(key)!;
    const txt = this.snap.blocks[key]?.interface;
    if (!txt) return null;
    const p = parseFcInterface(txt);
    this.ifcCache.set(key, p);
    return p;
  }
  fbInterface(fb: number) {
    const key = 'FB' + fb;
    if (this.fbCache.has(key)) return this.fbCache.get(key)!;
    const txt = this.snap.blocks[key]?.interface;
    if (!txt) return null;
    const p = parseFbInterface(txt);
    this.fbCache.set(key, p);
    return p;
  }
  /** symbol name -> absolute address string ("M 10.1", "DB 20", "FC 217", ...) */
  symbol(name: string): string | null {
    return this.snap.symbols[name.replace(/^"|"$/g, '').trim()] ?? null;
  }
}

/** Parse a DB declaration (STRUCT text from SUBBLK type 6) into offset -> dotted field path. */
export function parseDbOffsets(decl: string): Map<string, { byte: number; bit: number | null }> {
  const out = new Map<string, { byte: number; bit: number | null }>();
  let byte = 0, bit = 0;
  const stack: string[] = [];
  const put = (nm: string, ty: string, arr: number) => {
    let z = SZ[ty] ?? 2;
    if (ty === 'BOOL') {
      out.set(nm, { byte, bit });
      for (let k = 0; k < arr; k++) { bit++; if (bit === 8) { bit = 0; byte++; } }
      return;
    }
    if (bit) { bit = 0; byte++; }
    if (byte % 2) byte++;
    out.set(nm, { byte, bit: null });
    if (ty === 'STRING') z = 254;
    byte += z * arr;
  };
  for (const raw of decl.split('\n')) {
    const line = raw.split('//')[0].replace(/;.*$/, '').trim();
    if (!line) continue;
    if (/^END_STRUCT\b/i.test(line)) { stack.pop(); if (bit) { bit = 0; byte++; } if (byte % 2) byte++; continue; }
    const m = /^(\w+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const nm = (stack.length ? stack.join('.') + '.' : '') + m[1].toUpperCase();
    let ty = m[2].toUpperCase().replace(/:=.*$/, '').trim();
    if (/^STRUCT\b/.test(ty)) { if (bit) { bit = 0; byte++; } if (byte % 2) byte++; stack.push(m[1].toUpperCase()); continue; }
    let arr = 1;
    const am = /^ARRAY\s*\[\s*-?\d+\s*\.\.\s*(-?\d+)\s*\]\s*OF\s*(\w+)/.exec(ty) || /^ARRAY\s*\[\s*(-?\d+)\s*\.\./.exec(ty);
    const am2 = /^ARRAY\s*\[\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*\]\s*OF\s*(\w+)/.exec(ty);
    if (am2) { arr = +am2[2] - +am2[1] + 1; ty = am2[3]; }
    put(nm, ty.split(/\s/)[0], arr);
  }
  return out;
}

/** Reverse lookup: DB number + byte/bit -> "DB<n>.<field>" (top-level or dotted). */
export function dbFieldName(offsets: Map<string, { byte: number; bit: number | null }>, db: number, byte: number, bit?: number): string | null {
  let best: string | null = null;
  for (const [n, o] of offsets) {
    if (o.byte !== byte) continue;
    if (o.bit != null && bit != null && o.bit === bit) return `DB${db}.${n}`;
    if (o.bit == null && bit == null && (!best || n.split('.').length < best.split('.').length)) best = n;
  }
  return best ? `DB${db}.${best}` : null;
}
