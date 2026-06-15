const XLSX = require('xlsx');
const wb = XLSX.readFile('../14 data/Awami Availibility List.xlsx');
const ws = wb.Sheets['Awami'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
// data rows: col0 is a number (Sr No) AND col1 (Unit No) non-empty string
const data = rows.filter(r => typeof r[0] === 'number' && String(r[1]||'').trim() !== '');
console.log('VALID DATA ROWS:', data.length);
const types = {}; const floors = {}; let badArea=0, badPrice=0, dupCheck={};
data.forEach(r => {
  const t = String(r[2]||'').trim() || '(blank)';
  types[t] = (types[t]||0)+1;
  const uno = String(r[1]||'').trim();
  const m = uno.match(/^([A-Za-z]+)/); const pfx = m ? m[1].toUpperCase() : '(num)';
  floors[pfx] = (floors[pfx]||0)+1;
  if (!(Number(r[3])>0)) badArea++;
  if (!(Number(r[5])>0)) badPrice++;
  dupCheck[uno] = (dupCheck[uno]||0)+1;
});
console.log('\nTYPES:', JSON.stringify(types,null,0));
console.log('\nFLOOR PREFIXES (from unit_no):', JSON.stringify(floors,null,0));
console.log('\nrows with area<=0:', badArea, '| price<=0:', badPrice);
const dups = Object.entries(dupCheck).filter(([k,v])=>v>1);
console.log('DUPLICATE unit_no:', dups.length, dups.slice(0,10));
console.log('\nSAMPLE last 3:', JSON.stringify(data.slice(-3)));
