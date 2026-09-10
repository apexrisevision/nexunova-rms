/* a helper: render any of the pipeline's own HTML pages to a picture, so a
   contact sheet of character shapes can be read by eye.

   node scripts/_shot_html.js <file.html> <out.png> [width]
*/
const fs=require('fs'),path=require('path'),puppeteer=require('puppeteer-core');
const SRC=process.argv[2], OUT=process.argv[3], W=Number(process.argv[4]||1000);
const B=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
(async()=>{const br=await puppeteer.launch({executablePath:B.find(p=>fs.existsSync(p)),headless:'new',args:['--no-sandbox']});
const pg=await br.newPage();await pg.setViewport({width:W,height:900,deviceScaleFactor:2});
await pg.goto('file:///'+path.resolve(SRC).split(path.sep).join('/'),{waitUntil:'load'});
await new Promise(r=>setTimeout(r,1000));
await pg.screenshot({path:OUT,fullPage:true});await br.close();console.log('written '+OUT);
})().catch(e=>{console.error('ERR',e.message);process.exit(2)});
