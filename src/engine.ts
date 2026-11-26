// S7-300 STL engine (MVP). Plain logic, no UI.
/* eslint-disable */

export type Err = { line: number; msg: string };
export type Ins = { op: string; a?: any; line: number; text: string; label?: string };
export type Program = { ins: Ins[]; labels: Record<string, number>; lines: string[]; dbSizes?: Record<number, number> };
export type Field = { off: number; bit?: number; type: string; len?: number };
export type DbLayout = { size: number; fields: Record<string, Field> };
export type Ctx = { symbols?: Record<string, string>; dbs?: Record<number, DbLayout>; mnem?: 'auto' | 'en' | 'de'; virtualDb?: boolean };
export type VField = { db: number; name: string; type: string; first: number };
export type Skipped = { line: number; callee: string; net: number; title: string };
export type Block = { kind: string; name: string; text: string; line0: number; db?: number; num?: number };

const BITOPS = ['A', 'AN', 'O', 'ON', 'X', 'XN'];
const ALIAS: Record<string, string> = {
    U: 'A', UN: 'AN', JU: 'SPA', JC: 'SPB', JCN: 'SPBN', CU: 'ZV', CD: 'ZR',
    S_ODT: 'SE', S_PULSE: 'SI', S_ODTS: 'SS', S_PEXT: 'SV', S_OFFDT: 'SA', BEC: 'BEB', CLR: 'CLR', AUF: 'OPN',
};
const EN_TIMER: Record<string, string> = { SE: 'SV', SD: 'SE', SP: 'SI', SF: 'SA' };
export const TIMER_NAME: Record<string, string> = { SE: 'S_ODT', SI: 'S_PULSE', SS: 'S_ODTS', SV: 'S_PEXT', SA: 'S_OFFDT' };
const TIMER_OPS = ['SE', 'SI', 'SS', 'SV', 'SA'];
const UNSUPPORTED = ['CALL', 'CC', 'UC', 'LC', 'LOOP', 'POP', 'PUSH', 'RLDA', 'RRDA', 'MCR(', 'DI', 'DO', 'TAW', 'TAD', 'CDB', 'OPN_'];
const SIMPLE = ['TAK', 'ITD', 'DTR', 'RND', 'RND+', 'RND-', 'TRUNC', 'NEGI', 'NEGD', 'NEGR', 'ABS', 'INVI', 'INVD', 'CAW', 'CAD', 'SQRT', 'SQR', 'EXP', 'LN', 'SIN', 'COS', 'TAN', 'ASIN', 'ACOS', 'ATAN', 'MOD'];
const SHIFT = ['SLW', 'SRW', 'SLD', 'SRD', 'SSI', 'SSD', 'RLD', 'RRD'];
const LOGW = ['AW', 'OW', 'XOW', 'AD', 'OD', 'XOD'];

const roundEven = (x: number) => { const r = Math.round(x); return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; };
export function s5t(ms: number) {
    let base = 0, unit = 10;
    if (ms > 9990) { base = 1; unit = 100; }
    if (ms > 99900) { base = 2; unit = 1000; }
    if (ms > 999000) { base = 3; unit = 10000; }
    const v = Math.min(999, Math.floor(ms / unit));
    const d = (Math.floor(v / 100) << 8) | (Math.floor((v % 100) / 10) << 4) | (v % 10);
    return { word: (base << 12) | d, base, v, unit };
}
const bcd2bin = (w: number) => {
    const a = (w >> 8) & 15, b = (w >> 4) & 15, c = w & 15;
    return a > 9 || b > 9 || c > 9 ? 0 : a * 100 + b * 10 + c;
};
const bin2bcd = (n: number) => (Math.floor(n / 100) % 10 << 8) | (Math.floor(n / 10) % 10 << 4) | (n % 10);
const UNITS = [10, 100, 1000, 10000];
const s16 = (v: number) => ((v & 0xffff) << 16) >> 16;
const s32 = (v: number) => v | 0;
const f32 = (bits: number) => new Float32Array(new Uint32Array([bits >>> 0]).buffer)[0];
const bitsOf = (x: number) => new Uint32Array(new Float32Array([x]).buffer)[0] >>> 0;

// ---------- operand parsing ----------
type Addr = { area: string; byte: number; bit?: number; size?: string; n?: number };

function parseBitAddr(s: string): Addr | string {
    const m = /^([IEQAML])(\d+)\.(\d+)$/i.exec(s);
    if (!m) return 'bad';
    const bit = +m[3];
    if (bit > 7) return 'bit';
    const area = { I: 'I', E: 'I', Q: 'Q', A: 'Q', M: 'M', L: 'L' }[m[1].toUpperCase()] as string;
    const byte = +m[2];
    if (byte >= AREA_SIZE[area]) return 'range';
    return { area, byte, bit };
}

export const AREA_SIZE: Record<string, number> = { I: 1024, Q: 1024, M: 4096, L: 512, PI: 1024, PQ: 1024 };
const DBSIZE = 512;
let DBSZ: Record<number, number> = {};
const dbLimit = (db: number) => (db ? (DBSZ[db] || DBSIZE) : 65536);
function parseDbAddr(s: string, mode: 'bit' | 'num'): any {
    const m = /^(?:DB(\d+)\.)?(DB|DI)([XBWD])(\d+)(?:\.(\d+))?$/i.exec(s);
    if (!m) return null;
    const db = m[1] ? +m[1] : 0, reg = m[2].toUpperCase(), k = m[3].toUpperCase(), byte = +m[4];
    if (m[1] && reg === 'DI') return 'baddi';
    if (db > 65535 || (m[1] && db === 0)) return 'dbrange';
    if (k === 'X') {
        if (m[5] === undefined) return 'dbxbit';
        if (+m[5] > 7) return 'bit';
        if (byte >= dbLimit(db)) return 'dbbyte';
        return mode === 'bit' ? { area: 'DB', db, reg, byte, bit: +m[5] } : 'needsize';
    }
    if (m[5] !== undefined) return 'dbbitnotallowed';
    const w = k === 'B' ? 1 : k === 'W' ? 2 : 4;
    if (byte + w > dbLimit(db)) return 'dbbyte';
    return mode === 'num' ? { area: 'DB', db, reg, byte, size: k } : 'needbit';
}
const DBERR: Record<string, string> = {
    baddi: 'DI cannot take a DB number. Use DIX0.0 after OPN DI',
    dbrange: 'DB number must be 1 to 65535',
    dbxbit: 'DBX needs a bit number (e.g. DBX0.0)',
    bit: 'Bit number must be 0 to 7',
    dbbyte: 'Address is outside the DB size (from its declaration, or 512 bytes if none)',
    needsize: 'DBX is for bits only. To load or transfer use DBB/DBW/DBD (e.g. L DBW0)',
    needbit: 'This address is not a bit. Use DBX for bits, or L DBW0 to load',
    dbbitnotallowed: 'DBB/DBW/DBD take no bit number',
};

