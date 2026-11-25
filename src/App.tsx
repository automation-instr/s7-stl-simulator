import React, { useEffect, useMemo, useRef, useState } from 'react';
import { compile, Machine, TIMER_NAME, Ctx } from './engine';
import { Proj, loadFiles, idbPut, idbGet, idbDel } from './project';
import { EXAMPLES } from './examples';
import { BlockSheet, KIND_LABEL } from './BlockSheet';
const GROUP_NAME: Record<string, string> = { OB: 'Organization blocks', FB: 'Function blocks', FC: 'Functions', DB: 'Data blocks', UDT: 'User data types', SFC: 'System functions', SFB: 'System function blocks', VAT: 'Variable tables' };
const GROUPS = ['OB', 'FB', 'FC', 'DB', 'UDT', 'SFC', 'SFB', 'VAT'];
type Row = { key: string; kind: string; num?: number; name: string; title: string; blk?: any };
const rowsOf = (proj: any): Row[] => {
    const rows: Row[] = []; const used = new Set<any>();
    if (proj.catalog) {
        const sorted = proj.catalog.slice().sort((a: any, b: any) => a.num - b.num);
        for (const c of sorted) {
            const b = proj.blocks.find((x: any) => KIND_LABEL[x.kind] === c.kind && x.num === c.num);
            if (b) used.add(b);
            rows.push({ key: c.kind + c.num, kind: c.kind, num: c.num, name: c.name || (b ? b.name : c.kind + c.num), title: (b ? titleOf(b.text) : '') || c.comment || (c.name ? c.kind + c.num : ''), blk: b });
        }
    }
    for (const b of proj.blocks) if (!used.has(b)) rows.push({ key: 'src:' + b.name, kind: KIND_LABEL[b.kind] || b.kind, num: b.num, name: b.name, title: titleOf(b.text), blk: b });
    return rows;
};
const titleOf = (t: string) => { const m = /^\s*TITLE\s*=(.*)$/m.exec(t.split('\n').slice(0, 6).join('\n')); return m ? m[1].trim() : ''; };
const NEWTPL = '// New program\n// Write your STL here, then press Save.\n';
const WELCOME = '// Welcome. Open "Examples" to pick a ready-made program,\n// load your own AWL/ZIP project, or type STL here.\n';

const hex = (v: number, n = 8) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
const s16 = (v: number) => ((v & 0xffff) << 16) >> 16;
const f32 = (bits: number) => new Float32Array(new Uint32Array([bits >>> 0]).buffer)[0];
const fmtR = (bits: number) => { const f = f32(bits); return isFinite(f) ? String(parseFloat(f.toPrecision(7))) : '—'; };
const SPEEDS = [
    { ms: 500, label: 'Slow (scan every 0.5 s)' },
    { ms: 100, label: 'Medium (scan every 100 ms)' },
    { ms: 20, label: 'Fast (scan every 20 ms)' },
];


