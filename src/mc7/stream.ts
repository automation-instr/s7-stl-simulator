/**
 * Source-free MC7 block stream decoder: walks a compiled block and folds
 * CALL frames (FC/SFC via descriptor blocks, FB/SFB via instance-DB frames)
 * into single entries. Validated: on the 6 ground-truth blocks it consumes
 * every byte (RAW=0) and every call region matches the source-aligned
 * byte-exact walk exactly (see docs/MC7.md).
 */
import { decode, w1at, Instr } from './decode';
import { S7Project } from './project';

export interface StreamEntry {
  kind: 'I' | 'CALL' | 'CALLFB' | 'RAW';
  off: number;
  op?: string; arg?: unknown;            // kind 'I'
  hex?: string;                          // kind 'RAW'
  target?: [string, number];             // CALL
  scratch?: number;
  blds?: number[];
  pre?: Instr[]; hdrw?: number; params?: [string, number][]; post?: Instr[];
  fb?: number; inst?: number; tar2?: number;  // CALLFB
}

function dsc(code: Uint8Array, q: number): number {
  return ((code[q] << 24) | (code[q + 1] << 16) | (code[q + 2] << 8) | code[q + 3]) >>> 0;
}

function tryFcCall(code: Uint8Array, p: number, proj: S7Project): [number, StreamEntry] | null {
  let q = p;
  const blds: number[] = [];
  while ((w1at(code, q) & 0xff00) === 0x1000) {
    blds.push(code[q + 1]); q += 2;
    if (blds.length > 2) return null;
  }
  let r = decode(code, q);
  let d = r[1];
  if (!(d[0] === '=' && Array.isArray(d[1]) && (d[1] as unknown[])[0] === 'L' && (d[1] as unknown[])[2] === 0)) return null;
  const scratch = (d[1] as unknown[])[1] as number;
  q = r[0]!;
  const pre: Instr[] = [];
  for (;;) {
    r = decode(code, q); d = r[1];
    const a1 = Array.isArray(d[1]) ? (d[1] as unknown[])[0] : null;
    if (d[0] === 'L' || d[0] === 'OPN') { pre.push(d); q = r[0]!; continue; }
    if (d[0] === 'T' && a1 === 'L') { pre.push(d); q = r[0]!; continue; }
    break;
  }
  const w1 = w1at(code, q);
  let target: [string, number];
  if (w1 === 0xfb70) { target = ['FC', (code[q + 2] << 8) | code[q + 3]]; q += 4; }
  else if (code[q] === 0x3d) { target = ['FC', code[q + 1]]; q += 2; }
  else if (w1 === 0xfb74) { target = ['SFC', (code[q + 2] << 8) | code[q + 3]]; q += 4; }
  else return null;
  if (w1at(code, q) !== 0x700b) return null;
  const hdrw = code[q + 3]; q += 4;
  if (target[0] !== 'FC') return null;
  const ifc = proj.fcInterface(target[1]);
  if (!ifc) return null;
  const pnames = ifc.filter(pp => pp.section !== 'TEMP').map(pp => pp.name);
  const params: [string, number][] = [];
  for (const pn of pnames) { params.push([pn, dsc(code, q)]); q += 4; }
  const post: Instr[] = [];
  for (;;) {
    r = decode(code, q); d = r[1];
    if (d[0] === 'L' || d[0] === 'OPN' || d[0] === 'A' || d[0] === 'AN' || d[0] === 'O' || d[0] === 'ON' || d[0] === '=' || d[0] === 'T') {
      post.push(d); q = r[0]!;
      if (d[0] === 'T' || d[0] === '=') {
        const r2 = decode(code, q), d2 = r2[1];
        const b1 = Array.isArray(d2[1]) ? (d2[1] as unknown[])[0] : null;
        if ((d2[0] === 'L' || d2[0] === 'A' || d2[0] === 'AN') && b1 === 'L') continue;
        break;
      }
      continue;
    }
    break;
  }
  if (w1at(code, q) === 0x1002) q += 2;
  return [q, { kind: 'CALL', off: p, target, scratch, blds, pre, hdrw, params, post }];
}

function tryFbCall(code: Uint8Array, p: number): [number, StreamEntry] | null {
  let q = p;
  const blds: number[] = [];
  if ((w1at(code, q) & 0xff00) === 0x1000) { blds.push(code[q + 1]); q += 2; }
  let r = decode(code, q);
  let d = r[1];
  if (!(d[0] === '=' && Array.isArray(d[1]) && (d[1] as unknown[])[0] === 'L' && (d[1] as unknown[])[2] === 0)) return null;
  const scratch = (d[1] as unknown[])[1] as number;
  q = r[0]!;
  r = decode(code, q); d = r[1];
  if (d[0] !== 'CDB') return null;
  q = r[0]!;
  r = decode(code, q); d = r[1];
  if (!(d[0] === 'OPN' && Array.isArray(d[1]) && (d[1] as unknown[])[0] === 'DI')) return null;
  const inst = (d[1] as unknown[])[1] as number;
  q = r[0]!;
  r = decode(code, q); d = r[1];
  if (d[0] !== 'TAR2LD') return null;
  const tar2 = d[1] as number;
  q = r[0]!;
  const pre: Instr[] = [];
  for (;;) {
    r = decode(code, q); d = r[1];
    if (d[0] === 'LAR2P') { q = r[0]!; break; }
    if (r[0] === null) return null;
    pre.push(d); q = r[0];
  }
  r = decode(code, q); d = r[1];
  let fb: number;
  if (d[0] === 'UC' && Array.isArray(d[1]) && ((d[1] as unknown[])[0] === 'FB' || (d[1] as unknown[])[0] === 'SFB')) {
    fb = (d[1] as unknown[])[1] as number; q = r[0]!;
  } else return null;
  r = decode(code, q); d = r[1];
  if (!(d[0] === 'LAR2LD' && d[1] === tar2)) return null;
  q = r[0]!;
  const post: Instr[] = [];
  for (;;) {
    r = decode(code, q); d = r[1];
    if (d[0] === 'CDB') { q = r[0]!; break; }
    if (r[0] === null) return null;
    post.push(d); q = r[0];
  }
  if ((w1at(code, q) & 0xff00) === 0x1000) { blds.push(code[q + 1]); q += 2; }
  return [q, { kind: 'CALLFB', off: p, fb, inst, scratch, tar2, blds, pre, post }];
}

/** Decode a whole compiled block into a stream of instructions and call frames. */
export function streamBlock(code: Uint8Array, proj: S7Project): StreamEntry[] {
  const out: StreamEntry[] = [];
  let p = 0;
  while (p < code.length) {
    let r = tryFbCall(code, p);
    if (r) { r[1].off = p; out.push(r[1]); p = r[0]; continue; }
    r = tryFcCall(code, p, proj);
    if (r) { r[1].off = p; out.push(r[1]); p = r[0]; continue; }
    const [np, d] = decode(code, p);
    if (np === null) {
      out.push({ kind: 'RAW', off: p, hex: code[p].toString(16).padStart(2, '0') + code[p + 1].toString(16).padStart(2, '0') });
      p += 2;
      continue;
    }
    out.push({ kind: 'I', off: p, op: d[0], arg: d[1] });
    p = np;
  }
  return out;
}
