(function () {
  'use strict';

  const PANEL_ID = 'npc-preview-modal';
  const BUTTON_ID = 'npc-preview-open';
  const VAR_PREFIX = 'NPC_';
  const REG_PREFIX = 'npc_preview_registry_';
  const AVATAR_PREFIX = 'npc_preview_avatars_';
  const SETTINGS_PREFIX = 'npc_preview_settings_';
  const EXTRA_PREFIX = 'npc_preview_extra_';
  const REQUIRED_COLUMNS = ['NPC名称', '势力', '身份', '好感度', '状态', '心情', '备注', '首次登场', '登场事件', 'NPC关系', '好感历史'];

  const STATUSES = [
    ['offline', '离线', '#9e9e9e'],
    ['online', '在线', '#43a047'],
    ['away', '忙碌', '#f9a825'],
    ['danger', '危险', '#e53935'],
    ['missing', '失踪', '#6d4c41'],
  ];

  const MOODS = [
    ['calm', '平静', '😐'], ['happy', '愉悦', '😊'], ['angry', '愤怒', '😤'],
    ['sad', '悲伤', '😿'], ['fear', '恐惧', '😱'], ['love', '爱意', '❤️'],
    ['jealous', '嫉妒', '👿'], ['annoyed', '烦躁', '😾'], ['excited', '兴奋', '🤩'],
    ['shy', '害羞', '😳'], ['guilty', '心虚', '🫢'], ['cold', '冷漠', '🧊'],
  ];

  let rows = [];
  let selectedId = null;
  let filter = '全部';
  let query = '';
  let buttonDrag = null;
  let liveUpdateBound = false;
  let buttonObserver = null;
  let lastButtonOpenAt = 0;
  let syncCounter = 0;
  
  let panelX = null;
  let panelY = null;
  let panelW = null;
  let panelH = null;
  let panelDrag = null;

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
  function buttonSettings() { return parse(localStorage.getItem(ctxKey(SETTINGS_PREFIX)) || 'null', defaultSettings()) || defaultSettings(); }
  function saveButtonSettings(value) { localStorage.setItem(ctxKey(SETTINGS_PREFIX), JSON.stringify(value)); }
  function extras() { return parse(localStorage.getItem(ctxKey(EXTRA_PREFIX)) || '{}', {}); }
  function saveExtras(value) { localStorage.setItem(ctxKey(EXTRA_PREFIX), JSON.stringify(value)); }

  function defaultSettings() {
    return { 
      x: null, y: null, color: '#43a047', text: 'NPC', size: 46, 
      panelColor: '#ffffff', accentColor: '#43a047', textColor: '#233323', 
      collapsedGroups: {}, panelX: null, panelY: null, panelW: null, panelH: null,
      apiUrl: 'https://api.openai.com/v1', apiKey: '', apiModel: 'gpt-4o-mini', autoSyncInterval: 0
    };
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function updateViewportVars() {
    const vv = window.visualViewport;
    const width = vv?.width || window.innerWidth || document.documentElement.clientWidth || 360;
    const height = vv?.height || window.innerHeight || document.documentElement.clientHeight || 640;
    document.documentElement.style.setProperty('--npcpv-vw', width + 'px');
    document.documentElement.style.setProperty('--npcpv-vh', height + 'px');
  }

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
    const m = String(text || '').match(/(?:身份|职位|职业|职务|定位)\s*[:：]\s*([^\n]{1,180})/);
    return m ? m[1].trim() : '';
  }

  function extraFor(name) {
    return extras()[name] || { firstSeen: '', firstEvent: '', relations: '', history: [] };
  }

  function rowExtra(row) {
    const ex = extraFor(row['NPC名称']);
    return {
      ...ex,
      firstSeen: row['首次登场'] || ex.firstSeen || '',
      firstEvent: row['登场事件'] || ex.firstEvent || '',
      relations: row['NPC关系'] || row['关系'] || ex.relations || '',
      history: parseHistory(row['好感历史']) || ex.history || [],
    };
  }

  function saveExtraFor(name, patch) {
    const all = extras();
    all[name] = { ...(all[name] || {}), ...patch };
    saveExtras(all);
  }

  function parseHistory(value) {
    if (Array.isArray(value)) return value;
    if (!value) return null;
    const parsed = parse(String(value), null);
    if (Array.isArray(parsed)) return parsed;
    const list = String(value).split(/[;；\n]/).map(x => x.trim()).filter(Boolean).map(x => {
      const m = x.match(/(-?\d+)/);
      return m ? { time: '', value: Number(m[1]) || 0 } : null;
    }).filter(Boolean);
    return list.length ? list : null;
  }

  function serializeHistory(history) {
    return JSON.stringify((Array.isArray(history) ? history : []).slice(-80));
  }

  function splitNames(value) {
    return String(value || '')
      .replace(/[\[\]【】]/g, '\n')
      .split(/[、,，/|；;\n\r]+/)
      .map(v => v.replace(/^\s*(?:[-*•]|\d+[.、])\s*/g, '').replace(/(?:身份|势力|阵营|组织|职业|职位|职务|定位)\s*[:：].*$/g, '').trim())
      .filter(Boolean);
  }

  function addCandidate(map, name, sourceText) {
    const clean = normalizeName(name);
    if (!clean || clean.length < 2 || clean.length > 18) return;
    if (/^(用户|玩家|主角|你|我|他|她|它|众人|路人|角色|人物|NPC|名称|姓名|名字|NPC名称|NPC姓名|NPC名字|身份|势力)$/.test(clean)) return;
    if (!/[\u4e00-\u9fffA-Za-z]/.test(clean)) return;
    if (!map.has(clean)) map.set(clean, { name: clean, faction: inferFaction(sourceText), identity: inferIdentity(sourceText) });
    const item = map.get(clean);
    item.faction = item.faction || inferFaction(sourceText);
    item.identity = item.identity || inferIdentity(sourceText);
  }

  function entryKeys(entry) {
    const raw = entry?.keys || entry?.key || entry?.uid || entry?.comment || entry?.name || '';
    if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
    return String(raw || '').split(/[、,，|；;\n]/).map(x => x.trim()).filter(Boolean);
  }

  function normalizeEntry(raw, source) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      source: source || '',
      keys: entryKeys(raw),
      comment: String(raw.comment || raw.name || raw.title || ''),
      content: String(raw.content || raw.text || raw.memo || ''),
      raw,
    };
  }

  function collectEntriesFromBook(book, source, out) {
    if (!book || typeof book !== 'object') return;
    const entries = book.entries || book.entry || book.world_info || book.content;
    if (Array.isArray(entries)) entries.forEach(e => { const item = normalizeEntry(e, source); if (item) out.push(item); });
    else if (entries && typeof entries === 'object') Object.values(entries).forEach(e => { const item = normalizeEntry(e, source); if (item) out.push(item); });
  }

  async function maybe(value) { return typeof value?.then === 'function' ? await value : value; }

  async function scanWorldbookEntries() {
    const out = [];
    try {
      const ctx = window.SillyTavern?.getContext?.();
      const charId = ctx?.characterId ?? window.SillyTavern?.characterId ?? window.characterId ?? window.this_chid;
      const characters = ctx?.characters ?? window.SillyTavern?.characters ?? window.characters;
      const ch = characters?.[charId] || ctx?.character || ctx?.characterData || null;
      collectEntriesFromBook(ch?.data?.character_book || ch?.character_book || ch?.data?.extensions?.world, '角色卡内置世界书', out);

      const th = window.TavernHelper;
      if (th?.getCharLorebooks) {
        const lorebooks = await maybe(th.getCharLorebooks());
        if (Array.isArray(lorebooks)) {
          for (const book of lorebooks) {
            if (typeof book === 'string' && th.getLorebookEntries) {
              const entries = await maybe(th.getLorebookEntries(book));
              collectEntriesFromBook({ entries }, book, out);
            } else collectEntriesFromBook(book, book?.name || '角色世界书', out);
          }
        }
      }
      if (th?.getCurrentCharPrimaryLorebook && th?.getLorebookEntries) {
        const name = await maybe(th.getCurrentCharPrimaryLorebook());
        if (name) collectEntriesFromBook({ entries: await maybe(th.getLorebookEntries(name)) }, name, out);
      }
      if (ctx?.getWorldBooks) {
        const books = await maybe(ctx.getWorldBooks());
        if (Array.isArray(books)) books.forEach(book => collectEntriesFromBook(book, book?.name || 'SillyTavern世界书', out));
        else if (books && typeof books === 'object') Object.entries(books).forEach(([name, book]) => collectEntriesFromBook(book, name, out));
      }
    } catch (err) {
      console.warn('[NPC预览表] 读取世界书失败', err);
    }
    return out;
  }

  function parseImportNames(text) {
    const map = new Map();
    const lines = String(text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    for (const line of lines) {
      let matched = false;
      const labeled = /(?:NPC名字|NPC名称|NPC姓名|名字|姓名|名称)\s*[:：=]\s*(.+)$/i.exec(line);
      if (labeled) {
        splitNames(labeled[1]).forEach(name => addCandidate(map, name, line));
        matched = true;
      }
      if (!matched) splitNames(line).forEach(name => addCandidate(map, name, line));
    }
    return Array.from(map.values());
  }

  function enrichFromWorldbook(items, entries) {
    return items.map(item => {
      const hit = entries.find(entry => {
        const text = `${entry.comment}\n${entry.keys.join('\n')}\n${entry.content}`;
        return text.includes(item.name);
      });
      if (!hit) return item;
      const text = `${hit.comment}\n${hit.keys.join('\n')}\n${hit.content}`;
      return { ...item, faction: item.faction || inferFaction(text), identity: item.identity || inferIdentity(text) };
    });
  }

  async function addNpcBatch(items) {
    const existing = new Set(rows.map(r => r['NPC名称']).filter(Boolean));
    let added = 0;
    let skipped = 0;
    const reg = registry();
    const regNames = new Set(reg.map(n => n.name));
    for (const item of items) {
      if (existing.has(item.name) || regNames.has(item.name)) { skipped++; continue; }
      reg.push({ id: Date.now() + Math.random(), name: item.name, faction: item.faction || '', identity: item.identity || '' });
      regNames.add(item.name);
      added++;
      if ((added + skipped) % 100 === 0) await sleep(0);
    }
    saveRegistry(reg);
    await loadRows();
    render();
    return { added, skipped };
  }

  function exportPayload() {
    return { version: '1.0', exportedAt: new Date().toISOString(), requiredColumns: REQUIRED_COLUMNS, registry: registry(), extras: extras(), avatars: avatars(), settings: buttonSettings() };
  }

  async function importPayload(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('导入数据格式不正确');
    if (Array.isArray(payload.registry)) saveRegistry(payload.registry);
    if (payload.extras && typeof payload.extras === 'object') saveExtras(payload.extras);
    if (payload.avatars && typeof payload.avatars === 'object') saveAvatars(payload.avatars);
    if (payload.settings && typeof payload.settings === 'object') saveButtonSettings({ ...buttonSettings(), ...payload.settings });
    await loadRows();
    render();
    applyButtonSettings();
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function getChatTextForAi() {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (Array.isArray(ctx?.chat)) {
        const recent = ctx.chat.filter(m => m.is_user || m.is_name).slice(-40);
        return recent.map(m => `${m.name || (m.is_user ? 'User' : 'Character')}: ${m.mes || m.message || m.content || ''}`).join('\n\n');
      }
    } catch (err) { console.warn('[NPC预览表] getContext.chat 读取失败', err); }
    return '';
  }

  function extractJsonArray(text) {
    const raw = String(text || '').trim();
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fenced ? fenced[1].trim() : raw;
    const direct = parse(body, null);
    if (Array.isArray(direct)) return direct.map(normalizeAiNpc).filter(x => x['NPC名称']);
    if (direct && typeof direct === 'object') {
      const arr = direct.NPC列表 || direct.npcs || direct.NPCs || direct.data || direct.items || direct.list;
      if (Array.isArray(arr)) return arr.map(normalizeAiNpc).filter(x => x['NPC名称']);
      if (direct.NPC名称 || direct.name || direct.名字 || direct.名称) return [normalizeAiNpc(direct)].filter(x => x['NPC名称']);
    }
    const start = body.indexOf('[');
    const end = body.lastIndexOf(']');
    if (start >= 0 && end > start) {
      const parsed = parse(body.slice(start, end + 1), []);
      if (Array.isArray(parsed)) return parsed.map(normalizeAiNpc).filter(x => x['NPC名称']);
    }
    const objStart = body.indexOf('{');
    const objEnd = body.lastIndexOf('}');
    if (objStart >= 0 && objEnd > objStart) {
      const parsed = parse(body.slice(objStart, objEnd + 1), null);
      if (parsed && typeof parsed === 'object') {
        const arr = parsed.NPC列表 || parsed.npcs || parsed.NPCs || parsed.data || parsed.items || parsed.list;
        if (Array.isArray(arr)) return arr.map(normalizeAiNpc).filter(x => x['NPC名称']);
        return [normalizeAiNpc(parsed)].filter(x => x['NPC名称']);
      }
    }
    return [];
  }

  function normalizeAiNpc(item) {
    if (!item || typeof item !== 'object') return {};
    return {
      'NPC名称': item.NPC名称 || item.name || item.名字 || item.名称 || item.NPC名字 || '',
      '势力': item.势力 || item.阵营 || item.组织 || item.所属 || '',
      '身份': item.身份 || item.职业 || item.职位 || item.身份介绍 || '',
      '好感度': item.好感度 ?? item.好感 ?? 0,
      '状态': item.状态 || 'offline',
      '心情': item.心情 || 'calm',
      '备注': item.备注 || item.说明 || '',
      '首次登场': item.首次登场 || item.首次登场时间 || item.章节 || '',
      '登场事件': item.登场事件 || item.首次登场事件 || item.发生了什么 || '',
      'NPC关系': item.NPC关系 || item.关系 || '',
      '好感历史': item.好感历史 || '[]',
    };
  }

  async function syncAiFromChat(e, isBackground = false) {
    const btn = e?.currentTarget;
    const originalText = btn ? btn.textContent : '';
    if (btn && !isBackground) {
      btn.disabled = true;
      btn.textContent = '扫描中...';
    }
    
    const finish = () => {
      if (btn && !isBackground) {
        btn.disabled = false;
        btn.textContent = originalText || '手动测试';
      }
    };

    const notify = (msg, isError = false) => {
      if (!isBackground) showNotice(msg);
      else if (isError) console.warn('[NPC独立变量后台]', msg);
      else console.log('[NPC独立变量后台]', msg);
    };

    try {
      const cfg = buttonSettings();
      if (!cfg.apiUrl || !cfg.apiKey || !cfg.apiModel) {
          notify('请先在「API接口」面板中配置大模型 API 地址、密钥和模型名称。', true);
          return finish();
      }

      const chat = getChatTextForAi();
      if (!chat) {
        notify('没有读取到近期聊天记录，无法进行提取。', true);
        return finish();
      }
      
      const messages = [
        { role: 'system', content: '你是 NPC 数据整理器。只输出 JSON 数组，不要任何开头解释或Markdown说明。提取或更新以下对话中出现过的 NPC 状态。字段必须为：NPC名称, 势力, 身份, 好感度, 状态, 心情, 备注, 首次登场, 登场事件, NPC关系。若无新信息可留空或默认。' },
        { role: 'user', content: `请从以下最近的聊天记录中整理出现过的 NPC，并补全可判断的信息。只输出 JSON 数组：\n\n${chat}` }
      ];

      let endpoint = cfg.apiUrl.trim().replace(/\/$/, '');
      if (!endpoint.endsWith('/chat/completions')) {
          endpoint += '/chat/completions';
      }

      const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${cfg.apiKey.trim()}`
          },
          body: JSON.stringify({
              model: cfg.apiModel.trim(),
              messages: messages,
              temperature: 0.1,
              max_tokens: 1500
          })
      });

      if (!response.ok) {
          let errText = response.statusText;
          try { const errObj = await response.json(); errText = errObj.error?.message || errText; } catch (_) {}
          throw new Error(`API 返回错误: ${response.status} - ${errText}`);
      }

      const data = await response.json();
      let content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('API 返回格式异常，无法读取内容');

      const list = extractJsonArray(content);
      if (!list.length) {
        notify('模型已响应，但未从中提取到可更新的 NPC 变动数据。', true);
        return finish();
      }
      
      let ok = 0;
      for (const item of list) {
        if (!item?.NPC名称) continue;
        
        const reg = registry();
        const existing = reg.find(n => n.name === item['NPC名称']);
        if (!existing) {
          reg.push({ id: Date.now() + Math.random(), name: item['NPC名称'], faction: item['势力'] || '', identity: item['身份'] || '' });
        } else {
          existing.faction = item['势力'] || existing.faction;
          existing.identity = item['身份'] || existing.identity;
        }
        saveRegistry(reg);
        
        const key = keyName(item['NPC名称']);
        if (item['好感度'] !== undefined) await setVar(VAR_PREFIX + key + '_好感', item['好感度']);
        if (item['状态']) await setVar(VAR_PREFIX + key + '_状态', item['状态']);
        if (item['心情']) await setVar(VAR_PREFIX + key + '_心情', item['心情']);
        if (item['备注']) await setVar(VAR_PREFIX + key + '_备注', item['备注']);
        
        const ex = extraFor(item['NPC名称']);
        saveExtraFor(item['NPC名称'], {
          firstSeen: item['首次登场'] || ex.firstSeen || '',
          firstEvent: item['登场事件'] || ex.firstEvent || '',
          relations: item['NPC关系'] || ex.relations || ''
        });
        
        ok++;
        await sleep(0);
      }
      
      if (document.getElementById(PANEL_ID)) {
          await loadRows();
          render();
      }
      notify(`同步完成：成功调用独立 API，提取并更新了 ${ok} 个 NPC 数据。`);
      finish();
    } catch (err) {
      console.error('[NPC预览表] 独立 API 同步失败', err);
      notify('提取失败：' + (err?.message || String(err || '未知错误')), true);
      finish();
    }
  }

  function bindLiveUpdates() {
    if (liveUpdateBound) return;
    liveUpdateBound = true;
    
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (ctx?.eventSource && ctx?.event_types?.MESSAGE_RECEIVED) {
        ctx.eventSource.on(ctx.event_types.MESSAGE_RECEIVED, async () => {
          const cfg = buttonSettings();
          const interval = Number(cfg.autoSyncInterval) || 0;
          
          if (interval > 0) {
            syncCounter++;
            if (syncCounter >= interval) {
              syncCounter = 0;
              console.log(`[NPC独立变量后台] 聊天已达到 ${interval} 轮，正静默触发自动提取...`);
              await syncAiFromChat(null, true);
            }
          }
        });
      }
    } catch (e) {
      console.warn('[NPC预览表] 绑定轮次监听失败', e);
    }
  }

  function trendSvg(history, current) {
    const points = (Array.isArray(history) ? history : []).slice(-16);
    if (!points.length) points.push({ value: Number(current) || 0 });
    const values = points.map(p => Math.max(-100, Math.min(100, Number(p.value) || 0)));
    const coords = values.map((v, i) => `${8 + (i * 164 / Math.max(1, values.length - 1))},${52 - ((v + 100) / 200 * 44)}`).join(' ');
    return `<svg class="npcpv-trend" viewBox="0 0 180 60" aria-label="好感趋势"><polyline points="${coords}" fill="none" stroke="var(--npcpv-accent, #43a047)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline><line x1="8" y1="30" x2="172" y2="30" stroke="#dcebdc" stroke-dasharray="3 3"></line></svg>`;
  }

  function relationGraphHtml(selected) {
    const names = rows.map(r => r['NPC名称']).filter(Boolean);
    const ex = rowExtra(selected);
    const links = String(ex.relations || '').split(/[、,，;；\n]/).map(x => x.trim()).filter(Boolean);
    const nodes = [selected['NPC名称'], ...links.filter(x => names.includes(x))].slice(0, 9);
    if (nodes.length <= 1) return '<div class="npcpv-empty compact">暂无关系。可在“关系”里输入其他NPC名字，使用顿号或换行分隔。</div>';
    const center = { x: 110, y: 78 };
    const r = 58;
    const positions = nodes.map((name, i) => i === 0 ? center : { x: center.x + Math.cos((i - 1) / (nodes.length - 1) * Math.PI * 2) * r, y: center.y + Math.sin((i - 1) / (nodes.length - 1) * Math.PI * 2) * r, name });
    const lines = positions.slice(1).map(p => `<line x1="${center.x}" y1="${center.y}" x2="${p.x}" y2="${p.y}"></line>`).join('');
    const circles = positions.map((p, i) => `<g><circle cx="${p.x}" cy="${p.y}" r="${i ? 18 : 24}" class="${i ? '' : 'core'}"></circle><text x="${p.x}" y="${p.y + 4}" text-anchor="middle">${esc(nodes[i]).slice(0, 4)}</text></g>`).join('');
    return `<svg class="npcpv-graph" viewBox="0 0 220 156">${lines}${circles}</svg>`;
  }

  function orderedRows() {
    const ex = extras();
    return [...filteredRows()].sort((a, b) => (ex[a['NPC名称']]?.order ?? 999999) - (ex[b['NPC名称']]?.order ?? 999999));
  }

  function toggleGroup(name) {
    const cfg = buttonSettings();
    const collapsedGroups = { ...(cfg.collapsedGroups || {}) };
    collapsedGroups[name] = !collapsedGroups[name];
    saveButtonSettings({ ...cfg, collapsedGroups });
    render();
  }

  function getVarSync(key, fallback) {
    try {
      const context = window.SillyTavern?.getContext?.();
      if (context?.chatMetadata) {
        const value = context.chatMetadata[key];
        if (value !== undefined && value !== null && value !== '') return value;
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
      }
    } catch (_) {}
    localStorage.setItem(ctxKey('npcv_' + key + '_'), String(value));
  }

  async function readVars() {
    const result = [];
    for (const npc of registry()) {
      const key = keyName(npc.name);
      const item = {
        id: String(npc.id),
        rowIndex: npc.id,
        source: 'var',
        'NPC名称': npc.name,
        '势力': npc.faction || '',
        '身份': npc.identity || '',
        '好感度': Number(getVarSync(VAR_PREFIX + key + '_好感', 0)) || 0,
        '状态': getVarSync(VAR_PREFIX + key + '_状态', 'offline'),
        '心情': getVarSync(VAR_PREFIX + key + '_心情', 'calm'),
        '备注': getVarSync(VAR_PREFIX + key + '_备注', ''),
      };
      Object.assign(item, extraFor(npc.name));
      result.push(item);
    }
    return result;
  }

  async function loadRows() {
    rows = await readVars();
  }

  async function writeField(row, field, value) {
    const key = keyName(row['NPC名称']);
    const reg = registry();
    const item = reg.find(n => String(n.id) === String(row.id) || n.name === row['NPC名称']);
    if (item && (field === '势力' || field === '身份')) {
      if (field === '势力') item.faction = value;
      if (field === '身份') item.identity = value;
      saveRegistry(reg);
    }
    if (field === '好感度') await setVar(VAR_PREFIX + key + '_好感', value);
    if (field === '状态') await setVar(VAR_PREFIX + key + '_状态', value);
    if (field === '心情') await setVar(VAR_PREFIX + key + '_心情', value);
    if (field === '备注') await setVar(VAR_PREFIX + key + '_备注', value);
    
    if (field === '好感度') {
      const ex = rowExtra(row);
      const history = Array.isArray(ex.history) ? ex.history : [];
      history.push({ time: new Date().toISOString(), value: Number(value) || 0 });
      saveExtraFor(row['NPC名称'], { history: history.slice(-80) });
    }
    if (field === '首次登场') saveExtraFor(row['NPC名称'], { firstSeen: value });
    if (field === '登场事件') saveExtraFor(row['NPC名称'], { firstEvent: value });
    if (field === '关系') saveExtraFor(row['NPC名称'], { relations: value });
    await loadRows();
    render();
  }

  async function addNpc(name, faction, identity) {
    const reg = registry();
    const id = Date.now() + Math.random();
    reg.push({ id, name, faction, identity });
    saveRegistry(reg);
    const key = keyName(name);
    await setVar(VAR_PREFIX + key + '_好感', 0);
    await setVar(VAR_PREFIX + key + '_状态', 'offline');
    await setVar(VAR_PREFIX + key + '_心情', 'calm');
    await setVar(VAR_PREFIX + key + '_备注', '');
    
    await loadRows();
    selectedId = rows.find(r => r['NPC名称'] === name)?.id || selectedId;
    render();
  }

  async function deleteNpc(row) {
    saveRegistry(registry().filter(n => String(n.id) !== String(row.id)));
    selectedId = null;
    await loadRows();
    render();
  }

  async function clearAllNpcs() {
    if (!confirm('确定清空当前角色卡的全部NPC目录？')) return;
    saveRegistry([]);
    selectedId = null;
    filter = '全部';
    query = '';
    rows = [];
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
    return `<div class="npcpv-card ${active ? 'active' : ''}" data-id="${esc(row.id)}" draggable="true"><div class="npcpv-dot" style="background:${st[2]}"></div><div class="npcpv-avatar">${avatar ? `<img src="${avatar}">` : esc(name[0] || '?')}</div><div class="npcpv-name">${esc(name)}</div><div class="npcpv-faction">${esc(row['势力'] || '未分组')}</div><div class="npcpv-bar"><div class="npcpv-fill" style="width:${Math.min(Math.abs(aff), 100)}%;background:${affectionColor(aff)}"></div></div></div>`;
  }

  function cardsHtml(selected) {
    const cfg = buttonSettings();
    const collapsed = cfg.collapsedGroups || {};
    const grouped = new Map();
    for (const row of orderedRows()) {
      const group = row['势力'] || '未分组';
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group).push(row);
    }
    if (!grouped.size) return '<div class="npcpv-empty" style="grid-column:1/-1">暂无NPC<br>点击「批量导入」粘贴名单</div>';
    return Array.from(grouped.entries()).map(([group, list]) => `<div class="npcpv-group"><button class="npcpv-group-title" data-group="${esc(group)}">${collapsed[group] ? '▸' : '▾'} ${esc(group)} <span>${list.length}</span></button><div class="npcpv-group-cards ${collapsed[group] ? 'collapsed' : ''}">${list.map(r => cardHtml(r, selected && String(r.id) === String(selected.id))).join('')}</div></div>`).join('');
  }

  function detailHtml(row) {
    const name = row['NPC名称'] || '?';
    const aff = Number(row['好感度']) || 0;
    const mood = moodOf(row['心情']);
    const avatar = avatars()[name];
    const ex = rowExtra(row);
    
    const backBtn = `<button class="npcpv-btn npcpv-back-btn" data-action="back-to-list">⬅ 返回NPC列表</button>`;
    
    return `${backBtn}<div class="npcpv-profile"><div class="npcpv-big-avatar" data-action="avatar">${avatar ? `<img src="${avatar}">` : esc(name[0] || '?')}<span>上传头像</span></div><div class="npcpv-profile-text"><div class="npcpv-main-name">${esc(name)}</div><div class="npcpv-main-sub">${esc(row['势力'] || '未分组')}</div><div class="npcpv-main-sub long">${esc(row['身份'] || '')}</div></div></div><div class="npcpv-section"><div class="npcpv-label">分组 / 势力</div><input class="npcpv-input" data-action="faction" value="${esc(row['势力'] || '')}" placeholder="例如：星耀传媒、黑市、王城"></div><div class="npcpv-section"><div class="npcpv-label">身份介绍</div><textarea class="npcpv-textarea npcpv-identity" data-action="identity" placeholder="例如：星耀传媒旗下影帝 / 体验派演员 / 曾获金...">${esc(row['身份'] || '')}</textarea></div><div class="npcpv-section"><div class="npcpv-label">首次登场时间 / 章节</div><input class="npcpv-input" data-action="first-seen" value="${esc(ex.firstSeen || '')}" placeholder="例如：第3章 / 初见舞台 / 2026-07-06"></div><div class="npcpv-section"><div class="npcpv-label">首次登场发生了什么</div><textarea class="npcpv-textarea" data-action="first-event" placeholder="记录第一次出现的位置和事件，方便回溯">${esc(ex.firstEvent || '')}</textarea></div><div class="npcpv-section"><div class="npcpv-label">好感度 <span class="npcpv-small">纯变量模式：${VAR_PREFIX + keyName(name) + '_好感'}</span></div><div class="npcpv-aff"><div class="npcpv-affbar"><div class="npcpv-afffill" style="width:${Math.min(Math.abs(aff),100)}%;background:${affectionColor(aff)}"></div></div><div class="npcpv-affval" style="color:${affectionColor(aff)}">${aff}</div></div>${trendSvg(ex.history, aff)}<div class="npcpv-ctrls">${[-10,-5,-1,1,5,10].map(n => `<button class="npcpv-btn" data-action="aff" data-delta="${n}">${n > 0 ? '+' : ''}${n}</button>`).join('')}</div></div><div class="npcpv-section"><div class="npcpv-label">NPC关系</div><textarea class="npcpv-textarea" data-action="relations" placeholder="输入相关 NPC 名字，用顿号、逗号或换行分隔">${esc(ex.relations || '')}</textarea>${relationGraphHtml(row)}</div><div class="npcpv-section"><div class="npcpv-label">状态</div><select class="npcpv-select" data-action="status">${STATUSES.map(s => `<option value="${s[0]}" ${s[0] === (row['状态'] || 'offline') ? 'selected' : ''}>${s[1]}</option>`).join('')}</select></div><div class="npcpv-section"><div class="npcpv-label">心情 <span class="npcpv-small">${mood[2]}</span></div><select class="npcpv-select" data-action="mood">${MOODS.map(m => `<option value="${m[0]}" ${m[0] === (row['心情'] || 'calm') ? 'selected' : ''}>${m[2]} ${m[1]}</option>`).join('')}</select></div><div class="npcpv-section"><div class="npcpv-label">备注</div><textarea class="npcpv-textarea" data-action="notes">${esc(row['备注'] || '')}</textarea></div><div class="npcpv-ctrls"><button class="npcpv-btn danger" data-action="delete">删除NPC</button></div>`;
  }

  function render() {
    const root = document.getElementById(PANEL_ID);
    if (!root) return;
    const selected = rows.find(r => String(r.id) === String(selectedId));
    const factions = ['全部', ...Array.from(new Set(rows.map(r => r['势力']).filter(Boolean))).sort()];
    
    const styleAttr = `width:${panelW ? panelW + 'px' : 'min(860px, 92vw)'}; height:${panelH ? panelH + 'px' : 'min(680px, 88vh)'}; left:${panelX}px; top:${panelY}px; transform: none !important; margin: 0;`;
    const viewClass = selected ? 'view-detail' : 'view-list';
    
    // 【更新核心点】更改了右上角的入口按钮
    root.innerHTML = `<div class="npcpv-root ${viewClass}" style="${styleAttr}"><div class="npcpv-modal"><div class="npcpv-header"><div class="npcpv-title">NPC预览表 <span class="npcpv-mode">纯变量独立模式</span></div><div class="npcpv-actions"><button class="npcpv-btn primary" data-action="api-setup" style="background:#0288d1; border-color:#0288d1; font-weight: 800;">🔌 API与自动同步</button><button class="npcpv-btn primary" data-action="batch-import">批量导入</button><button class="npcpv-btn" data-action="data-io">导入/导出</button><button class="npcpv-btn danger" data-action="clear-all">清空</button><button class="npcpv-btn" data-action="button-settings">外观设置</button><button class="npcpv-btn" data-action="add">+ 新NPC</button><button class="npcpv-close" data-action="close">×</button></div></div><div class="npcpv-body"><div class="npcpv-list"><input class="npcpv-search" value="${esc(query)}" placeholder="搜索名称、势力、身份..." data-action="search"><div class="npcpv-filters">${factions.map(f => `<button class="npcpv-chip ${f === filter ? 'active' : ''}" data-filter="${esc(f)}">${esc(f)}</button>`).join('')}</div><div class="npcpv-cards">${cardsHtml(selected)}</div></div><div class="npcpv-detail">${selected ? detailHtml(selected) : '<div class="npcpv-empty">选择左侧NPC查看详情<br>或使用批量导入添加目录</div>'}</div></div></div></div>`;
    
    applyPanelTheme(root);
    bindEvents(root);
  }

  function bindEvents(root) {
    const selected = rows.find(r => String(r.id) === String(selectedId));
    
    root.querySelector('.npcpv-root')?.addEventListener('pointerdown', startPanelDrag);
    root.querySelector('[data-action="close"]')?.addEventListener('click', closePanel);
    root.querySelector('[data-action="back-to-list"]')?.addEventListener('click', () => { selectedId = null; render(); });
    root.querySelector('[data-action="add"]')?.addEventListener('click', showAddDialog);
    
    // 【更新核心点】绑定新的 API 设置面板
    root.querySelector('[data-action="api-setup"]')?.addEventListener('click', showApiSetupDialog);
    
    root.querySelector('[data-action="button-settings"]')?.addEventListener('click', showButtonDialog);
    root.querySelector('[data-action="data-io"]')?.addEventListener('click', showDataDialog);
    root.querySelector('[data-action="batch-import"]')?.addEventListener('click', showBatchImportDialog);
    root.querySelector('[data-action="clear-all"]')?.addEventListener('click', clearAllNpcs);
    root.querySelector('[data-action="search"]')?.addEventListener('input', e => { query = e.target.value; render(); });
    root.querySelectorAll('[data-filter]').forEach(btn => btn.addEventListener('click', () => { filter = btn.dataset.filter; render(); }));
    root.querySelectorAll('[data-group]').forEach(btn => btn.addEventListener('click', () => toggleGroup(btn.dataset.group)));
    root.querySelectorAll('.npcpv-card').forEach(card => {
      card.addEventListener('click', () => { selectedId = card.dataset.id; render(); });
      card.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', card.dataset.id));
      card.addEventListener('dragover', e => e.preventDefault());
      card.addEventListener('drop', e => { e.preventDefault(); reorderNpc(e.dataTransfer.getData('text/plain'), card.dataset.id); });
    });
    if (!selected) return;
    root.querySelectorAll('[data-action="aff"]').forEach(btn => btn.addEventListener('click', () => writeField(selected, '好感度', Math.max(-100, Math.min(100, (Number(selected['好感度']) || 0) + Number(btn.dataset.delta))))));
    root.querySelector('[data-action="status"]')?.addEventListener('change', e => writeField(selected, '状态', e.target.value));
    root.querySelector('[data-action="mood"]')?.addEventListener('change', e => writeField(selected, '心情', e.target.value));
    let timer;
    root.querySelector('[data-action="faction"]')?.addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => writeField(selected, '势力', e.target.value), 350); });
    root.querySelector('[data-action="identity"]')?.addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => writeField(selected, '身份', e.target.value), 350); });
    root.querySelector('[data-action="first-seen"]')?.addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => writeField(selected, '首次登场', e.target.value), 350); });
    root.querySelector('[data-action="first-event"]')?.addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => writeField(selected, '登场事件', e.target.value), 350); });
    root.querySelector('[data-action="relations"]')?.addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => writeField(selected, '关系', e.target.value), 350); });
    root.querySelector('[data-action="notes"]')?.addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => writeField(selected, '备注', e.target.value), 500); });
    root.querySelector('[data-action="delete"]')?.addEventListener('click', () => { if (confirm('删除这个NPC？')) deleteNpc(selected); });
    root.querySelector('[data-action="avatar"]')?.addEventListener('click', () => uploadAvatar(selected));
  }

  function showNotice(message) {
    const root = document.getElementById(PANEL_ID);
    if (!root) return alert(message);
    showSubDialog(`<h3>提示</h3><div class="npcpv-notice">${esc(message)}</div><div class="npcpv-dialog-actions"><button class="npcpv-btn primary" data-subclose="1">知道了</button></div>`);
  }

  function reorderNpc(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    const visible = orderedRows();
    const fromIndex = visible.findIndex(r => String(r.id) === String(fromId));
    const toIndex = visible.findIndex(r => String(r.id) === String(toId));
    if (fromIndex < 0 || toIndex < 0) return;
    const moved = visible.splice(fromIndex, 1)[0];
    visible.splice(toIndex, 0, moved);
    const all = extras();
    visible.forEach((row, index) => { all[row['NPC名称']] = { ...(all[row['NPC名称']] || {}), order: index }; });
    saveExtras(all);
    render();
  }

  function showSubDialog(html, after) {
    const root = document.getElementById(PANEL_ID);
    const div = document.createElement('div');
    div.className = 'npcpv-modal-sub';
    div.id = 'npcpv-subdialog';
    div.innerHTML = `<div class="npcpv-dialog">${html}</div>`;
    root.querySelector('.npcpv-root').appendChild(div);
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

  function showApiSetupDialog() {
    const cfg = buttonSettings();
    showSubDialog(`
      <h3>🔌 独立大模型 API 与自动同步配置</h3>
      <div class="npcpv-notice" style="margin-bottom: 12px; color: #2e7d32; font-weight:bold;">
        在这里配置独立的 API，让插件在后台自动提取变量，彻底摆脱一切框架依赖。
      </div>
      <div class="npcpv-form">
        <div>
          <div class="npcpv-label">API 代理地址 (Base URL)</div>
          <input class="npcpv-input" id="npc-api-url" placeholder="兼容 OpenAI 的地址，如 https://api.openai.com/v1" value="${esc(cfg.apiUrl || 'https://api.openai.com/v1')}">
        </div>
        <div>
          <div class="npcpv-label">API 密钥 (API Key)</div>
          <input class="npcpv-input" type="password" id="npc-api-key" placeholder="sk-..." value="${esc(cfg.apiKey || '')}">
        </div>
        <div>
          <div class="npcpv-label">模型名称 (Model)</div>
          <input class="npcpv-input" id="npc-api-model" placeholder="gpt-4o-mini 或 claude-3-haiku" value="${esc(cfg.apiModel || 'gpt-4o-mini')}">
        </div>
        <div style="margin-top: 10px; border-top: 1px dashed #dcebdc; padding-top: 14px;">
          <div class="npcpv-label" style="color:#d84315;">🚀 后台自动同步间隔（聊天轮次）</div>
          <input class="npcpv-input" type="number" id="npc-api-interval" placeholder="设为 0 即为纯手动，设为 5 则每 5 句话后台扫描一次" value="${Number(cfg.autoSyncInterval) || 0}" min="0" max="100">
          <div class="npcpv-small" style="margin-top:6px; line-height:1.5;">
            设置间隔后，系统会在背后静默调用上方配置的 API 更新数据，完全不打断你的打字。<br>
            <i>进阶用法：若想在酒馆宏中调用已存的变量，可用 <code>{{//javascript NPCPreviewAPI.getValue('张三', '好感度')}}</code></i>
          </div>
        </div>
      </div>
      <div class="npcpv-dialog-actions" style="margin-top: 20px; justify-content: space-between;">
        <button class="npcpv-btn primary" id="npc-api-force-sync" style="background:#0288d1; border-color:#0288d1; font-weight:800;">🤖 保存并立刻手动提取一次</button>
        <div>
          <button class="npcpv-btn" data-subclose="1">取消</button>
          <button class="npcpv-btn primary" id="npc-api-save">仅保存配置</button>
        </div>
      </div>
    `, () => {
      const saveCfg = () => {
        const newCfg = {
          ...buttonSettings(),
          apiUrl: document.getElementById('npc-api-url').value.trim() || 'https://api.openai.com/v1',
          apiKey: document.getElementById('npc-api-key').value.trim(),
          apiModel: document.getElementById('npc-api-model').value.trim() || 'gpt-4o-mini',
          autoSyncInterval: Number(document.getElementById('npc-api-interval').value) || 0
        };
        saveButtonSettings(newCfg);
        return newCfg;
      };

      document.getElementById('npc-api-save').onclick = () => {
        saveCfg();
        closeSubDialog();
        showNotice('独立 API 与同步配置已保存。');
      };

      document.getElementById('npc-api-force-sync').onclick = async (e) => {
        saveCfg();
        closeSubDialog();
        await syncAiFromChat(e, false);
      };
    });
  }

  function previewImportHtml(items) {
    if (!items.length) return '<div class="npcpv-empty compact">未解析到可导入的NPC名字</div>';
    return items.map(item => `<div class="npcpv-import-row"><b>${esc(item.name)}</b><span>${esc(item.faction || '未识别势力')}</span><span>${esc(item.identity || '未识别身份')}</span></div>`).join('');
  }

  function showBatchImportDialog() {
    showSubDialog(`<h3>批量导入NPC</h3><div class="npcpv-form"><textarea class="npcpv-textarea npcpv-import-input" id="npc-import-text" placeholder="从世界书复制NPC名字文本，或手动输入。支持一行一个、顿号/逗号分隔，也支持：NPC名字：张三、李四"></textarea><div class="npcpv-small">导入时会按名字匹配当前世界书条目，能识别到“势力/阵营/组织/所属”和“身份/职业/职位/职务/定位”时会自动带入。</div><div class="npcpv-import-preview" id="npc-import-preview"></div></div><div class="npcpv-dialog-actions"><button class="npcpv-btn" data-subclose="1">取消</button><button class="npcpv-btn primary" id="npc-import-ok">全部添加</button></div>`, () => {
      const input = document.getElementById('npc-import-text');
      const preview = document.getElementById('npc-import-preview');
      let parsed = [];
      let timer;
      const update = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const base = parseImportNames(input.value);
          parsed = enrichFromWorldbook(base, await scanWorldbookEntries());
          preview.innerHTML = previewImportHtml(parsed);
        }, 120);
      };
      input.addEventListener('input', update);
      preview.innerHTML = previewImportHtml([]);
      document.getElementById('npc-import-ok').onclick = async e => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = '导入中...';
        const base = parseImportNames(input.value);
        const items = enrichFromWorldbook(base, await scanWorldbookEntries());
        if (!items.length) { btn.disabled = false; btn.textContent = '全部添加'; return; }
        const result = await addNpcBatch(items);
        closeSubDialog();
        showNotice(`批量导入完成：新增 ${result.added} 个，跳过重复 ${result.skipped} 个。`);
      };
    });
  }

  function showDataDialog() {
    showSubDialog(`<h3>数据导入/导出</h3><div class="npcpv-form"><textarea class="npcpv-textarea npcpv-import-input" id="npc-data-json" placeholder="这里会显示导出的 JSON，也可以粘贴备份 JSON 后导入"></textarea><div class="npcpv-small">这里导出的 JSON 将包含所有本地 NPC 变量数据和 UI 设置。你可以随时使用它来备份或跨设备迁移。</div></div><div class="npcpv-dialog-actions"><button class="npcpv-btn" id="npc-data-fill">生成导出JSON</button><button class="npcpv-btn" id="npc-data-download">下载</button><button class="npcpv-btn primary" id="npc-data-import">导入</button><button class="npcpv-btn" data-subclose="1">关闭</button></div>`, () => {
      const area = document.getElementById('npc-data-json');
      document.getElementById('npc-data-fill').onclick = () => { area.value = JSON.stringify(exportPayload(), null, 2); };
      document.getElementById('npc-data-download').onclick = () => downloadJson('npc-preview-backup.json', exportPayload());
      document.getElementById('npc-data-import').onclick = async () => {
        try {
          await importPayload(JSON.parse(area.value));
          closeSubDialog();
          showNotice('数据导入完成。');
        } catch (err) {
          showNotice('导入失败：' + (err?.message || 'JSON 格式错误'));
        }
      };
    });
  }

  function showButtonDialog() {
    const cfg = buttonSettings();
    showSubDialog(`<h3>外观设置</h3><div class="npcpv-form"><input class="npcpv-input" id="npc-btn-text" placeholder="按钮文字或图标" value="${esc(cfg.text)}"><label class="npcpv-small">悬浮按钮颜色</label><input class="npcpv-input" id="npc-btn-color" type="color" value="${esc(cfg.color)}"><label class="npcpv-small">面板主色</label><input class="npcpv-input" id="npc-accent-color" type="color" value="${esc(cfg.accentColor || '#43a047')}"><label class="npcpv-small">面板背景</label><input class="npcpv-input" id="npc-panel-color" type="color" value="${esc(cfg.panelColor || '#ffffff')}"><label class="npcpv-small">文字颜色</label><input class="npcpv-input" id="npc-text-color" type="color" value="${esc(cfg.textColor || '#233323')}"><label class="npcpv-small">按钮尺寸：<span id="npc-btn-size-val">${Number(cfg.size) || 46}</span>px</label><input class="npcpv-range" id="npc-btn-size" type="range" min="34" max="86" value="${Number(cfg.size) || 46}"></div><div class="npcpv-dialog-actions"><button class="npcpv-btn" data-subclose="1">取消</button><button class="npcpv-btn primary" id="npc-btn-ok">保存</button></div>`, () => {
      const size = document.getElementById('npc-btn-size');
      const sizeVal = document.getElementById('npc-btn-size-val');
      size.oninput = () => { sizeVal.textContent = size.value; };
      document.getElementById('npc-btn-ok').onclick = () => {
        saveButtonSettings({ ...buttonSettings(), text: document.getElementById('npc-btn-text').value.trim() || 'NPC', color: document.getElementById('npc-btn-color').value, accentColor: document.getElementById('npc-accent-color').value, panelColor: document.getElementById('npc-panel-color').value, textColor: document.getElementById('npc-text-color').value, size: Number(size.value) || 46 });
        applyButtonSettings();
        applyPanelTheme(document.getElementById(PANEL_ID));
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
    updateViewportVars();
    bindLiveUpdates();
    
    const cfg = buttonSettings();
    panelX = cfg.panelX;
    panelY = cfg.panelY;
    panelW = cfg.panelW;
    panelH = cfg.panelH;
    
    const maxW = window.innerWidth;
    const maxH = window.innerHeight;
    
    if (panelX == null || panelY == null || panelX < -100 || panelY < 0 || panelX > maxW) {
       const w = panelW || Math.min(860, maxW * 0.92);
       const h = panelH || Math.min(680, maxH * 0.88);
       panelX = Math.max(0, (maxW - w) / 2);
       panelY = Math.max(0, (maxH - h) / 2);
    }
    
    panelX = Math.max(0, Math.min(maxW - 60, panelX));
    panelY = Math.max(0, Math.min(maxH - 60, panelY));
    
    let root = document.getElementById(PANEL_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = PANEL_ID;
      document.body.appendChild(root);
    }
    
    const styleAttr = `width:${panelW ? panelW + 'px' : 'min(860px, 92vw)'}; height:${panelH ? panelH + 'px' : 'min(680px, 88vh)'}; left:${panelX}px; top:${panelY}px; transform: none !important; margin: 0;`;
    const viewClass = selectedId ? 'view-detail' : 'view-list';
    
    root.innerHTML = `<div class="npcpv-root ${viewClass}" style="${styleAttr}"><div class="npcpv-modal"><div class="npcpv-header"><div class="npcpv-title">NPC预览表 <span class="npcpv-mode">加载中</span></div><div class="npcpv-actions"><button class="npcpv-close" data-action="close">×</button></div></div><div class="npcpv-empty">正在读取 NPC 变量数据...</div></div></div>`;
    
    root.querySelector('[data-action="close"]')?.addEventListener('click', closePanel);
    applyPanelTheme(root);
    
    try {
      await loadRows();
    } catch (err) {
      console.error('[NPC预览表] 读取数据失败', err);
      rows = [];
    }
    render();
  }

  function closePanel() { 
    const win = document.querySelector('.npcpv-root');
    if (win) {
      panelX = parseFloat(win.style.left) || null;
      panelY = parseFloat(win.style.top) || null;
      panelW = parseFloat(win.style.width) || win.offsetWidth;
      panelH = parseFloat(win.style.height) || win.offsetHeight;
      const cfg = buttonSettings();
      saveButtonSettings({ ...cfg, panelX, panelY, panelW, panelH });
    }
    document.getElementById(PANEL_ID)?.remove(); 
  }
  
  function startPanelDrag(e) {
    const tag = e.target.tagName;
    if (['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(tag)) return;
    if (e.target.closest('.npcpv-card, .npcpv-chip, .npcpv-close, [data-action], .npcpv-actions')) return;
    
    const win = document.querySelector('.npcpv-root');
    if (!win) return;

    let pressTimer = null;
    let isDragging = false;
    const startTouchX = e.clientX;
    const startTouchY = e.clientY;
    
    const blockContextMenu = ev => { if (isDragging) ev.preventDefault(); };
    window.addEventListener('contextmenu', blockContextMenu);

    const triggerDrag = () => {
      isDragging = true;
      win.classList.add('npcpv-dragging');
      navigator.vibrate?.(30);
      
      panelDrag = { 
        startX: startTouchX, 
        startY: startTouchY, 
        left: parseFloat(win.style.left) || 0, 
        top: parseFloat(win.style.top) || 0 
      };
      win.setPointerCapture?.(e.pointerId);
    };

    pressTimer = setTimeout(triggerDrag, 300);

    const move = ev => {
      if (!isDragging) {
        if (Math.abs(ev.clientX - startTouchX) > 8 || Math.abs(ev.clientY - startTouchY) > 8) {
          clearTimeout(pressTimer);
        }
        return;
      }
      ev.preventDefault();
      const dx = ev.clientX - panelDrag.startX;
      const dy = ev.clientY - panelDrag.startY;
      
      let newX = panelDrag.left + dx;
      let newY = panelDrag.top + dy;
      newX = Math.max(0, Math.min(window.innerWidth - 40, newX));
      newY = Math.max(0, Math.min(window.innerHeight - 40, newY)); 
      
      win.style.left = newX + 'px';
      win.style.top = newY + 'px';
    };
    
    const up = () => {
      clearTimeout(pressTimer);
      if (isDragging) {
         win.classList.remove('npcpv-dragging');
         if (win) {
            panelX = parseFloat(win.style.left) || null;
            panelY = parseFloat(win.style.top) || null;
         }
         panelDrag = null;
      }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setTimeout(() => window.removeEventListener('contextmenu', blockContextMenu), 50);
    };
    
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function ensureButton() {
    if (document.getElementById(BUTTON_ID)) return;
    if (!document.body) return;
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.className = 'npcpv-open-button';
    btn.title = 'NPC预览表：点击打开，拖动移动位置';
    btn.addEventListener('pointerdown', startButtonDrag);
    
    document.body.appendChild(btn);
    applyButtonSettings();
  }

  function keepButtonVisible() {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    const size = btn.offsetWidth || 46;
    const vv = window.visualViewport;
    const width = vv?.width || window.innerWidth;
    const height = vv?.height || window.innerHeight;
    const left = btn.style.left ? parseFloat(btn.style.left) : (width - size - 18);
    const top = btn.style.top ? parseFloat(btn.style.top) : (height - size - 86);
    const x = Math.max(8, Math.min(width - size - 8, left));
    const y = Math.max(8, Math.min(height - size - 8, top));
    btn.style.left = x + 'px';
    btn.style.top = y + 'px';
    btn.style.right = 'auto';
    btn.style.bottom = 'auto';
  }

  function observeButton() {
    if (buttonObserver || !document.body) return;
    buttonObserver = new MutationObserver(() => {
      if (!document.getElementById(BUTTON_ID)) ensureButton();
    });
    buttonObserver.observe(document.body, { childList: true });
  }

  function boot() {
    updateViewportVars();
    ensureButton();
    keepButtonVisible();
    bindLiveUpdates();
    observeButton();
  }

  function applyButtonSettings() {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    const cfg = buttonSettings();
    const minSize = window.matchMedia?.('(max-width: 640px)').matches ? 54 : 34;
    const size = Math.max(minSize, Math.min(86, Number(cfg.size) || 46));
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
    keepButtonVisible();
  }

  function applyPanelTheme(root) {
    if (!root) return;
    const cfg = buttonSettings();
    const accent = cfg.accentColor || '#43a047';
    const panel = cfg.panelColor || '#ffffff';
    const text = cfg.textColor || '#233323';
    root.style.setProperty('--npcpv-accent', accent);
    root.style.setProperty('--npcpv-panel', panel);
    root.style.setProperty('--npcpv-text', text);
    root.style.setProperty('--npcpv-soft', `${accent}18`);
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
      const moved = !!buttonDrag?.moved;
      if (moved) {
        const cfg = buttonSettings();
        saveButtonSettings({ ...cfg, x: parseFloat(btn.style.left), y: parseFloat(btn.style.top) });
      } else {
        if (Date.now() - lastButtonOpenAt >= 450) {
          lastButtonOpenAt = Date.now();
          if (document.getElementById(PANEL_ID)) {
             closePanel();
          } else {
             openPanel().catch(reportOpenError);
          }
        }
      }
      setTimeout(() => { buttonDrag = null; }, 0);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function reportOpenError(err) {
    console.error('[NPC预览表] 打开面板失败', err);
    alert('NPC预览表打开失败：' + (err?.message || String(err || '未知错误')));
  }

  window.NPCPreviewAPI = {
    syncNow: async () => await syncAiFromChat(null, false),
    
    get: (name) => {
      const reg = registry();
      const item = reg.find(n => n.name === name);
      if (!item) return null;
      const key = keyName(name);
      return {
        id: String(item.id),
        rowIndex: item.id,
        'NPC名称': item.name,
        '势力': item.faction || '',
        '身份': item.identity || '',
        '好感度': Number(getVarSync(VAR_PREFIX + key + '_好感', 0)) || 0,
        '状态': getVarSync(VAR_PREFIX + key + '_状态', 'offline'),
        '心情': getVarSync(VAR_PREFIX + key + '_心情', 'calm'),
        '备注': getVarSync(VAR_PREFIX + key + '_备注', ''),
        ...(extras()[name] || {})
      };
    },

    getValue: (name, key) => {
      const npc = window.NPCPreviewAPI.get(name);
      if (!npc) return '';
      return npc[key] !== undefined ? npc[key] : '';
    },

    update: async (name, data) => {
       const reg = registry();
       let item = reg.find(n => n.name === name);
       if (!item) {
           item = { id: Date.now() + Math.random(), name, faction: '', identity: '' };
           reg.push(item);
       }
       if (data.faction !== undefined) item.faction = data.faction;
       if (data.identity !== undefined) item.identity = data.identity;
       saveRegistry(reg);

       const key = keyName(name);
       if (data.affection !== undefined || data['好感度'] !== undefined) await setVar(VAR_PREFIX + key + '_好感', data.affection ?? data['好感度']);
       if (data.status !== undefined || data['状态'] !== undefined) await setVar(VAR_PREFIX + key + '_状态', data.status ?? data['状态']);
       if (data.mood !== undefined || data['心情'] !== undefined) await setVar(VAR_PREFIX + key + '_心情', data.mood ?? data['心情']);
       if (data.notes !== undefined || data['备注'] !== undefined) await setVar(VAR_PREFIX + key + '_备注', data.notes ?? data['备注']);
       
       await loadRows();
       render();
    },

    list: () => {
       return registry().map(n => window.NPCPreviewAPI.get(n.name)).filter(Boolean);
    }
  };

  window.NPCPreviewOpen = openPanel;
  boot();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  window.addEventListener('resize', () => { updateViewportVars(); keepButtonVisible(); });
  window.visualViewport?.addEventListener('resize', () => { updateViewportVars(); keepButtonVisible(); });
  window.visualViewport?.addEventListener('scroll', () => { updateViewportVars(); keepButtonVisible(); });
  setTimeout(boot, 500);
  setTimeout(boot, 2000);
  setTimeout(boot, 6000);
  setTimeout(bindLiveUpdates, 3000);
})();