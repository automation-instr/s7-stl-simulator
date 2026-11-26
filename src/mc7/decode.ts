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
  if (w1 in JUMPS) return [p + 4, [JUMPS[w1], ['REL', a16, p]]];
  if (w1 in MISC2) return [p + 2, MISC2[w1]];
  if (hi === 0xff && (lo & 0x0f) <= 5 && (lo & 0xf0) in STATUS_BIT) {
    return [p + 2, [LOGIC6[lo & 0x0f], ['ST', STATUS_BIT[lo & 0xf0]]]];
  }
  if (hi === 0xfb && lo in PAR_OP) return [p + 4, [PAR_OP[lo][0], ['PAR', a16, PAR_OP[lo][1]]]];
  if (w1 in UC_IND) return [p + 4, [UC_IND[w1][0], [UC_IND[w1][1], ['IND', UC_IND[w1][2], a16]]]];
  if (w1 === 0x3801) return [p + 6, ['L', ['REAL', ((code[p + 2] << 24) | (code[p + 3] << 16) | (code[p + 4] << 8) | code[p + 5]) >>> 0]]];
  if (b0 === 0x1d) return [p + 2, ['CC', ['FC', code[p + 1]]]];
  if (b0 === 0x55) return [p + 2, ['CC', ['FB', code[p + 1]]]];
  return [null, ['??', code[p].toString(16).padStart(2, '0') + ' ' + code[p + 1].toString(16).padStart(2, '0') + ' @' + p]];
}


