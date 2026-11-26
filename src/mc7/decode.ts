/**
 * MC7 instruction decoder (S7-300 bytecode).
 * Validated byte-exact against 6 SIMATIC-compiled ground-truth blocks
 * (FC20/21/22/81/82/83 of the MORE PLC project): 7417 statements,
 * 29652 bytes, 84 jumps. See docs/MC7.md for the full opcode table
 * and provenance of every entry.
 */

export type Operand = unknown;
export type Instr = [string, Operand];

const SHM: Record<number, string> = { 0x80: 'A', 0x88: 'O', 0x90: 'S', 0x98: '=', 0xb0: 'R', 0xa0: 'AN', 0xa8: 'ON' };
const SHI: Record<number, string> = { 0xc0: 'A', 0xc8: 'O', 0xd0: 'S', 0xd8: '=', 0xe0: 'AN', 0xe8: 'ON', 0xf0: 'R' };
const AR: Record<number, string> = { 0x10: 'I', 0x20: 'Q', 0x30: 'M', 0x40: 'DB', 0x60: 'L', 0x50: 'DI' };
const T2: Record<number, Instr> = {
  0xba00: ['A(', null], 0xbf00: [')', null], 0xfb00: ['O', null], 0x2180: ['==I', null],
  0x21a0: ['>=I', null], 0x7900: ['+I', null], 0x0000: ['NOP', null], 0x6500: ['BE', null],
};

