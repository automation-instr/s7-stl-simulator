import React, { useEffect, useMemo, useRef, useState } from 'react';
import { compile, Machine, TIMER_NAME, Ctx } from './engine';
import { Proj, loadFiles, idbPut, idbGet, idbDel } from './project';
import { EXAMPLES } from './examples';

const hex = (v: number, n = 8) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
const s16 = (v: number) => ((v & 0xffff) << 16) >> 16;
const f32 = (bits: number) => new Float32Array(new Uint32Array([bits >>> 0]).buffer)[0];
const fmtR = (bits: number) => { const f = f32(bits); return isFinite(f) ? String(parseFloat(f.toPrecision(7))) : '—'; };
const SPEEDS = [
    { ms: 500, label: 'بطيء (سكان كل 0.5 ث)' },
    { ms: 100, label: 'متوسط (سكان كل 100 مللي)' },
    { ms: 20, label: 'سريع (سكان كل 20 مللي)' },
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
    const [text, setText] = useState(() => lsGet(LS_DRAFT) || EXAMPLES[0].code);
    const [exId, setExId] = useState(() => (lsGet(LS_DRAFT) ? '' : 'motor'));
    const [progs, setProgs] = useState(loadProgs);
    const [saveName, setSaveName] = useState('');
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
        if (!name) { setSaveMsg('اكتب اسم للبرنامج الأول'); return; }
        const next = { ...progs, [name]: { code: text, ts: Date.now() } };
        if (lsSet(LS_PROGS, JSON.stringify(next))) { setProgs(next); setSaveMsg('اتحفظ: ' + name); } else setSaveMsg('المتصفح رافض الحفظ (التخزين مقفول)');
    };
    const doLoad = (name: string) => { setRunning(false); setText(progs[name].code); setExId(''); setSaveName(name); mach.I.fill(0); mach.reset(); bump(); setSaveMsg('اتفتح: ' + name); };
    const doDel = (name: string) => {
        if (delAsk !== name) { setDelAsk(name); return; }
        const next = { ...progs }; delete next[name]; lsSet(LS_PROGS, JSON.stringify(next)); setProgs(next); setDelAsk(''); setSaveMsg('اتمسح: ' + name);
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
        setRunning(false); setBlk(name); setText(b.text); setExId(''); mach.I.fill(0); mach.reset(); bump();
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
        setRunning(false); setText(e.code); setExId(id);
        mach.I.fill(0); mach.reset(); bump();
    };
    const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const fl = Array.from(e.target.files || []); e.target.value = '';
        if (!fl.length) return;
        if (fl.some(f => f.size > 60e6)) { setFileMsg('الملف كبير زيادة (أقصى حجم 60 MB)'); return; }
        setBusy(true); setFileMsg('بقرأ الملفات...');
        try {
            const files = await Promise.all(fl.map(async f => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
            const r = await loadFiles(files);
            setRunning(false); mach.I.fill(0); mach.reset();
            if (r.kind === 'program') {
                setProj(null); setBlk(''); idbDel('project'); setText(r.text); setExId('');
                setFileMsg('تم تحميل الملف: ' + r.name + ' (' + r.text.split('\n').length + ' سطر)');
            } else {
                const first = r.proj.blocks.find(b => b.kind === 'FUNCTION' || b.kind === 'ORGANIZATION_BLOCK' || b.kind === 'FUNCTION_BLOCK');
                setProj(r.proj); setBlk(first ? first.name : ''); if (first) { setText(first.text); setExId(''); }
                const ok = await idbPut('project', { proj: r.proj, blk: first ? first.name : '' });
                setFileMsg('تم تحميل المشروع: ' + r.proj.blocks.length + ' بلوك، ' + r.proj.symCount + ' رمز، ' + Object.keys(r.proj.dbs).length + ' DB' + (ok ? '' : ' (مش هيتحفظ بعد إغلاق الصفحة)'));
            }
            bump();
        } catch (err: any) { setFileMsg('معرفتش أقرأ الملف: ' + (err && err.message ? err.message : '')); }
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
    const ex = EXAMPLES.find(e => e.id === exId);

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
            <div className="s7-title">محاكي S7-300 (STL)<small>Siemens STEP 7 Classic | الإصدار 1.2</small></div>
            <div className={'s7-mode ' + (running ? 'run' : 'stop')}>{running ? 'RUN' : 'STOP'}</div>
        </div>

        <div className="s7-panel">
            <div className="s7-h">تحكم<span>سكان #{mach.scans} | آخر سكان {mach.lastScanMs.toFixed(0)} ms</span></div>
            <div className="s7-ctl">
                {!running
                    ? <button type="button" className="s7-btn go" disabled={hasErr} onClick={() => { mach.error = ''; setRunning(true); }}><b>▶</b>تشغيل</button>
                    : <button type="button" className="s7-btn pause" onClick={() => { setRunning(false); bump(); }}><b>⏸</b>إيقاف</button>}
                <button type="button" className="s7-btn" disabled={hasErr || running} onClick={doStep}><b>⏭</b>خطوة</button>
                <button type="button" className="s7-btn" disabled={hasErr || running} onClick={() => { mach.runScan(); bump(); }}><b>⟳</b>سكان</button>
                <button type="button" className="s7-btn" onClick={doReset}><b>↺</b>ريست</button>
            </div>
            <div className="s7-row">
                <select className="s7-sel" value={speed} onChange={e => setSpeed(+e.target.value)} aria-label="السرعة">
                    {SPEEDS.map(s => <option key={s.ms} value={s.ms}>{s.label}</option>)}
                </select>
            </div>
            {!running && <div className="s7-row">
                <button type="button" className="s7-chip" onClick={() => adv(100)}>⏩ +0.1 ث</button>
                <button type="button" className="s7-chip" onClick={() => adv(1000)}>⏩ +1 ث</button>
                <button type="button" className="s7-chip" onClick={() => adv(5000)}>⏩ +5 ث</button>
            </div>}
            <div className="s7-hint">{running ? 'الـ PLC شغال: الوقت بيمشي حقيقي والتايمرات بتعد.' : 'متوقف: الوقت واقف. اضغط "خطوة" لتنفيذ تعليمة واحدة، "سكان" لدورة كاملة، أو ⏩ لتقديم الوقت للتايمرات.'}</div>
            {mach.error && <div className="s7-err">{mach.error}</div>}
        </div>

        <div className="s7-panel">
            <div className="s7-h">أمثلة جاهزة</div>
            <div className="s7-row" style={{ marginTop: 0, marginBottom: 8 }}>
                <button type="button" className="s7-btn" style={{ flex: 1, flexDirection: 'row', gap: 8 }} onClick={() => fileRef.current && fileRef.current.click()}><b>📂</b>{busy ? 'استنى...' : 'تحميل برنامج أو مشروع (AWL / ZIP / جدول رموز)'}</button>
                <input ref={fileRef} type="file" accept=".awl,.txt,.stl,.src,.zip,.dbf,.sdf,.asc,.csv,.sym,text/plain,application/octet-stream,application/zip" multiple style={{ display: 'none' }} onChange={onFile} />
            </div>
            {fileMsg && <div className="s7-ok" style={{ marginBottom: 8 }}>{fileMsg}</div>}
            <div className="s7-chips">{EXAMPLES.map(e => <button type="button" key={e.id} className={'s7-chip' + (exId === e.id && text === e.code ? ' on' : '')} onClick={() => loadEx(e.id)}>{e.name}</button>)}</div>
            {ex && <div className="s7-hint">{ex.hint}</div>}
        </div>


        {proj && <div className="s7-panel">
            <div className="s7-h">المشروع المحمّل<span>{proj.symCount} رمز | {Object.keys(proj.dbs).length} DB</span></div>
            <div className="s7-hint" style={{ marginTop: 0 }}>{proj.files.join(' | ')}</div>
            {verdicts.map((v: any) => <div className={'s7-tc' + (blk === v.name ? ' q' : '')} key={v.name}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nm" style={{ direction: 'ltr', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.name}<small>{v.kind.replace('_', ' ')} | {v.lines} سطر</small></div>
                    <div className="s7-hint" style={{ marginTop: 2, color: v.err ? '#ff8a80' : v.skip ? '#ffcc80' : '#81c995' }}>
                        {v.err ? 'مش بيحمّل: ' + v.err + ' خطأ' : v.skip ? 'بيحمّل (' + v.ins + ' تعليمة) مع ' + v.skip + ' CALL متخطي' : 'بيحمّل (' + v.ins + ' تعليمة)'}{v.virt ? ' | ' + v.virt + ' حقل DB افتراضي' : ''}
                    </div>
                </div>
                <button type="button" className="s7-chip" onClick={() => pickBlock(v.name)}>فتح</button>
            </div>)}
            {proj.blocks.filter(b => b.kind === 'DATA_BLOCK').length > 0 && <div className="s7-hint">+ {proj.blocks.filter(b => b.kind === 'DATA_BLOCK').length} بلوك DB (تعريفات بس، بتتحمّل تلقائي)</div>}
            {proj.warn.length > 0 && <div className="s7-hint">{proj.warn.slice(0, 3).join(' | ')}</div>}
            <div className="s7-row"><button type="button" className="s7-chip" onClick={() => { setProj(null); setBlk(''); idbDel('project'); setFileMsg('اتمسح المشروع المحمّل'); }}>مسح المشروع</button></div>
        </div>}

        <div className="s7-panel">
            <div className="s7-h">برامجي المحفوظة<span>على الموبايل ده فقط</span></div>
            <div className="s7-row" style={{ marginTop: 0 }}>
                <input className="s7-sel" style={{ flex: 2 }} value={saveName} placeholder="اسم البرنامج" maxLength={40} onChange={e => setSaveName(e.target.value)} aria-label="اسم البرنامج" />
                <button type="button" className="s7-chip on" onClick={doSave}>💾 حفظ</button>
            </div>
            {saveMsg && <div className="s7-ok">{saveMsg}</div>}
            {Object.keys(progs).sort((x, y) => progs[y].ts - progs[x].ts).map(n => <div className="s7-tc" key={n}>
                <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700 }}>{n}<div className="s7-hint" style={{ marginTop: 2 }}>{new Date(progs[n].ts).toLocaleString('ar-EG')}</div></div>
                <button type="button" className="s7-chip" onClick={() => doLoad(n)}>فتح</button>
                <button type="button" className="s7-chip" style={delAsk === n ? { background: '#b3261e', borderColor: '#b3261e' } : undefined} onClick={() => doDel(n)}>{delAsk === n ? 'تأكيد المسح' : 'مسح'}</button>
            </div>)}
            {Object.keys(progs).length === 0 && <div className="s7-hint">لسه مفيش برامج محفوظة. اكتب اسم واضغط حفظ.</div>}
        </div>

        <div className="s7-panel">
            <div className="s7-h">البرنامج (STL)<span>{lineCount} سطر{proj && blk ? ' | ' + blk : ''}</span></div>
            <div className="s7-row" style={{ marginTop: 0, marginBottom: 8 }}>
                <select className="s7-sel" value={mnemSel} onChange={e => setMnemSel(e.target.value as any)} aria-label="مجموعة الرموز">
                    <option value="auto">رموز: تلقائي ({mnemUsed === 'en' ? 'English' : 'Deutsch'})</option>
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
                <textarea className="s7-ta" value={text} spellCheck={false} autoCapitalize="none" autoCorrect="off" wrap="off" dir="ltr" aria-label="محرر STL"
                    onChange={e => { setText(e.target.value); setExId(''); }} onScroll={e => setScrollTop((e.target as HTMLTextAreaElement).scrollTop)} />
            </div>
            {hasErr
                ? <div className="s7-errs">{errors.slice().sort((a, b) => a.line - b.line).map((e, i) => <div className="s7-err" key={i}><b>سطر {e.line}</b> : {e.msg}</div>)}</div>
                : <div className="s7-ok">البرنامج سليم: {prog.ins.length} تعليمة. بيتحمّل تلقائياً.{skipped.length > 0 ? ' (فيه ' + skipped.length + ' استدعاء CALL متخطي)' : ''}</div>}
            {!hasErr && skipped.length > 0 && <details className="s7-info"><summary>استدعاءات CALL المتخطية ({skipped.length}): الكود بتاعها مش موجود كنص</summary>
                <div className="s7-skip">{skipped.map((k, i) => <div key={i}><b>سطر {k.line}</b> : {k.callee}<small> (شبكة {k.net}{k.title ? ': ' + k.title : ''})</small></div>)}</div>
                <div className="s7-hint">مخرجات الدوال دي بتفضل على قيمتها (صفر) لأن المحاكي مش شايف الكود بتاعها.</div></details>}
            {!hasErr && virtual.length > 0 && <details className="s7-info"><summary>حقول DB من غير تعريف ({virtual.length}): اتحط لها مكان افتراضي</summary>
                <div className="s7-skip">{virtual.map((v, i) => <div key={i}><b>DB{v.db}</b>.{v.name}<small> ({v.type}، أول استخدام سطر {v.first})</small></div>)}</div>
                <div className="s7-hint">تعريف الـ DB ده مش في الملفات. المحاكي اختار نوع وعنوان للحقل من طريقة استخدامه، فالعناوين المطلقة مش مضمونة.</div></details>}
            {!hasErr && <div className="s7-next">{running ? 'RUN ...' : 'التعليمة الجاية: ' + (nextIns ? 'سطر ' + nextIns.line + '   ' + nextIns.text : '—')}</div>}
        </div>

        <div className="s7-panel">
            <div className="s7-h">حالة المعالج (CPU)</div>
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
            <div className="s7-h">العناوين المستخدمة<span>{used.watchList.length} عنوان</span></div>
            <input className="s7-sel" style={{ width: '100%', boxSizing: 'border-box', marginBottom: 6 }} dir="ltr" value={wfilter} placeholder="بحث بالاسم أو العنوان" onChange={e => { setWfilter(e.target.value); setWmax(60); }} aria-label="بحث" />
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
                        } catch { ctl = <small style={{ color: '#8b98a9' }}>DB مش متاح</small>; }
                        return <div className="s7-wrow" key={w.addr + i}><div className="s7-wn"><b>{w.name || w.addr}</b>{w.name && <small>{w.addr}</small>}</div>{ctl}</div>;
                    })}
                    {list.length > wmax && <div className="s7-row"><button type="button" className="s7-chip" onClick={() => setWmax(wmax + 100)}>عرض المزيد ({list.length - wmax})</button></div>}
                    {list.length === 0 && <div className="s7-hint">مفيش نتايج</div>}
                </>;
            })()}
            <div className="s7-hint">اضغط على البت للتبديل (الدخل I والميركر M والـ DB). الأرقام: اكتب القيمة واضغط Enter (رقم عشري للـ REAL في الـ DD). الخرج Q للعرض بس.</div>
        </div>}
        {used.watchList.length <= 24 && <div className="s7-panel">
            <div className="s7-h">الدخل I (اضغط للتبديل)<span>بيتقرأ في أول كل سكان (PII)</span></div>
            {used.I.map(b => byteRow('I', b, true))}
        </div>}
        {used.watchList.length <= 24 && <div className="s7-panel">
            <div className="s7-h">الخرج Q<span>عرض فقط</span></div>
            {used.Q.map(b => byteRow('Q', b, false))}
        </div>}
        {used.watchList.length <= 24 && <div className="s7-panel">
            <div className="s7-h">الميركر M (اضغط للإجبار)</div>
            {used.M.map(b => byteRow('M', b, true))}
            {used.watch.filter((w: any) => w.area !== 'DB').length > 0 && <div className="s7-watch">{used.watch.filter((w: any) => w.area !== 'DB').map((a: any, i: number) => {
                const v = mach.readN(a); const bits = a.size === 'B' ? 8 : a.size === 'W' ? 16 : 32;
                const sv = bits === 8 ? v : bits === 16 ? s16(v) : v | 0;
                return <div className="s7-cell" key={i}><label>{a.area}{a.size}{a.byte}</label><code>{sv}</code> <small>0x{hex(v, bits / 4)}{bits === 32 ? ' | real ' + fmtR(v) : ''}</small></div>;
            })}</div>}
        </div>}


        {used.watchList.length <= 24 && (used.dbBits.length > 0 || used.watch.some((w: any) => w.area === 'DB')) && <div className="s7-panel">
            <div className="s7-h">الداتا بلوك DB<span>اضغط على البت للإجبار</span></div>
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
            <div className="s7-h">التايمرات والعدادات</div>
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
                    <div className="nm">C{n}<small>عداد</small></div>
                    <div className="vl" style={{ fontSize: 22 }}>{v}</div>
                    <Led on={v !== 0} label="Q" kind="q" />
                </div>;
            })}
        </div>}

        <div className="s7-panel s7-info"><details>
            <summary>إيه اللي مدعوم في الإصدار 1.2؟</summary>
            <p><b>منطق بت:</b> A, AN, O, ON, X, XN, الأقواس A( O( ) ، NOT, SET, CLR, = , S, R, FP, FN. الـ AND بتتنفذ قبل الـ OR زي STEP 7 بالظبط، وO لوحدها بتفصل المجموعات.</p>
            <p><b>تحميل ونقل:</b> L و T لـ IB/IW/ID, QB/QW/QD, MB/MW/MD وثوابت (5، W#16#FF، S5T#2S، C#5، T#...). ACCU1/ACCU2 بالترتيب الحقيقي (Big-Endian).</p>
            <p><b>حسابات ومقارنات:</b> ==, &lt;&gt;, &gt;, &lt;, &gt;=, &lt;= بنوع I وD وR، +I -I *I /I، +D -D *D /D MOD، +R -R *R /R، + رقم، INC, DEC.</p>
            <p><b>REAL وتحويلات:</b> ثوابت زي 3.14 وL 1.5E2، ITD, DTR, RND, RND+, RND-, TRUNC, NEGI/NEGD/NEGR, ABS, SQRT, SQR, EXP, LN, SIN, COS, TAN, ASIN, ACOS, ATAN, INVI/INVD, CAW/CAD, TAK.</p>
            <p><b>إزاحة ودوران ومنطق كلمات:</b> SLW SRW SLD SRD SSI SSD RLD RRD (بعدد ثابت أو من ACCU2)، AW OW XOW AD OD XOD.</p>
            <p><b>قفز:</b> SPA, SPB, SPBN, BE, BEB مع Labels (4 حروف حد أقصى).</p>
            <p><b>تايمرات S5:</b> SE (S_ODT)، SI (S_PULSE)، SS (S_ODTS)، SV (S_PEXT)، SA (S_OFFDT)، R, FR، وقيم S5T# بأساس زمني حقيقي.</p>
            <p><b>عدادات:</b> ZV, ZR, S, R مع قيمة C#.</p>
            <p><b>داتا بلوك:</b> OPN DB/DI، وDBX/DBB/DBW/DBD (مثال: DBW2 أو DB1.DBX0.3) ومعاها A, =, S, R, L, T. كل DB حجمه 512 بايت (أو حسب تعريفه لو متحمل).</p>
            <p><b>جديد 1.2 (مشاريع حقيقية):</b> تحميل ملف ZIP لمشروع STEP 7 كامل أو أكتر من ملف AWL مع جدول الرموز (SYMLIST.DBF). العناوين الرمزية "اسم" و"DB".حقل، تعريفات الـ DB (STRUCT) بترتيب STEP 7 الحقيقي، المتغيرات المؤقتة #اسم وL 12.0 (VAR_TEMP)، BLD وNOP، JNB/JBI/JNBI وSAVE، عناوين I/Q لحد 1023 وM لحد 4095 وDB لحد 65535، PIW/PQW، واختيار مجموعة الرموز English أو Deutsch.</p>
            <p><b>التايمرات:</b> English: SP=pulse، SE=extended pulse، SD=on-delay، SS=retentive، SF=off-delay. Deutsch: SI، SV، SE=on-delay، SS، SA. الاختيار تلقائي من الكود ومعاه اختيار يدوي.</p>
            <p><b>اتأجل:</b> CALL لـ FC/FB (بيتخطى ويتعرض في قائمة)، الـ OV/OS، الـ indirect addressing [AR1,P#..]، UDT.</p>
            <p>تقبل المسميات الألماني والإنجليزي: U/UN = A/AN, E/A = I/Q, ZV/CU, ZR/CD, SPB/JC.</p>
            <div className="s7-warn">دي محاكاة لسلوك STL على S7-300 لأغراض التعلم. مش بديل لـ PLCSIM والاختبار على الجهاز الحقيقي.</div>
        </details></div>
    </div>;
}