function parseConst(s: string): { v: number; kind: string } | string {
    const u = s.toUpperCase();
    let m: RegExpExecArray | null;
    if ((m = /^S5T#(.+)$/.exec(u))) {
        const r = /^(?:(\d+)H)?(?:(\d+)M(?!S))?(?:(\d+)S)?(?:(\d+)MS)?$/.exec(m[1]);
        if (!r || !m[1]) return 'S5T';
        const ms = (+(r[1] || 0)) * 3600000 + (+(r[2] || 0)) * 60000 + (+(r[3] || 0)) * 1000 + (+(r[4] || 0));
        if (ms > 9990000) return 'S5Tmax';
        return { v: s5t(ms).word, kind: 'W' };
    }
    if ((m = /^T#(.+)$/.exec(u))) {
        const r = /^(?:(\d+)D)?(?:(\d+)H)?(?:(\d+)M(?!S))?(?:(\d+)S)?(?:(\d+)MS)?$/.exec(m[1]);
        if (!r || !m[1]) return 'T#';
        return { v: (+(r[1] || 0)) * 86400000 + (+(r[2] || 0)) * 3600000 + (+(r[3] || 0)) * 60000 + (+(r[4] || 0)) * 1000 + (+(r[5] || 0)), kind: 'D' };
    }
    if ((m = /^C#(\d{1,3})$/.exec(u))) return { v: bin2bcd(+m[1]), kind: 'W' };
    if ((m = /^B#16#([0-9A-F]{1,2})$/.exec(u))) return { v: parseInt(m[1], 16), kind: 'B' };
    if ((m = /^W#16#([0-9A-F]{1,4})$/.exec(u))) return { v: parseInt(m[1], 16), kind: 'W' };
    if ((m = /^DW#16#([0-9A-F]{1,8})$/.exec(u))) return { v: parseInt(m[1], 16) >>> 0, kind: 'D' };
    if ((m = /^2#([01]{1,32})$/.exec(u))) { const v = parseInt(m[1], 2) >>> 0; return { v, kind: m[1].length > 16 ? 'D' : 'W' }; }
    if ((m = /^L#(-?\d+)$/.exec(u))) return { v: +m[1] | 0, kind: 'D' };
    if ((m = /^([+-]?\d+\.\d+(?:E[+-]?\d+)?|[+-]?\d+E[+-]?\d+)$/.exec(u))) {
        const f = new Float32Array([parseFloat(m[1])]); if (!isFinite(f[0])) return 'big';
        return { v: new Uint32Array(f.buffer)[0], kind: 'D' };
    }
    if ((m = /^(-?\d+)$/.exec(u))) {
        const n = +m[1];
        if (n >= -32768 && n <= 32767) return { v: n & 0xffff, kind: 'W' };
        if (n >= -2147483648 && n <= 2147483647) return { v: n | 0, kind: 'D' };
        return 'big';
    }
    return 'bad';
}

// ---------- project helpers: layouts, blocks, symbols ----------
const stripC = (l: string) => l.replace(/\/\/.*$/, '').replace(/\(\*.*?\*\)/g, '');
const TYPE_SZ: Record<string, number> = { BYTE: 1, CHAR: 1, INT: 2, WORD: 2, DATE: 2, S5TIME: 2, DINT: 4, DWORD: 4, REAL: 4, TIME: 4, TIME_OF_DAY: 4, TOD: 4, DATE_AND_TIME: 8, DT: 8 };
// STEP 7 layout: BOOLs pack into bits, BYTE/CHAR sit on the next byte, everything bigger on an even byte.
export function layoutDecls(lines: string[]): DbLayout & { errors: string[] } {
    const fields: Record<string, Field> = {}; const errors: string[] = [];
    let byte = 0, bit = 0; // bit>0 means inside a byte of bools
    const pre: string[] = [];
    const align = () => { if (bit > 0) { bit = 0; byte++; } if (byte & 1) byte++; };
    for (const raw of lines) {
        const t = stripC(raw).trim();
        if (/^END_STRUCT\b/i.test(t)) { align(); pre.pop(); continue; }
        const m = /^([A-Za-z_][\w]*)\s*:\s*(.+?)\s*(?::=.*)?;?\s*$/.exec(t);
        if (!m) continue;
        if (/^STRUCT\b/i.test(m[2])) { align(); pre.push(m[1].toUpperCase()); continue; }
        const name = (pre.length ? pre.join('.') + '.' : '') + m[1].toUpperCase(); let ty = m[2].replace(/;$/, '').trim().toUpperCase(); let n = 1;
        const am = /^ARRAY\s*\[\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*\]\s*OF\s+(\w+)/.exec(ty);
        if (am) { n = +am[2] - +am[1] + 1; ty = am[3]; }
        const sm = /^STRING\s*\[\s*(\d+)\s*\]/.exec(ty);
        let sz: number, isBool = false;
        if (ty === 'BOOL') { isBool = true; sz = 0; }
        else if (sm) { sz = +sm[1] + 2; ty = 'STRING'; }
        else if (TYPE_SZ[ty]) sz = TYPE_SZ[ty];
        else { errors.push('Unsupported type: ' + ty + ' (' + name + ')'); continue; }
        if (isBool && n === 1) {
            fields[name] = { off: byte, bit, type: 'BOOL' };
            if (++bit === 8) { bit = 0; byte++; }
            continue;
        }
        if (isBool) { // array of bool: pack
            fields[name] = { off: byte, bit, type: 'BOOL', len: n };
            const tot = bit + n; byte += tot >> 3; bit = tot & 7; continue;
        }
        if (bit > 0) { bit = 0; byte++; }
        if (sz > 1 && (byte & 1)) byte++;
        fields[name] = { off: byte, type: ty, len: am ? n : undefined };
        byte += sz * n;
    }
    if (bit > 0) { byte++; }
    if (byte & 1) byte++;
    return { size: byte, fields, errors };
}
export function splitBlocks(src: string): Block[] {
    const lines = src.replace(/\r/g, '').split('\n'); const out: Block[] = []; let cur: { kind: string; name: string; start: number; db?: number } | null = null;
    lines.forEach((l, i) => {
        const t = l.trim();
        const h = /^(FUNCTION_BLOCK|FUNCTION|ORGANIZATION_BLOCK|DATA_BLOCK|TYPE)\s+("[^"]+"|[\w]+)/i.exec(t);
        if (h && !cur) {
            const nm = h[2].replace(/"/g, ''); const dm = /^DB(\d+)$/i.exec(nm);
            cur = { kind: h[1].toUpperCase(), name: nm, start: i, db: dm ? +dm[1] : undefined };
        } else if (cur && /^END_(FUNCTION_BLOCK|FUNCTION|ORGANIZATION_BLOCK|DATA_BLOCK|TYPE)\b/i.test(t)) {
            out.push({ kind: cur.kind, name: cur.name, db: cur.db, line0: cur.start, text: lines.slice(cur.start, i + 1).join('\n') }); cur = null;
        }
    });
    return out;
}
// DB layouts from DATA_BLOCK sources (STRUCT ... END_STRUCT)
export function dbLayouts(blocks: Block[]): { dbs: Record<number, DbLayout>; warn: string[] } {
    const dbs: Record<number, DbLayout> = {}; const warn: string[] = [];
    for (const b of blocks) {
        if (b.kind !== 'DATA_BLOCK' || !b.db) continue;
        const ls = b.text.split('\n'); const a = ls.findIndex(l => /^\s*STRUCT\b/i.test(l)); let z = -1; for (let i = ls.length - 1; i > a && a >= 0; i--) if (/^\s*END_STRUCT\b/i.test(ls[i])) { z = i; break; }
        if (a < 0 || z < 0) { warn.push('DB' + b.db + ': no STRUCT found'); continue; }
        const r = layoutDecls(ls.slice(a + 1, z));
        dbs[b.db] = { size: r.size, fields: r.fields }; r.errors.forEach(e => warn.push('DB' + b.db + ': ' + e));
    }
    return { dbs, warn };
}
// Siemens symbol table (SYMLIST.DBF from a STEP 7 project): returns NAME(UPPER) -> absolute address
export function parseSymList(buf: Uint8Array): Record<string, string> {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const hlen = dv.getUint16(8, true), rlen = dv.getUint16(10, true), nrec = dv.getUint32(4, true);
    const flds: { name: string; len: number; off: number }[] = []; let off = 1;
    for (let p = 32; p + 32 <= hlen && buf[p] !== 0x0d; p += 32) {
        let nm = ''; for (let i = 0; i < 11 && buf[p + i]; i++) nm += String.fromCharCode(buf[p + i]);
        const len = buf[p + 16]; flds.push({ name: nm, len, off }); off += len;
    }
    const fS = flds.find(f => f.name === '_SKZ'), fO = flds.find(f => f.name === '_OPIEC');
    if (!fS || !fO) throw new Error('This is not a STEP 7 symbol table (no _SKZ/_OPIEC fields)');
    const rd = (r: number, f: { len: number; off: number }) => { let s = ''; for (let i = 0; i < f.len; i++) { const c = buf[r + f.off + i]; if (c) s += String.fromCharCode(c); } return s.trim(); };
    const out: Record<string, string> = {};
    for (let i = 0; i < nrec; i++) {
        const r = hlen + i * rlen; if (r + rlen > buf.length) break; if (buf[r] === 0x2a) continue;
        const n = rd(r, fS), a = rd(r, fO); if (n && a) out[n.toUpperCase()] = a.replace(/\s+/g, ' ');
    }
    return out;
}
// symbol info keyed by compact address ("FC20"): original name and comment
export function parseSymInfo(buf: Uint8Array): Record<string, { name: string; comment: string }> {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const hlen = dv.getUint16(8, true), rlen = dv.getUint16(10, true), nrec = dv.getUint32(4, true);
    const flds: { name: string; len: number; off: number }[] = []; let off = 1;
    for (let p = 32; p + 32 <= hlen && buf[p] !== 0x0d; p += 32) { let nm = ''; for (let i = 0; i < 11 && buf[p + i]; i++) nm += String.fromCharCode(buf[p + i]); const len = buf[p + 16]; flds.push({ name: nm, len, off }); off += len; }
    const fS = flds.find(f => f.name === '_SKZ'), fO = flds.find(f => f.name === '_OPIEC'), fC = flds.find(f => f.name === '_COMMENT');
    const out: Record<string, { name: string; comment: string }> = {}; if (!fS || !fO) return out;
    const rd = (r: number, f: { len: number; off: number }) => { let s = ''; for (let i = 0; i < f.len; i++) { const c = buf[r + f.off + i]; if (c) s += String.fromCharCode(c); } return s.trim(); };
    for (let i = 0; i < nrec; i++) { const r = hlen + i * rlen; if (r + rlen > buf.length) break; if (buf[r] === 0x2a) continue; const n = rd(r, fS), a = rd(r, fO).replace(/\s+/g, '').toUpperCase(); if (n && /^(OB|FB|FC|DB|UDT|SFC|SFB|VAT)\d+$/.test(a)) out[a] = { name: n, comment: fC ? rd(r, fC) : '' }; }
    return out;
}
// block directory of a STEP 7 project (ombstx/offline/*/BAUSTEIN.DBF): [{kind, num}] of non-deleted blocks
const CAT_KIND: Record<number, string> = { 0: 'UDT', 8: 'OB', 10: 'DB', 12: 'FC', 13: 'SFC', 14: 'FB', 15: 'SFB', 27: 'VAT' };
export function parseBlockCatalog(buf: Uint8Array): { kind: string; num: number; id: number }[] {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const hlen = dv.getUint16(8, true), rlen = dv.getUint16(10, true), nrec = dv.getUint32(4, true);
    const flds: { name: string; len: number; off: number }[] = []; let off = 1;
    for (let p = 32; p + 32 <= hlen && buf[p] !== 0x0d; p += 32) { let nm = ''; for (let i = 0; i < 11 && buf[p + i]; i++) nm += String.fromCharCode(buf[p + i]); const len = buf[p + 16]; flds.push({ name: nm, len, off }); off += len; }
    const fT = flds.find(f => f.name === 'TYP'), fN = flds.find(f => f.name === 'NUMMER'); const fI = flds.find(f => f.name === 'ID'); const out: { kind: string; num: number; id: number }[] = [];
    if (!fT || !fN) return out;
    const rd = (r: number, f: { len: number; off: number }) => { let s = ''; for (let i = 0; i < f.len; i++) { const c = buf[r + f.off + i]; if (c) s += String.fromCharCode(c); } return s.trim(); };
    for (let i = 0; i < nrec; i++) { const r = hlen + i * rlen; if (r + rlen > buf.length) break; if (buf[r] === 0x2a) continue; const k = CAT_KIND[+rd(r, fT)]; if (k) out.push({ kind: k, num: +rd(r, fN), id: fI ? +rd(r, fI) : -1 }); }
    return out;
}
// SUBBLK.DBF: per block, the sub-block whose type equals the block type carries two S7 timestamps
// (6 bytes: ms of day as uint32 BE, then days since 1984-01-01 as uint16 BE): code and interface last modified.
const SUB_TYP: Record<string, number> = { UDT: 0, OB: 8, DB: 10, FC: 12, SFC: 13, FB: 14, SFB: 15, VAT: 27 };
const s7ts = (b: Uint8Array, o: number): number => { const ms = ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; const d = (b[o + 4] << 8) | b[o + 5]; if (!d && !ms) return 0; return Date.UTC(1984, 0, 1) + d * 86400000 + ms; };
export function parseBlockDates(buf: Uint8Array): Record<number, Record<number, { code: number; iface: number }>> {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const hlen = dv.getUint16(8, true), rlen = dv.getUint16(10, true), nrec = dv.getUint32(4, true);
    const flds: Record<string, { len: number; off: number }> = {}; let off = 1;
    for (let p = 32; p + 32 <= hlen && buf[p] !== 0x0d; p += 32) { let nm = ''; for (let i = 0; i < 11 && buf[p + i]; i++) nm += String.fromCharCode(buf[p + i]); const len = buf[p + 16]; flds[nm] = { len, off }; off += len; }
    const out: Record<number, Record<number, { code: number; iface: number }>> = {};
    const num = (r: number, f: { len: number; off: number }) => { let s = ''; for (let i = 0; i < f.len; i++) { const c = buf[r + f.off + i]; if (c) s += String.fromCharCode(c); } return +s.trim(); };
    if (!flds.OBJECTID || !flds.SUBBLKTYP || !flds.TIMESTAMP1 || !flds.TIMESTAMP2) return out;
    for (let i = 0; i < nrec; i++) { const r = hlen + i * rlen; if (r + rlen > buf.length) break; if (buf[r] === 0x2a) continue; const id = num(r, flds.OBJECTID), t = num(r, flds.SUBBLKTYP); (out[id] = out[id] || {})[t] = { code: s7ts(buf, r + flds.TIMESTAMP1.off), iface: s7ts(buf, r + flds.TIMESTAMP2.off) }; }
    return out;
}
// plain text symbol table: "NAME<TAB or comma>ADDRESS" per line, or "NAME  ADDRESS" (SDF/ASC export)
export function parseSymText(txt: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const l of txt.replace(/\r/g, '').split('\n')) {
        const m = /^\s*"?([^\t,";]+?)"?\s*[\t,;]\s*"?([A-Za-z]{1,3}\s*\d+(?:\.\d+)?)"?/.exec(l);
        if (m) out[m[1].trim().toUpperCase()] = m[2].replace(/\s+/g, ' ');
    }
    return out;
}
export function detectMnem(src: string): 'en' | 'de' {
    let en = 0, de = 0;
    for (const raw of src.replace(/\r/g, '').split('\n')) {
        const t = stripC(raw).trim().replace(/^[A-Za-z_]\w*\s*:(?!=)\s*/, '');
        const m = /^([A-Za-z_]+)\b/.exec(t); if (!m) continue; const o = m[1].toUpperCase();
        if (/^(SD|SF|SP)$/.test(o) && /^\w+\s+(T\s*\d|"|#)/.test(t)) en++;
        else if (/^(JU|JC|JCN|CU|CD)$/.test(o)) en++;
        else if (/^(SI|SV|SA|SPA|SPB|SPBN|ZV|ZR|U|UN|AUF)$/.test(o)) de++;
    }
    return en > de ? 'en' : 'de';
}

// ---------- parser ----------
export function compile(src: string, ctx: Ctx = {}): { prog: Program; errors: Err[]; skipped: Skipped[]; mnem: 'en' | 'de'; temps: number; virtual: VField[] } {
    const lines = src.replace(/\r/g, '').split('\n');
    const ins: Ins[] = [];
    const labels: Record<string, number> = {};
    const errors: Err[] = [];
    const skipped: Skipped[] = [];
    const E = (line: number, msg: string) => errors.push({ line, msg });
    let depth = 0, depthLine = 0;
    const mnem: 'en' | 'de' = ctx.mnem === 'en' || ctx.mnem === 'de' ? ctx.mnem : detectMnem(src);
    const syms = ctx.symbols || {}; const dbs: Record<number, DbLayout> = { ...(ctx.dbs || {}) };
    const virtual: VField[] = []; const vlay: Record<number, { byte: number; bit: number }> = {}; const vdbNums = new Set<number>();
    const inferType = (ln: number): string => {
        const first = (lines[ln - 1] || '').replace(/\/\/.*$/, '').trim().replace(/^\w+\s*:(?!=)\s*/, '').split(/\s+/)[0].toUpperCase();
        if (/^(A|AN|O|ON|X|XN|=|S|R|FP|FN)$/.test(first)) return 'BOOL';
        const look = (dir: number) => { let n = 0; for (let j = ln - 1 + dir; j >= 0 && j < lines.length && n < 4; j += dir) { const t = lines[j].replace(/\/\/.*$/, '').trim().replace(/^\w+\s*:(?!=)\s*/, ''); if (!t) continue; n++; const m = /^(?:[+\-*\/]|==|<>|>=|<=|>|<)([IDR])\b/.exec(t); if (m) return m[1] === 'I' ? 'INT' : 'REAL'; if (/^T\s/i.test(t) || /^(SPA|SPB|SPBN|JU|JC|JCN|JNB|BE|BEB)\b/i.test(t)) return ''; } return ''; };
        return (first === 'T' ? look(-1) : look(1)) || (/REAL/i.test(lines[ln - 1]) ? 'REAL' : 'INT');
    };
    const virtualField = (db: number, name: string, ln: number): Field => {
        const lay = dbs[db] || (dbs[db] = { size: 0, fields: {} }); vdbNums.add(db);
        const v = vlay[db] || (vlay[db] = { byte: 0, bit: 0 }); const type = inferType(ln); const key = name.toUpperCase();
        let f: Field;
        if (type === 'BOOL') { f = { off: v.byte, bit: v.bit, type }; if (++v.bit === 8) { v.bit = 0; v.byte++; } }
        else { if (v.bit) { v.bit = 0; v.byte++; } if (v.byte & 1) v.byte++; f = { off: v.byte, type }; v.byte += type === 'INT' ? 2 : 4; }
        lay.fields[key] = f; lay.size = Math.max(lay.size, v.byte + (v.bit ? 1 : 0)); DBSZ[db] = lay.size; dbSizes[db] = lay.size;
        virtual.push({ db, name, type, first: ln }); return f;
    };
    DBSZ = {}; const dbSizes: Record<number, number> = {};
    for (const k in dbs) { DBSZ[+k] = dbs[+k].size; dbSizes[+k] = dbs[+k].size; }

    // VAR_TEMP declarations -> local data layout (#name)
    let tempLay: DbLayout = { size: 0, fields: {} };
    { const a = lines.findIndex(l => /^\s*VAR_TEMP\b/i.test(l)); if (a >= 0) { const z = lines.findIndex((l, i) => i > a && /^\s*END_VAR\b/i.test(l)); tempLay = layoutDecls(lines.slice(a + 1, z < 0 ? lines.length : z)); } }
    const FLET: Record<string, string> = { BYTE: 'B', CHAR: 'B', INT: 'W', WORD: 'W', DATE: 'W', S5TIME: 'W' };
    const dbOperand = (n: number, f: Field) => 'DB' + n + '.DB' + (f.type === 'BOOL' ? 'X' : FLET[f.type] || 'D') + f.off + (f.type === 'BOOL' ? '.' + f.bit : '');
    const resolve = (s: string, ln: number): string => s
        .replace(/"([^"]+)"(?:\.([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*))?/g, (m0, name: string, field?: string) => {
            const a = syms[name.toUpperCase()];
            if (a === undefined) { E(ln, 'Symbol "' + name + '" is not in the symbol table. Load the symbol table (SYMLIST.DBF)'); return m0; }
            const norm = a.replace(/\s+/g, '').toUpperCase();
            if (!field) return norm;
            const dm = /^DB(\d+)$/.exec(norm); if (!dm) { E(ln, 'Symbol "' + name + '" (' + a + ') is not a DB'); return m0; }
            const dn = +dm[1], lay = dbs[dn];
            if ((!lay || vdbNums.has(dn)) && ctx.virtualDb === false) { E(ln, 'Symbol "' + name + '" (' + a + ') has no DB declaration loaded. Load the DB source (AWL)'); return m0; }
            let f = lay ? lay.fields[field.toUpperCase()] : undefined;
            if (!f && (!lay || vdbNums.has(dn))) f = virtualField(dn, field, ln);
            if (!f) { E(ln, 'Field ' + field + ' not found in ' + a.replace(/\s+/g, '')); return m0; }
            return dbOperand(+dm[1], f);
        })
        .replace(/(^|[^\w#])#([A-Za-z_]\w*)/g, (m0, pre: string, name: string) => {
            const f = tempLay.fields[name.toUpperCase()];
            if (!f) { E(ln, 'Temp variable #' + name + ' is not declared in VAR_TEMP'); return m0; }
            return pre + (f.type === 'BOOL' ? 'L' + f.off + '.' + f.bit : 'L' + (FLET[f.type] || 'D') + f.off);
        });

    let inVar = false, callDepth = -1, net = 0, title = '', callee = '', callLine = 0;
    const parenDelta = (x: string) => { x = x.replace(/"[^"]*"/g, ''); return (x.match(/\(/g) || []).length - (x.match(/\)/g) || []).length; };
    lines.forEach((raw, i) => {
        const ln = i + 1;
        let t = raw.replace(/\/\/.*$/, '').replace(/\(\*.*?\*\)/g, '').replace(/;\s*$/, '').trim();
        if (!t) return;
        if (callDepth >= 0) { callDepth += parenDelta(t); if (callDepth <= 0) callDepth = -1; return; }
        if (inVar) { if (/^END_VAR\b/i.test(t)) inVar = false; return; }
        if (/^VAR\w*\b/i.test(t)) { inVar = true; return; }
        if (/^NETWORK\b/i.test(t)) { net++; title = ''; return; }
        if (/^TITLE\s*=/i.test(t)) { title = t.replace(/^TITLE\s*=\s*/i, '').slice(0, 60); return; }
        if (/^(BEGIN\b|END_\w+|ORGANIZATION_BLOCK\b|FUNCTION_BLOCK\b|FUNCTION\b|DATA_BLOCK\b|VERSION\b|AUTHOR\b|FAMILY\b|NAME\b|KNOW_HOW_PROTECT\b|\{)/i.test(t)) return;
        let label: string | undefined;
        const lm = /^([A-Za-z_][A-Za-z0-9_]*)\s*:(?!=)\s*(.*)$/.exec(t);
        if (lm) {
            label = lm[1].toUpperCase();
            if (label.length > 4) E(ln, 'Label "' + lm[1] + '" is too long. Max 4 characters (e.g. M001:)');
            else if (labels[label] !== undefined) E(ln, 'Label "' + label + '" is duplicated');
            labels[label] = ins.length;
            t = lm[2].trim();
            if (!t) return;
        }
        const cm = /^CALL\s+(?:"([^"]+)"|(\w+(?:\s+\d+)?))/i.exec(t);
        if (cm) {
            callee = cm[1] || cm[2]; callLine = ln;
            const d = parenDelta(t); if (d > 0) callDepth = d;
            skipped.push({ line: ln, callee, net, title });
            ins.push({ op: 'CALLSKIP', line: ln, text: t.length > 70 ? t.slice(0, 70) + '…' : t, label });
            return;
        }
        const mm = /^(==[IDR]|<>[IDR]|>=[IDR]|<=[IDR]|>[IDR]|<[IDR]|[+\-*\/][IDR]|RND[+\-]|=|\+|\)|[A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/.exec(t);
        if (!mm) { E(ln, 'Cannot parse this line: "' + t + '"'); return; }
        let op = mm[1].toUpperCase();
        const nErr = errors.length;
        let rest = resolve(mm[2], ln).replace(/\s+/g, '');
        if (errors.length > nErr) return;
        const text = t;
        if (mnem === 'en' && EN_TIMER[op]) op = EN_TIMER[op];
        else if (mnem === 'de' && (op === 'SD' || op === 'SF' || op === 'SP')) { E(ln, 'Instruction ' + op + ' belongs to the English mnemonic set. Switch the mnemonic set to English'); return; }
        if (ALIAS[op]) op = ALIAS[op];
        const push = (a?: any) => ins.push({ op, a, line: ln, text, label });

        if (BITOPS.includes(op) && rest.startsWith('(')) {
            if (rest !== '(') { E(ln, 'After "' + op + '(" nothing else may follow on the same line'); return; }
            depth++; depthLine = ln; op = op + '('; push(); return;
        }
        if (op === ')') {
            if (depth === 0) { E(ln, 'Closing ")" without an opening parenthesis'); return; }
            depth--; push(); return;
        }
        if (['SET', 'CLR', 'NOT', 'BE', 'SPA_', 'SAVE', 'BLD'].includes(op) || (op === 'NOP')) {
            if (op === 'NOP' || op === 'BLD') { push(); return; }
            if (rest) { E(ln, 'Instruction ' + op + ' takes no operand'); return; }
            push(); return;
        }
        if (op === 'O' && !rest) { push(); return; }
        if (BITOPS.includes(op) || op === '=' || op === 'S' || op === 'R' || op === 'FP' || op === 'FN') {
            if (!rest) { E(ln, 'Instruction ' + op + ' needs an address (e.g. ' + op + ' I0.0)'); return; }
            const tc = /^([TC])(\d+)$/i.exec(rest);
            if (tc) {
                const kind = tc[1].toUpperCase(), n = +tc[2];
                if (n > 255) { E(ln, '' + (kind === 'T' ? 'timer' : 'counter') + ' number must be 0 to 255'); return; }
                if (BITOPS.includes(op)) { push({ area: kind, n }); return; }
                if (op === 'R') { push({ area: kind, n }); return; }
                if (op === 'S' && kind === 'C') { push({ area: kind, n }); return; }
                E(ln, 'Instruction ' + op + ' cannot be used on a ' + (kind === 'T' ? 'timer' : 'counter') + '. Use ' + (kind === 'T' ? 'SE / SI / SS / SV / SA or R' : 'ZV / ZR / S / R')); return;
            }
            const da = parseDbAddr(rest, 'bit');
            if (da) { if (typeof da === 'string') { E(ln, DBERR[da]); return; } push(da); return; }
            const a = parseBitAddr(rest);
            if (typeof a === 'string') {
                E(ln, a === 'bit' ? 'Bit number must be 0 to 7 in "' + rest + '"' : a === 'range' ? 'Address "' + rest + '" is out of range' : 'Address "' + rest + '" is invalid. Valid forms: I0.0, Q0.1, M2.3');
                return;
            }
            if ((op === 'FP' || op === 'FN') && a.area === 'I') { E(ln, op + ' needs a Merker or DB bit as edge memory (not an input)'); return; }
            push(a); return;
        }
        if (TIMER_OPS.includes(op) || op === 'ZV' || op === 'ZR' || op === 'FR') {
            const tc = /^([TC])(\d+)$/i.exec(rest);
            const want = TIMER_OPS.includes(op) ? 'T' : 'C';
            if (op === 'FR') { if (!tc) { E(ln, 'FR needs a T or C, e.g. FR T1'); return; } push({ area: tc[1].toUpperCase(), n: +tc[2] }); return; }
            if (!tc || tc[1].toUpperCase() !== want) { E(ln, 'Instruction ' + op + ' needs ' + (want === 'T' ? 'a timer, e.g. ' + op + ' T1' : 'a counter, e.g. ' + op + ' C1')); return; }
            if (+tc[2] > 255) { E(ln, 'Number must be 0 to 255'); return; }
            push({ area: want, n: +tc[2] }); return;
        }
        if (op === 'L' || op === 'T') {
            if (!rest) { E(ln, 'Instruction ' + op + ' needs an address' + (op === 'L' ? ' or a constant (e.g. L 5 or L MW10)' : ' (e.g. T MW10)')); return; }
            const dn = parseDbAddr(rest, 'num');
            if (dn) { if (typeof dn === 'string') { E(ln, DBERR[dn]); return; } push(dn); return; }
            const m = /^(PI|PE|PQ|PA|[IEQAML])([BWD])(\d+)$/i.exec(rest);
            if (m) {
                const area = { I: 'I', E: 'I', Q: 'Q', A: 'Q', M: 'M', L: 'L', PI: 'PI', PE: 'PI', PQ: 'PQ', PA: 'PQ' }[m[1].toUpperCase()] as string;
                const size = m[2].toUpperCase(), byte = +m[3];
                const w = size === 'B' ? 1 : size === 'W' ? 2 : 4;
                if (byte + w > AREA_SIZE[area]) { E(ln, 'Address "' + rest + '" is out of range'); return; }
                if (op === 'T' && (area === 'I' || area === 'PI')) { E(ln, 'T cannot write to an input'); return; }
                push({ area, byte, size }); return;
            }
            const tc = /^([TC])(\d+)$/i.exec(rest);
            if (tc && op === 'L') { push({ area: tc[1].toUpperCase(), n: +tc[2], val: true }); return; }
            if (op === 'L') {
                const c = parseConst(rest);
                if (typeof c === 'string') {
                    E(ln, c === 'S5T' ? 'Invalid time format. Examples: S5T#5S, S5T#1M30S, S5T#500MS' : c === 'S5Tmax' ? 'Maximum S5T# time is 2H46M30S' : c === 'big' ? 'Number exceeds the 32-bit range' : 'Cannot parse value "' + rest + '". Try: L 5, L W#16#FF, L S5T#2S or L MW10');
                    return;
                }
                push({ area: 'K', ...c }); return;
            }
            E(ln, 'Address "' + rest + '" is invalid. Examples: T MW10, T QB0'); return;
        }
        if (op === 'SPA' || op === 'SPB' || op === 'SPBN' || op === 'JNB' || op === 'JBI' || op === 'JNBI') {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(rest)) { E(ln, op + ' needs a label name (e.g. ' + op + ' M001)'); return; }
            push(rest.toUpperCase()); return;
        }
        if (op === 'BEB') { push(); return; }
        if (op === 'OPN') {
            const om = /^(DB|DI)(\d+)$/i.exec(rest);
            if (!om || +om[2] < 1 || +om[2] > 65535) { E(ln, 'OPN needs DB or DI with a number from 1 to 65535 (e.g. OPN DB1)'); return; }
            push({ reg: om[1].toUpperCase(), n: +om[2] }); return;
        }
        if (SIMPLE.includes(op)) { if (rest) { E(ln, 'Instruction ' + op + ' takes no operand'); return; } push(); return; }
        if (SHIFT.includes(op)) {
            if (rest && (!/^\d+$/.test(rest) || +rest > 32)) { E(ln, op + ' needs a shift count from 0 to 32 (or none if the count is in ACCU2)'); return; }
            push(rest ? +rest : -1); return;
        }
        if (LOGW.includes(op)) {
            if (!rest) { push(null); return; }
            const c = parseConst(rest);
            if (typeof c === 'string') { E(ln, 'Value of ' + op + ' is invalid. Example: ' + op + ' W#16#00FF'); return; }
            push(c); return;
        }
        if (/^(==|<>|>=|<=|>|<)[IDR]$/.test(op) || /^[+\-*\/][IDR]$/.test(op)) {
            if (rest) { E(ln, 'Instruction ' + op + ' takes no operand'); return; }
            push(); return;
        }
        if (op === '+') {
            const c = parseConst(rest);
            if (typeof c === 'string' || !rest) { E(ln, '+ needs a constant (e.g. + 1)'); return; }
            push(c); return;
        }
        if (op === 'INC' || op === 'DEC') {
            if (!/^\d+$/.test(rest) || +rest > 255) { E(ln, op + ' needs a number from 0 to 255'); return; }
            push(+rest); return;
        }
        if (UNSUPPORTED.includes(op)) { E(ln, 'Instruction ' + op + ' is not supported yet'); return; }
        E(ln, 'Instruction "' + mm[1] + '" is not recognized. Try A, AN, O, =, S, R, L, T, SD, JC ...');
    });
    if (depth > 0) E(depthLine, 'Opening "(" without a closing ")"');
    ins.forEach(x => {
        if (['SPA', 'SPB', 'SPBN', 'JNB', 'JBI', 'JNBI'].includes(x.op) && labels[x.a] === undefined) E(x.line, 'Label "' + x.a + '" does not exist in the program');
    });
    return { prog: { ins, labels, lines, dbSizes }, errors, skipped, mnem, temps: tempLay.size, virtual };
}

// ---------- machine ----------
export type Timer = { kind: string; rem: number; pre: number; base: number; running: boolean; started: boolean; sig: boolean };
export type Counter = { val: number; su: boolean; sd: boolean; ss: boolean };

export class Machine {
    prog: Program = { ins: [], labels: {}, lines: [] };
    I = new Uint8Array(AREA_SIZE.I); // actual inputs
    PII = new Uint8Array(AREA_SIZE.I); // process image of inputs (sampled at scan start)
    Q = new Uint8Array(AREA_SIZE.Q);
    M = new Uint8Array(AREA_SIZE.M);
    PI = new Uint8Array(AREA_SIZE.PI); // peripheral inputs (PIB/PIW/PID)
    PQ = new Uint8Array(AREA_SIZE.PQ); // peripheral outputs (PQB/PQW/PQD)
    Lm = new Uint8Array(AREA_SIZE.L); // local (temp) data, cleared every scan
    BR = false;
    timers: Record<number, Timer> = {};
    counters: Record<number, Counter> = {};
    acc1 = 0; acc2 = 0;
    RLO = false; STA = false;
    fresh = true; acc = false; rlo = false; newTerm = false;
    stack: any[] = [];
    dbs: Record<number, Uint8Array> = {}; dbReg = 0; diReg = 0;
    dbArr(n: number) { return this.dbs[n] || (this.dbs[n] = new Uint8Array(Math.max(DBSIZE, (this.prog.dbSizes && this.prog.dbSizes[n]) || 0))); }
    pc = 0; inScan = false; scans = 0; lastScanMs = 0; scanStartClock = 0;
    clock = 0; // simulated ms
    error = '';
    lastInstrCount = 0;

    load(p: Program) { this.prog = p; this.pc = 0; this.inScan = false; this.resetChain(); this.error = ''; }
    resetChain() { this.fresh = true; this.acc = false; this.rlo = false; this.newTerm = false; this.stack = []; }
    reset() {
        this.PII.fill(0); this.Q.fill(0); this.M.fill(0); this.PQ.fill(0); this.Lm.fill(0); this.BR = false;
        this.timers = {}; this.counters = {}; this.dbs = {}; this.dbReg = 0; this.diReg = 0;
        this.acc1 = this.acc2 = 0; this.RLO = false; this.STA = false;
        this.pc = 0; this.inScan = false; this.scans = 0; this.lastScanMs = 0; this.error = '';
        this.resetChain();
    }
    advance(dt: number) {
        this.clock += dt;
        for (const k in this.timers) { const t = this.timers[k]; if (t.running) t.rem = Math.max(0, t.rem - dt); }
    }
    // memory
    arr(a: any) {
        if (a.area === 'DB') {
            const n = a.db || (a.reg === 'DI' ? this.diReg : this.dbReg);
            if (!n) throw new Error('No ' + (a.reg === 'DI' ? 'DI' : 'DB') + ' is open. Use OPN ' + (a.reg === 'DI' ? 'DI' : 'DB') + '1 first');
            return this.dbArr(n);
        }
        return a.area === 'I' ? this.PII : a.area === 'Q' ? this.Q : a.area === 'L' ? this.Lm : a.area === 'PI' ? this.PI : a.area === 'PQ' ? this.PQ : this.M;
    }
    getBit(a: Addr) { if (a.byte >= this.arr(a).length) throw new Error('Address is outside the open DB size'); return ((this.arr(a)[a.byte] >> a.bit!) & 1) === 1; }
    setBit(a: Addr, v: boolean) {
        const m = this.arr(a);
        if (v) m[a.byte] |= 1 << a.bit!; else m[a.byte] &= ~(1 << a.bit!);
        if (a.area === 'I') { if (v) this.I[a.byte] |= 1 << a.bit!; else this.I[a.byte] &= ~(1 << a.bit!); }
    }
    readN(a: Addr) {
        const m = this.arr(a); const n = a.size === 'B' ? 1 : a.size === 'W' ? 2 : 4;
        if (a.byte + n > m.length) throw new Error('Address is outside the open DB size');
        let v = 0; for (let i = 0; i < n; i++) v = (v * 256) + m[a.byte + i];
        return v >>> 0;
    }
    writeN(a: Addr, v: number) {
        const m = this.arr(a); const n = a.size === 'B' ? 1 : a.size === 'W' ? 2 : 4;
        if (a.byte + n > m.length) throw new Error('Address is outside the open DB size');
        for (let i = 0; i < n; i++) m[a.byte + i] = (v >>> (8 * (n - 1 - i))) & 255;
    }
    timer(n: number): Timer { return this.timers[n] || (this.timers[n] = { kind: '', rem: 0, pre: 0, base: 2, running: false, started: false, sig: false }); }
    counter(n: number): Counter { return this.counters[n] || (this.counters[n] = { val: 0, su: false, sd: false, ss: false }); }
    timerQ(t: Timer) {
        switch (t.kind) {
            case 'SE': return t.running && t.rem <= 0;
            case 'SI': case 'SV': return t.running && t.rem > 0;
            case 'SS': return t.started && t.rem <= 0;
            case 'SA': return t.sig || (t.running && t.rem > 0);
        }
        return false;
    }
    total() { return this.fresh ? this.RLO : (this.acc || (this.newTerm ? false : this.rlo)); }
    bitOp(kind: string, x: boolean) {
        const inv = kind.endsWith('N'); if (inv) x = !x;
        const k = kind[0];
        if (this.fresh) { this.acc = false; this.rlo = x; this.fresh = false; this.newTerm = false; }
        else if (k === 'A') { if (this.newTerm) { this.rlo = x; this.newTerm = false; } else this.rlo = this.rlo && x; }
        else if (k === 'O') { this.acc = this.acc || (this.newTerm ? false : this.rlo); this.rlo = x; this.newTerm = false; }
        else { const tot = this.acc || (this.newTerm ? false : this.rlo); this.rlo = tot !== x; this.acc = false; this.newTerm = false; }
        this.RLO = this.acc || this.rlo;
        this.STA = x;
    }
    setChainValue(v: boolean) { this.acc = false; this.rlo = v; this.fresh = false; this.newTerm = false; this.RLO = v; }
    operandBit(a: any) {
        if (a.area === 'T') { const t = this.timers[a.n]; return t ? this.timerQ(t) : false; }
        if (a.area === 'C') { const c = this.counters[a.n]; return c ? c.val !== 0 : false; }
        return this.getBit(a);
    }
    endScan() {
        this.inScan = false; this.pc = 0; this.scans++;
        this.lastScanMs = this.clock - this.scanStartClock;
        this.resetChain();
    }
    // execute one instruction; returns false if scan finished
    step(): boolean {
        const ins = this.prog.ins;
        if (!this.inScan) {
            this.inScan = true; this.pc = 0; this.PII.set(this.I); this.Lm.fill(0); this.scanStartClock = this.clock; this.lastInstrCount = 0;
            this.resetChain();
        }
        if (this.pc >= ins.length) { this.endScan(); return false; }
        if (++this.lastInstrCount > 20000) { this.error = 'Watchdog: scan took too long (infinite loop?)'; this.endScan(); return false; }
        const x = ins[this.pc]; let next = this.pc + 1; const a = x.a; const op = x.op;
        try {
            if (op === 'O' && a === undefined) { if (!this.fresh && !this.newTerm) { this.acc = this.acc || this.rlo; this.newTerm = true; } }
            else if (BITOPS.includes(op)) this.bitOp(op, this.operandBit(a));
            else if (op.endsWith('(') && BITOPS.includes(op.slice(0, -1))) {
                this.stack.push({ kind: op.slice(0, -1), acc: this.acc, rlo: this.rlo, fresh: this.fresh, nt: this.newTerm, RLO: this.RLO });
                this.fresh = true; this.acc = false; this.rlo = false; this.newTerm = false;
            } else if (op === ')') {
                const inner = this.total(); const f = this.stack.pop();
                this.acc = f.acc; this.rlo = f.rlo; this.fresh = f.fresh; this.newTerm = f.nt; this.RLO = f.RLO;
                this.bitOp(f.kind, inner);
            } else if (op === 'O') {
                if (!this.fresh && !this.newTerm) { this.acc = this.acc || this.rlo; this.newTerm = true; }
            } else if (op === '=') { this.assign(a, this.RLO_now()); }
            else if (op === 'S') {
                if (a.area === 'C') { const c = this.counter(a.n); const r = this.RLO_now(); if (r && !c.ss) c.val = Math.min(999, bcd2bin(this.acc1 & 0xfff)); c.ss = r; }
                else if (this.RLO_now()) this.setBit(a, true);
                this.endTerm(this.RLO_now());
            } else if (op === 'R') {
                const r = this.RLO_now();
                if (a.area === 'T') { if (r) { const t = this.timer(a.n); t.running = false; t.rem = 0; t.started = false; } }
                else if (a.area === 'C') { if (r) this.counter(a.n).val = 0; }
                else if (r) this.setBit(a, false);
                this.endTerm(r);
            } else if (op === 'SET') { this.RLO = true; this.STA = true; this.resetChain(); }
            else if (op === 'CLR') { this.RLO = false; this.STA = false; this.resetChain(); }
            else if (op === 'NOT') {
                const v = !this.total();
                if (this.fresh) this.RLO = v; else this.setChainValue(v);
            } else if (op === 'FP' || op === 'FN') {
                const cur = this.total(); const edge = this.getBit(a);
                const res = op === 'FP' ? (cur && !edge) : (!cur && edge);
                this.setBit(a, cur); this.setChainValue(res); this.STA = cur;
            } else if (TIMER_OPS.includes(op)) this.timerOp(op, a.n);
            else if (op === 'ZV' || op === 'ZR') {
                const c = this.counter(a.n); const r = this.RLO_now();
                if (op === 'ZV') { if (r && !c.su && c.val < 999) c.val++; c.su = r; }
                else { if (r && !c.sd && c.val > 0) c.val--; c.sd = r; }
                this.endTerm(r);
            } else if (op === 'FR') {
                if (a.area === 'T') this.timer(a.n).sig = false;
                else { const c = this.counter(a.n); c.su = c.sd = c.ss = false; }
                this.endTerm(this.RLO_now());
            } else if (op === 'L') {
                this.acc2 = this.acc1;
                if (a.area === 'K') this.acc1 = a.v >>> 0;
                else if (a.area === 'T') {
                    const t = this.timers[a.n];
                    this.acc1 = t ? Math.ceil(t.rem / UNITS[t.base]) : 0;
                } else if (a.area === 'C') this.acc1 = this.counters[a.n] ? this.counters[a.n].val : 0;
                else this.acc1 = this.readN(a);
            } else if (op === 'T') this.writeN(a, this.acc1);
            else if (/^(==|<>|>=|<=|>|<)[IDR]$/.test(op)) {
                const t = op[op.length - 1]; const o = op.slice(0, -1);
                let p: number, q: number;
                if (t === 'R') { p = f32(this.acc2); q = f32(this.acc1); } else if (t === 'D') { p = s32(this.acc2); q = s32(this.acc1); } else { p = s16(this.acc2); q = s16(this.acc1); }
                const r = o === '==' ? p === q : o === '<>' ? p !== q : o === '>' ? p > q : o === '<' ? p < q : o === '>=' ? p >= q : p <= q;
                this.setChainValue(r); this.STA = r;
            } else if (/^[+\-*\/][IDR]$/.test(op)) {
                const t = op[op.length - 1];
                if (t === 'R') {
                    const p = f32(this.acc2), q = f32(this.acc1);
                    const r = op[0] === '+' ? p + q : op[0] === '-' ? p - q : op[0] === '*' ? p * q : p / q;
                    this.acc1 = bitsOf(r);
                } else {
                const d = t === 'D';
                const p = d ? s32(this.acc2) : s16(this.acc2), q = d ? s32(this.acc1) : s16(this.acc1);
                let r = 0;
                if (op[0] === '+') r = p + q; else if (op[0] === '-') r = p - q; else if (op[0] === '*') r = p * q;
                else if (q === 0) r = 0; else r = Math.trunc(p / q);
                if (d) this.acc1 = r >>> 0;
                else if (op[0] === '/') { const rem = q === 0 ? 0 : p % q; this.acc1 = (((rem & 0xffff) << 16) | (r & 0xffff)) >>> 0; }
                else if (op[0] === '*') this.acc1 = r >>> 0;
                else this.acc1 = ((this.acc1 & 0xffff0000) | (r & 0xffff)) >>> 0;
                }
            } else if (SIMPLE.includes(op)) this.simple(op);
            else if (SHIFT.includes(op)) this.shift(op, a);
            else if (LOGW.includes(op)) {
                const w = op.endsWith('W'); const b = a ? a.v >>> 0 : this.acc2;
                const m = w ? 0xffff : 0xffffffff; const x = this.acc1, y = b;
                const k = op.startsWith('XO') ? 'X' : op[0];
                let r = k === 'A' ? (x & y) : k === 'O' ? (x | y) : (x ^ y);
                r = r >>> 0;
                this.acc1 = w ? (((x & 0xffff0000) | (r & 0xffff)) >>> 0) : r;
            } else if (op === '+') {
                if (a.kind === 'D') this.acc1 = (s32(this.acc1) + a.v) >>> 0;
                else this.acc1 = ((this.acc1 & 0xffff0000) | ((s16(this.acc1) + s16(a.v)) & 0xffff)) >>> 0;
            } else if (op === 'INC') this.acc1 = ((this.acc1 & 0xffffff00) | (((this.acc1 & 255) + a) & 255)) >>> 0;
            else if (op === 'DEC') this.acc1 = ((this.acc1 & 0xffffff00) | (((this.acc1 & 255) - a) & 255)) >>> 0;
            else if (op === 'OPN') { if (a.reg === 'DB') this.dbReg = a.n; else this.diReg = a.n; }
            else if (op === 'SPA') next = this.prog.labels[a];
            else if (op === 'SPB' || op === 'SPBN') {
                const r = this.RLO_now(); const jump = op === 'SPB' ? r : !r;
                this.RLO = true; this.STA = true; this.resetChain(); this.RLO = true;
                if (jump) next = this.prog.labels[a];
            } else if (op === 'JNB' || op === 'JBI' || op === 'JNBI') {
                const r = this.RLO_now(); let jump: boolean;
                if (op === 'JNB') { jump = !r; this.BR = r; } else jump = op === 'JBI' ? this.BR : !this.BR;
                this.resetChain(); this.RLO = op === 'JNB' ? true : r; this.STA = true;
                if (jump) next = this.prog.labels[a];
            } else if (op === 'SAVE') this.BR = this.RLO_now();
            else if (op === 'CALLSKIP') { const r = this.RLO_now(); this.resetChain(); this.RLO = r; }
            else if (op === 'BE') next = ins.length;
            else if (op === 'BEB') { const r = this.RLO_now(); this.RLO = true; this.resetChain(); this.RLO = true; if (r) next = ins.length; }
        } catch (e: any) { this.error = 'Runtime error: ' + (e && e.message); next = ins.length; }
        this.pc = next;
        if (this.pc >= ins.length) { this.endScan(); return false; }
        return true;
    }
    simple(op: string) {
        const a1 = this.acc1;
        const setR = (x: number) => { this.acc1 = bitsOf(x); };
        switch (op) {
            case 'TAK': this.acc1 = this.acc2; this.acc2 = a1; break;
            case 'ITD': this.acc1 = (s16(a1)) >>> 0; break;
            case 'DTR': setR(s32(a1)); break;
            case 'RND': this.acc1 = roundEven(f32(a1)) >>> 0; break;
            case 'RND+': this.acc1 = Math.ceil(f32(a1)) >>> 0; break;
            case 'RND-': this.acc1 = Math.floor(f32(a1)) >>> 0; break;
            case 'TRUNC': this.acc1 = Math.trunc(f32(a1)) >>> 0; break;
            case 'NEGI': this.acc1 = ((a1 & 0xffff0000) | ((-s16(a1)) & 0xffff)) >>> 0; break;
            case 'NEGD': this.acc1 = (-s32(a1)) >>> 0; break;
            case 'NEGR': setR(-f32(a1)); break;
            case 'ABS': setR(Math.abs(f32(a1))); break;
            case 'INVI': this.acc1 = ((a1 & 0xffff0000) | (~a1 & 0xffff)) >>> 0; break;
            case 'INVD': this.acc1 = (~a1) >>> 0; break;
            case 'CAW': this.acc1 = ((a1 & 0xffff0000) | ((a1 & 0xff) << 8) | ((a1 >> 8) & 0xff)) >>> 0; break;
            case 'CAD': this.acc1 = (((a1 & 0xff) << 24) | (((a1 >> 8) & 0xff) << 16) | (((a1 >> 16) & 0xff) << 8) | ((a1 >>> 24) & 0xff)) >>> 0; break;
            case 'SQRT': setR(Math.sqrt(f32(a1))); break;
            case 'SQR': setR(f32(a1) * f32(a1)); break;
            case 'EXP': setR(Math.exp(f32(a1))); break;
            case 'LN': setR(Math.log(f32(a1))); break;
            case 'SIN': setR(Math.sin(f32(a1))); break;
            case 'COS': setR(Math.cos(f32(a1))); break;
            case 'TAN': setR(Math.tan(f32(a1))); break;
            case 'ASIN': setR(Math.asin(f32(a1))); break;
            case 'ACOS': setR(Math.acos(f32(a1))); break;
            case 'ATAN': setR(Math.atan(f32(a1))); break;
            case 'MOD': { const q = s32(a1), p = s32(this.acc2); this.acc1 = (q === 0 ? 0 : p % q) >>> 0; break; }
        }
    }
    shift(op: string, n: number) {
        if (n < 0) n = this.acc2 & 0xff;
        const a1 = this.acc1;
        const hi = a1 & 0xffff0000, lo = a1 & 0xffff;
        switch (op) {
            case 'SLW': this.acc1 = (hi | (n > 15 ? 0 : (lo << n) & 0xffff)) >>> 0; break;
            case 'SRW': this.acc1 = (hi | (n > 15 ? 0 : lo >> n)) >>> 0; break;
            case 'SLD': this.acc1 = n > 31 ? 0 : (a1 << n) >>> 0; break;
            case 'SRD': this.acc1 = n > 31 ? 0 : a1 >>> n; break;
            case 'SSI': { const v = s16(a1) >> Math.min(n, 15); this.acc1 = ((a1 & 0xffff0000) | (v & 0xffff)) >>> 0; break; }
            case 'SSD': this.acc1 = (s32(a1) >> Math.min(n, 31)) >>> 0; break;
            case 'RLD': { const k = n % 32; this.acc1 = k === 0 ? a1 : ((a1 << k) | (a1 >>> (32 - k))) >>> 0; break; }
            case 'RRD': { const k = n % 32; this.acc1 = k === 0 ? a1 : ((a1 >>> k) | (a1 << (32 - k))) >>> 0; break; }
        }
    }
    RLO_now() { return this.fresh ? this.RLO : this.total(); }
    endTerm(v: boolean) { this.RLO = v; this.STA = v; this.fresh = true; this.acc = false; this.rlo = false; this.newTerm = false; }
    assign(a: any, v: boolean) { this.setBit(a, v); this.endTerm(v); }
    timerOp(op: string, n: number) {
        const t = this.timer(n); const r = this.RLO_now(); const prev = t.sig;
        t.kind = op;
        const start = () => {
            const w = this.acc1 & 0xffff; t.base = (w >> 12) & 3; t.pre = bcd2bin(w & 0xfff) * UNITS[t.base];
            t.rem = t.pre; t.running = true; t.started = true;
        };
        if (op === 'SE') { if (r && !prev) start(); if (!r) t.running = false; }
        else if (op === 'SI') { if (r && !prev) start(); if (!r) t.running = false; }
        else if (op === 'SS') { if (r && !prev) start(); }
        else if (op === 'SV') { if (r && !prev) start(); }
        else if (op === 'SA') { if (!r && prev) start(); if (r) t.running = false; }
        t.sig = r;
        this.endTerm(r);
    }
    runScan(maxInstr = 20000) { let g = 0; do { if (!this.step()) return; } while (++g < maxInstr); }
}

export function fmtTimer(t: Timer | undefined) { return t ? (t.rem / 1000).toFixed(2) : '0.00'; }


// ---------- compiled-only blocks: readable parts of SUBBLK.DBF/DBT ----------
const DECL_SUB: Record<string, number> = { FC: 5, OB: 3, FB: 4, DB: 6 };
const CMT_SUB: Record<string, number> = { FC: 19, OB: 17, FB: 18, DB: 20 };
export type CompInfo = { decl: string; nets: string[]; codeBytes: number; code?: Uint8Array };
export function parseCompiled(dbf: Uint8Array, dbt: Uint8Array): Record<number, Record<number, { memo: Record<string, Uint8Array>; len: number }>> {
    const dv = new DataView(dbf.buffer, dbf.byteOffset, dbf.byteLength);
    const hlen = dv.getUint16(8, true), rlen = dv.getUint16(10, true), nrec = dv.getUint32(4, true);
    const flds: Record<string, { len: number; off: number }> = {}; let off = 1;
    for (let p = 32; p + 32 <= hlen && dbf[p] !== 0x0d; p += 32) { let nm = ''; for (let i = 0; i < 11 && dbf[p + i]; i++) nm += String.fromCharCode(dbf[p + i]); const len = dbf[p + 16]; flds[nm] = { len, off }; off += len; }
    const num = (r: number, f: { len: number; off: number }) => { let s = ''; for (let i = 0; i < f.len; i++) { const c = dbf[r + f.off + i]; if (c) s += String.fromCharCode(c); } return +s.trim() || 0; };
    const dbv = new DataView(dbt.buffer, dbt.byteOffset, dbt.byteLength);
    const memo = (r: number, name: string): Uint8Array => { const f = flds[name]; if (!f) return new Uint8Array(0); const b = num(r, f) * 512; if (!b || b + 8 > dbt.length) return new Uint8Array(0); const L = dbv.getUint32(b + 4, true); return dbt.subarray(b + 8, Math.min(dbt.length, b + 8 + L)); };
    const out: Record<number, Record<number, { memo: Record<string, Uint8Array>; len: number }>> = {};
    if (!flds.OBJECTID || !flds.SUBBLKTYP) return out;
    for (let i = 0; i < nrec; i++) { const r = hlen + i * rlen; if (r + rlen > dbf.length) break; if (dbf[r] === 0x2a) continue; const id = num(r, flds.OBJECTID), t = num(r, flds.SUBBLKTYP); (out[id] = out[id] || {})[t] = { memo: { code: memo(r, 'MC5CODE'), ssb: memo(r, 'SSBPART'), add: memo(r, 'ADDINFO') }, len: flds.MC5LEN ? num(r, flds.MC5LEN) : 0 }; }
    return out;
}
const asc = (b: Uint8Array) => { let s = ''; for (const c of b) s += c === 0 ? '\u0000' : String.fromCharCode(c); return s; };
export function compInfo(kind: string, subs: Record<number, { memo: Record<string, Uint8Array>; len: number }> | undefined): CompInfo | undefined {
    if (!subs) return undefined;
    const dsub = subs[DECL_SUB[kind]]; let decl = '';
    if (dsub) { const m = dsub.memo.code; if (m.length) { const t = asc(m); const z = t.indexOf('\u0000'); decl = (z >= 0 ? t.slice(0, z) : t).replace(/\r/g, '').replace(/\t/g, '').trim(); } }
    const nets: string[] = [];
    const c = subs[CMT_SUB[kind]]; if (c) {
        const m = c.memo.code;
        for (let p = 0; p + 8 <= m.length; p++) {
            if (m[p] !== 0x06 || m[p + 2] !== 0 || m[p + 4] !== 0 || m[p + 5] !== 0x06) continue;
            const L = m[p + 3]; if (m[p + 1] !== ((L - 1) & 0xff) || L < 8 || p + L > m.length) continue;
            if (m[p + L - 1] !== 0 || m[p + L - 2] !== 0) continue;
            const t = asc(m.subarray(p + 6, p + L - 2)); if (/[\u0000-\u0008\u000e-\u001f]/.test(t)) continue;
            nets.push(t); p += L - 1;
        }
    }
    const body = subs[({ FC: 12, OB: 8, FB: 14, DB: 10 } as any)[kind]];
    let code: Uint8Array | undefined;
    if (body && body.memo.code.length && body.len > 0 && body.len <= body.memo.code.length) code = body.memo.code.slice(0, body.len);
    else if (body && body.memo.code.length) code = body.memo.code;
    return { decl, nets, codeBytes: body ? body.len : 0, code };
}
