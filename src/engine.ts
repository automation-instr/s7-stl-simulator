// S7-300 STL engine (MVP). Plain logic, no UI.
/* eslint-disable */

export type Err = { line: number; msg: string };
export type Ins = { op: string; a?: any; line: number; text: string; label?: string };
export type Program = { ins: Ins[]; labels: Record<string, number>; lines: string[] };

const BITOPS = ['A', 'AN', 'O', 'ON', 'X', 'XN'];
const ALIAS: Record<string, string> = {
    U: 'A', UN: 'AN', JU: 'SPA', JC: 'SPB', JCN: 'SPBN', CU: 'ZV', CD: 'ZR',
    S_ODT: 'SE', S_PULSE: 'SI', S_ODTS: 'SS', S_PEXT: 'SV', S_OFFDT: 'SA', BEC: 'BEB', CLR: 'CLR',
};
const TIMER_OPS = ['SE', 'SI', 'SS', 'SV', 'SA'];
const UNSUPPORTED = ['CALL', 'CC', 'UC', 'LC', 'LOOP', 'SAVE', 'POP', 'PUSH', 'RLDA', 'RRDA', 'MCR(', 'DI', 'DO', 'AUF', 'TAW', 'TAD', 'CDB', 'OPN_'];
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
    const m = /^([IEQAM])(\d+)\.(\d+)$/i.exec(s);
    if (!m) return 'bad';
    const bit = +m[3];
    if (bit > 7) return 'bit';
    const area = { I: 'I', E: 'I', Q: 'Q', A: 'Q', M: 'M' }[m[1].toUpperCase()] as string;
    const byte = +m[2];
    if (byte > 255 || (area !== 'M' && byte > 127)) return 'range';
    return { area, byte, bit };
}