/** Jump instructions: 4-byte, 16-bit relative target (in words) from instruction start. */
const JUMPS: Record<number, string> = {
  0x7008: 'LOOP', 0x7009: 'JL', 0x700b: 'JU',
  0xff08: 'JOS', 0xff18: 'JO', 0xff28: 'JP', 0xff48: 'JM', 0xff58: 'JUO', 0xff68: 'JN',
  0xff78: 'JNBI', 0xff88: 'JZ', 0xff98: 'JNB', 0xffb8: 'JCN', 0xffd8: 'JCB', 0xffe8: 'JBI', 0xfff8: 'JC',
};
/** Status-bit logic: 2-byte, families OS/OV/>0/<0/UO/<>0/==0/BR x A/AN/O/ON/X/XN. */
const STATUS_BIT: Record<number, string> = { 0x00: 'OS', 0x10: 'OV', 0x20: '>0', 0x40: '<0', 0x50: 'UO', 0x60: '<>0', 0x80: '==0', 0xe0: 'BR' };
const LOGIC6 = ['A', 'AN', 'O', 'ON', 'X', 'XN'];
/** Two-byte accumulator/misc instructions. */
const MISC2: Record<number, Instr> = {
  0x6000: ['/I', null], 0x6001: ['MOD', null], 0x6002: ['ABS', null], 0x6003: ['/R', null],
  0x6004: ['*I', null], 0x6006: ['NEGR', null], 0x6007: ['*R', null], 0x6008: ['ENT', null],
  0x6009: ['-D', null], 0x600a: ['*D', null], 0x600b: ['-R', null], 0x600d: ['+D', null], 0x600e: ['/D', null], 0x600f: ['+R', null],
  0x2120: ['>I', null], 0x2140: ['>=I', null], 0x2160: ['<>I', null], 0x2180: ['==I', null], 0x21a0: ['<I', null], 0x21c0: ['<=I', null],
  0x3120: ['>R', null], 0x3140: ['>=R', null], 0x3160: ['<>R', null], 0x3180: ['==R', null], 0x31a0: ['<R', null], 0x31c0: ['<=R', null],
  0x4100: ['AW', null],
  0x6010: ['SIN', null], 0x6011: ['COS', null], 0x6012: ['TAN', null], 0x6013: ['LN', null], 0x6014: ['SQRT', null],
  0x6018: ['ASIN', null], 0x6019: ['ACOS', null], 0x601a: ['ATAN', null], 0x601b: ['EXP', null], 0x601c: ['SQR', null],
  0x6806: ['DTR', null], 0x6807: ['NEGD', null], 0x6808: ['ITB', null], 0x680a: ['DTB', null],
  0x680c: ['BTI', null], 0x680d: ['INVD', null], 0x680e: ['BTD', null], 0x6812: ['SLW', null],
  0x6813: ['SLD', null], 0x6817: ['RLD', null], 0x6818: ['RLDA', null], 0x681a: ['CAW', null],
  0x681b: ['CAD', null], 0x681c: ['CLR', null], 0x681e: ['ITD', null], 0x6822: ['SRW', null],
  0x6823: ['SRD', null], 0x6824: ['SSI', null], 0x6825: ['SSD', null], 0x682c: ['SAVE', null],
  0x7002: ['TAK', null], 0x6501: ['BEU', null], 0x0500: ['BEC', null], 0xffff: ['NOP', 1],
  0xfe04: ['LAR1', null], 0xfe01: ['LAR1AR2', null], 0xfe05: ['TAR1', null], 0xfe06: ['+AR1', null],
  0xfe08: ['CAR', null], 0xfe09: ['TAR1AR2', null], 0xfe0c: ['LAR2', null], 0xfe0d: ['TAR2', null], 0xfe0e: ['+AR2', null],
};
/** PARAMETER instructions (block-parameter access; operand = 2*(param index+1)). 4 bytes. */
const PAR_OP: Record<number, [string, string]> = {
  0x80: ['A', 'BOOL'], 0x81: ['AN', 'BOOL'], 0x82: ['O', 'BOOL'], 0x83: ['ON', 'BOOL'], 0x84: ['X', 'BOOL'], 0x85: ['XN', 'BOOL'],
  0x90: ['S', 'BOOL'], 0x91: ['R', 'BOOL'], 0x92: ['=', 'BOOL'], 0x94: ['FP', 'BOOL'], 0x95: ['FN', 'BOOL'],
  0xa0: ['A', 'TIMER'], 0xa1: ['AN', 'TIMER'], 0xa2: ['O', 'TIMER'], 0xa3: ['ON', 'TIMER'], 0xa4: ['X', 'TIMER'], 0xa5: ['XN', 'TIMER'],
  0xa6: ['L', 'TIMER'], 0xa8: ['FR', 'TIMER'], 0xa9: ['LC', 'TIMER'], 0xaa: ['SF', 'TIMER'], 0xab: ['SE', 'TIMER'],
  0xac: ['SD', 'TIMER'], 0xad: ['SS', 'TIMER'], 0xae: ['SP', 'TIMER'], 0xaf: ['R', 'TIMER'],
  0xb0: ['A', 'COUNTER'], 0xb1: ['AN', 'COUNTER'], 0xb2: ['O', 'COUNTER'], 0xb3: ['ON', 'COUNTER'], 0xb4: ['X', 'COUNTER'], 0xb5: ['XN', 'COUNTER'],
  0xb6: ['L', 'COUNTER'], 0xb8: ['FR', 'COUNTER'], 0xb9: ['LC', 'COUNTER'], 0xba: ['CD', 'COUNTER'], 0xbb: ['S', 'COUNTER'], 0xbd: ['CU', 'COUNTER'], 0xbf: ['R', 'COUNTER'],
  0xc1: ['L', 'B'], 0xc2: ['L', 'W'], 0xc3: ['L', 'D'], 0xc5: ['T', 'B'], 0xc6: ['T', 'W'], 0xc7: ['T', 'D'],
  0xd0: ['UC', 'BLOCK_FC'], 0xd2: ['UC', 'BLOCK_FB'], 0xd8: ['OPN', 'BLOCK_DB'],
};
/** Indirect UC/CC. */
const UC_IND: Record<number, [string, string, string]> = {
  0xfb30: ['UC', 'FC', 'MW'], 0xfb31: ['CC', 'FC', 'MW'], 0xfb32: ['UC', 'FB', 'MW'], 0xfb33: ['CC', 'FB', 'MW'],
  0xfb41: ['CC', 'FC', 'DBW'], 0xfb43: ['CC', 'FB', 'DBW'], 0xfb51: ['CC', 'FC', 'DIW'], 0xfb53: ['CC', 'FB', 'DIW'],
  0xfb61: ['CC', 'FC', 'LW'], 0xfb63: ['CC', 'FB', 'LW'],
};

/** Word at p (big-endian). */
export function w1at(code: Uint8Array, p: number): number {
  return (code[p] << 8) | code[p + 1];
}
