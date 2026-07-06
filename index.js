(function () {
  'use strict';

  const PANEL_ID = 'npc-preview-modal';
  const BUTTON_ID = 'npc-preview-open';
  const TABLE_NAME = 'NPC预览表';
  const VAR_PREFIX = 'NPC_';
  const REG_PREFIX = 'npc_preview_registry_';
  const AVATAR_PREFIX = 'npc_preview_avatars_';
  const API_PREFIX = 'npc_preview_api_';
  const SETTINGS_PREFIX = 'npc_preview_settings_';
  const SCAN_PREFIX = 'npc_preview_scan_';

  const STATUSES = [
    ['offline', '离线', '#9e9e9e'],
    ['online', '在线', '#43a047'],
    ['away', '忙碌', '#f9a825'],
    ['danger', '危险', '#e53935'],
    ['missing', '失踪', '#6d4c41'],
  ];

  const MOODS = [
    ['calm', '平静', '😌'], ['happy', '愉悦', '😊'], ['angry', '愤怒', '😤'],
    ['sad', '悲伤', '😢'], ['fear', '恐惧', '😰'], ['love', '爱意', '❤️'],
    ['jealous', '嫉妒', '🤢'], ['annoyed', '烦躁', '😒'], ['excited', '兴奋', '🤩'],
    ['shy', '害羞', '😳'], ['guilty', '心虚', '😅'], ['cold', '冷漠', '🧊'],
  ];

  let rows = [];
  let selectedId = null;
  let mode = '变量模式';
  let filter = '全部';
  let query = '';
  let buttonDrag = null;
  let autoSyncing = false;

  function ctxKey(prefix) {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (ctx && ctx.characterId != null) return prefix + ctx.characterId;
    } catch (_) {}
    return prefix + 'global';
  }

  function parse(raw, fallback) {
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  }

  function keyName(name) {
    return String(name || '').replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
  }

  function registry() { return parse(localStorage.getItem(ctxKey(REG_PREFIX)) || '[]', []); }
  function saveRegistry(value) { localStorage.setItem(ctxKey(REG_PREFIX), JSON.stringify(value)); }
  function avatars() { return parse(localStorage.getItem(ctxKey(AVATAR_PREFIX)) || '{}', {}); }
  function saveAvatars(value) { localStorage.setItem(ctxKey(AVATAR_PREFIX), JSON.stringify(value)); }
  function apiConfig() { return parse(localStorage.getItem(ctxKey(API_PREFIX)) || 'null', { baseUrl: '', apiKey: '', model: '' }) || { baseUrl: '', apiKey: '', model: '' }; }
  function saveApiConfig(value) { localStorage.setItem(ctxKey(API_PREFIX), JSON.stringify(value)); }
  function buttonSettings() { return parse(localStorage.getItem(ctxKey(SETTINGS_PREFIX)) || 'null', { x: null, y: null, color: '#43a047', text: 'NPC', size: 46 }) || { x: null, y: null, color: '#43a047', text: 'NPC', size: 46 }; }
  function saveButtonSettings(value) { localStorage.setItem(ctxKey(SETTINGS_PREFIX), JSON.stringify(value)); }
  function scanState() { return parse(localStorage.getItem(ctxKey(SCAN_PREFIX)) || 'null', { signature: '' }) || { signature: '' }; }
  function saveScanState(value) { localStorage.setItem(ctxKey(SCAN_PREFIX), JSON.stringify(value)); }

  function statusOf(value) { return STATUSES.find(x => x[0] === value) || STATUSES[0]; }
  function moodOf(value) { return MOODS.find(x => x[0] === value) || MOODS[0]; }
  function affectionColor(value) {
    const n = Number(value) || 0;
    if (n < 0) return '#e53935';
    if (n >= 80) return '#2e7d32';
    if (n >= 50) return '#43a047';
    if (n >= 20) return '#81c784';
    if (n > 0) return '#c8e6c9';
    return '#bdbdbd';
  }

  function normalizeName(value) {
    return String(value || '').replace(/[《》【】\[\]「」『』“”"'`]/g, '').replace(/\s+/g, '').trim();
  }

  function inferFaction(text) {
    const m = String(text || '').match(/(?:势力|阵营|组织|所属)\s*[:：]\s*([^，。；;\n]{1,16})/);
    return m ? m[1].trim() : '';
  }

  function inferIdentity(text) {
    const m = String(text || '').match(/(?:身份|职位|职业|职务|定位)\s*[:：]\s*([^，。；;\n]{1,20})/);
    return m ? m[1].trim() : '';
  }

  function splitNames(value) {
    return String(value || '')
      .split(/[、,，/|；;\n]/)
      .map(v => v.replace(/(?:身份|势力|阵营|组织|职业|职位|职务|定位)\s*[:：].*$/g, '').trim())
      .filter(Boolean);
  }

  function addCandidate(map, name, sourceText) {
    const clean = normalizeName(name);
    if (!clean || clean.length < 2 || clean.length > 18) return;
    if (/^(用户|玩家|主角|你|我|他|她|它|众人|路人|角色|人物|NPC|名称|姓名|身份|势力)$/.test(clean)) return;
    if (!/[\u4e00-\u9fffA-Za-z]/.test(clean)) return;
    if (!map.has(clean)) map.set(clean, { name: clean, faction: inferFaction(sourceText), identity: inferIdentity(sourceText) });
    const item = map.get(clean);
    item.faction = item.faction || inferFaction(sourceText);
    item.identity = item.identity || inferIdentity(sourceText);
  }

  function collectText(value, out, depth) {
    if (value == null) return;
    if ((depth || 0) > 8) return;
    if (typeof value === 'string') {
      if (value.length > 1 && !/^data:image\//.test(value)) out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(v => collectText(v, out, (depth || 0) + 1));
      return;
    }
    if (typeof value === 'object') {
      Object.keys(value).forEach(k => {
        if (/^(avatar|chat|date_added|date_last_chat|create_date|last_mes|fav|fav_checkbox)$/i.test(k)) return;
        collectText(value[k], out, (depth || 0) + 1);
      });
    }
  }

  function collectStructuredNpcNames(value, map, depth) {
    if (value == null || (depth || 0) > 8) return;
    if (Array.isArray(value)) {
      value.forEach(v => collectStructuredNpcNames(v, map, (depth || 0) + 1));
      return;
    }
    if (typeof value !== 'object') return;
    const keys = Object.keys(value);
    const nameKey = keys.find(k => /^(npc名称|npc名字|npc姓名|npc_name|npcName|npc|name|名称|姓名|名字)$/i.test(k));
    if (nameKey && (keys.some(k => /npc/i.test(k)) || keys.some(k => /^(身份|势力|阵营|组织|职业|职位|职务|定位|好感度|状态|心情)$/i.test(k)))) {
      splitNames(value[nameKey]).forEach(name => addCandidate(map, name, JSON.stringify(value).slice(0, 500)));
    }
    keys.forEach(k => collectStructuredNpcNames(value[k], map, (depth || 0) + 1));
  }

  function scanSourceData() {
    const texts = [];
    const objects = [];
    try {
      const ctx = window.SillyTavern?.getContext?.();
      const charId = ctx?.characterId ?? window.SillyTavern?.characterId ?? window.characterId ?? window.this_chid;
      const characters = ctx?.characters ?? window.SillyTavern?.characters ?? window.characters;
      const ch = characters?.[charId] || ctx?.character || ctx?.characterData || null;
      objects.push(ch, ch?.data, ch?.data?.character_book, ctx?.extensionSettings?.character);
      collectText(ch, texts);
      collectText(ch?.data, texts);
      collectText(ch?.data?.character_book, texts);
      collectText(ctx?.world_names, texts);
      collectText(ctx?.extensionSettings?.character, texts);
    } catch (_) {}
    return { texts, objects };
  }

  function textSignature(texts) {
    const joined = texts.join('\n').slice(0, 200000);
    let hash = 0;
    for (let i = 0; i < joined.length; i++) hash = ((hash << 5) - hash + joined.charCodeAt(i)) | 0;
    return `${joined.length}:${hash}`;
  }

  function scanNpcCandidates(texts, objects) {
    const map = new Map();
    (objects || []).forEach(obj => collectStructuredNpcNames(obj, map));
    for (const text of texts) {
      const lines = String(text).split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        if (!/(NPC|npc|npc名称|NPC名称|NPC姓名|NPC名字|NPC名单|NPC目录|npc_name|npcName)/.test(line)) continue;
        let m;
        const direct = /(?:NPC(?:名称|姓名|名字)?|npc(?:_?name)?)\s*[:：=]\s*([^。；;\n]{2,80})/gi;
        while ((m = direct.exec(line))) splitNames(m[1]).forEach(name => addCandidate(map, name, line));
        const listHeader = /NPC(?:名单|目录|列表)\s*[:：]\s*([^。；;\n]{2,120})/i.exec(line);
        if (listHeader) splitNames(listHeader[1]).forEach(name => addCandidate(map, name, line));
      }
    }
    return Array.from(map.values());
  }

  async function syncAutoNpcs(force) {
    if (autoSyncing) return { scanned: 0, found: 0, added: 0, dbAdded: 0, skipped: true };
    autoSyncing = true;
    try {
      const source = scanSourceData();
      const texts = source.texts;
      const signature = textSignature(texts);
      if (!force && signature && scanState().signature === signature) return { scanned: texts.length, found: 0, added: 0, dbAdded: 0, cached: true };
      const found = scanNpcCandidates(texts, source.objects);
      saveScanState({ signature });
      if (!found.length) return { scanned: texts.length, found: 0, added: 0, dbAdded: 0 };
      const byName = new Set(registry().map(n => n.name));
      const next = registry();
      let added = 0;
      for (const npc of found) {
        if (byName.has(npc.name)) continue;
        next.push({ id: Date.now() + Math.random(), name: npc.name, faction: npc.faction || '自动识别', identity: npc.identity || '' });
        byName.add(npc.name);
        added++;
      }
      saveRegistry(next);

      const api = dbApi();
      if (!api?.insertRow) return { scanned: texts.length, found: found.length, added, dbAdded: 0 };
      const dbRows = await readDb();
      if (!dbRows) return { scanned: texts.length, found: found.length, added, dbAdded: 0 };
      const dbNames = new Set(dbRows.map(r => r['NPC名称']));
      let dbAdded = 0;
      for (const npc of found) {
        if (dbNames.has(npc.name)) continue;
        await api.insertRow(TABLE_NAME, { 'NPC名称': npc.name, '势力': npc.faction || '自动识别', '身份': npc.identity || '', '好感度': 0, '状态': 'offline', '心情': 'calm', '备注': '打开角色卡时自动识别' });
        dbAdded++;
      }
      if (api.refreshDataAndWorldbook) await api.refreshDataAndWorldbook();
      return { scanned: texts.length, found: found.length, added, dbAdded };
    } finally {
      autoSyncing = false;
    }
  }

  async function getVar(key, fallback) {
    try {
      const context = window.SillyTavern?.getContext?.();
      if (context?.chatMetadata) {
        const value = context.chatMetadata[key];
        return value == null || value === '' ? fallback : value;
      }
    } catch (_) {}
    const value = localStorage.getItem(ctxKey('npcv_' + key + '_'));
    return value == null || value === '' ? fallback : value;
  }

  async function setVar(key, value) {
    try {
      const context = window.SillyTavern?.getContext?.();
      if (context?.chatMetadata) {
        context.chatMetadata[key] = value;
        if (context.saveMetadata) await context.saveMetadata();
        return;
      }
    } catch (_) {}
    localStorage.setItem(ctxKey('npcv_' + key + '_'), String(value));
  }

  function dbApi() { return window.AutoCardUpdaterAPI || null; }

  async function readDb() {
    const api = dbApi();
    if (!api?.exportTableAsJson) return null;
    try {
      const raw = api.exportTableAsJson(TABLE_NAME);
      if (!raw) return null;
      const table = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!table?.content || !Array.isArray(table.content) || table.content.length < 2) return null;
      const headers = table.content[0];
      if (!headers.includes('NPC名称') || !headers.includes('好感度')) return null;
      return table.content.slice(1).map((row, index) => {
        const item = { id: 'db_' + (index + 1), rowIndex: index + 1, source: 'db' };
        headers.forEach((h, i) => { item[h] = row[i] == null ? '' : row[i]; });
        return item;
      });
    } catch (_) { return null; }
  }

  async function readVars() {
    const result = [];
    for (const npc of registry()) {
      const key = keyName(npc.name);
      result.push({
        id: String(npc.id),
        rowIndex: npc.id,
        source: 'var',
        'NPC名称': npc.name,
        '势力': npc.faction || '',
        '身份': npc.identity || '',
        '好感度': Number(await getVar(VAR_PREFIX + key + '_好感', 0)) || 0,
        '状态': await getVar(VAR_PREFIX + key + '_状态', 'offline'),
        '心情': await getVar(VAR_PREFIX + key + '_心情', 'calm'),
        '备注': await getVar(VAR_PREFIX + key + '_备注', ''),
      });
    }
    return result;
  }

  async function loadRows() {
    await syncAutoNpcs();
    const dbRows = await readDb();
    if (dbRows && dbRows.length) {
      mode = '数据库模式';
      rows = dbRows;
    } else {
      mode = '变量模式';
      rows = await readVars();
    }
  }

  async function writeField(row, field, value) {
    if (row.source === 'db') {
      const api = dbApi();
      if (api?.updateRow) {
        const ok = await api.updateRow(TABLE_NAME, row.rowIndex, { [field]: value });
        if (ok && api.refreshDataAndWorldbook) await api.refreshDataAndWorldbook();
      }
    } else {
      const key = keyName(row['NPC名称']);
      if (field === '好感度') await setVar(VAR_PREFIX + key + '_好感', value);
      if (field === '状态') await setVar(VAR_PREFIX + key + '_状态', value);
      if (field === '心情') await setVar(VAR_PREFIX + key + '_心情', value);
      if (field === '备注') await setVar(VAR_PREFIX + key + '_备注', value);
    }
    await loadRows();
    render();
  }

  async function addNpc(name, faction, identity) {
    if (mode === '数据库模式' && dbApi()?.insertRow) {
      const ok = await dbApi().insertRow(TABLE_NAME, { 'NPC名称': name, '势力': faction, '身份': identity, '好感度': 0, '状态': 'offline', '心情': 'calm', '备注': '' });
      if (ok && dbApi().refreshDataAndWorldbook) await dbApi().refreshDataAndWorldbook();
    } else {
      const reg = registry();
      const id = Date.now() + Math.random();
      reg.push({ id, name, faction, identity });
      saveRegistry(reg);
      const key = keyName(name);
      await setVar(VAR_PREFIX + key + '_好感', 0);
      await setVar(VAR_PREFIX + key + '_状态', 'offline');
      await setVar(VAR_PREFIX + key + '_心情', 'calm');
      await setVar(VAR_PREFIX + key + '_备注', '');
    }
    await loadRows();
    selectedId = rows.find(r => r['NPC名称'] === name)?.id || selectedId;
    render();
  }

  async function deleteNpc(row) {
    if (row.source === 'db' && dbApi()?.deleteRow) {
      const ok = await dbApi().deleteRow(TABLE_NAME, row.rowIndex);
      if (ok && dbApi().refreshDataAndWorldbook) await dbApi().refreshDataAndWorldbook();
    } else {
      saveRegistry(registry().filter(n => String(n.id) !== String(row.id)));
    }
    selectedId = null;
    await loadRows();
    render();
  }

  async function clearAllNpcs() {
    if (!confirm('确定清空当前角色卡的全部NPC目录？')) return;
    if (mode === '数据库模式' && dbApi()?.deleteRow) {
      const api = dbApi();
      const dbRows = await readDb();
      if (dbRows) {
        for (let i = dbRows.length - 1; i >= 0; i--) await api.deleteRow(TABLE_NAME, dbRows[i].rowIndex);
        if (api.refreshDataAndWorldbook) await api.refreshDataAndWorldbook();
      }
    }
    saveRegistry([]);
    selectedId = null;
    filter = '全部';
    query = '';
    saveScanState({ signature: textSignature(scanSourceData().texts) });
    rows = [];
    mode = dbApi()?.exportTableAsJson ? '数据库模式' : '变量模式';
    render();
    showNotice('已清空当前角色卡的NPC目录。');
  }

  function filteredRows() {
    const q = query.trim().toLowerCase();
    let list = rows;
    if (filter !== '全部') list = list.filter(r => (r['势力'] || '') === filter);
    if (q) list = list.filter(r => (r['NPC名称'] || '').toLowerCase().includes(q) || (r['势力'] || '').toLowerCase().includes(q) || (r['身份'] || '').toLowerCase().includes(q));
    return list;
  }

  function cardHtml(row, active) {
    const name = row['NPC名称'] || '?';
    const aff = Number(row['好感度']) || 0;
    const st = statusOf(row['状态']);
    const avatar = avatars()[name];
    return `<div class="npcpv-card ${active ? 'active' : ''}" data-id="${esc(row.id)}"><div class="npcpv-dot" style="background:${st[2]}"></div><div class="npcpv-avatar">${avatar ? `<img src="${avatar}">` : esc(name[0] || '?')}</div><div class="npcpv-name">${esc(name)}</div><div class="npcpv-faction">${esc(row['势力'] || '未分组')}</div><div class="npcpv-bar"><div class="npcpv-fill" style="width:${Math.min(Math.abs(aff), 100)}%;background:${affectionColor(aff)}"></div></div></div>`;
  }

  function detailHtml(row) {
    const name = row['NPC名称'] || '?';
    const aff = Number(row['好感度']) || 0;
    const mood = moodOf(row['心情']);
    const avatar = avatars()[name];
    return `<div class="npcpv-profile"><div class="npcpv-big-avatar" data-action="avatar">${avatar ? `<img src="${avatar}">` : esc(name[0] || '?')}<span>上传头像</span></div><div><div class="npcpv-main-name">${esc(name)}</div><div class="npcpv-main-sub">${esc(row['势力'] || '未分组')}</div><div class="npcpv-main-sub">${esc(row['身份'] || '')}</div></div></div><div class="npcpv-section"><div class="npcpv-label">好感度 <span class="npcpv-small">${mode === '数据库模式' ? '数据库列：好感度' : '变量：' + VAR_PREFIX + keyName(name) + '_好感'}</span></div><div class="npcpv-aff"><div class="npcpv-affbar"><div class="npcpv-afffill" style="width:${Math.min(Math.abs(aff),100)}%;background:${affectionColor(aff)}"></div></div><div class="npcpv-affval" style="color:${affectionColor(aff)}">${aff}</div></div><div class="npcpv-ctrls">${[-10,-5,-1,1,5,10].map(n => `<button class="npcpv-btn" data-action="aff" data-delta="${n}">${n > 0 ? '+' : ''}${n}</button>`).join('')}</div></div><div class="npcpv-section"><div class="npcpv-label">状态</div><select class="npcpv-select" data-action="status">${STATUSES.map(s => `<option value="${s[0]}" ${s[0] === (row['状态'] || 'offline') ? 'selected' : ''}>${s[1]}</option>`).join('')}</select></div><div class="npcpv-section"><div class="npcpv-label">心情 <span class="npcpv-small">${mood[2]}</span></div><select class="npcpv-select" data-action="mood">${MOODS.map(m => `<option value="${m[0]}" ${m[0] === (row['心情'] || 'calm') ? 'selected' : ''}>${m[2]} ${m[1]}</option>`).join('')}</select></div><div class="npcpv-section"><div class="npcpv-label">备注</div><textarea class="npcpv-textarea" data-action="notes">${esc(row['备注'] || '')}</textarea></div><div class="npcpv-ctrls"><button class="npcpv-btn danger" data-action="delete">删除NPC</button></div>`;
  }

  function render() {
    const root = document.getElementById(PANEL_ID);
    if (!root) return;
    const selected = rows.find(r => String(r.id) === String(selectedId));
    const factions = ['全部', ...Array.from(new Set(rows.map(r => r['势力']).filter(Boolean))).sort()];
    const cards = filteredRows().map(r => cardHtml(r, selected && String(r.id) === String(selected.id))).join('');
    root.innerHTML = `<div class="npcpv-mask" data-close="1"><div class="npcpv-modal"><div class="npcpv-header"><div class="npcpv-title">NPC预览表 <span class="npcpv-mode">${mode}</span></div><div class="npcpv-actions"><button class="npcpv-btn" data-action="rescan">重扫角色卡</button><button class="npcpv-btn danger" data-action="clear-all">清空</button><button class="npcpv-btn" data-action="button-settings">按钮</button><button class="npcpv-btn" data-action="api">API</button><button class="npcpv-btn primary" data-action="add">+ 新NPC</button><button class="npcpv-close" data-action="close">×</button></div></div><div class="npcpv-body"><div class="npcpv-list"><input class="npcpv-search" value="${esc(query)}" placeholder="搜索名称、势力、身份..." data-action="search"><div class="npcpv-filters">${factions.map(f => `<button class="npcpv-chip ${f === filter ? 'active' : ''}" data-filter="${esc(f)}">${esc(f)}</button>`).join('')}</div><div class="npcpv-cards">${cards || '<div class="npcpv-empty" style="grid-column:1/-1">未识别到NPC<br>可点「重扫角色卡」或手动添加</div>'}</div></div><div class="npcpv-detail">${selected ? detailHtml(selected) : '<div class="npcpv-empty">选择左侧NPC查看详情<br>打开角色卡后会自动扫描目录</div>'}</div></div></div></div>`;
    bindEvents(root);
  }

  function bindEvents(root) {
    const selected = rows.find(r => String(r.id) === String(selectedId));
    root.querySelector('[data-close]')?.addEventListener('click', e => { if (e.target.dataset.close) closePanel(); });
    root.querySelector('[data-action="close"]')?.addEventListener('click', closePanel);
    root.querySelector('[data-action="add"]')?.addEventListener('click', showAddDialog);
    root.querySelector('[data-action="api"]')?.addEventListener('click', showApiDialog);
    root.querySelector('[data-action="button-settings"]')?.addEventListener('click', showButtonDialog);
    root.querySelector('[data-action="rescan"]')?.addEventListener('click', handleRescan);
    root.querySelector('[data-action="clear-all"]')?.addEventListener('click', clearAllNpcs);
    root.querySelector('[data-action="search"]')?.addEventListener('input', e => { query = e.target.value; render(); });
    root.querySelectorAll('[data-filter]').forEach(btn => btn.addEventListener('click', () => { filter = btn.dataset.filter; render(); }));
    root.querySelectorAll('.npcpv-card').forEach(card => card.addEventListener('click', () => { selectedId = card.dataset.id; render(); }));
    if (!selected) return;
    root.querySelectorAll('[data-action="aff"]').forEach(btn => btn.addEventListener('click', () => writeField(selected, '好感度', Math.max(-100, Math.min(100, (Number(selected['好感度']) || 0) + Number(btn.dataset.delta))))));
    root.querySelector('[data-action="status"]')?.addEventListener('change', e => writeField(selected, '状态', e.target.value));
    root.querySelector('[data-action="mood"]')?.addEventListener('change', e => writeField(selected, '心情', e.target.value));
    let timer;
    root.querySelector('[data-action="notes"]')?.addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => writeField(selected, '备注', e.target.value), 500); });
    root.querySelector('[data-action="delete"]')?.addEventListener('click', () => { if (confirm('删除这个NPC？')) deleteNpc(selected); });
    root.querySelector('[data-action="avatar"]')?.addEventListener('click', () => uploadAvatar(selected));
  }

  async function handleRescan(e) {
    const btn = e?.currentTarget;
    if (btn) {
      btn.disabled = true;
      btn.textContent = '扫描中...';
    }
    try {
      const result = await syncAutoNpcs(true);
      await loadRows();
      render();
      const message = result?.found
        ? `重扫完成：扫描文本 ${result.scanned} 段，识别 ${result.found} 个NPC，新增 ${result.added} 个${result.dbAdded ? `，数据库新增 ${result.dbAdded} 行` : ''}。`
        : `重扫完成：扫描文本 ${result?.scanned || 0} 段，未识别到可自动建档的NPC。请确认角色卡资料或世界书里包含“NPC/角色/人物/姓名/身份/势力”等结构化描述。`;
      showNotice(message);
    } catch (err) {
      console.error(err);
      showNotice('重扫失败：扩展读取当前角色卡资料时出错，详情见浏览器控制台。');
      render();
    }
  }

  function showNotice(message) {
    const root = document.getElementById(PANEL_ID);
    if (!root) return alert(message);
    showSubDialog(`<h3>扫描结果</h3><div class="npcpv-notice">${esc(message)}</div><div class="npcpv-dialog-actions"><button class="npcpv-btn primary" data-subclose="1">知道了</button></div>`);
  }

  function showSubDialog(html, after) {
    const root = document.getElementById(PANEL_ID);
    const div = document.createElement('div');
    div.className = 'npcpv-modal-sub';
    div.id = 'npcpv-subdialog';
    div.innerHTML = `<div class="npcpv-dialog">${html}</div>`;
    root.querySelector('.npcpv-modal').appendChild(div);
    div.querySelectorAll('[data-subclose]').forEach(b => b.addEventListener('click', closeSubDialog));
    if (after) after();
  }

  function closeSubDialog() { document.getElementById('npcpv-subdialog')?.remove(); }

  function showAddDialog() {
    showSubDialog(`<h3>添加NPC</h3><div class="npcpv-form"><input class="npcpv-input" id="npc-add-name" placeholder="NPC名称 *"><input class="npcpv-input" id="npc-add-faction" placeholder="势力/分组"><input class="npcpv-input" id="npc-add-identity" placeholder="身份/职位"></div><div class="npcpv-dialog-actions"><button class="npcpv-btn" data-subclose="1">取消</button><button class="npcpv-btn primary" id="npc-add-ok">添加</button></div>`, () => {
      document.getElementById('npc-add-ok').onclick = () => {
        const name = document.getElementById('npc-add-name').value.trim();
        if (!name) return;
        addNpc(name, document.getElementById('npc-add-faction').value.trim(), document.getElementById('npc-add-identity').value.trim());
        closeSubDialog();
      };
    });
  }

  function showApiDialog() {
    const cfg = apiConfig();
    showSubDialog(`<h3>API配置</h3><div class="npcpv-form"><input class="npcpv-input" id="npc-api-url" placeholder="Base URL，例如 https://api.openai.com/v1" value="${esc(cfg.baseUrl)}"><input class="npcpv-input" id="npc-api-key" type="password" placeholder="API Key" value="${esc(cfg.apiKey)}"><input class="npcpv-input" id="npc-api-model" placeholder="Model，例如 gpt-4o-mini" value="${esc(cfg.model)}"></div><div class="npcpv-small" style="margin-top:8px">配置只保存在本地浏览器。</div><div class="npcpv-dialog-actions"><button class="npcpv-btn" data-subclose="1">取消</button><button class="npcpv-btn primary" id="npc-api-ok">保存</button></div>`, () => {
      document.getElementById('npc-api-ok').onclick = () => {
        saveApiConfig({ baseUrl: document.getElementById('npc-api-url').value.trim(), apiKey: document.getElementById('npc-api-key').value.trim(), model: document.getElementById('npc-api-model').value.trim() });
        closeSubDialog();
      };
    });
  }

  function showButtonDialog() {
    const cfg = buttonSettings();
    showSubDialog(`<h3>悬浮按钮设置</h3><div class="npcpv-form"><input class="npcpv-input" id="npc-btn-text" placeholder="按钮文字或图标" value="${esc(cfg.text)}"><input class="npcpv-input" id="npc-btn-color" type="color" value="${esc(cfg.color)}"><label class="npcpv-small">按钮尺寸：<span id="npc-btn-size-val">${Number(cfg.size) || 46}</span>px</label><input class="npcpv-range" id="npc-btn-size" type="range" min="34" max="86" value="${Number(cfg.size) || 46}"></div><div class="npcpv-small" style="margin-top:8px">也可以直接拖动页面右下角按钮改变位置。</div><div class="npcpv-dialog-actions"><button class="npcpv-btn" data-subclose="1">取消</button><button class="npcpv-btn primary" id="npc-btn-ok">保存</button></div>`, () => {
      const size = document.getElementById('npc-btn-size');
      const sizeVal = document.getElementById('npc-btn-size-val');
      size.oninput = () => { sizeVal.textContent = size.value; };
      document.getElementById('npc-btn-ok').onclick = () => {
        saveButtonSettings({ ...buttonSettings(), text: document.getElementById('npc-btn-text').value.trim() || 'NPC', color: document.getElementById('npc-btn-color').value, size: Number(size.value) || 46 });
        applyButtonSettings();
        closeSubDialog();
      };
    });
  }

  function uploadAvatar(item) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 220;
          canvas.height = 220;
          const ctx = canvas.getContext('2d');
          const min = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, 220, 220);
          const av = avatars();
          av[item['NPC名称']] = canvas.toDataURL('image/jpeg', 0.82);
          saveAvatars(av);
          render();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  async function openPanel() {
    await loadRows();
    let root = document.getElementById(PANEL_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = PANEL_ID;
      document.body.appendChild(root);
    }
    render();
  }

  function closePanel() { document.getElementById(PANEL_ID)?.remove(); }

  function ensureButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.className = 'npcpv-open-button';
    btn.title = 'NPC预览表：点击打开，拖动移动位置';
    btn.addEventListener('pointerdown', startButtonDrag);
    btn.addEventListener('click', e => { if (!buttonDrag?.moved) openPanel(e); });
    document.body.appendChild(btn);
    applyButtonSettings();
  }

  function applyButtonSettings() {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    const cfg = buttonSettings();
    const size = Math.max(34, Math.min(86, Number(cfg.size) || 46));
    btn.textContent = cfg.text || 'NPC';
    btn.style.background = cfg.color || '#43a047';
    btn.style.width = size + 'px';
    btn.style.height = size + 'px';
    btn.style.fontSize = Math.max(11, Math.round(size / 3.8)) + 'px';
    if (cfg.x != null && cfg.y != null) {
      btn.style.left = Math.max(4, Math.min(window.innerWidth - size - 4, cfg.x)) + 'px';
      btn.style.top = Math.max(4, Math.min(window.innerHeight - size - 4, cfg.y)) + 'px';
      btn.style.right = 'auto';
      btn.style.bottom = 'auto';
    }
  }

  function startButtonDrag(e) {
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    buttonDrag = { startX: e.clientX, startY: e.clientY, left: rect.left, top: rect.top, moved: false };
    btn.setPointerCapture?.(e.pointerId);
    const move = ev => {
      if (!buttonDrag) return;
      const dx = ev.clientX - buttonDrag.startX;
      const dy = ev.clientY - buttonDrag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) buttonDrag.moved = true;
      const size = btn.offsetWidth;
      const x = Math.max(4, Math.min(window.innerWidth - size - 4, buttonDrag.left + dx));
      const y = Math.max(4, Math.min(window.innerHeight - size - 4, buttonDrag.top + dy));
      btn.style.left = x + 'px';
      btn.style.top = y + 'px';
      btn.style.right = 'auto';
      btn.style.bottom = 'auto';
    };
    const up = () => {
      if (buttonDrag?.moved) {
        const cfg = buttonSettings();
        saveButtonSettings({ ...cfg, x: parseFloat(btn.style.left), y: parseFloat(btn.style.top) });
      }
      setTimeout(() => { buttonDrag = null; }, 0);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  window.NPCPreviewOpen = openPanel;
  ensureButton();
  syncAutoNpcs().catch(console.error);
  setTimeout(ensureButton, 2000);
  setTimeout(ensureButton, 6000);
  setTimeout(() => syncAutoNpcs().catch(console.error), 3000);
})();