const LS_PROGS = 's7stl.programs.v1', LS_DRAFT = 's7stl.draft.v1';
function lsGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string): boolean { try { localStorage.setItem(k, v); return true; } catch { return false; } }
function loadProgs(): Record<string, { code: string; ts: number }> { try { const o = JSON.parse(lsGet(LS_PROGS) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } }

function Led({ on, label, kind, onTap }: { on: boolean; label: string; kind: string; onTap?: () => void }) {
    return <button type="button" className={'s7-led ' + kind + (on ? ' on' : '') + (onTap ? '' : ' ro')} onClick={onTap} aria-pressed={on} aria-label={label}>
        <i />{label}
    </button>;
}

function NumCell({ value, onCommit }: { value: string; onCommit: (s: string) => void }) {
    const [d, setD] = useState<string | null>(null);
    return <input className="s7-num" inputMode="decimal" dir="ltr" value={d === null ? value : d} onFocus={() => setD(value)} onChange={e => setD(e.target.value)}
        onBlur={() => { if (d !== null) onCommit(d); setD(null); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

export function App() {
    const m = useRef<Machine>(null as any);
    if (!m.current) m.current = new Machine();
    const mach = m.current;
    const [text, setText] = useState(() => lsGet(LS_DRAFT) || WELCOME);
    const [pick, setPick] = useState(false);
    const [viewBlk, setViewBlk] = useState('');
    const [bfilter, setBfilter] = useState('');
    const [exId, setExId] = useState('');
    const [progs, setProgs] = useState(loadProgs);
    const [saveName, setSaveName] = useState('');
    const [cur, setCur] = useState<'' | 'new' | 'saved'>('');
    const [saveMsg, setSaveMsg] = useState('');
    const [delAsk, setDelAsk] = useState('');
    const [running, setRunning] = useState(false);
    const [speed, setSpeed] = useState(20);
    const [, setTick] = useState(0);
    const [scrollTop, setScrollTop] = useState(0);
    const lastRender = useRef(0);
    const fileRef = useRef<HTMLInputElement>(null);
    const [fileMsg, setFileMsg] = useState('');
    const [proj, setProj] = useState<Proj | null>(null);
    const [blk, setBlk] = useState('');
    const [mnemSel, setMnemSel] = useState<'auto' | 'en' | 'de'>('auto');
    const [wfilter, setWfilter] = useState('');
    const [wmax, setWmax] = useState(60);
    const [busy, setBusy] = useState(false);
    useEffect(() => { idbGet('project').then((p: any) => { if (p && p.proj) { setProj(p.proj); if (p.blk) { setBlk(p.blk); const b = p.proj.blocks.find((x: any) => x.name === p.blk); if (b) { setText(b.text); setExId(''); } } } }); }, []);

    useEffect(() => { const id = setTimeout(() => lsSet(LS_DRAFT, text), 400); return () => clearTimeout(id); }, [text]);
    const doSave = () => {
        const name = saveName.trim().slice(0, 40);
        if (!name) { setSaveMsg('Type a name for the program first'); return; }
        const next = { ...progs, [name]: { code: text, ts: Date.now() } };
        if (lsSet(LS_PROGS, JSON.stringify(next))) { setProgs(next); setCur('saved'); setSaveMsg('Saved: ' + name); } else setSaveMsg('Browser refused to save (storage is blocked)');
    };
    const doNew = () => { setRunning(false); setText(NEWTPL); setExId(''); setCur('new'); setSaveName(''); setSaveMsg(''); setBlk(''); mach.I.fill(0); mach.reset(); bump(); setTimeout(() => { const el = document.querySelector('.s7-ta') as HTMLElement | null; if (el) el.focus(); }, 50); };
    const doLoad = (name: string) => { setRunning(false); setText(progs[name].code); setExId(''); setCur('saved'); setSaveName(name); mach.I.fill(0); mach.reset(); bump(); setSaveMsg('Opened: ' + name); };
    const doDel = (name: string) => {
        if (delAsk !== name) { setDelAsk(name); return; }
        const next = { ...progs }; delete next[name]; lsSet(LS_PROGS, JSON.stringify(next)); setProgs(next); setDelAsk(''); setSaveMsg('Deleted: ' + name);
    };
    const ctx: Ctx = useMemo(() => proj ? { symbols: proj.symbols, dbs: proj.dbs, mnem: mnemSel === 'auto' ? proj.mnem : mnemSel } : { mnem: mnemSel }, [proj, mnemSel]);
    const { prog, errors, skipped, mnem: mnemUsed, virtual } = useMemo(() => compile(text, ctx), [text, ctx]);
    const verdicts = useMemo(() => {
        if (!proj) return [] as any[];
        return proj.blocks.filter(b => b.kind !== 'DATA_BLOCK' && b.kind !== 'TYPE').map(b => {
            const r = compile(b.text, ctx);
            return { name: b.name, kind: b.kind, lines: b.text.split('\n').length, ins: r.prog.ins.length, err: r.errors.length, skip: r.skipped.length, virt: r.virtual.length };
        });
    }, [proj, ctx]);
    const pickBlock = (name: string) => {
        const b = proj && proj.blocks.find(x => x.name === name); if (!b) return;
        setRunning(false); setBlk(name); setText(b.text); setExId(''); setCur(''); mach.I.fill(0); mach.reset(); bump();
        if (proj) idbPut('project', { proj, blk: name });
    };
    const hasErr = errors.length > 0;
    useEffect(() => { if (!hasErr) mach.load(prog); }, [prog, hasErr]);
    const bump = () => setTick(t => (t + 1) % 1e9);
    const memOf = (a: any): Uint8Array => (a.area === 'I' ? mach.I : mach.arr(a));
    const nB = (a: any) => (a.size === 'B' ? 1 : a.size === 'W' ? 2 : 4);
    const rdN = (a: any) => { const m = memOf(a); let v = 0; for (let i = 0; i < nB(a); i++) v = v * 256 + (m[a.byte + i] || 0); return v >>> 0; };
    const wrN = (a: any, v: number) => { const m = memOf(a); const n = nB(a); for (let i = 0; i < n; i++) m[a.byte + i] = (v >>> (8 * (n - 1 - i))) & 255; bump(); };
    const commitNum = (a: any, s: string) => {
        s = s.trim(); if (s === '') return;
        let v: number; if (/^-?\d*\.\d+(e[+-]?\d+)?$/i.test(s) && a.size === 'D') v = new Uint32Array(new Float32Array([parseFloat(s)]).buffer)[0];
        else if (/^-?\d+$/.test(s)) v = parseInt(s, 10); else return;
        wrN(a, v >>> 0);
    };

    useEffect(() => {
        if (!running || hasErr) return;
        let last = performance.now();
        const id = setInterval(() => {
            const now = performance.now();
            const dt = Math.min(now - last, 1000); last = now;
            mach.advance(dt); mach.runScan();
            if (now - lastRender.current > 30) { lastRender.current = now; bump(); }
        }, speed);
        return () => clearInterval(id);
    }, [running, speed, hasErr]);

    const used = useMemo(() => {
        const bytes: Record<string, Set<number>> = { I: new Set([0, 1]), Q: new Set([0, 1]), M: new Set([0]) };
        const timers = new Set<number>(), counters = new Set<number>(); const watch: any[] = []; const seen = new Set<string>();
        const dbBits: Record<number, Set<number>> = {}; let curDB = 0, curDI = 0;
        prog.ins.forEach(x => {
            const a = x.a; if (!a || typeof a !== 'object') return;
            if (x.op === 'OPN') { if (a.reg === 'DB') curDB = a.n; else curDI = a.n; return; }
            if (a.area === 'DB') {
                const n = a.db || (a.reg === 'DI' ? curDI : curDB); if (!n) return;
                if (a.size) { const k = 'DB' + n + a.size + a.byte; if (!seen.has(k)) { seen.add(k); watch.push({ area: 'DB', db: n, size: a.size, byte: a.byte, reg: 'DB' }); } }
                else (dbBits[n] = dbBits[n] || new Set()).add(a.byte);
                return;
            }
            if (a.area === 'T') timers.add(a.n); else if (a.area === 'C') counters.add(a.n);
            else if (bytes[a.area]) {
                if (a.size) {
                    const w = a.size === 'B' ? 1 : a.size === 'W' ? 2 : 4;
                    for (let i = 0; i < w; i++) bytes[a.area].add(a.byte + i);
                    const k = a.area + a.size + a.byte; if (!seen.has(k)) { seen.add(k); watch.push(a); }
                } else bytes[a.area].add(a.byte);
            }
        });
        const sorted = (s: Set<number>) => Array.from(s).sort((p, q) => p - q);
        const wl = new Map<string, any>();
        prog.ins.forEach(x => {
            const a = x.a; if (!a || typeof a !== 'object' || !a.area || ['K', 'L', 'T', 'C'].includes(a.area)) return;
            if (a.area === 'DB' && !a.db) return;
            if (!['I', 'Q', 'M', 'PI', 'PQ', 'DB'].includes(a.area)) return;
            const key = a.area + (a.db || '') + ':' + a.byte + (a.bit !== undefined ? '.' + a.bit : a.size || '');
            if (wl.has(key)) return;
            const sm = /"([^"]+)"(\.[A-Za-z_][\w.]*)?/.exec(x.text);
            const addr = a.area === 'DB' ? 'DB' + a.db + '.DB' + (a.size || 'X') + a.byte + (a.bit !== undefined ? '.' + a.bit : '') : (a.area === 'PI' ? 'PI' : a.area === 'PQ' ? 'PQ' : a.area) + (a.size || '') + a.byte + (a.bit !== undefined ? '.' + a.bit : '');
            wl.set(key, { a, addr, name: sm ? sm[1] + (sm[2] || '') : '', isBit: a.bit !== undefined });
        });
        return { watchList: Array.from(wl.values()), dbBits: Object.keys(dbBits).map(n => ({ n: +n, bytes: sorted(dbBits[+n]) })), I: sorted(bytes.I), Q: sorted(bytes.Q), M: sorted(bytes.M), timers: sorted(timers), counters: sorted(counters), watch };
    }, [prog]);

    const loadEx = (id: string) => {
        const e = EXAMPLES.find(x => x.id === id)!;
        setRunning(false); setText(e.code); setExId(id); setCur(''); setSaveMsg('');
        mach.I.fill(0); mach.reset(); bump();
    };
    const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const fl = Array.from(e.target.files || []); e.target.value = '';
        if (!fl.length) return;
        if (fl.some(f => f.size > 60e6)) { setFileMsg('File is too large (max 60 MB)'); return; }
        setBusy(true); setFileMsg('Reading files...');
        try {
            const files = await Promise.all(fl.map(async f => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
            const r = await loadFiles(files);
            setRunning(false); mach.I.fill(0); mach.reset();
            if (r.kind === 'program') {
                setProj(null); setBlk(''); idbDel('project'); setText(r.text); setExId(''); setCur('');
                setFileMsg('File loaded: ' + r.name + ' (' + r.text.split('\n').length + ' lines)');
            } else {
                const first = r.proj.blocks.find(b => b.kind === 'FUNCTION' || b.kind === 'ORGANIZATION_BLOCK' || b.kind === 'FUNCTION_BLOCK');
                setProj(r.proj); setBlk(first ? first.name : ''); if (first) { setText(first.text); setExId(''); setCur(''); }
                const ok = await idbPut('project', { proj: r.proj, blk: first ? first.name : '' });
                setFileMsg('Project loaded: ' + r.proj.blocks.length + ' blocks, ' + r.proj.symCount + ' symbols, ' + Object.keys(r.proj.dbs).length + ' DB' + (ok ? '' : ' (will not be kept after the page closes)'));
            }
            bump();
        } catch (err: any) { setFileMsg('Could not read the file: ' + (err && err.message ? err.message : '')); }
        setBusy(false);
    };
    const doReset = () => { setRunning(false); mach.reset(); bump(); };
    const toggleI = (b: number, bit: number) => { mach.I[b] ^= 1 << bit; bump(); };
    const toggleM = (b: number, bit: number) => { mach.M[b] ^= 1 << bit; bump(); };
    const doStep = () => { if (hasErr) return; mach.step(); bump(); };
    const adv = (ms: number) => { mach.advance(ms); bump(); };

    const nextIns = mach.inScan && mach.pc < prog.ins.length ? prog.ins[mach.pc] : prog.ins[0];
    const curLine = !hasErr && nextIns && !running ? nextIns.line : 0;
    const errLines = new Set(errors.map(e => e.line));
    const lineCount = text.split('\n').length;
    const LH = 22;
    
    const byteRow = (area: string, b: number, tappable: boolean) => {
        const arr = area === 'I' ? mach.I : area === 'Q' ? mach.Q : mach.M;
        return <div className="s7-byte" key={area + b}>
            <em>{area}B{b}  =  0x{hex(arr[b], 2)}  ({arr[b]})</em>
            <div className="s7-leds">
                {[7, 6, 5, 4, 3, 2, 1, 0].map(bit => <Led key={bit} on={((arr[b] >> bit) & 1) === 1} label={area + b + '.' + bit} kind={area === 'Q' ? 'q' : 'i'}
                    onTap={tappable ? () => (area === 'I' ? toggleI(b, bit) : toggleM(b, bit)) : undefined} />)}
            </div>
        </div>;
    };

    return <div className="s7">
        <div className="s7-top">
            <div className="s7-title">{'S7-300 Simulator (STL)'}<small>{'Siemens STEP 7 Classic | Version 1.3.4'}</small></div>
            <div className={'s7-mode ' + (running ? 'run' : 'stop')}>{running ? 'RUN' : 'STOP'}</div>
        </div>

        <div className="s7-panel">
            <div className="s7-h">{'Control'}<span>{'Scan #'}{mach.scans} {'| last scan'} {mach.lastScanMs.toFixed(0)} ms</span></div>
            <div className="s7-ctl">
                {!running
                    ? <button type="button" className="s7-btn go" disabled={hasErr} onClick={() => { mach.error = ''; setRunning(true); }}><b>▶</b>{'Run'}</button>
                    : <button type="button" className="s7-btn pause" onClick={() => { setRunning(false); bump(); }}><b>⏸</b>{'Stop'}</button>}
                <button type="button" className="s7-btn" disabled={hasErr || running} onClick={doStep}><b>⏭</b>{'Step'}</button>
                <button type="button" className="s7-btn" disabled={hasErr || running} onClick={() => { mach.runScan(); bump(); }}><b>⟳</b>{'Scan'}</button>
                <button type="button" className="s7-btn" onClick={doReset}><b>↺</b>{'Reset'}</button>
            </div>
            <div className="s7-row">
                <select className="s7-sel" value={speed} onChange={e => setSpeed(+e.target.value)} aria-label={'Speed'}>
                    {SPEEDS.map(s => <option key={s.ms} value={s.ms}>{s.label}</option>)}
                </select>
            </div>
            {!running && <div className="s7-row">
                <button type="button" className="s7-chip" onClick={() => adv(100)}>{'⏩ +0.1 s'}</button>
                <button type="button" className="s7-chip" onClick={() => adv(1000)}>{'⏩ +1 s'}</button>
                <button type="button" className="s7-chip" onClick={() => adv(5000)}>{'⏩ +5 s'}</button>
            </div>}
            <div className="s7-hint">{running ? 'The PLC is running: time advances in real time and timers count.' : 'Stopped: time is frozen. Press "Step" to execute one instruction, "Scan" for a full cycle, or ⏩ to advance timer time.'}</div>
            {mach.error && <div className="s7-err">{mach.error}</div>}
        </div>

        <div className="s7-panel">
            <div className="s7-h">{'Programs'}</div>
            <div className="s7-row" style={{ marginTop: 0 }}>
                <button type="button" className="s7-btn wide" onClick={doNew}><b>＋</b>{'New'}</button>
                <button type="button" className="s7-btn wide" onClick={() => setPick(true)}><b>📂</b>{'Open'}</button>
                <input ref={fileRef} type="file" accept=".awl,.txt,.stl,.src,.zip,.dbf,.sdf,.asc,.csv,.sym,text/plain,application/octet-stream,application/zip" multiple style={{ display: 'none' }} onChange={onFile} />
            </div>
                        {fileMsg && <div className="s7-ok" style={{ marginTop: 8 }}>{fileMsg}</div>}
            {pick && <div className="s7-modal" onClick={() => setPick(false)}>
                <div className="s7-sheet" role="dialog" aria-label="Open" onClick={e => e.stopPropagation()}>
                    <div className="s7-h">{'Open'}<button type="button" className="s7-x" aria-label="Close" onClick={() => setPick(false)}>✕</button></div>
                    <button type="button" className="s7-btn wide" style={{ width: '100%', marginBottom: 12 }} onClick={() => { setPick(false); fileRef.current && fileRef.current.click(); }}><b>📁</b>{'From file or project (AWL / ZIP / symbols)'}</button>
                    <div className="s7-h">{'My programs'}<span>{'On this device only'}</span></div>
                    {Object.keys(progs).length === 0 && <div className="s7-hint" style={{ marginBottom: 10 }}>{'No saved programs yet. Press New, write a program and Save it.'}</div>}
                    {Object.keys(progs).sort((x, y) => progs[y].ts - progs[x].ts).map(n => <div className="s7-ex row" key={n}>
                        <button type="button" className="main" onClick={() => { doLoad(n); setPick(false); }}><b>{n}</b><small>{new Date(progs[n].ts).toLocaleString('en-GB')}</small></button>
                        <button type="button" className="s7-chip" style={delAsk === n ? { background: '#b3261e', borderColor: '#b3261e' } : undefined} onClick={() => doDel(n)}>{delAsk === n ? 'Confirm delete' : 'Delete'}</button>
                    </div>)}
                    <div className="s7-h" style={{ marginTop: 14 }}>{'Examples'}</div>
                    {EXAMPLES.map(e => <button type="button" key={e.id} className="s7-ex" onClick={() => { loadEx(e.id); setPick(false); }}><b>{e.name}</b><small>{e.hint}</small></button>)}
                </div>
            </div>}
        </div>


        {proj && <div className="s7-panel">
            <div className="s7-h">{'Loaded project'}<span>{proj.symCount} {'symbols |'} {Object.keys(proj.dbs).length} DB</span></div>
            <div className="s7-hint" style={{ marginTop: 0 }}>{proj.files.join(' | ')}</div>
            <input className="s7-sel" style={{ width: '100%', marginBottom: 8 }} dir="ltr" value={bfilter} placeholder={'Filter blocks by name or title'} aria-label="Filter blocks" onChange={e => setBfilter(e.target.value)} />
            {GROUPS.map(g => {
                const all = rowsOf(proj).filter(r => r.kind === g);
                const items = all.filter(r => !bfilter || ((r.num != null ? r.kind + r.num : '') + ' ' + r.name + ' ' + r.title).toLowerCase().includes(bfilter.toLowerCase()));
                if (!all.length) return null;
                const withSrc = all.filter(r => r.blk).length;
                return <details className="s7-grp" key={g} open={(g === 'FC' || g === 'FB' || g === 'OB') && all.length < 40 || !!bfilter}>
                    <summary>{g}<span>{GROUP_NAME[g]} | {bfilter ? items.length + ' / ' : ''}{all.length}{withSrc < all.length ? ' (' + withSrc + ' with source)' : ''}</span></summary>
                    {items.slice(0, 200).map(r => {
                        const x = r.blk; const v: any = x && verdicts.find((y: any) => y.name === x.name);
                        return <div className={'s7-tc' + (x && blk === x.name ? ' q' : '')} key={r.key} style={x ? undefined : { opacity: .6 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="nm" style={{ direction: 'ltr', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.num != null && <span className="s7-num">{r.kind + r.num}</span>}{r.name !== r.kind + r.num && r.name}{x && <small>{x.text.split('\n').length} {'lines'}</small>}</div>
                                {r.title && <div className="s7-hint" style={{ marginTop: 2 }}>{r.title}</div>}
                                {!x && <div className="s7-hint" style={{ marginTop: 2 }}>{'Compiled block only: no source in the files you loaded'}</div>}
                                {v && <div className="s7-hint" style={{ marginTop: 2, color: v.err ? '#ff8a80' : v.skip ? '#ffcc80' : '#81c995' }}>
                                    {v.err ? 'Cannot load: ' + v.err + ' error(s)' : v.skip ? 'Loads (' + v.ins + ' instructions) with ' + v.skip + ' skipped CALL(s)' : 'Loads (' + v.ins + ' instructions)'}{v.virt ? ' | ' + v.virt + ' virtual DB field(s)' : ''}
                                </div>}
                            </div>
                            {x && <button type="button" className="s7-chip" onClick={() => setViewBlk(x.name)}>{'View'}</button>}
                            {v && <button type="button" className="s7-chip" onClick={() => pickBlock(x.name)}>{'Load'}</button>}
                        </div>;
                    })}
                    {items.length > 200 && <div className="s7-hint">{'Showing 200. Use the filter to narrow.'}</div>}
                </details>;
            })}
            {proj.catalog && <div className="s7-hint">{'Block directory read from the project database: ' + proj.catalog.length + ' blocks, ' + proj.blocks.length + ' with exported source.'}</div>}
            {proj.warn.length > 0 && <div className="s7-hint">{proj.warn.slice(0, 3).join(' | ')}</div>}
            <div className="s7-row"><button type="button" className="s7-chip" onClick={() => { setProj(null); setBlk(''); idbDel('project'); setFileMsg('Loaded project cleared'); }}>{'Clear project'}</button></div>
        </div>}

        {proj && viewBlk && (() => { const vb = proj.blocks.find(x => x.name === viewBlk); if (!vb) return null; const vv: any = verdicts.find((y: any) => y.name === viewBlk);
            return <BlockSheet b={vb} layout={vb.db ? proj.dbs[vb.db] : undefined} status={vv ? (vv.err ? 'Cannot load: ' + vv.err + ' error(s)' : 'Loads (' + vv.ins + ' instructions)' + (vv.skip ? ', ' + vv.skip + ' skipped CALL(s)' : '')) : undefined}
                onLoad={vv ? () => { pickBlock(viewBlk); setViewBlk(''); } : undefined} onClose={() => setViewBlk('')} />; })()}


        <div className="s7-panel">
            <div className="s7-h">{'Program'}<span>{lineCount} {'lines'}{proj && blk ? ' | ' + blk : ''}</span></div>
            {cur && <div className="s7-savebar">
                <input className="s7-sel" value={saveName} placeholder={'Program name'} maxLength={40} onChange={e => setSaveName(e.target.value)} aria-label={'Program name'} onKeyDown={e => { if (e.key === 'Enter') doSave(); }} />
                <button type="button" className="s7-chip on" onClick={doSave}>{'💾 Save'}</button>
            </div>}
            {cur && saveMsg && <div className="s7-ok" style={{ marginTop: 0, marginBottom: 8 }}>{saveMsg}</div>}
            <div className="s7-row" style={{ marginTop: 0, marginBottom: 8 }}>
                <select className="s7-sel" value={mnemSel} onChange={e => setMnemSel(e.target.value as any)} aria-label={'Mnemonics'}>
                    <option value="auto">{'Mnemonics: auto ('}{mnemUsed === 'en' ? 'English' : 'Deutsch'})</option>
                    <option value="en">English (SD=on-delay, SE=ext.pulse)</option>
                    <option value="de">Deutsch (SE=on-delay, SV=ext.pulse)</option>
                </select>
            </div>
            <div className="s7-ed">
                {curLine > 0 && <div className="s7-bar cur" style={{ top: 8 + (curLine - 1) * LH - scrollTop }} />}
                {errors.map((e, i) => <div key={i} className="s7-bar err" style={{ top: 8 + (e.line - 1) * LH - scrollTop }} />)}
                <div className="s7-gut"><div style={{ transform: 'translateY(' + (8 - scrollTop) + 'px)' }}>
                    {Array.from({ length: lineCount }, (_, i) => <div key={i} className={errLines.has(i + 1) ? 'err' : curLine === i + 1 ? 'cur' : ''}>{i + 1}</div>)}
                </div></div>
                <textarea className="s7-ta" value={text} spellCheck={false} autoCapitalize="none" autoCorrect="off" wrap="off" dir="ltr" aria-label={'STL editor'}
                    onChange={e => { setText(e.target.value); setExId(''); }} onScroll={e => setScrollTop((e.target as HTMLTextAreaElement).scrollTop)} />
            </div>
            {hasErr
                ? <div className="s7-errs">{errors.slice().sort((a, b) => a.line - b.line).map((e, i) => <div className="s7-err" key={i}><b>{'line'} {e.line}</b> : {e.msg}</div>)}</div>
                : <div className="s7-ok">{'Program is valid:'} {prog.ins.length} {'instructions. It reloads automatically.'}{skipped.length > 0 ? ' (' + skipped.length + ' CALL(s) skipped)' : ''}</div>}
            {!hasErr && skipped.length > 0 && <details className="s7-info"><summary>{'Skipped CALLs ('}{skipped.length}{'): their code is not available as source'}</summary>
                <div className="s7-skip">{skipped.map((k, i) => <div key={i}><b>{'line'} {k.line}</b> : {k.callee}<small> {'(network'} {k.net}{k.title ? ': ' + k.title : ''})</small></div>)}</div>
                <div className="s7-hint">{'The outputs of these functions stay at their current value (zero) because the simulator cannot see their code.'}</div></details>}
            {!hasErr && virtual.length > 0 && <details className="s7-info"><summary>{'DB fields without declaration ('}{virtual.length}{'): a virtual location was assigned'}</summary>
                <div className="s7-skip">{virtual.map((v, i) => <div key={i}><b>DB{v.db}</b>.{v.name}<small> ({v.type}{', first used at line'} {v.first})</small></div>)}</div>
                <div className="s7-hint">{'This DB declaration is not in the loaded files. The simulator chose a type and address for each field from how it is used, so absolute addresses are not guaranteed.'}</div></details>}
            {!hasErr && <div className="s7-next">{running ? 'RUN ...' : 'Next instruction: ' + (nextIns ? 'line ' + nextIns.line + '   ' + nextIns.text : '—')}</div>}
        </div>

        <div className="s7-panel">
            <div className="s7-h">{'CPU state'}</div>
            <div className="s7-st">
                <div className="s7-cell"><label>ACCU1</label><code>{hex(mach.acc1)}</code> <small>(int {s16(mach.acc1)} | dint {mach.acc1 | 0} | real {fmtR(mach.acc1)})</small></div>
                <div className="s7-cell"><label>ACCU2</label><code>{hex(mach.acc2)}</code> <small>(int {s16(mach.acc2)} | dint {mach.acc2 | 0} | real {fmtR(mach.acc2)})</small></div>
            </div>
            <div className="s7-flags">
                <div className={'s7-flag' + (mach.RLO ? ' on' : '')}>RLO {mach.RLO ? 1 : 0}</div>
                <div className={'s7-flag' + (mach.STA ? ' on' : '')}>STA {mach.STA ? 1 : 0}</div>
                <div className={'s7-flag' + (!mach.fresh ? ' on' : '')}>/FC {mach.fresh ? 0 : 1}</div>
                <div className={'s7-flag' + (mach.acc ? ' on' : '')}>OR {mach.acc ? 1 : 0}</div>
            </div>
        </div>

        {used.watchList.length > 24 && <div className="s7-panel">
            <div className="s7-h">{'Used addresses'}<span>{used.watchList.length} {'address'}</span></div>
            <input className="s7-sel" style={{ width: '100%', boxSizing: 'border-box', marginBottom: 6 }} dir="ltr" value={wfilter} placeholder={'Search by name or title'} onChange={e => { setWfilter(e.target.value); setWmax(60); }} aria-label={'Search'} />
            {(() => {
                const f = wfilter.trim().toLowerCase();
                const list = used.watchList.filter((w: any) => !f || w.name.toLowerCase().includes(f) || w.addr.toLowerCase().includes(f));
                return <>
                    {list.slice(0, wmax).map((w: any, i: number) => {
                        let ctl: any;
                        try {
                            if (w.isBit) {
                                const on = ((memOf(w.a)[w.a.byte] >> w.a.bit) & 1) === 1;
                                const tappable = w.a.area !== 'Q' && w.a.area !== 'PQ';
                                ctl = <Led on={on} label={on ? '1' : '0'} kind={w.a.area === 'Q' ? 'q' : 'i'} onTap={tappable ? () => { memOf(w.a)[w.a.byte] ^= 1 << w.a.bit; bump(); } : undefined} />;
                            } else {
                                const v = rdN(w.a); const bits = nB(w.a) * 8; const sv = bits === 8 ? v : bits === 16 ? s16(v) : v | 0;
                                ctl = <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><NumCell value={String(sv)} onCommit={t => commitNum(w.a, t)} />{bits === 32 && <small style={{ color: '#8b98a9' }}>R {fmtR(v)}</small>}</span>;
                            }
                        } catch { ctl = <small style={{ color: '#8b98a9' }}>{'DB not available'}</small>; }
                        return <div className="s7-wrow" key={w.addr + i}><div className="s7-wn"><b>{w.name || w.addr}</b>{w.name && <small>{w.addr}</small>}</div>{ctl}</div>;
                    })}
                    {list.length > wmax && <div className="s7-row"><button type="button" className="s7-chip" onClick={() => setWmax(wmax + 100)}>{'Show more ('}{list.length - wmax})</button></div>}
                    {list.length === 0 && <div className="s7-hint">{'No results'}</div>}
                </>;
            })()}
            <div className="s7-hint">{'Click a bit to toggle it (inputs I, markers M and DB). Numbers: type the value and press Enter (decimal for REAL in DD). Output Q is display only.'}</div>
        </div>}
        {used.watchList.length <= 24 && <div className="s7-panel">
            <div className="s7-h">{'Inputs I (click to toggle)'}<span>{'Read at the start of every scan (PII)'}</span></div>
            {used.I.map(b => byteRow('I', b, true))}
        </div>}
        {used.watchList.length <= 24 && <div className="s7-panel">
            <div className="s7-h">{'Outputs Q'}<span>{'Display only'}</span></div>
            {used.Q.map(b => byteRow('Q', b, false))}
        </div>}
        {used.watchList.length <= 24 && <div className="s7-panel">
            <div className="s7-h">{'Markers M (click to force)'}</div>
            {used.M.map(b => byteRow('M', b, true))}
            {used.watch.filter((w: any) => w.area !== 'DB').length > 0 && <div className="s7-watch">{used.watch.filter((w: any) => w.area !== 'DB').map((a: any, i: number) => {
                const v = mach.readN(a); const bits = a.size === 'B' ? 8 : a.size === 'W' ? 16 : 32;
                const sv = bits === 8 ? v : bits === 16 ? s16(v) : v | 0;
                return <div className="s7-cell" key={i}><label>{a.area}{a.size}{a.byte}</label><code>{sv}</code> <small>0x{hex(v, bits / 4)}{bits === 32 ? ' | real ' + fmtR(v) : ''}</small></div>;
            })}</div>}
        </div>}


        {used.watchList.length <= 24 && (used.dbBits.length > 0 || used.watch.some((w: any) => w.area === 'DB')) && <div className="s7-panel">
            <div className="s7-h">{'Data blocks DB'}<span>{'Click a bit to force it'}</span></div>
            {used.dbBits.map(d => d.bytes.map(b => {
                const arr = mach.dbArr(d.n);
                return <div className="s7-byte" key={'db' + d.n + '_' + b}>
                    <em>DB{d.n}.DBB{b}  =  0x{hex(arr[b], 2)}  ({arr[b]})</em>
                    <div className="s7-leds">{[7, 6, 5, 4, 3, 2, 1, 0].map(bit => <Led key={bit} on={((arr[b] >> bit) & 1) === 1} label={'DBX' + b + '.' + bit} kind="i" onTap={() => { arr[b] ^= 1 << bit; bump(); }} />)}</div>
                </div>;
            }))}
            <div className="s7-watch">{used.watch.filter((w: any) => w.area === 'DB').map((a: any, i: number) => {
                const v = mach.readN(a); const bits = a.size === 'B' ? 8 : a.size === 'W' ? 16 : 32;
                const sv = bits === 8 ? v : bits === 16 ? s16(v) : v | 0;
                return <div className="s7-cell" key={i}><label>DB{a.db}.DB{a.size}{a.byte}</label><code>{sv}</code> <small>0x{hex(v, bits / 4)}{bits === 32 ? ' | real ' + fmtR(v) : ''}</small></div>;
            })}</div>
        </div>}

        {(used.timers.length > 0 || used.counters.length > 0) && <div className="s7-panel">
            <div className="s7-h">{'Timers and counters'}</div>
            {used.timers.map(n => {
                const t = mach.timers[n]; const q = t ? mach.timerQ(t) : false;
                const pct = t && t.pre > 0 ? Math.round(100 * (1 - t.rem / t.pre)) : 0;
                return <div key={n} className={'s7-tc' + (q ? ' q' : '')}>
                    <div style={{ flex: 1 }}>
                        <div className="nm">T{n}<small>{t && t.kind ? TIMER_NAME[t.kind] || t.kind : '—'}</small></div>
                        <div className="s7-prog"><div style={{ width: (t && t.running ? pct : q ? 100 : 0) + '%' }} /></div>
                    </div>
                    <div className="vl">{t ? (t.rem / 1000).toFixed(2) : '0.00'} s<br /><small style={{ color: '#8b98a9' }}> of {t ? (t.pre / 1000).toFixed(2) : '0.00'} s</small></div>
                    <Led on={q} label={'Q'} kind="q" />
                </div>;
            })}
            {used.counters.map(n => {
                const c = mach.counters[n]; const v = c ? c.val : 0;
                return <div key={'c' + n} className={'s7-tc' + (v ? ' q' : '')}>
                    <div className="nm">C{n}<small>{'Counter'}</small></div>
                    <div className="vl" style={{ fontSize: 22 }}>{v}</div>
                    <Led on={v !== 0} label="Q" kind="q" />
                </div>;
            })}
        </div>}

        <div className="s7-panel s7-info"><details>
            <summary>{'What is supported in version 1.3?'}</summary>
            <p><b>{'Bit logic:'}</b> {'A, AN, O, ON, X, XN, brackets A( O( ), NOT, SET, CLR, =, S, R, FP, FN. AND is evaluated before OR exactly as in STEP 7, and a lone O separates the groups.'}</p>
            <p><b>{'Load and transfer:'}</b> {'L and T for IB/IW/ID, QB/QW/QD, MB/MW/MD and constants (5, W#16#FF, S5T#2S, C#5, T#...). ACCU1/ACCU2 in true order (big-endian).'}</p>
            <p><b>{'Arithmetic and comparison:'}</b> {'==, <>, >, <, >=, <= for types I, D and R, +I -I *I /I, +D -D *D /D MOD, +R -R *R /R, + constant, INC, DEC.'}</p>
            <p><b>{'REAL and conversions:'}</b> {'Constants such as 3.14 and L 1.5E2, ITD, DTR, RND, RND+, RND-, TRUNC, NEGI/NEGD/NEGR, ABS, SQRT, SQR, EXP, LN, SIN, COS, TAN, ASIN, ACOS, ATAN, INVI/INVD, CAW/CAD, TAK.'}</p>
            <p><b>{'Shift, rotate and word logic:'}</b> {'SLW SRW SLD SRD SSI SSD RLD RRD (fixed count or from ACCU2), AW OW XOW AD OD XOD.'}</p>
            <p><b>{'Jumps:'}</b> {'JU, JC, JCN, BE, BEB with labels (max 4 characters).'}</p>
            <p><b>{'S5 timers:'}</b> {'SD (S_ODT), SP (S_PULSE), SS (S_ODTS), SE (S_PEXT), SF (S_OFFDT), R, FR, and S5T# values with a real time base.'}</p>
            <p><b>{'Counters:'}</b> {'CU, CD, S, R with a C# value.'}</p>
            <p><b>{'Data blocks:'}</b> {'OPN DB/DI, and DBX/DBB/DBW/DBD (e.g. DBW2 or DB1.DBX0.3) with A, =, S, R, L, T. Each DB is 512 bytes (or its declared size when loaded).'}</p>
            <p><b>{'New in 1.2 (real projects):'}</b> {'Load a full STEP 7 project ZIP or several AWL files with the symbol table (SYMLIST.DBF). Symbolic addresses "name" and "DB".field, DB declarations (STRUCT) in true STEP 7 layout, temp variables #name and L 12.0 (VAR_TEMP), BLD and NOP, JNB/JBI/JNBI and SAVE, I/Q addresses up to 1023, M up to 4095, DB up to 65535, PIW/PQW, and a choice of English or Deutsch mnemonics.'}</p>
            <p><b>{'Timers:'}</b> {'English: SP=pulse, SE=extended pulse, SD=on-delay, SS=retentive, SF=off-delay. Deutsch: SI, SV, SE=on-delay, SS, SA. Chosen automatically from the code, with a manual override.'}</p>
            <p><b>{'Not yet supported:'}</b> {'CALL to FC/FB (skipped and listed), OV/OS, indirect addressing [AR1,P#..], UDT.'}</p>
            <p>{'German and English mnemonics are both accepted: U/UN = A/AN, E/A = I/Q, ZV/CU, ZR/CD, SPB/JC.'}</p>
            <div className="s7-warn">{'This simulates STL behavior on an S7-300 for learning. It is not a replacement for PLCSIM or testing on real hardware.'}</div>
        </details></div>
    </div>;
}
