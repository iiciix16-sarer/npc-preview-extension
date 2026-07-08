(function () {
  'use strict';

  // --- 样式自动注入 ---
  const style = document.createElement('style');
  style.innerHTML = `
    .npcpv-root { position: fixed !important; z-index: 2147483647 !important; }
    .npcpv-open-button { position: fixed !important; z-index: 2147483647 !important; }
    .npcpv-loading-overlay { position: absolute; inset: 0; background: rgba(255,255,255,0.6); backdrop-filter: blur(4px); z-index: 1000; display: flex; flex-direction: column; align-items: center; justify-content: center; transition: opacity 0.3s; opacity: 0; pointer-events: none; border-radius: 14px; }
    .npcpv-loading-overlay.active { opacity: 1; pointer-events: auto; }
    .npcpv-spinner { width: 36px; height: 36px; border: 4px solid var(--npcpv-accent); border-top-color: transparent; border-radius: 50%; animation: npcpv-spin 1s linear infinite; }
    @keyframes npcpv-spin { to { transform: rotate(360deg); } }
    .npcpv-loading-text { margin-top: 12px; font-size: 13px; font-weight: bold; color: var(--npcpv-accent); }
    .npcpv-toast { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%) translateY(20px); background: #323232; color: #fff; padding: 10px 24px; border-radius: 24px; font-size: 13px; font-weight: 500; opacity: 0; transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); z-index: 2147483647; pointer-events: none; box-shadow: 0 4px 16px rgba(0,0,0,0.2); text-align: center; }
    .npcpv-toast.show { transform: translateX(-50%) translateY(0); opacity: 1; }
    
    .npcpv-node.clickable { cursor: pointer; transition: transform 0.2s; }
    .npcpv-node.clickable:hover { transform: scale(1.1); }
    .npcpv-node.clickable circle { fill: #fff; stroke: var(--npcpv-accent); stroke-width: 2; transition: fill 0.2s; }
    .npcpv-node.clickable:hover circle { fill: var(--npcpv-soft); }
    .npcpv-edge-label { fill: #6e826e; font-size: 8.5px; font-weight: bold; pointer-events: none; }
    
    .npcpv-api-docs { background: #fbfdfb; border: 1px solid #dcebdc; border-radius: 8px; margin-bottom: 14px; font-size: 12px; overflow: hidden; }
    .npcpv-api-docs summary { padding: 10px 12px; font-weight: 800; cursor: pointer; outline: none; user-select: none; color: var(--npcpv-accent); background: var(--npcpv-soft); transition: background 0.2s; }
    .npcpv-api-docs summary:hover { background: #e8f5e9; }
    .npcpv-doc-content { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .npcpv-doc-content code { background: #f1f8f2; padding: 6px 10px; border-radius: 6px; font-family: monospace; color: #2e7d32; user-select: all; border: 1px dashed #cfe5d0; }
    .npcpv-doc-desc { color: #6e826e; font-size: 11px; margin-bottom: 2px; }
    .npcpv-import-row { display: grid; grid-template-columns: minmax(72px, .8fr) minmax(72px, .8fr) minmax(160px, 1.8fr); gap: 6px; align-items: start; border: 1px solid #e5efe5; border-radius: 7px; padding: 6px 8px; background: #fbfdfb; color: #5f735f; font-size: 12px; margin-bottom:4px; }
    .npcpv-import-row b { overflow-wrap: anywhere; color: var(--npcpv-accent, #2e7d32); }
    .npcpv-import-preview { max-height: 190px; overflow: auto; margin-top:10px; }
  `;
  document.head.appendChild(style);

  const PANEL_ID = 'npc-preview-modal';
  const BUTTON_ID = 'npc-preview-open';
  const VAR_PREFIX = 'NPC_';
  const REG_PREFIX = 'npc_preview_registry_';
  const AVATAR_PREFIX = 'npc_preview_avatars_';
  const SETTINGS_PREFIX = 'npc_preview_settings_';
  const EXTRA_PREFIX = 'npc_preview_extra_';

  const STATUSES = [
    ['offline', '离线', '#9e9e9e'],
    ['online', '在线', '#43a047'],
    ['away', '忙碌', '#f9a825'],
    ['danger', '危险', '#e53935'],
    ['missing', '失踪', '#6d4c41'],
  ];

  const MOODS = [
    ['calm', '平静', '😐'], ['happy', '愉悦', '😆'], ['angry', '愤怒', '😤'],
    ['sad', '悲伤', '😿'], ['fear', '恐惧', '😱'], ['love', '爱意', '❤️'],
    ['jealous', '嫉妒', '👿'], ['annoyed', '烦躁', '😾'], ['excited', '兴奋', '🤩'],
    ['shy', '害羞', '😳'], ['guilty', '心虚', '🫢'], ['cold', '冷漠', '🧊'],
  ];

  let rows = [];
  let selectedId = null;
  let filter = '全部';
  let query = '';
  let buttonDrag = null;
  let chatCompletionCount = 0;
  
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
  
  function buttonSettings() { return parse(localStorage.getItem(SETTINGS_PREFIX + 'global') || 'null', defaultSettings()) || defaultSettings(); }
  function saveButtonSettings(value) { localStorage.setItem(SETTINGS_PREFIX + 'global', JSON.stringify(value)); }

  function getVarSync(key, fallback) {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (ctx?.chatMetadata && ctx.chatMetadata[key] !== undefined && ctx.chatMetadata[key] !== '') {
        return ctx.chatMetadata[key];
      }
    } catch (_) {}
    const val = localStorage.getItem(ctxKey('npcv_' + key + '_'));
    return val != null && val !== '' ? val : fallback;
  }

  function setVarSync(key, value) {
    try {
      const ctx = window.SillyTavern?.getContext?.();
      if (ctx?.chatMetadata) {
        ctx.chatMetadata[key] = value;
        if (ctx.saveMetadata) ctx.saveMetadata();
      }
    } catch (_) {}
    localStorage.setItem(ctxKey('npcv_' + key + '_'), String(value));
  }

  window.NPCPreviewAPI = {
    get: function(name) {
       const reg = registry().find(r => r.name === name);
       if(!reg) return null;
       const key = keyName(name);
       return {
          'NPC名称': name,
          '势力': reg.faction,
          '身份': reg.identity,
          '好感度': Number(getVarSync(VAR_PREFIX + key + '_好感', 0)),
          '状态': getVarSync(VAR_PREFIX + key + '_状态', 'offline'),
          '心情': getVarSync(VAR_PREFIX + key + '_心情', 'calm'),
          '备注': getVarSync(VAR_PREFIX + key + '_备注', ''),
          '首次登场': getVarSync(VAR_PREFIX + key + '_初见', ''),
          '登场事件': getVarSync(VAR_PREFIX + key + '_事件', ''),
          'NPC关系': getVarSync(VAR_PREFIX + key + '_关系', ''),
          '好感历史': getVarSync(VAR_PREFIX + key + '_历史', '[]')
       };
    },
    getValue: function(name, keyAttr) {
       if(keyAttr === 'NPC名称') return name;
       const reg = registry().find(r => r.name === name);
       if(!reg) return '';
       if(keyAttr === '势力') return reg.faction;
       if(keyAttr === '身份') return reg.identity;
       
       const attrMap = { '好感度': '_好感', '状态': '_状态', '心情': '_心情', '备注': '_备注', '首次登场': '_初见', '登场事件': '_事件', 'NPC关系': '_关系' };
       const suffix = attrMap[keyAttr];
       if(!suffix) return '';
       return getVarSync(VAR_PREFIX + keyName(name) + suffix, keyAttr==='好感度'?0:'');
    },
    update: function(name, dataObj) {
       const reg = registry();
       let item = reg.find(r => r.name === name);
       if(!item) {
          item = { id: Date.now()+Math.random(), name: name, faction: dataObj['势力']||'', identity: dataObj['身份']||'' };
          reg.push(item);
       } else {
          if(dataObj['势力'] !== undefined) item.faction = dataObj['势力'];
          if(dataObj['身份'] !== undefined) item.identity = dataObj['身份'];
       }
       saveRegistry(reg);
       
       const key = keyName(name);
       const attrMap = { '好感度': '_好感', '状态': '_状态', '心情': '_心情', '备注': '_备注', '首次登场': '_初见', '登场事件': '_事件', 'NPC关系': '_关系', '关系': '_关系' };
       for(let k in attrMap) {
          if(dataObj[k] !== undefined && dataObj[k] !== null && dataObj[k] !== '') {
              setVarSync(VAR_PREFIX + key + attrMap[k], dataObj[k]);
          }
       }
       loadRowsSync();
       render();
    },
    syncNow: async function() {
       await doAISync(false);
    },
    list: function() { return registry().map(r => r.name); }
  };



  function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'npcpv-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 20);
    setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 400);
    }, 3000);
  }

  function toggleLoading(active, text = '正在分析剧情...') {
     const overlay = document.getElementById('npcpv-loading');
     if(!overlay) return;
     if(active) {
        overlay.querySelector('.npcpv-loading-text').textContent = text;
        overlay.classList.add('active');
     } else {
        overlay.classList.remove('active');
     }
  }

  function parseHistory(value) {
    if (Array.isArray(value)) return value;
    return parse(String(value || '[]'), []);
  }

  function parseRelations(relText) {
     const links = [];
     if(!relText) return links;
     const regex = /([^\(（、，,;；\n]+)(?:[\(（]([^)）]+)[\)）])?/g;
     let match;
     while ((match = regex.exec(relText)) !== null) {
         const name = match[1].trim();
         if(name && name.length < 20) links.push({ name: name, label: (match[2]||'相关').trim() });
     }
     return links;
  }

  // 计算好感度颜色的辅助函数 (原代码中似乎漏了这个定义，我补充一个简单的渐变器防止报错)
  function affectionColor(aff) {
    if (aff > 50) return '#e91e63'; // 高好感 粉红
    if (aff > 0) return '#4caf50';  // 正好感 绿色
    if (aff < -50) return '#d32f2f';// 极低好感 深红
    if (aff < 0) return '#ff9800';  // 负好感 橙色
    return '#9e9e9e'; // 0
  }

  function statusOf(st) {
    const found = STATUSES.find(s => s[0] === st);
    return found || STATUSES[0];
  }

  function relationGraphHtml(selected) {
    const names = registry().map(r => r.name);
    const relText = getVarSync(VAR_PREFIX + keyName(selected['NPC名称']) + '_关系', '');
    const links = parseRelations(relText);
    const validLinks = links.filter(l => names.includes(l.name)).slice(0, 8);
    
    if (!validLinks.length) return '<div class="npcpv-empty compact">暂无网状关系。<br>由AI自动记录，或输入：名字(关系)</div>';
    
    const center = { x: 130, y: 85 };
    const r = 62;
    
    const positions = validLinks.map((l, i) => {
        const angle = (i / validLinks.length) * Math.PI * 2 - Math.PI/2;
        return { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r, name: l.name, label: l.label };
    });
    
    const lines = positions.map(p => {
        const midX = (center.x + p.x)/2;
        const midY = (center.y + p.y)/2;
        let color = '#bdbdbd';
        if (['宿敌','仇人','敌对','讨厌','嫉妒','仇视'].includes(p.label)) color = '#e53935';
        if (['挚友','情侣','喜欢','爱慕','贴贴','爱意','暗恋'].includes(p.label)) color = '#e91e63';
        if (['手下','上司','同僚','主仆','师徒','从属'].includes(p.label)) color = '#1e88e5';
        
        return `<line x1="${center.x}" y1="${center.y}" x2="${p.x}" y2="${p.y}" stroke="${color}" stroke-width="1.5"></line>
                <rect x="${midX-16}" y="${midY-7}" width="32" height="14" fill="#ffffff" rx="3" stroke="${color}" stroke-width="0.5"></rect>
                <text x="${midX}" y="${midY+3}" text-anchor="middle" style="fill:${color};font-size:8px;font-weight:bold;">${esc(p.label).slice(0,4)}</text>`;
    }).join('');
    
    const circles = positions.map(p => `
        <g class="npcpv-node clickable" data-npc="${esc(p.name)}">
          <circle cx="${p.x}" cy="${p.y}" r="18"></circle>
          <text x="${p.x}" y="${p.y+4}" text-anchor="middle" style="font-size:9px;fill:var(--npcpv-text);">${esc(p.name).slice(0,4)}</text>
        </g>`).join('');
        
    const centerCircle = `
        <g>
          <circle cx="${center.x}" cy="${center.y}" r="24" style="fill:var(--npcpv-accent);stroke:none;"></circle>
          <text x="${center.x}" y="${center.y+4}" text-anchor="middle" style="fill:#ffffff;font-size:10px;font-weight:bold;">${esc(selected['NPC名称']).slice(0,4)}</text>
        </g>`;

    return `<svg class="npcpv-graph" viewBox="0 0 260 170" style="background:#fbfdfb;border:1px solid #e3f2fd;border-radius:8px;margin-top:8px;width:100%;height:170px;">${lines}${circles}${centerCircle}</svg>`;
  }

  function getChatTextForAi() {
    try {
      const th = window.TavernHelper;
      if (th?.getLastMessageId && th?.getChatMessages) {
        const last = th.getLastMessageId();
        const messages = th.getChatMessages(`0-${last}`, { include_swipes: false }) || [];
        return messages.slice(-25).map(m => `${m.is_user?'User':'Char'}: ${m.message || m.mes || m.content || ''}`).join('\n\n');
      }
      const ctx = window.SillyTavern?.getContext?.();
      if (Array.isArray(ctx?.chat)) return ctx.chat.slice(-25).map(m => `${m.is_user?'User':'Char'}: ${m.mes || m.message || m.content || ''}`).join('\n\n');
    } catch (err) { console.warn('[NPC预览表] 提取聊天记录失败', err); }
    return '';
  }

  async function doAISync(isSilent = false) {
    const cfg = buttonSettings();
    if (!cfg.apiKey) {
       if(!isSilent) showToast('请点击 API与说明 按钮，配置你的 API Key 后再同步');
       return;
    }
    
    const chat = getChatTextForAi();
    if (!chat) {
       if(!isSilent) showToast('未读取到聊天记录，请确认当前已进入对话界面');
       return;
    }

    if(!isSilent) toggleLoading(true, '剧情扫描中,请稍候...');

    // 【核心修复】：自动检测并补全 '/chat/completions' 路径
    let targetUrl = cfg.apiUrl.trim();
    if (!targetUrl.endsWith('/chat/completions')) {
        targetUrl = targetUrl.replace(/\/+$/, '') + '/chat/completions';
    }

    const systemPrompt = `你是NPC状态判定器。仅输出纯JSON数组，绝对不要有任何解释或markdown格式。
数组对象允许使用中文或对应英文键名：NPC名称(name), 势力(faction), 身份(identity), 好感度(affection, 必须是数字), 状态(status: online/offline/away/danger/missing), 心情(mood: calm/happy/angry/sad/love/fear/excited/shy/guilty/cold), 备注(notes), 首次登场(first_seen), 登场事件(first_event), NPC关系(relations)。
【极其重要】：NPC关系(relations) 字段必须严格使用"名字(关系标签)"格式，并用顿号或逗号分隔。例如："李四(挚友)、王五(宿敌)"。
若某NPC未在近期被提及，不要返回。`;
    
    try {
       // 这里使用拼接好的 targetUrl 
       const res = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({
             model: cfg.apiModel || 'gpt-3.5-turbo',
             messages: [
               { role: 'system', content: systemPrompt },
               { role: 'user', content: `请提取以下最新对话中出现的NPC状态变化：\n\n${chat}` }
             ],
             temperature: 0.2
          })
       });
       
      if (!res.ok) {
           const errText = await res.text();
           console.error('[NPC预览表] API 请求失败:', res.status, errText);
           // 新增：直接在手机屏幕上弹窗显示 API 接口的详细报错
           if (!isSilent) alert(`API 请求失败 (HTTP ${res.status})\n\n错误详情:\n${errText.substring(0, 300)}`);
           throw new Error(`HTTP ${res.status}`);
       }

       const json = await res.json();
       const responseText = json.choices?.[0]?.message?.content || '';
       
       let list = [];
       try { 
           const raw = responseText.match(/\[[\s\S]*\]/)?.[0] || responseText;
           list = JSON.parse(raw); 
      } catch(e) { 
           console.error('[NPC预览表] JSON解析失败，大模型返回的原文是:', responseText);
           if(!isSilent) {
               // 新增：直接弹窗展示大模型原本吐出来的完整文本，方便你检查到底哪里没对齐格式
               alert(`AI返回格式有误，解析失败！\n\n大模型实际返回的原文是：\n\n${responseText.substring(0, 600)}`);
           }
           toggleLoading(false); return; 
       }
       
       if(!Array.isArray(list)) { toggleLoading(false); return; }
       
       let count = 0;
       for (const item of list) {
          const npcName = item['NPC名称'] || item['name'] || item['npc_name'];
          if (!npcName) continue;

          window.NPCPreviewAPI.update(npcName, {
             '势力': item['势力'] || item['faction'],
             '身份': item['身份'] || item['identity'],
             '好感度': item['好感度'] ?? item['affection'] ?? item['score'],
             '状态': item['状态'] || item['status'],
             '心情': item['心情'] || item['mood'],
             '备注': item['备注'] || item['notes'] || item['note'],
             '首次登场': item['首次登场'] || item['first_seen'],
             '登场事件': item['登场事件'] || item['first_event'],
             '关系': item['NPC关系'] || item['relations'] || item['relation']
          });
          count++;
       }
       
       toggleLoading(false);
       if(!isSilent) showToast(`状态刷新成功！更新了 ${count} 位 NPC 变量`);
    } catch(err) {
       toggleLoading(false);
       if(!isSilent) showToast('请求失败：' + (err.message || '网络或跨域错误'));
       console.error('[NPC预览表] 请求抛出异常:', err);
    }
  }

  function loadRowsSync() {
    const result = [];
    const ex = extras();
    for (const npc of registry()) {
      const key = keyName(npc.name);
      result.push({
        id: String(npc.id),
        'NPC名称': npc.name,
        '势力': npc.faction || '',
        '身份': npc.identity || '',
        '好感度': Number(getVarSync(VAR_PREFIX + key + '_好感', 0)) || 0,
        '状态': getVarSync(VAR_PREFIX + key + '_状态', 'offline'),
        '心情': getVarSync(VAR_PREFIX + key + '_心情', 'calm'),
        '备注': getVarSync(VAR_PREFIX + key + '_备注', ''),
        '首次登场': getVarSync(VAR_PREFIX + key + '_初见', ''),
        '登场事件': getVarSync(VAR_PREFIX + key + '_事件', ''),
        'NPC关系': getVarSync(VAR_PREFIX + key + '_关系', ''),
        '历史': parseHistory(getVarSync(VAR_PREFIX + key + '_历史', '[]'))
      });
    }
    rows = result.sort((a, b) => (ex[a['NPC名称']]?.order ?? 999) - (ex[b['NPC名称']]?.order ?? 999));
  }

  function writeField(row, field, value) {
     const key = keyName(row['NPC名称']);
     const reg = registry();
     const item = reg.find(n => n.name === row['NPC名称']);
     
     if (item && (field === '势力' || field === '身份')) {
        if (field === '势力') item.faction = value;
        if (field === '身份') item.identity = value;
        saveRegistry(reg);
     }
     
     const attrMap = { '好感度': '_好感', '状态': '_状态', '心情': '_心情', '备注': '_备注', '首次登场': '_初见', '登场事件': '_事件', '关系': '_关系' };
     if(attrMap[field]) setVarSync(VAR_PREFIX + key + attrMap[field], value);
     
     if (field === '好感度') {
         const history = parseHistory(getVarSync(VAR_PREFIX + key + '_历史', '[]'));
         history.push({ time: new Date().toISOString(), value: Number(value) || 0 });
         setVarSync(VAR_PREFIX + key + '_历史', JSON.stringify(history.slice(-80)));
     }
     
     loadRowsSync();
     render();
  }

  function toggleGroup(name) {
    const cfg = buttonSettings();
    const collapsedGroups = { ...(cfg.collapsedGroups || {}) };
    collapsedGroups[name] = !collapsedGroups[name];
    saveButtonSettings({ ...cfg, collapsedGroups });
  }

  function filteredRows() {
    const q = query.trim().toLowerCase();
    let list = rows;
    if (filter !== '全部') list = list.filter(r => (r['势力'] || '未分组') === filter);
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
    for (const row of filteredRows()) {
      const group = row['势力'] || '未分组';
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group).push(row);
    }
    if (!grouped.size) return '<div class="npcpv-empty" style="grid-column:1/-1">未检索到NPC档案<br>点击右上角「批量导入」添加数据</div>';
    return Array.from(grouped.entries()).map(([group, list]) => `<div class="npcpv-group"><button class="npcpv-group-title" data-group="${esc(group)}">${collapsed[group] ? '▸' : '▾'} ${esc(group)} <span>${list.length}</span></button><div class="npcpv-group-cards ${collapsed[group] ? 'collapsed' : ''}">${list.map(r => cardHtml(r, selected && String(r.id) === String(selected.id))).join('')}</div></div>`).join('');
  }

  function detailHtml(row) {
    const name = row['NPC名称'] || '?';
    const aff = Number(row['好感度']) || 0;
    const avatar = avatars()[name];
    
    return `<button class="npcpv-btn npcpv-back-btn" data-action="back-to-list">⬅ 返回名册</button>
    <div class="npcpv-profile"><div class="npcpv-big-avatar" data-action="avatar">${avatar ? `<img src="${avatar}">` : esc(name[0] || '?')}<span>换头像</span></div><div class="npcpv-profile-text"><div class="npcpv-main-name">${esc(name)}</div><div class="npcpv-main-sub">${esc(row['势力'] || '未分组')}</div><div class="npcpv-main-sub long">${esc(row['身份'] || '')}</div></div></div>
    
    <div class="npcpv-section"><div class="npcpv-label">阵营/势力</div><input class="npcpv-input" data-action="faction" value="${esc(row['势力'] || '')}" placeholder="例如：调查局、魔法学院..."></div>
    <div class="npcpv-section"><div class="npcpv-label">身份特征</div><textarea class="npcpv-textarea npcpv-identity" data-action="identity" placeholder="一句话描述人设">${esc(row['身份'] || '')}</textarea></div>
    
    <div class="npcpv-section"><div class="npcpv-label">好感度</div>
    <div class="npcpv-aff"><div class="npcpv-affbar"><div class="npcpv-afffill" style="width:${Math.min(Math.abs(aff),100)}%;background:${affectionColor(aff)}"></div></div><div class="npcpv-affval" style="color:${affectionColor(aff)}">${aff}</div></div>
    <div class="npcpv-ctrls">${[-10,-5,-1,1,5,10].map(n => `<button class="npcpv-btn" data-action="aff" data-delta="${n}">${n > 0 ? '+' : ''}${n}</button>`).join('')}</div></div>
    
    <div class="npcpv-section"><div class="npcpv-label">当前状态 & 心情</div>
    <div style="display:flex;gap:10px;">
    <select class="npcpv-select" data-action="status">${STATUSES.map(s => `<option value="${s[0]}" ${s[0] === (row['状态'] || 'offline') ? 'selected' : ''}>${s[1]}</option>`).join('')}</select>
    <select class="npcpv-select" data-action="mood">${MOODS.map(m => `<option value="${m[0]}" ${m[0] === (row['心情'] || 'calm') ? 'selected' : ''}>${m[2]} ${m[1]}</option>`).join('')}</select>
    </div></div>
    
    <div class="npcpv-section"><div class="npcpv-label">社交关系网 <span class="npcpv-small">（AI可自动解析）</span></div>
    <textarea class="npcpv-textarea" data-action="relations" placeholder="例如：李四(挚友)、王五(宿敌)">${esc(row['NPC关系'] || '')}</textarea>
    ${relationGraphHtml(row)}
    </div>
    
    <div class="npcpv-section"><div class="npcpv-label">首次登场</div><input class="npcpv-input" data-action="first-seen" value="${esc(row['首次登场'] || '')}" placeholder="第X章 / 某地点"></div>
    <div class="npcpv-section"><div class="npcpv-label">登场事件</div><textarea class="npcpv-textarea" data-action="first-event" placeholder="记录如何相遇的">${esc(row['登场事件'] || '')}</textarea></div>
    <div class="npcpv-section"><div class="npcpv-label">个人私密备注</div><textarea class="npcpv-textarea" data-action="notes" placeholder="记录密码、弱点、未公开情报">${esc(row['备注'] || '')}</textarea></div>
    
    <div class="npcpv-ctrls" style="margin-top:20px;border-top:1px solid #dcebdc;padding-top:14px;"><button class="npcpv-btn danger" data-action="delete">抹除该NPC</button></div>`;
  }

  function render() {
    const root = document.getElementById(PANEL_ID);
    if (!root) return;
    const selected = rows.find(r => String(r.id) === String(selectedId));
    const factions = ['全部', ...Array.from(new Set(rows.map(r => r['势力'] || '未分组').filter(Boolean))).sort()];
    
    const styleAttr = `width:${panelW ? panelW + 'px' : 'min(860px, 92vw)'}; height:${panelH ? panelH + 'px' : 'min(680px, 88vh)'}; left:${panelX}px; top:${panelY}px; transform: none !important; margin: 0;`;
    const viewClass = selected ? 'view-detail' : 'view-list';
    
    root.innerHTML = `<div class="npcpv-root ${viewClass}" style="${styleAttr}"><div class="npcpv-modal">
      <div class="npcpv-header">
         <div class="npcpv-title">NPC 面板 <span class="npcpv-mode">纯变量引擎</span></div>
         <div class="npcpv-actions">
           <button class="npcpv-btn primary" data-action="api-settings">🔌 API与说明</button>
           <button class="npcpv-btn danger" data-action="clear-all">清空</button>
           <button class="npcpv-close" data-action="close">×</button>
         </div>
      </div>
      <div class="npcpv-body">
         <div class="npcpv-list">
           <input class="npcpv-search" value="${esc(query)}" placeholder="搜索名册..." data-action="search">
           <div class="npcpv-filters">${factions.map(f => `<button class="npcpv-chip ${f === filter ? 'active' : ''}" data-filter="${esc(f)}">${esc(f)}</button>`).join('')}</div>
           <div class="npcpv-cards">${cardsHtml(selected)}</div>
         </div>
         <div class="npcpv-detail">${selected ? detailHtml(selected) : '<div class="npcpv-empty">选择左侧NPC查看情报<br>开始掌控你的世界</div>'}</div>
      </div>
      <div id="npcpv-loading" class="npcpv-loading-overlay"><div class="npcpv-spinner"></div><div class="npcpv-loading-text">正在分析剧情...</div></div>
    </div></div>`;
    
    applyPanelTheme(root);
    bindEvents(root);
  }

  function bindEvents(root) {
    const selected = rows.find(r => String(r.id) === String(selectedId));
    
    root.querySelector('.npcpv-root')?.addEventListener('pointerdown', startPanelDrag);
    root.querySelector('[data-action="close"]')?.addEventListener('click', closePanel);
    root.querySelector('[data-action="back-to-list"]')?.addEventListener('click', () => { selectedId = null; render(); });
    root.querySelector('[data-action="clear-all"]')?.addEventListener('click', () => { if(confirm('彻底抹除所有NPC变量？')) { saveRegistry([]); loadRowsSync(); render(); } });
    root.querySelector('[data-action="api-settings"]')?.addEventListener('click', showApiDocsDialog);
    
    root.querySelector('[data-action="search"]')?.addEventListener('input', e => { query = e.target.value; render(); });
    root.querySelectorAll('[data-filter]').forEach(btn => btn.addEventListener('click', () => { filter = btn.dataset.filter; render(); }));
    root.querySelectorAll('[data-group]').forEach(btn => {
      btn.addEventListener('click', () => { 
         toggleGroup(btn.dataset.group); 
         loadRowsSync();
         render(); 
      });
    });
    
    root.querySelectorAll('.npcpv-card').forEach(card => {
      card.addEventListener('click', () => { selectedId = card.dataset.id; render(); });
      card.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', card.dataset.id));
      card.addEventListener('dragover', e => e.preventDefault());
      card.addEventListener('drop', e => { e.preventDefault(); reorderNpc(e.dataTransfer.getData('text/plain'), card.dataset.id); });
    });
    
    // Wiki式穿透点击跳转
    root.querySelectorAll('.npcpv-node.clickable').forEach(node => {
      node.addEventListener('click', () => {
         const tName = node.getAttribute('data-npc');
         const tNpc = rows.find(r => r['NPC名称'] === tName);
         if(tNpc) { selectedId = tNpc.id; render(); }
         else showToast(`系统内暂无名为 [${tName}] 的独立档案`);
      });
    });

    if (!selected) return;
    root.querySelectorAll('[data-action="aff"]').forEach(btn => btn.addEventListener('click', () => writeField(selected, '好感度', Math.max(-100, Math.min(100, (Number(selected['好感度']) || 0) + Number(btn.dataset.delta))))));
    root.querySelector('[data-action="status"]')?.addEventListener('change', e => writeField(selected, '状态', e.target.value));
    root.querySelector('[data-action="mood"]')?.addEventListener('change', e => writeField(selected, '心情', e.target.value));
    
    let timer;
    const bindInput = (action, field) => {
      root.querySelector(`[data-action="${action}"]`)?.addEventListener('input', e => {
         clearTimeout(timer); 
         timer = setTimeout(() => writeField(selected, field, e.target.value), 400);
      });
    };
    bindInput('faction', '势力');
    bindInput('identity', '身份');
    bindInput('first-seen', '首次登场');
    bindInput('first-event', '登场事件');
    bindInput('relations', '关系');
    bindInput('notes', '备注');
    
    root.querySelector('[data-action="delete"]')?.addEventListener('click', () => { 
        if (confirm('确认抹除该NPC所有记录？')) {
           saveRegistry(registry().filter(n => String(n.id) !== String(selected.id)));
           selectedId = null; loadRowsSync(); render();
        } 
    });
    root.querySelector('[data-action="avatar"]')?.addEventListener('click', () => uploadAvatar(selected));
  }

  function reorderNpc(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    const visible = [...filteredRows()].sort((a, b) => (extras()[a['NPC名称']]?.order ?? 999) - (extras()[b['NPC名称']]?.order ?? 999));
    const fIdx = visible.findIndex(r => String(r.id) === String(fromId));
    const tIdx = visible.findIndex(r => String(r.id) === String(toId));
    if (fIdx < 0 || tIdx < 0) return;
    const moved = visible.splice(fIdx, 1)[0];
    visible.splice(tIdx, 0, moved);
    const all = extras();
    visible.forEach((row, index) => { all[row['NPC名称']] = { ...(all[row['NPC名称']] || {}), order: index }; });
    saveExtras(all);
    loadRowsSync();
    render();
  }

  function normalizeName(value) { return String(value || '').replace(/[《》【】\[\]「」『』“”"'`]/g, '').replace(/\s+/g, '').trim(); }
  function splitNames(value) { return String(value || '').replace(/[\[\]【】]/g, '\n').split(/[、,，/|；;\n\r]+/).map(v => v.replace(/^\s*(?:[-*•]|\d+[.、])\s*/g, '').replace(/(?:身份|势力|阵营|组织|职业|职位|职务|定位)\s*[:：].*$/g, '').trim()).filter(Boolean); }
  function inferFaction(text) { const m = String(text || '').match(/(?:势力|阵营|组织|所属)\s*[:：]\s*([^，。；;\n]{1,16})/); return m ? m[1].trim() : ''; }
  function inferIdentity(text) { const m = String(text || '').match(/(?:身份|职位|职业|职务|定位)\s*[:：]\s*([^\n]{1,180})/); return m ? m[1].trim() : ''; }
  
  function addCandidate(map, name, sourceText) {
    const clean = normalizeName(name);
    if (!clean || clean.length < 2 || clean.length > 18) return;
    if (/^(用户|玩家|主角|你|我|他|她|它|众人|路人|角色|人物|NPC|名称|姓名|名字|NPC名称|NPC姓名|NPC名字|身份|势力|user|使用者)$/i.test(clean)) return;
    if (!/[\u4e00-\u9fffA-Za-z]/.test(clean)) return;
    if (!map.has(clean)) map.set(clean, { name: clean, faction: inferFaction(sourceText), identity: inferIdentity(sourceText) });
    const item = map.get(clean);
    item.faction = item.faction || inferFaction(sourceText);
    item.identity = item.identity || inferIdentity(sourceText);
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

  function previewImportHtml(items) {
    if (!items.length) return '<div class="npcpv-empty compact" style="margin-top:10px;">未解析到可导入的NPC名字</div>';
    return items.map(item => `<div class="npcpv-import-row"><b>${esc(item.name)}</b><span>${esc(item.faction || '未识别势力')}</span><span>${esc(item.identity || '未识别身份')}</span></div>`).join('');
  }

  function showApiDocsDialog() {
    const cfg = buttonSettings();
    showSubDialog(`
      <h3>🔌 状态扫描器与配置</h3>
      <div class="npcpv-api-docs">
        <details>
          <summary>👨‍💻 开发者控制台 (酒馆宏调用代码)</summary>
          <div class="npcpv-doc-content">
            <div class="npcpv-doc-desc">将以下代码直接粘贴至「快速回复」或宏指令中，可实现纯同步瞬间读取：</div>
            <code>{{//javascript NPCPreviewAPI.getValue('张三', '好感度')}}</code>
            <code>{{//javascript NPCPreviewAPI.getValue('张三', '状态')}}</code>
            <code>{{//javascript NPCPreviewAPI.getValue('张三', 'NPC关系')}}</code>
            <div class="npcpv-doc-desc" style="margin-top:6px;">静默后台修改属性 (立刻生效并刷新面板)：</div>
            <code>NPCPreviewAPI.update('张三', {'好感度': 80, '心情': 'happy'})</code>
          </div>
        </details>
      </div>
      
      <div class="npcpv-form" style="margin-top:14px; border-top:1px solid #eee; padding-top:14px;">
        <label class="npcpv-label">模型 API </label>
        <input class="npcpv-input" id="cfg-url" placeholder="API Base URL" value="${esc(cfg.apiUrl)}">
        <input class="npcpv-input" id="cfg-key" type="password" placeholder="API Key (sk-...)" value="${esc(cfg.apiKey)}">
        <input class="npcpv-input" id="cfg-model" placeholder="Model (例如 gpt-4o-mini)" value="${esc(cfg.apiModel)}">
        
        <label class="npcpv-label" style="margin-top:8px;">后台自动同步间隔 (聊天轮次)</label>
        <input class="npcpv-input" id="cfg-interval" type="number" min="0" max="100" value="${cfg.autoSyncInterval}" placeholder="设为 0 则关闭自动同步">
        <div class="npcpv-small">设为 0 仅保留下方手动分析。设为 N，则每聊 N 句话插件自动静默调用上述 API。</div>
        
        <label class="npcpv-label" style="margin-top:14px; border-top:1px solid #eee; padding-top:14px;">🎨 悬浮球与面板外观</label>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <input class="npcpv-input" id="cfg-btn-text" placeholder="按钮文字" value="${esc(cfg.text)}" style="width:45%;">
            <div style="display:flex; align-items:center; width:45%; gap:5px;"><label class="npcpv-small">按钮</label><input class="npcpv-input" id="cfg-btn-color" type="color" value="${esc(cfg.color)}" style="padding:2px; height:28px;"></div>
            <div style="display:flex; align-items:center; width:30%; gap:5px;"><label class="npcpv-small">主色</label><input class="npcpv-input" id="cfg-accent" type="color" value="${esc(cfg.accentColor)}" style="padding:2px; height:28px;"></div>
            <div style="display:flex; align-items:center; width:30%; gap:5px;"><label class="npcpv-small">背景</label><input class="npcpv-input" id="cfg-panel" type="color" value="${esc(cfg.panelColor)}" style="padding:2px; height:28px;"></div>
            <div style="display:flex; align-items:center; width:30%; gap:5px;"><label class="npcpv-small">文字</label><input class="npcpv-input" id="cfg-text" type="color" value="${esc(cfg.textColor)}" style="padding:2px; height:28px;"></div>
        </div>
        <label class="npcpv-small" style="margin-top:4px;">按钮尺寸: <span id="cfg-size-val">${cfg.size}</span>px</label>
        <input class="npcpv-range" id="cfg-size" type="range" min="34" max="86" value="${cfg.size}">
      </div>
      
      <div class="npcpv-dialog-actions" style="margin-top:20px; justify-content: space-between;">
        <button class="npcpv-btn" id="cfg-manual-sync" style="background:#e3f2fd; color:#1976d2; border-color:#bbdefb;">⚡ 立即手动提取一次</button>
        <div style="display:flex; gap:8px;">
           <button class="npcpv-btn" data-subclose="1">取消</button>
           <button class="npcpv-btn primary" id="cfg-save">保存配置</button>
        </div>
      </div>
    `, () => {
      const sizeInput = document.getElementById('cfg-size');
      const sizeVal = document.getElementById('cfg-size-val');
      sizeInput.oninput = () => sizeVal.textContent = sizeInput.value;

      document.getElementById('cfg-save').onclick = () => {
         saveButtonSettings({
            ...buttonSettings(),
            apiUrl: document.getElementById('cfg-url').value.trim(),
            apiKey: document.getElementById('cfg-key').value.trim(),
            apiModel: document.getElementById('cfg-model').value.trim(),
            autoSyncInterval: parseInt(document.getElementById('cfg-interval').value) || 0,
            text: document.getElementById('cfg-btn-text').value.trim() || 'NPC',
            color: document.getElementById('cfg-btn-color').value,
            accentColor: document.getElementById('cfg-accent').value,
            panelColor: document.getElementById('cfg-panel').value,
            textColor: document.getElementById('cfg-text').value,
            size: Number(document.getElementById('cfg-size').value) || 46
         });
         applyButtonSettings();
         applyPanelTheme(document.getElementById(PANEL_ID));
         closeSubDialog();
         showToast('系统配置已生效');
      };
      document.getElementById('cfg-manual-sync').onclick = () => {
         closeSubDialog();
         doAISync(false);
      };
    });
  }

  function showSubDialog(html, after) {
    const root = document.getElementById(PANEL_ID);
    const div = document.createElement('div');
    div.className = 'npcpv-modal-sub';
    div.id = 'npcpv-subdialog';
    div.innerHTML = `<div class="npcpv-dialog">${html}</div>`;
    root.querySelector('.npcpv-root').appendChild(div);
    div.querySelectorAll('[data-subclose]').forEach(b => b.addEventListener('click', () => div.remove()));
    if (after) after();
  }
  function closeSubDialog() { document.getElementById('npcpv-subdialog')?.remove(); }

  function uploadAvatar(item) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 220; canvas.height = 220;
          const ctx = canvas.getContext('2d');
          const min = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - min)/2, (img.height - min)/2, min, min, 0, 0, 220, 220);
          const av = avatars(); av[item['NPC名称']] = canvas.toDataURL('image/jpeg', 0.82);
          saveAvatars(av); loadRowsSync(); render();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

 function startPanelDrag(e) {
    if (['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'DETAILS', 'SUMMARY', 'CODE'].includes(e.target.tagName)) return;
    if (e.target.closest('.npcpv-card, .npcpv-chip, .npcpv-close, .npcpv-actions, .clickable, code, #npcpv-subdialog')) return;
    
    const win = document.querySelector('.npcpv-root');
    if (!win) return;
    let pressTimer = null, isDragging = false;
    const startX = e.clientX, startY = e.clientY;
    
    const triggerDrag = () => {
      isDragging = true; win.style.opacity = '0.9'; navigator.vibrate?.(30);
      panelDrag = { startX, startY, left: parseFloat(win.style.left)||0, top: parseFloat(win.style.top)||0 };
      win.setPointerCapture?.(e.pointerId);
    };
    pressTimer = setTimeout(triggerDrag, 250);

    const move = ev => {
      if (!isDragging) { if (Math.abs(ev.clientX - startX)>8 || Math.abs(ev.clientY - startY)>8) clearTimeout(pressTimer); return; }
      ev.preventDefault();
      win.style.left = Math.max(0, Math.min(window.innerWidth - 40, panelDrag.left + (ev.clientX - panelDrag.startX))) + 'px';
      win.style.top = Math.max(0, Math.min(window.innerHeight - 40, panelDrag.top + (ev.clientY - panelDrag.startY))) + 'px';
    };
    const up = () => {
      clearTimeout(pressTimer);
      if (isDragging) {
         win.style.opacity = '1';
         panelX = parseFloat(win.style.left)||null; panelY = parseFloat(win.style.top)||null;
         panelDrag = null;
      }
      window.removeEventListener('pointermove', move, { capture: true }); 
      window.removeEventListener('pointerup', up, { capture: true });
      window.removeEventListener('pointercancel', up, { capture: true }); 
    };
    window.addEventListener('pointermove', move, { capture: true, passive: false }); 
    window.addEventListener('pointerup', up, { capture: true });
    window.addEventListener('pointercancel', up, { capture: true }); 
  }

  function ensureButton() {
    if (document.getElementById(BUTTON_ID) || !document.body) return;
    const btn = document.createElement('button');
    btn.id = BUTTON_ID; btn.className = 'npcpv-open-button';
    btn.addEventListener('pointerdown', startButtonDrag);
    document.body.appendChild(btn); applyButtonSettings();
  }

  function keepButtonVisible() {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    const size = buttonSettings().size || 46;
    const x = Math.max(8, Math.min(window.innerWidth - size - 8, parseFloat(btn.style.left) || window.innerWidth-60));
    const y = Math.max(8, Math.min(window.innerHeight - size - 8, parseFloat(btn.style.top) || window.innerHeight-100));
    btn.style.left = x + 'px'; btn.style.top = y + 'px'; btn.style.right = 'auto'; btn.style.bottom = 'auto';
  }

function applyButtonSettings() {
    const btn = document.getElementById(BUTTON_ID);
    const cfg = buttonSettings();
    if (btn) {
        // 如果按钮当前处于同步状态，则跳过背景更新以避免冲突
        if (btn.dataset.syncing !== 'true') {
            btn.style.background = cfg.color || '#43a047';
        }
        btn.style.width = (cfg.size || 46) + 'px';
        btn.style.height = (cfg.size || 46) + 'px';
        btn.style.fontSize = Math.max(11, Math.round((cfg.size || 46) / 3.8)) + 'px';
        btn.innerHTML = cfg.text ? esc(cfg.text) : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>`;
    }
  }

  function setButtonSyncing(isSyncing) {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    if (isSyncing) {
        // 存储原始背景颜色，如果尚未存储的话
        if (!btn.dataset.originalBackground) {
            btn.dataset.originalBackground = btn.style.background || '';
        }
        // 设置同步状态数据属性
        btn.dataset.syncing = 'true';
        // 设置同步颜色 - 使用与手动同步按钮相同的蓝色
        btn.style.background = '#1976d2';
    } else {
        // 恢复原始背景颜色
        const original = btn.dataset.originalBackground;
        if (original !== undefined) {
            btn.style.background = original;
            // 清除数据属性以避免泄漏
            delete btn.dataset.originalBackground;
        }
        // 删除同步状态数据属性
        delete btn.dataset.syncing;
    }
  }

  function applyPanelTheme(root) {
    if (!root) return;
    const cfg = buttonSettings();
    root.style.setProperty('--npcpv-accent', cfg.accentColor || '#43a047');
    root.style.setProperty('--npcpv-panel', cfg.panelColor || '#ffffff');
    root.style.setProperty('--npcpv-text', cfg.textColor || '#233323');
    root.style.setProperty('--npcpv-soft', (cfg.accentColor||'#43a047')+'18');
  }

  function startButtonDrag(e) {
    const btn = e.currentTarget;
    buttonDrag = { startX: e.clientX, startY: e.clientY, left: btn.getBoundingClientRect().left, top: btn.getBoundingClientRect().top, moved: false };
    btn.setPointerCapture?.(e.pointerId);
    const move = ev => {
      if (!buttonDrag) return;
      if (Math.abs(ev.clientX - buttonDrag.startX) + Math.abs(ev.clientY - buttonDrag.startY) > 4) buttonDrag.moved = true;
      const size = buttonSettings().size || 46;
      btn.style.left = Math.max(4, Math.min(window.innerWidth - size - 4, buttonDrag.left + (ev.clientX - buttonDrag.startX))) + 'px';
      btn.style.top = Math.max(4, Math.min(window.innerHeight - size - 4, buttonDrag.top + (ev.clientY - buttonDrag.startY))) + 'px';
    };
    const up = () => {
      if (buttonDrag && !buttonDrag.moved) {
          if (document.getElementById(PANEL_ID)) {
             closePanel();
          } else { 
             loadRowsSync(); 
             openPanel(); 
          }
      }
      setTimeout(() => { buttonDrag = null; }, 0);
      window.removeEventListener('pointermove', move, { capture: true }); 
      window.removeEventListener('pointerup', up, { capture: true });
    };
    window.addEventListener('pointermove', move, { capture: true, passive: false }); 
    window.addEventListener('pointerup', up, { capture: true });
  }

  function openPanel() {
    updateViewportVars();
    const maxW = window.innerWidth, maxH = window.innerHeight;
    if (panelX == null || panelY == null || panelX < -100 || panelY < 0 || panelX > maxW) {
       panelX = Math.max(0, (maxW - (panelW || Math.min(860, maxW * 0.92))) / 2);
       panelY = Math.max(0, (maxH - (panelH || Math.min(680, maxH * 0.88))) / 2);
    }
    let root = document.getElementById(PANEL_ID);
    if (!root) { root = document.createElement('div'); root.id = PANEL_ID; document.body.appendChild(root); }
    render();
  }

  function closePanel() { 
    const win = document.querySelector('.npcpv-root');
    if (win) {
      panelX = parseFloat(win.style.left)||null; panelY = parseFloat(win.style.top)||null;
      panelW = parseFloat(win.style.width)||win.offsetWidth; panelH = parseFloat(win.style.height)||win.offsetHeight;
    }
    document.getElementById(PANEL_ID)?.remove(); 
  }

  function updateViewportVars() { document.documentElement.style.setProperty('--npcpv-vw', window.innerWidth+'px'); document.documentElement.style.setProperty('--npcpv-vh', window.innerHeight+'px'); }

function boot() {
      updateViewportVars(); ensureButton(); keepButtonVisible(); loadRowsSync();
      // 绑定聊天完成事件以自动同步NPC状态
      if (window.eventSource && !window._npcpv_event_bound) {
          window._npcpv_event_bound = true;
          window.eventSource.on('chat_completion', () => {
              setButtonSyncing(true);
              doAISync(false).finally(() => {
                  setButtonSyncing(false);
              });
          });
      }
      if(!window._npcpv_obs) {
          window._npcpv_obs = new MutationObserver(() => { if (!document.getElementById(BUTTON_ID)) ensureButton(); });
          window._npcpv_obs.observe(document.body, { childList: true });
      }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  window.addEventListener('resize', () => { updateViewportVars(); keepButtonVisible(); });
  setTimeout(boot, 500);

})();
