const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../js/kome-compat.js');
test('旧KOMEの位置・色・本文・改行・フォントを分離する', () => {
  const r = C.decodeJSON(JSON.stringify([{time:1.25,content:'[ue big red font=mincho]注目\nここ'}]));
  assert.deepEqual(r.items[0],{t:1.25,cmd:'ue big red mincho',text:'注目\nここ',id:undefined});
});
test('旧KOMEのエスケープと未知の角括弧を本文として保持する', () => {
  assert.equal(C.splitLegacy('\\[ue]文字').text,'[ue]文字');
  assert.equal(C.splitLegacy('[not-a-command]本文').text,'[not-a-command]本文');
});
test('speed/durをnativeの表示時間に変換しdurを優先する', () => {
  assert.equal(C.splitLegacy('[naka speed=0.5]a').cmd,'naka @7');
  assert.equal(C.splitLegacy('[ue speed=0.5]a').cmd,'ue @6');
  assert.equal(C.splitLegacy('[naka speed=2 dur=5]a').cmd,'naka @4');
  assert.equal(C.splitLegacy('[dur=1]a').cmd,'@0.1');
});
test('旧独自・未知コマンドは削除せず再現不可の通知対象にする', () => {
  const r=C.splitLegacy('[red italic opacity=0.5 font=mono custom]a');
  assert.equal(r.cmd,'red italic opacity=0.5 font=mono custom');
  assert.deepEqual(r.warnings,['italic','opacity=0.5','font=mono','custom']);
});
test('空文字・不正時刻・件数過多を拒否する', () => {
  for (const time of [-1,'1',null]) assert.throws(()=>C.decodeJSON(JSON.stringify([{time,content:'a'}])));
  assert.throws(()=>C.splitLegacy(' '));
  assert.throws(()=>C.splitLegacy('a'.repeat(4001)));
  assert.throws(()=>C.decodeJSON(JSON.stringify(Array(20001).fill({t:1,text:'a'}))));
});
test('native JSON v2・ニコニコJSON・JSONLを保持する', () => {
  const c={id:'01900000-0000-7000-8000-000000000001',t:1.2,cmd:'ue red',text:'あ'};
  assert.deepEqual(C.decodeJSON(JSON.stringify({format:'komenagare',version:2,comments:[c]})).items,[c]);
  assert.deepEqual(C.decodeJSON(JSON.stringify({data:{threads:[{comments:[c]}]}})).items,[c]);
  assert.deepEqual(C.decodeJSON(C.serializeExtra([c],'jsonl'),'comments.jsonl').items,[c]);
  assert.throws(()=>C.decodeJSON('{bad}\n','a.jsonl'));
});
test('旧KOME出力は括弧本文を保持し再読み込みできる', () => {
  const items=[{t:1,cmd:'mincho ue @5',text:'[ue]文字'}, {t:2,cmd:'',text:'[red]literal'}];
  const old=C.legacyItems(items);
  assert.deepEqual(old,[{time:1,content:'[font=mincho ue dur=5][ue]文字'}, {time:2,content:'[naka][red]literal'}]);
  const decoded=C.decodeJSON(JSON.stringify(old)).items;
  assert.equal(decoded[0].text,items[0].text);
  assert.equal(decoded[1].text,items[1].text);
});
test('XMLエスケープとUUID保存', () => {
  const xml=C.serializeExtra([{id:'uuid',t:1.25,cmd:'red',text:'<chat>&"\''}],'xml');
  assert.match(xml,/vpos="125"/);assert.match(xml,/uuid="uuid"/);
  assert.match(xml,/&lt;chat&gt;&amp;&quot;&apos;/);
});
test('サンプルJSONを全件読み込める', () => {
  const sample=fs.readFileSync(path.join(__dirname,'../sample.comments.json'),'utf8');
  const r=C.decodeJSON(sample);assert.ok(r.items.length>0);
  assert.ok(r.items.every(c=>!c.text.startsWith('[naka')));
});
test('manifestの全ファイルが存在し、スクリプトとCSSが同梱されている', () => {
  const root=path.join(__dirname,'..');const manifest=JSON.parse(fs.readFileSync(path.join(root,'web.json')));
  assert.equal(manifest.protocol,4);
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  for (const m of html.matchAll(/(?:src|href)="((?:js|css)\/[^\"]+)"/g)) assert.ok(manifest.files.includes(m[1]),m[1]);
  for (const f of manifest.files) assert.ok(fs.existsSync(path.join(root,f)),f);
});
