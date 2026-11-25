import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const chrome = spawn('google-chrome-stable',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=9341','--user-data-dir=/tmp/pwa/prof24','about:blank'],{stdio:'ignore'});
await new Promise(r=>setTimeout(r,2500));
const tabs = await (await fetch('http://127.0.0.1:9341/json')).json();
const ws = new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
let id=0; const pend={}; ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend[m.id]) pend[m.id](m.result||m.error);};
const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}));});
const ev=async(x)=>{const r=await send('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true}); return r.result?.value ?? r.exceptionDetails?.exception?.description;};
const sl=ms=>new Promise(r=>setTimeout(r,ms));
const shot=async(f)=>{const r=await send('Page.captureScreenshot',{format:'png'}); writeFileSync(f,Buffer.from(r.data,'base64'));};
await send('Page.enable'); await send('DOM.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
await send('Page.navigate',{url:'http://127.0.0.1:8765/'}); await sl(2500);

const btn=(t)=>`[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===${JSON.stringify(t)})`;
const doc = await send('DOM.getDocument'); const n = await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[type=file]'});
await send('DOM.setFileInputFiles',{files:['/downloads/MORE PLC-13b9f3c4-9b2b5644.zip'],nodeId:n.nodeId}); await sl(3500);

console.log('groups:',await ev('[...document.querySelectorAll(".s7-grp summary")].map(e=>e.innerText.replace(/\\n/g," ")).join(" ## ")'));
console.log('footer:',await ev('[...document.querySelectorAll(".s7-hint")].map(e=>e.innerText).find(t=>t.startsWith("Block directory"))'));
console.log('FC rows with source:',await ev('[...document.querySelectorAll(".s7-grp")].find(g=>g.innerText.startsWith("FC")).querySelectorAll(".s7-tc:not([style])").length'));
await ev('[...document.querySelectorAll(".s7-grp")].forEach(g=>{if(g.innerText.startsWith("FC")||g.innerText.startsWith("DB")||g.innerText.startsWith("FB"))g.open=true})'); await sl(300);
console.log('first FC rows:',await ev('[...[...document.querySelectorAll(".s7-grp")].find(g=>g.innerText.startsWith("FC")).querySelectorAll(".s7-tc")].slice(0,24).map(e=>e.innerText.replace(/\\n/g," / ").slice(0,60)).join(" | ")'));
console.log('OB:',await ev('[...[...document.querySelectorAll(".s7-grp")].find(g=>g.innerText.startsWith("OB")).querySelectorAll(".s7-tc")].map(e=>e.innerText.split("\\n")[0]).join(" | ")'));
await ev('[...document.querySelectorAll(".s7-grp")].find(g=>g.innerText.startsWith("FC")).scrollIntoView()'); await sl(300); await shot('/tmp/pwa/v134_groups.png');
console.log('scrollW',await ev('document.documentElement.scrollWidth'));
chrome.kill();
