/* KOME Studio compatibility helpers. Apache-2.0. No DOM required. */
(function(root, factory){
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KomeCompat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const MAX_COMMENTS = 20000, MAX_TEXT = 4000, MAX_BYTES = 20 * 1024 * 1024;
  const COLORS = new Set(('white red pink orange yellow green cyan blue purple black white2 niconicowhite red2 truered pink2 orange2 passionorange yellow2 madyellow green2 elementalgreen cyan2 blue2 marineblue purple2 nobleviolet black2').split(' '));
  const basic = t => ['naka','ue','shita','small','medium','big','184','bold','thin','italic'].includes(t) || COLORS.has(t) || /^#[0-9a-f]{6}$/i.test(t);
  const numeric = (t, key, min, max) => {
    const m = t.match(new RegExp('^' + key + '=(\\d+(?:\\.\\d+)?|\\.\\d+)$'));
    return m && +m[1] >= min && +m[1] <= max ? +m[1] : null;
  };
  const known = t => basic(t) || /^font=(gothic|mincho|mono)$/.test(t) || numeric(t,'speed',.25,3) !== null || numeric(t,'dur',1,30) !== null || numeric(t,'opacity',.1,1) !== null;
  function splitLegacy(content){
    if (typeof content !== 'string' || !content.trim() || content.length > MAX_TEXT) throw Error('旧KOMEの本文は空でない4,000文字以内の文字列にしてください');
    if (content.startsWith('\\[')) return { cmd:'', text:content.slice(1), warnings:[] };
    const m = content.match(/^\[([^\]\n]{0,500})\] ?/);
    if (!m || !m[1].trim().split(/\s+/).some(t => known(t.toLowerCase()))) return { cmd:'', text:content, warnings:[] };
    const toks = m[1].trim().split(/\s+/), out = [], warnings = [];
    let pos = 'naka', speed = 1, dur = null;
    for (const raw of toks){
      const t = raw.toLowerCase();
      if (['naka','ue','shita'].includes(t)) pos = t;
      if (numeric(t,'speed',.25,3) !== null) { speed = numeric(t,'speed',.25,3); continue; }
      if (numeric(t,'dur',1,30) !== null) { dur = numeric(t,'dur',1,30); continue; }
      if (/^font=(gothic|mincho)$/.test(t)) { out.push(t.slice(5)); continue; }
      if (/^font=mono$/.test(t) || ['bold','thin','italic'].includes(t) || numeric(t,'opacity',.1,1) !== null || !known(t)) warnings.push(raw);
      out.push(raw);
    }
    // Both apps retain the numeric timestamp. Native naka begins 1s before it.
    if (dur !== null || speed !== 1){
      const lifetime = dur ?? (pos === 'naka' ? 4 : 3) / speed;
      out.push('@' + Math.round(Math.max(.1, lifetime - (pos === 'naka' ? 1 : 0)) * 100) / 100);
    }
    return { cmd:out.join(' '), text:content.slice(m[0].length), warnings };
  }
  function decodeJSON(text, name = ''){
    let data;
    if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw Error('コメントファイルは20MBまでです');
    text = text.replace(/^\ufeff/, '');
    if (/\.jsonl$/i.test(name)){
      data = text.split(/\r?\n/).filter(l => l.trim()).map((l, i) => {
        try { return JSON.parse(l); } catch { throw Error(`JSONL の ${i + 1} 件目を解析できません`); }
      });
    } else { try { data = JSON.parse(text); } catch { throw Error('JSON の解析に失敗しました'); } }
    let arr;
    if (Array.isArray(data)) arr = data;
    else if (data && Array.isArray(data.comments)) arr = data.comments;
    else if (data && (data.data?.threads || data.threads)) arr = (data.data?.threads || data.threads).flatMap(th => th.comments || []);
    if (!arr) throw Error('コメントの配列が見つかりません');
    if (arr.length > MAX_COMMENTS) throw Error('コメントは20,000件までです');
    const warnings = new Set(); let legacyCount = 0;
    const items = arr.map((it, i) => {
      it = it?.chat || it;
      if (!it || typeof it !== 'object') throw Error(`${i + 1} 件目のコメントが不正です`);
      if (Object.hasOwn(it,'time') && Object.hasOwn(it,'content') && !('cmd' in it) && !('command' in it) && !('mail' in it) && !('text' in it)){
        if (typeof it.time !== 'number' || !Number.isFinite(it.time) || it.time < 0) throw Error(`${i + 1} 件目の時刻は0以上の数値にしてください`);
        legacyCount++; const p = splitLegacy(it.content); p.warnings.forEach(t => warnings.add(t));
        return { t:it.time, cmd:p.cmd, text:p.text, id:it.id };
      }
      return it;
    });
    return { items, warnings:[...warnings], legacyCount };
  }
  function legacyItems(items){
    return items.map(c => {
      const out = [], toks = c.cmd.trim().split(/\s+/).filter(Boolean);
      const pos = toks.find(t => ['naka','ue','shita'].includes(t.toLowerCase()))?.toLowerCase() || 'naka';
      let duration = null;
      for (const t of toks){
        if (t === 'gothic' || t === 'mincho') out.push('font=' + t);
        else if (/^@\d+(\.\d+)?$/.test(t)) duration ??= +t.slice(1) + (pos === 'naka' ? 1 : 0);
        else out.push(t);
      }
      if (duration !== null) out.push('dur=' + duration);
      // A recognized prefix keeps text beginning '[' literal in the old app.
      if (!out.some(t => known(t.toLowerCase()))) out.unshift('naka');
      return { time:c.t, content:'[' + out.join(' ') + ']' + c.text };
    });
  }
  const xmlEsc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  function serializeExtra(items, fmt){
    if (fmt === 'jsonl') return items.map(c => JSON.stringify({id:c.id,t:c.t,cmd:c.cmd,text:c.text})).join('\n') + (items.length ? '\n' : '');
    if (fmt === 'legacy') return JSON.stringify(legacyItems(items), null, 2) + '\n';
    if (fmt === 'xml') return '<?xml version="1.0" encoding="UTF-8"?>\n<packet>\n' + items.map(c => `  <chat vpos="${Math.round(c.t * 100)}" mail="${xmlEsc(c.cmd)}" uuid="${xmlEsc(c.id)}">${xmlEsc(c.text)}</chat>`).join('\n') + '\n</packet>\n';
    throw Error('未対応の形式です');
  }
  return { MAX_BYTES, MAX_COMMENTS, MAX_TEXT, splitLegacy, decodeJSON, legacyItems, serializeExtra };
});
