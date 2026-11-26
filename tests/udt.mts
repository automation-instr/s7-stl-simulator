// UDT layout tests: UDT member inlining into DB layouts (synthetic fixtures only).
import { layoutDecls, dbLayouts, DbLayout } from '../src/engine';

let fails = 0;
const chk = (name: string, cond: boolean, extra?: any) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + JSON.stringify(extra))); };

// synthetic UDT 5: 2 BOOLs + 1 REAL  -> size: bools byte0 bits0-1, pad to even -> REAL at 2, size 6
const udt5 = layoutDecls(['FlagA : BOOL ;', 'FlagB : BOOL ;', 'Value : REAL ;']);
chk('udt self layout', udt5.size === 6 && udt5.fields.FLAGA.off === 0 && udt5.fields.VALUE.off === 2, udt5);

const udts: Record<number, DbLayout> = { 5: { size: udt5.size, fields: udt5.fields } };

// DB with a UDT member followed by an INT
const r = layoutDecls(['Part : UDT 5 ;', 'Count : INT ;'], udts);
chk('udt inlined offsets', r.fields['PART.FLAGA'].off === 0 && r.fields['PART.FLAGA'].bit === 0
  && r.fields['PART.VALUE'].off === 2 && r.fields['PART.VALUE'].type === 'REAL'
  && r.fields['COUNT'].off === 6 && r.size === 8, r);
chk('no errors', r.errors.length === 0, r.errors);

// ARRAY OF UDT
const ra = layoutDecls(['Head : BOOL ;', 'Items : ARRAY [1..2] OF UDT 5 ;'], udts);
chk('array of udt', ra.fields['ITEMS[1].FLAGA'].off === 2 && ra.fields['ITEMS[2].FLAGA'].off === 8
  && ra.fields['ITEMS[2].VALUE'].off === 10 && ra.size === 14, ra);

// unknown UDT stays an honest error
const ru = layoutDecls(['Part : UDT 99 ;'], udts);
chk('unknown udt errors', ru.errors.length === 1 && /Unknown UDT/.test(ru.errors[0]), ru.errors);

// nested UDT (UDT 6 contains UDT 5)
const udt6 = layoutDecls(['Inner : UDT 5 ;', 'Tail : BYTE ;'], udts);
chk('nested udt', udt6.errors.length === 0 && udt6.fields['INNER.VALUE'].off === 2 && udt6.fields['TAIL'].off === 6 && udt6.size === 8, udt6);

// dbLayouts passes the resolver through
const dls = dbLayouts([{ kind: 'DATA_BLOCK', name: 'DB1', db: 1, text: 'DATA_BLOCK DB 1\nSTRUCT\nPart : UDT 5 ;\nEND_STRUCT\nBEGIN\nEND_DATA_BLOCK' } as any], udts);
chk('dbLayouts udt', dls.dbs[1].fields['PART.VALUE'].off === 2 && dls.dbs[1].size === 6, dls);

process.exit(fails ? 1 : 0);
