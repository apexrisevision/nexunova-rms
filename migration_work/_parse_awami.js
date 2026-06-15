const XLSX = require('xlsx');
const wb = XLSX.readFile('../14 data/Awami Availibility List.xlsx');
console.log('SHEETS:', wb.SheetNames);
wb.SheetNames.forEach(name => {
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  console.log('\n===== SHEET:', name, '| rows:', rows.length, '=====');
  // print first 12 rows to find header + data shape
  rows.slice(0, 12).forEach((r, i) => console.log(i, JSON.stringify(r)));
});