const DBSIZE = 512;
function parseDbAddr(s: string, mode: 'bit' | 'num'): any {
    const m = /^(?:DB(\d+)\.)?(DB|DI)([XBWD])(\d+)(?:\.(\d+))?$/i.exec(s);
    if (!m) return null;
    const db = m[1] ? +m[1] : 0, reg = m[2].toUpperCase(), k = m[3].toUpperCase(), byte = +m[4];
    if (m[1] && reg === 'DI') return 'baddi';
    if (db > 255 || (m[1] && db === 0)) return 'dbrange';
    if (k === 'X') {
        if (m[5] === undefined) return 'dbxbit';
        if (+m[5] > 7) return 'bit';
        if (byte >= DBSIZE) return 'dbbyte';
        return mode === 'bit' ? { area: 'DB', db, reg, byte, bit: +m[5] } : 'needsize';
    }
    if (m[5] !== undefined) return 'dbbitnotallowed';
    const w = k === 'B' ? 1 : k === 'W' ? 2 : 4;
    if (byte + w > DBSIZE) return 'dbbyte';
    return mode === 'num' ? { area: 'DB', db, reg, byte, size: k } : 'needbit';
}
const DBERR: Record<string, string> = {
    baddi: 'DI مينفعش يتكتب معاه رقم DB. استخدم DIX0.0 بعد OPN DI',
    dbrange: 'رقم الـ DB لازم يكون من 1 لـ 255',
    dbxbit: 'DBX محتاج رقم بت (مثال: DBX0.0)',
    bit: 'رقم البت لازم يكون من 0 لـ 7',
    dbbyte: 'العنوان برا حجم الـ DB (' + DBSIZE + ' بايت)',
    needsize: 'DBX للبت بس. للقراءة والكتابة استخدم DBB/DBW/DBD (مثال: L DBW0)',
    needbit: 'العنوان ده مش بت. للبت استخدم DBX، وللقراءة استخدم L DBW0',
    dbbitnotallowed: 'DBB/DBW/DBD من غير رقم بت',
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

// ---------- parser ----------
export function compile(src: string): { prog: Program; errors: Err[] } {
    const lines = src.replace(/\r/g, '').split('\n');
    const ins: Ins[] = [];
    const labels: Record<string, number> = {};
    const errors: Err[] = [];
    const E = (line: number, msg: string) => errors.push({ line, msg });
    let depth = 0, depthLine = 0;

    let inVar = false;
    lines.forEach((raw, i) => {
        const ln = i + 1;
        let t = raw.replace(/\/\/.*$/, '').replace(/\(\*.*?\*\)/g, '').replace(/;\s*$/, '').trim();
        if (!t) return;
        if (inVar) { if (/^END_VAR\b/i.test(t)) inVar = false; return; }
        if (/^VAR\w*\b/i.test(t)) { inVar = true; return; }
        if (/^(NETWORK\b|TITLE\s*=|BEGIN\b|END_\w+|ORGANIZATION_BLOCK\b|FUNCTION_BLOCK\b|FUNCTION\b|VERSION\b|AUTHOR\b|FAMILY\b|KNOW_HOW_PROTECT\b|\{)/i.test(t)) return;
        let label: string | undefined;
        const lm = /^([A-Za-z_][A-Za-z0-9_]*)\s*:(?!=)\s*(.*)$/.exec(t);
        if (lm) {
            label = lm[1].toUpperCase();
            if (label.length > 4) E(ln, 'اسم الـ Label "' + lm[1] + '" طويل. أقصى حاجة 4 حروف (مثال: M001:)');
            else if (labels[label] !== undefined) E(ln, 'الـ Label "' + label + '" متكرر');
            labels[label] = ins.length;
            t = lm[2].trim();
            if (!t) return;
        }
        const mm = /^(==[IDR]|<>[IDR]|>=[IDR]|<=[IDR]|>[IDR]|<[IDR]|[+\-*\/][IDR]|RND[+\-]|=|\+|\)|[A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/.exec(t);
        if (!mm) { E(ln, 'مش فاهم السطر ده: "' + t + '"'); return; }
        let op = mm[1].toUpperCase();
        let rest = mm[2].replace(/\s+/g, '');
        const text = t;
        if (ALIAS[op]) op = ALIAS[op];
        const push = (a?: any) => ins.push({ op, a, line: ln, text, label });

        if (BITOPS.includes(op) && rest.startsWith('(')) {
            if (rest !== '(') { E(ln, 'بعد "' + op + '(" مينفعش يبقى فيه حاجة تانية في نفس السطر'); return; }
            depth++; depthLine = ln; op = op + '('; push(); return;
        }
        if (op === ')') {
            if (depth === 0) { E(ln, 'قوس قفل ")" من غير قوس فتح'); return; }
            depth--; push(); return;
        }
        if (['SET', 'CLR', 'NOT', 'BE', 'SPA_'].includes(op) || (op === 'NOP')) {
            if (op === 'NOP') { push(); return; }
            if (rest) { E(ln, 'التعليمة ' + op + ' من غير عنوان'); return; }
            push(); return;
        }
        if (op === 'O' && !rest) { push(); return; }
        if (BITOPS.includes(op) || op === '=' || op === 'S' || op === 'R' || op === 'FP' || op === 'FN') {
            if (!rest) { E(ln, 'التعليمة ' + op + ' محتاجة عنوان (مثال: ' + op + ' I0.0)'); return; }
            const tc = /^([TC])(\d+)$/i.exec(rest);
            if (tc) {
                const kind = tc[1].toUpperCase(), n = +tc[2];
                if (n > 255) { E(ln, 'رقم ' + (kind === 'T' ? 'التايمر' : 'العداد') + ' لازم يكون من 0 لـ 255'); return; }
                if (BITOPS.includes(op)) { push({ area: kind, n }); return; }
                if (op === 'R') { push({ area: kind, n }); return; }
                if (op === 'S' && kind === 'C') { push({ area: kind, n }); return; }
                E(ln, 'التعليمة ' + op + ' مينفعش تتعامل مع ' + (kind === 'T' ? 'التايمر' : 'العداد') + ' كده. استخدم ' + (kind === 'T' ? 'SE / SI / SS / SV / SA أو R' : 'ZV / ZR / S / R')); return;
            }
            const da = parseDbAddr(rest, 'bit');
            if (da) { if (typeof da === 'string') { E(ln, DBERR[da]); return; } if (op === 'FP' || op === 'FN') { E(ln, op + ' محتاجة Merker زي M1.0 كذاكرة للحافة'); return; } push(da); return; }
            const a = parseBitAddr(rest);
            if (typeof a === 'string') {
                E(ln, a === 'bit' ? 'رقم البت لازم يكون من 0 لـ 7 في "' + rest + '"' : a === 'range' ? 'العنوان "' + rest + '" برا النطاق' : 'العنوان "' + rest + '" غلط. الشكل الصحيح: I0.0 أو Q0.1 أو M2.3');
                return;
            }
            if (op === 'FP' || op === 'FN') { if (a.area !== 'M') { E(ln, op + ' محتاجة Merker زي M1.0 كذاكرة للحافة'); return; } }
            push(a); return;
        }
        if (TIMER_OPS.includes(op) || op === 'ZV' || op === 'ZR' || op === 'FR') {
            const tc = /^([TC])(\d+)$/i.exec(rest);
            const want = TIMER_OPS.includes(op) ? 'T' : 'C';
            if (op === 'FR') { if (!tc) { E(ln, 'FR محتاجة T أو C مثال: FR T1'); return; } push({ area: tc[1].toUpperCase(), n: +tc[2] }); return; }
            if (!tc || tc[1].toUpperCase() !== want) { E(ln, 'التعليمة ' + op + ' محتاجة ' + (want === 'T' ? 'تايمر مثال: ' + op + ' T1' : 'عداد مثال: ' + op + ' C1')); return; }
            if (+tc[2] > 255) { E(ln, 'الرقم لازم يكون من 0 لـ 255'); return; }
            push({ area: want, n: +tc[2] }); return;
        }
        if (op === 'L' || op === 'T') {
            if (!rest) { E(ln, 'التعليمة ' + op + ' محتاجة عنوان' + (op === 'L' ? ' أو رقم (مثال: L 5 أو L MW10)' : ' (مثال: T MW10)')); return; }
            const dn = parseDbAddr(rest, 'num');
            if (dn) { if (typeof dn === 'string') { E(ln, DBERR[dn]); return; } push(dn); return; }
            const m = /^([IEQAM])([BWD])(\d+)$/i.exec(rest);
            if (m) {
                const area = { I: 'I', E: 'I', Q: 'Q', A: 'Q', M: 'M' }[m[1].toUpperCase()] as string;
                const size = m[2].toUpperCase(), byte = +m[3];
                const w = size === 'B' ? 1 : size === 'W' ? 2 : 4;
                if (byte + w > (area === 'M' ? 256 : 128)) { E(ln, 'العنوان "' + rest + '" برا النطاق'); return; }
                if (op === 'T' && area === 'I') { E(ln, 'التعليمة T مينفعش تكتب على I (دخل)'); return; }
                push({ area, byte, size }); return;
            }
            const tc = /^([TC])(\d+)$/i.exec(rest);
            if (tc && op === 'L') { push({ area: tc[1].toUpperCase(), n: +tc[2], val: true }); return; }
            if (op === 'L') {
                const c = parseConst(rest);
                if (typeof c === 'string') {
                    E(ln, c === 'S5T' ? 'صيغة الوقت غلط. مثال: S5T#5S أو S5T#1M30S أو S5T#500MS' : c === 'S5Tmax' ? 'أكبر وقت في S5T# هو 2H46M30S' : c === 'big' ? 'الرقم أكبر من حدود 32 بت' : 'مش فاهم القيمة "' + rest + '". جرب: L 5 أو L W#16#FF أو L S5T#2S أو L MW10');
                    return;
                }
                push({ area: 'K', ...c }); return;
            }
            E(ln, 'العنوان "' + rest + '" غلط. مثال: T MW10 أو T QB0'); return;
        }
        if (op === 'SPA' || op === 'SPB' || op === 'SPBN') {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(rest)) { E(ln, op + ' محتاجة اسم Label (مثال: ' + op + ' M001)'); return; }
            push(rest.toUpperCase()); return;
        }
        if (op === 'BEB') { push(); return; }
        if (op === 'OPN') {
            const om = /^(DB|DI)(\d+)$/i.exec(rest);
            if (!om || +om[2] < 1 || +om[2] > 255) { E(ln, 'OPN محتاجة DB أو DI مع رقم من 1 لـ 255 (مثال: OPN DB1)'); return; }
            push({ reg: om[1].toUpperCase(), n: +om[2] }); return;
        }
        if (SIMPLE.includes(op)) { if (rest) { E(ln, 'التعليمة ' + op + ' من غير عنوان'); return; } push(); return; }
        if (SHIFT.includes(op)) {
            if (rest && (!/^\d+$/.test(rest) || +rest > 32)) { E(ln, op + ' محتاجة عدد إزاحة من 0 لـ 32 (أو من غير رقم لو العدد في ACCU2)'); return; }
            push(rest ? +rest : -1); return;
        }
        if (LOGW.includes(op)) {
            if (!rest) { push(null); return; }
            const c = parseConst(rest);
            if (typeof c === 'string') { E(ln, 'قيمة ' + op + ' غلط. مثال: ' + op + ' W#16#00FF'); return; }
            push(c); return;
        }
        if (/^(==|<>|>=|<=|>|<)[IDR]$/.test(op) || /^[+\-*\/][IDR]$/.test(op)) {
            if (rest) { E(ln, 'التعليمة ' + op + ' من غير عنوان'); return; }
            push(); return;
        }
        if (op === '+') {
            const c = parseConst(rest);
            if (typeof c === 'string' || !rest) { E(ln, '+ محتاجة رقم ثابت (مثال: + 1)'); return; }
            push(c); return;
        }
        if (op === 'INC' || op === 'DEC') {
            if (!/^\d+$/.test(rest) || +rest > 255) { E(ln, op + ' محتاجة رقم من 0 لـ 255'); return; }
            push(+rest); return;
        }
        if (UNSUPPORTED.includes(op)) { E(ln, 'التعليمة ' + op + ' لسه مش مدعومة في النسخة الأولى'); return; }
        E(ln, 'التعليمة "' + mm[1] + '" مش معروفة. جرب A, AN, O, =, S, R, L, T, SE, SPB ...');
    });
    if (depth > 0) E(depthLine, 'قوس فتح "(" من غير قوس قفل ")"');
    ins.forEach(x => {
        if (['SPA', 'SPB', 'SPBN'].includes(x.op) && labels[x.a] === undefined) E(x.line, 'الـ Label "' + x.a + '" مش موجود في البرنامج');
    });
    return { prog: { ins, labels, lines }, errors };
}

// ---------- machine ----------
export type Timer = { kind: string; rem: number; pre: number; base: number; running: boolean; started: boolean; sig: boolean };
export type Counter = { val: number; su: boolean; sd: boolean; ss: boolean };

export class Machine {
    prog: Program = { ins: [], labels: {}, lines: [] };
    I = new Uint8Array(128); // actual inputs
    PII = new Uint8Array(128); // process image of inputs (sampled at scan start)
    Q = new Uint8Array(128);
    M = new Uint8Array(256);
    timers: Record<number, Timer> = {};
    counters: Record<number, Counter> = {};
    acc1 = 0; acc2 = 0;
    RLO = false; STA = false;
    fresh = true; acc = false; rlo = false; newTerm = false;
    stack: any[] = [];
    dbs: Record<number, Uint8Array> = {}; dbReg = 0; diReg = 0;
    dbArr(n: number) { return this.dbs[n] || (this.dbs[n] = new Uint8Array(DBSIZE)); }
    pc = 0; inScan = false; scans = 0; lastScanMs = 0; scanStartClock = 0;
    clock = 0; // simulated ms
    error = '';
    lastInstrCount = 0;

    load(p: Program) { this.prog = p; this.pc = 0; this.inScan = false; this.resetChain(); this.error = ''; }
    resetChain() { this.fresh = true; this.acc = false; this.rlo = false; this.newTerm = false; this.stack = []; }
    reset() {
        this.PII.fill(0); this.Q.fill(0); this.M.fill(0);
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
            if (!n) throw new Error('مفيش ' + (a.reg === 'DI' ? 'DI' : 'DB') + ' مفتوح. استخدم OPN ' + (a.reg === 'DI' ? 'DI' : 'DB') + '1 الأول');
            return this.dbArr(n);
        }
        return a.area === 'I' ? this.PII : a.area === 'Q' ? this.Q : this.M;
    }
    getBit(a: Addr) { return ((this.arr(a)[a.byte] >> a.bit!) & 1) === 1; }
    setBit(a: Addr, v: boolean) {
        const m = this.arr(a);
        if (v) m[a.byte] |= 1 << a.bit!; else m[a.byte] &= ~(1 << a.bit!);
        if (a.area === 'I') { if (v) this.I[a.byte] |= 1 << a.bit!; else this.I[a.byte] &= ~(1 << a.bit!); }
    }
    readN(a: Addr) {
        const m = this.arr(a); const n = a.size === 'B' ? 1 : a.size === 'W' ? 2 : 4;
        let v = 0; for (let i = 0; i < n; i++) v = (v * 256) + m[a.byte + i];
        return v >>> 0;
    }
    writeN(a: Addr, v: number) {
        const m = this.arr(a); const n = a.size === 'B' ? 1 : a.size === 'W' ? 2 : 4;
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
            this.inScan = true; this.pc = 0; this.PII.set(this.I); this.scanStartClock = this.clock; this.lastInstrCount = 0;
            this.resetChain();
        }
        if (this.pc >= ins.length) { this.endScan(); return false; }
        if (++this.lastInstrCount > 20000) { this.error = 'Watchdog: السكان طوّل زيادة (لوب لا نهائي؟)'; this.endScan(); return false; }
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
            } else if (op === 'BE') next = ins.length;
            else if (op === 'BEB') { const r = this.RLO_now(); this.RLO = true; this.resetChain(); this.RLO = true; if (r) next = ins.length; }
        } catch (e: any) { this.error = 'خطأ تنفيذ: ' + (e && e.message); next = ins.length; }
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