/** Decode one instruction at p. Returns [nextPos, instr] or [null, ['??', info]]. */
export function decode(code: Uint8Array, p: number): [number | null, Instr] {
  const w1 = (code[p] << 8) | code[p + 1];
  const b0 = code[p];
  if (b0 >= 0x80 && b0 <= 0xb7 && (b0 & 0xf8) in SHM) return [p + 2, [SHM[b0 & 0xf8], ['M', code[p + 1], b0 & 7]]];
  if (b0 >= 0xc0 && b0 <= 0xf7 && (b0 & 0xf8) in SHI) return [p + 2, [SHI[b0 & 0xf8], ['I', code[p + 1], b0 & 7]]];
  if (b0 === 0xf8) return [p + 2, ['A', ['T', code[p + 1]]]];
  if (b0 === 0xfc) return [p + 2, ['AN', ['T', code[p + 1]]]];
  if (b0 === 0xf9) return [p + 2, ['O', ['T', code[p + 1]]]];
  if (b0 === 0xfd) return [p + 2, ['ON', ['T', code[p + 1]]]];
  if (w1 in T2) return [p + 2, T2[w1]];
  if ((w1 & 0xff00) === 0x1000) return [p + 2, ['BLD', w1 & 0xff]];
  const hi = w1 >> 8, lo = w1 & 0xff;
  const a16 = (code[p + 2] << 8) | code[p + 3];
  if (w1 === 0xff98) return [p + 4, ['JNB', ['REL', a16, p]]];
  if ((w1 & 0xfff8) === 0x7e40) {
    const n = w1 & 7;
    const op = ({ 1: 'L', 2: 'L', 3: 'L', 5: 'T', 6: 'T', 7: 'T' } as Record<number, string>)[n] ?? '??';
    const sz = ({ 1: 'DBB', 2: 'DBW', 3: 'DBD', 5: 'DBB', 6: 'DBW', 7: 'DBD' } as Record<number, string>)[n] ?? '??';
    return [p + 4, [op, [sz, a16]]];
  }
  if ((w1 & 0xfff8) === 0x7e50) {
    const n = w1 & 7;
    const op = ({ 1: 'L', 2: 'L', 3: 'L', 5: 'T', 6: 'T', 7: 'T' } as Record<number, string>)[n] ?? '??';
    const sz = ({ 1: 'DIB', 2: 'DIW', 3: 'DID', 5: 'DIB', 6: 'DIW', 7: 'DID' } as Record<number, string>)[n] ?? '??';
    return [p + 4, [op, [sz, a16]]];
  }
  if ((w1 & 0xfff8) === 0x7e60) {
    const n = w1 & 7;
    const op = ({ 1: 'L', 2: 'L', 3: 'L', 5: 'T', 6: 'T', 7: 'T' } as Record<number, string>)[n] ?? '??';
    const sz = ({ 1: 'B', 2: 'W', 3: 'D', 5: 'B', 6: 'W', 7: 'D' } as Record<number, string>)[n] ?? '??';
    return [p + 4, [op, ['L', a16, sz]]];
  }
  if (w1 === 0x300c) return [p + 4, ['L', ['S5T', a16]]];
  if (w1 === 0xfb7c) return [p + 2, ['CDB', null]];
  if (w1 === 0xfb79) return [p + 4, ['OPN', ['DI', a16]]];
  if (w1 === 0xfb74) return [p + 4, ['UC', ['SFC', a16]]];
  if (w1 === 0xfb76) return [p + 4, ['UC', ['SFB', a16]]];
  if (w1 === 0xfb72) return [p + 4, ['UC', ['FB', a16]]];
  if (w1 === 0xfe6f) return [p + 4, ['TAR2LD', a16]];
  if (w1 === 0xfe6b) return [p + 4, ['LAR2LD', a16]];
  if (w1 === 0x681d) return [p + 2, ['SET', null]];
  if (b0 === 0x75) return [p + 2, ['UC', ['FB', code[p + 1]]]];
  if (b0 === 0x0a) return [p + 2, ['L', ['MB', code[p + 1]]]];
  if (b0 === 0x1a) return [p + 2, ['L', ['MD', code[p + 1]]]];
  if (b0 === 0x13) return [p + 2, ['T', ['MW', code[p + 1]]]];
  if (b0 === 0x1b) return [p + 2, ['T', ['MD', code[p + 1]]]];
  if (w1 === 0xfe0b) return [p + 6, ['LAR2P', ((code[p + 2] << 24) | (code[p + 3] << 16) | (code[p + 4] << 8) | code[p + 5]) >>> 0]];
  if (w1 === 0x3003) return [p + 4, ['L', ['CONST', a16]]];
  if (w1 === 0x3803) return [p + 6, ['L', ['CONST32', ((code[p + 2] << 24) | (code[p + 3] << 16) | (code[p + 4] << 8) | code[p + 5]) >>> 0]]];
  if (w1 === 0xbb00) return [p + 2, ['O(', null]];
  if (w1 === 0x600f) return [p + 2, ['+R', null]];
  if (w1 === 0x682d) return [p + 2, ['NOT', null]];
  if (w1 === 0x5900) return [p + 2, ['-I', null]];
  if (b0 === 0x24) return [p + 2, ['SD', ['T', code[p + 1]]]];
  if (w1 === 0xfb78) return [p + 4, ['OPN', ['DB', a16]]];
  if (b0 === 0x20) return [p + 2, ['OPN', ['DB', code[p + 1]]]];
  if (b0 === 0x3d) return [p + 2, ['UC', ['FC', code[p + 1]]]];
  if ((hi === 0x00 || hi === 0x01) && (lo & 0x70) in AR) {
    const op = hi === 0x00 ? (lo & 0x80 ? 'AN' : 'A') : (lo & 0x80 ? 'ON' : 'O');
    const area = AR[lo & 0x70];
    return [p + 4, [op, [area === 'DB' ? 'DBX' : area, a16, lo & 7]]];
  }
  if (hi === 0x49 && ((lo & 0xf0) === 0x30 || (lo & 0xf0) === 0xb0)) {
    const fa16 = (code[p + 2] << 8) | code[p + 3];
    return [p + 4, [(lo & 0xf0) === 0x30 ? 'FP' : 'FN', ['M', fa16, lo & 7]]];
  }
  if (hi === 0x09 && (lo & 0x70) in AR) {
    const area = AR[lo & 0x70];
    return [p + 4, [lo & 0x80 ? 'R' : 'S', [area === 'DB' ? 'DBX' : area, a16, lo & 7]]];
  }
  if (hi === 0x41 && (lo & 0x70) in AR) {
    const area = AR[lo & 0x70];
    return [p + 4, ['=', [area === 'DB' ? 'DBX' : area, a16, lo & 7]]];
  }
  return [null, ['??', code[p].toString(16).padStart(2, '0') + ' ' + code[p + 1].toString(16).padStart(2, '0') + ' @' + p]];
}

/** Word at p (big-endian). */
export function w1at(code: Uint8Array, p: number): number {
  return (code[p] << 8) | code[p + 1];
}
