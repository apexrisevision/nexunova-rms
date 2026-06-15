const fs=require('fs');
const F='../js/pages/reports.js';
let c=fs.readFileSync(F,'utf8');
const startMarker='// Backend: get_recovery_position(p_company_id';
const s=c.indexOf(startMarker);
const am='ACCOUNT STATEMENT helpers (called from';
const a=c.indexOf(am);
if(s<0||a<0){console.error('anchors not found',{s,a});process.exit(1);}
const ls=c.lastIndexOf('\n',a); // newline before the "// ══ ACCOUNT STATEMENT" comment line
const block=fs.readFileSync('rp2_block.txt','utf8').replace(/\s+$/,'');
const before=c.slice(0,s), after=c.slice(ls+1);
const out=before+block+'\n\n'+after;
fs.writeFileSync(F,out);
console.log('spliced. removed', (a-s),'chars, inserted', block.length,'chars. new file len',out.length);
