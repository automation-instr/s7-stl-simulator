import { compile, Machine } from './engine.mts';
let f=0; const ok=(c:boolean,m:string)=>{if(!c){f++;console.log('FAIL',m)}else console.log('ok',m)};
let r=compile(`OPN DB1\nL 1234\nT DBW2\nA I0.0\n= DBX10.3\nA DBX10.3\n= Q0.0\nL DB1.DBW2\nT MW0\nL 7\nT DB2.DBB5\nL DB2.DBB5\nT MB4`);
console.log(r.errors); const m=new Machine(); m.load(r.prog); m.I[0]=1; m.runScan();
ok(m.dbs[1][2]===0x04&&m.dbs[1][3]===0xD2,'DBW2 big endian 1234'); ok((m.dbs[1][10]>>3&1)===1&&m.Q[0]===1,'DBX10.3'); ok(m.M[1]===0xD2&&m.M[0]===4,'DB1.DBW2 -> MW0'); ok(m.dbs[2][5]===7&&m.M[4]===7,'DB2.DBB5');
r=compile(`L DBW0`); const m2=new Machine(); m2.load(r.prog); m2.runScan(); console.log(m2.error); ok(m2.error.includes('OPN'),'no open DB error');
console.log(compile(`A DBX0\nA DB1.DIX0.0\nL DBX0.0\nT DBW600\nOPN DB0\nOPN X\nA DB1.DBX0.9`).errors.map(e=>e.line+':'+e.msg));
r=compile(`OPN DI3\nL 9\nT DIW0`); const m3=new Machine(); m3.load(r.prog); m3.runScan(); ok(m3.dbs[3][1]===9,'DI3');
console.log(f?'FAILS':'DB PASS');
