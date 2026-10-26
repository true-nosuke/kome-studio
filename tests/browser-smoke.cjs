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
    await c.addInitScript(()=>{window.showOpenFilePicker=undefined;window.showSaveFilePicker=undefined;try{localStorage.setItem('kome-studio.name','Browser test');if(!localStorage.getItem('kome-studio.settings'))localStorage.setItem('kome-studio.settings',JSON.stringify({sidePane:'vim',mobilePane:'vim',timeline:true}));}catch{}});
    c.on('page',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());p.on('request',r=>requests.push(r.url()));});
    return c;
  }
  try{
    for(const url of ['file://'+path.join(root,'index.html'),base+'/']){
      const c=await context({viewport:{width:1440,height:1050},colorScheme:'light'});const p=await c.newPage();await p.goto(url);assert.equal(await p.locator('#paneVim').count(),0);assert.equal(await p.locator('script[src*=vim]').count(),0);assert.equal(await p.locator('#cmdInput').isVisible(),false);assert.equal(await p.locator('#timeline').isVisible(),false);assert.equal(await p.locator('#btnPost').isDisabled(),true);
      await p.locator('.more-tools').evaluate(el=>el.open=true);await p.locator('#btnTimeline').click();assert.equal(await p.locator('#timeline').isVisible(),true);
      await p.locator('.more-tools').evaluate(el=>el.open=true);await p.locator('#btnTimeline').click();assert.equal(await p.locator('#timeline').isVisible(),false);
      await p.locator('#fileComments').setInputFiles(sample);await p.waitForFunction(()=>document.querySelector('#commentCount').textContent==='コメント 8');
      const chooserPromise=p.waitForEvent('filechooser');await p.locator('#btnPickVideo').click();await (await chooserPromise).setFiles(fixture);await p.waitForFunction(()=>document.querySelector('#video').readyState>=2);
      assert.equal(await p.locator('#emptyState').isVisible(),false);await p.locator('#stagePlay').click();await p.waitForFunction(()=>!document.querySelector('#video').paused);await p.locator('#btnPlay').click();await p.waitForFunction(()=>document.querySelector('#video').paused);await p.locator('#stagePlay').waitFor({state:'visible'});
      await p.locator('#list .row').filter({hasText:'こんにちは'}).locator('.rt').click();await p.waitForFunction(()=>document.querySelector('#video').currentTime>0);assert.ok((await p.locator('#postAt').textContent()).length>0);
      await p.locator('#stylePosition').selectOption('ue');await p.locator('#styleColor').selectOption('red');await p.locator('#textInput').fill('<b>literal</b>');await p.locator('#btnPost').click();
      await p.waitForFunction(()=>document.querySelector('#commentCount').textContent==='コメント 9');assert.equal(await p.locator('#list .row b').count(),0);
      await p.locator('#list .row').last().locator('.rc').click();
      assert.ok((await p.locator('#edCmd').inputValue()).includes('@4'));await p.locator('#edText').fill('わかりやすく編集');await p.locator('#edColor').selectOption('yellow');await p.locator('#edOk').click();
      await p.waitForFunction(()=>document.querySelector('#list').textContent.includes('わかりやすく編集'));
      await p.locator('#btnUndo').click();await p.waitForFunction(()=>!document.querySelector('#list').textContent.includes('わかりやすく編集'));
      await p.locator('#btnRedo').click();await p.waitForFunction(()=>document.querySelector('#list').textContent.includes('わかりやすく編集'));
      await p.locator('#btnShare').click();assert.equal(await p.locator('#shareChooser').isVisible(),true);await p.locator('[data-share-view="file"]').click();assert.ok(await p.locator('#shareOnlineNote').textContent().then(s=>s.includes('招待リンク')));
      const sharedDownload=p.waitForEvent('download');await p.locator('#btnShareDownload').click();const shared=await sharedDownload;
      const sharedJSON=JSON.parse(fs.readFileSync(await shared.path(),'utf8'));assert.equal(sharedJSON.format,'komenagare');assert.equal(sharedJSON.comments.length,9);
      await p.locator('#shareClose').click();
      for(const fmt of ['json','csv','xml','jsonl']){
        await p.locator('#setFormat').evaluate((el,f)=>{el.value=f;el.dispatchEvent(new Event('change'));},fmt);
        const dp=p.waitForEvent('download');await p.locator('#btnSave').click();const d=await dp;
        const bytes=fs.readFileSync(await d.path(),'utf8');assert.ok(bytes.includes('literal'));assert.ok(bytes.includes('わかりやすく編集'));
        await p.locator('#fileComments').setInputFiles({name:'roundtrip.'+fmt,mimeType:'application/octet-stream',buffer:Buffer.from(bytes)});
        await p.waitForFunction(()=>document.querySelector('#commentCount').textContent==='コメント 9');
        await p.waitForFunction(f=>document.querySelector('#fileStatus').textContent.includes('roundtrip.'+f),fmt);
      }
      // Invalid JSON must not replace the current comments.
      await p.locator('#fileComments').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('[{"time":-1,"content":"bad"}]')});
      await p.waitForFunction(()=>document.querySelector('#toasts').textContent.includes('0以上'));assert.equal(await p.locator('#list .row').count(),9);
      await p.waitForFunction(()=>JSON.parse(localStorage.getItem('kome-studio-work-v2')||'null')?.comments?.length===9);await p.reload();await p.locator('#recoveryRestore').click();await p.waitForFunction(()=>document.querySelector('#commentCount').textContent==='コメント 9');
      await p.locator('.more-tools').evaluate(el=>el.open=true);await p.locator('#btnConnection').click();assert.ok(await p.locator('#connectionDlg').isVisible());await p.locator('#connectionClose').click();
      await p.setViewportSize({width:390,height:844});await p.waitForTimeout(200);
      const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,'390px page overflow');
      await p.setViewportSize({width:1440,height:1050});
      while(await p.locator('#list .row').count()){
        await p.locator('#list .row').first().locator('.del').click();await p.locator('#edDelete').click();
      }
      assert.equal(await p.locator('#btnSave').isDisabled(),false,'last deletion must still be saveable');
      await p.locator('#setFormat').evaluate(el=>{el.value='json';el.dispatchEvent(new Event('change'));});
      const emptyDownload=p.waitForEvent('download');await p.locator('#btnSave').click();const empty=await emptyDownload;
      assert.equal(JSON.parse(fs.readFileSync(await empty.path(),'utf8')).comments.length,0);
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
    await p1.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('mock denied');}},configurable:true}));
    await p1.evaluate(()=>history.replaceState(null,'',location.pathname+location.search+'&otp=do-not-share'));
    await p1.locator('#btnShare').click();await p1.locator('[data-share-view="live"]').click();await p1.locator('#btnCopyInvite').click();
    const link=new URL(await p1.locator('#inviteFallback').inputValue());assert.equal(link.searchParams.get('k'),'test');assert.equal(link.searchParams.get('p'),project.id);assert.equal(link.searchParams.has('otp'),false);assert.equal(link.searchParams.has('session'),false);
    await p1.locator('#shareClose').click();
    assert.equal(await p1.locator('#recoveryBanner').isVisible(),false);await c1.close();await c2.close();console.log('PASS protocol-4 two-client contract mock');
    // No network use except the local test server and local resources.
    assert.deepEqual(requests.filter(u=>/^https?:/.test(u)&&!u.startsWith(base)),[]);
    assert.deepEqual(errors,[]);console.log('PASS no page errors / no external requests');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exit(1);});
