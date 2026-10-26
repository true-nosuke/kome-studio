// Local KOME Studio only. Never starts or connects to a real komenagare host.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {CommentStore}=require('../js/comment-store.js');
const root=path.resolve(__dirname,'..');
const fixture={name:'test.webm',mimeType:'video/webm',buffer:Buffer.from(fs.readFileSync(path.join(__dirname,'fixtures/video.webm.base64'),'utf8'),'base64')};
const sample=path.join(root,'sample.comments.json');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const project={id:'01900000-0000-7000-8000-000000000001',name:'Mock project'};
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname==='/api/projects'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({projects:[project],auth:'token',me:null}));return;}
  let relative=decodeURIComponent(u.pathname).replace(/^\/shared\//,'/');
  if(relative==='/')relative='/index.html';
  const file=path.resolve(root,'.'+relative);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try{
    let buf=fs.readFileSync(file);
    if(u.pathname==='/shared/')buf=Buffer.from(buf.toString().replace('</head>','<meta name="komenagare-host" content="mock" data-auth="token"></head>'));
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(buf);
  }catch{res.writeHead(404);res.end();}
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
  const errors=[], requests=[];
  async function context(opts={}){
    const c=await browser.newContext(opts);
    await c.addInitScript(()=>{window.showOpenFilePicker=undefined;window.showSaveFilePicker=undefined;try{localStorage.setItem('kome-studio.name','Browser test');}catch{}});
    c.on('page',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());p.on('request',r=>requests.push(r.url()));});
    return c;
  }
  try{
    for(const url of ['file://'+path.join(root,'index.html'),base+'/']){
      const c=await context({viewport:{width:1440,height:1050},colorScheme:'light'});const p=await c.newPage();await p.goto(url);
      await p.locator('#fileComments').setInputFiles(sample);await p.waitForFunction(()=>document.querySelector('#commentCount').textContent==='コメント 8');
      await p.locator('#fileVideo').setInputFiles(fixture);await p.waitForFunction(()=>document.querySelector('#video').readyState>=2);
      await p.locator('#cmdInput').fill('ue red');await p.locator('#textInput').fill('<b>literal</b>');await p.locator('#btnPost').click();
      await p.waitForFunction(()=>document.querySelector('#commentCount').textContent==='コメント 9');assert.equal(await p.locator('#list .row b').count(),0);
      for(const fmt of ['json','csv','xml','jsonl']){
        await p.locator('#setFormat').evaluate((el,f)=>{el.value=f;el.dispatchEvent(new Event('change'));},fmt);
        const dp=p.waitForEvent('download');await p.locator('#btnSave').click();const d=await dp;
        const bytes=fs.readFileSync(await d.path(),'utf8');assert.ok(bytes.includes('literal'));
        await p.locator('#fileComments').setInputFiles({name:'roundtrip.'+fmt,mimeType:'application/octet-stream',buffer:Buffer.from(bytes)});
        await p.waitForFunction(()=>document.querySelector('#commentCount').textContent==='コメント 9');
      }
      // Invalid JSON must not replace the current comments.
      await p.locator('#fileComments').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('[{"time":-1,"content":"bad"}]')});
      await p.waitForFunction(()=>document.querySelector('#toasts').textContent.includes('0以上'));assert.equal(await p.locator('#list .row').count(),9);
      await p.waitForTimeout(350);await p.reload();await p.locator('#recoveryRestore').click();await p.waitForFunction(()=>document.querySelector('#commentCount').textContent==='コメント 9');
      await p.locator('#btnConnection').click();assert.ok(await p.locator('#connectionDlg').isVisible());await p.locator('#connectionClose').click();
      await p.setViewportSize({width:390,height:844});await p.waitForTimeout(200);
      const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,'390px page overflow');
      await c.close();console.log('PASS standalone',url.startsWith('file:')?'file://':'HTTP');
    }
    // Protocol-4 contract double, not the upstream application/server.
    const hostStore=new CommentStore(),clients=new Set(),hellos=[],seen=new Set();let rev=0,peer=0;
    const c1=await context(),c2=await context();
    for(const c of [c1,c2])await c.routeWebSocket('**/ws?*',ws=>{
      const client={ws,id:++peer};clients.add(client);
      ws.onClose(()=>clients.delete(client));
      ws.onMessage(raw=>{
        const m=JSON.parse(raw);
        if(m.type==='hello'){
          hellos.push(m);assert.equal(m.protocol,4);
          ws.send(JSON.stringify({type:'snapshot',rev,you:client.id,name:'Browser test',comments:hostStore.comments}));
        }else if(m.type==='change'){
          let r={conflicts:[]};if(!seen.has(m.change.id)){seen.add(m.change.id);r=hostStore.apply(m.change);rev++;
            for(const other of clients)if(other!==client&&r.applied)other.ws.send(JSON.stringify({type:'change',rev,time:Date.now(),author:'Test',change:r.applied}));
          }
          ws.send(JSON.stringify({type:'ack',id:m.change.id,rev,conflicts:r.conflicts,fix:[]}));
        }else if(m.type==='history')ws.send(JSON.stringify({type:'history',entries:[]}));
      });
    });
    const p1=await c1.newPage(),p2=await c2.newPage();await Promise.all([p1.goto(base+'/shared/?k=test'),p2.goto(base+'/shared/?k=test')]);
    for(const p of [p1,p2]){await p.waitForFunction(()=>document.querySelector('#collabStatus').classList.contains('on'));await p.locator('#fileVideo').setInputFiles(fixture);await p.waitForFunction(()=>document.querySelector('#video').readyState>=2);}
    await p1.locator('#textInput').fill('shared comment');await p1.locator('#btnPost').click();
    await p2.waitForFunction(()=>document.querySelector('#list').textContent.includes('shared comment'));assert.equal(hostStore.size,1);assert.equal(hellos.length,2);
    assert.equal(await p1.locator('#recoveryBanner').isVisible(),false);await c1.close();await c2.close();console.log('PASS protocol-4 two-client contract mock');
    // No network use except the local test server and local resources.
    assert.deepEqual(requests.filter(u=>/^https?:/.test(u)&&!u.startsWith(base)),[]);
    assert.deepEqual(errors,[]);console.log('PASS no page errors / no external requests');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exit(1);});
