(function () {
  'use strict';

  // --- 样式自动注入，确保所有新UI组件立刻生效 ---
  const style = document.createElement('style');
  style.innerHTML = `
    .npcpv-loading-overlay { position: absolute; inset: 0; background: rgba(255,255,255,0.6); backdrop-filter: blur(4px); z-index: 1000; display: flex; flex-direction: column; align-items: center; justify-content: center; transition: opacity 0.3s; opacity: 0; pointer-events: none; border-radius: 14px; }
    .npcpv-loading-overlay.active { opacity: 1; pointer-events: auto; }
    .npcpv-spinner { width: 36px; height: 36px; border: 4px solid var(--npcpv-accent); border-top-color: transparent; border-radius: 50%; animation: npcpv-spin 1s linear infinite; }
    @keyframes npcpv-spin { to { transform: rotate(360deg); } }
    .npcpv-loading-text { margin-top: 12px; font-size: 13px; font-weight: bold; color: var(--npcpv-accent); }
    .npcpv-toast { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%) translateY(20px); background: #323232; color: #fff; padding: 10px 24px; border-radius: 24px; font-size: 13px; font-weight: 500; opacity: 0; transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); z-index: 999999; pointer-events: none; box-shadow: 0 4px 16px rgba(0,0,0,0.2); text-align: center; }
    .npcpv-toast.show { transform: translateX(-50%) translateY(0); opacity: 1; }
    
    /* 关系网格图定制 */
    .npcpv-node.clickable { cursor: pointer; transition: transform 0.2s; }
    .npcpv-node.clickable:hover { transform: scale(1.1); }
    .npcpv-node.clickable circle { fill: #fff; stroke: var(--npcpv-accent); stroke-width: 2; transition: fill 0.2s; }
    .npcpv-node.clickable:hover circle { fill: var(--npcpv-soft); }
    .npcpv-edge-label { fill: #6e826e; font-size: 8.5px; font-weight: bold; pointer-events: none; }
    
    /* 折叠开发者控制台 */
    .npcpv-api-docs { background: #fbfdfb; border: 1px solid #dcebdc; border-radius: 8px; margin-bottom: 14px; font-size: 12px; overflow: hidden; }
    .npcpv-api-docs summary { padding: 10px 12px; font-weight: 800; cursor: pointer; outline: none; user-select: none; color: var(--npcpv-accent); background: var(--npcpv-soft); transition: background 0.2s; }
    .npcpv-api-docs summary:hover { background: #e8f5e9; }
    .npcpv-doc-content { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .npcpv-doc-content code { background: #f1f8f2; padding: 6px 10px; border-radius: 6px; font-family: monospace; color: #2e7d32; user-select: all; border: 1px dashed #cfe5d0; }
    .npcpv-doc-desc { color: #6e826e; font-size: 11px; margin-bottom: 2px; }
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
    ['calm', '平静', '😌'], ['happy', '愉悦', '😊'], ['angry', '愤怒', '😤'],
    ['sad', '悲伤', '😢'], ['fear', '恐惧', '😰'], ['love', '爱意', '❤️'],
    ['jealous', '嫉妒', '🤢'], ['annoyed', '烦躁', '😒'], ['excited', '兴奋', '🤩'],
    ['shy', '害羞', '😳'], ['guilty', '心虚', '😅'], ['cold', '冷漠', '🧊'],
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

  // 获取上下文隔离的前缀
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

  // --- 本地存储封装 ---
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
      apiUrl: 'https://api.openai.com/v1/chat/completions', apiKey: '', apiModel: 'gpt-4o-mini', autoSyncInterval: 0
    };
  }
  
  function buttonSettings() { return parse(localStorage.getItem(ctxKey(SETTINGS_PREFIX)) || 'null', defaultSettings()) || defaultSettings(); }
  function saveButtonSettings(value) { localStorage.setItem(ctxKey(SETTINGS_PREFIX), JSON.stringify(value)); }

  // --- 核心：完全原生的同步变量读写（脱离数据库） ---
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

  // --- 暴露给酒馆的全局 API 对象 ---
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
       const attrMap = { '好感度': '_好感', '状态': '_状态', '心情': '_心情', '备注': '_备注', '首次登场': '_初见', '登场事件': '_事件', 'NPC关系': '_关系' };
       for(let k in attrMap) {
          if(dataObj[k] !== undefined) setVarSync(VAR_PREFIX + key + attrMap[k], dataObj[k]);
       }
       loadRowsSync();
       render();
    },
    syncNow: async function() {
       await doAISync(false);
    },
    list: function() { return registry().map(r => r.name); }
  };

  // 监听酒馆原生事件做静默自动同步
  if (window.eventSource && !window._npcpv_event_bound) {
      window._npcpv_event_bound = true;
      window.eventSource.on('chat_completion', () => {
          const cfg = buttonSettings();
          const interval = Number(cfg.autoSyncInterval) || 0;
          if (interval > 0) {
              chatCompletionCount++;
              if (chatCompletionCount >= interval) {
                  chatCompletionCount = 0;
                  doAISync(true); // background silent
              }
          }
      });
  }

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

  function parseRelations(relText) {
     const links = [];
     if(!relText) return links;
     const regex = /([^\(（、，,]+)(?:[\(（]([^)）]+)[\)）])?/g;
     let match;
     while ((match = regex.exec(relText)) !== null) {
         const name = match[1].trim();
         if(name && name.length < 20) links.push({ name: name, label: (match[2]||'相关').trim() });
     }
     return links;
  }

  // 关系网图绘制 (支持点击节点跳转)
  function relationGraphHtml(selected) {
    const names = registry().map(r => r.name);
    const relText = getVarSync(VAR_PREFIX + keyName(selected['NPC名称']) + '_关系', '');
    const links = parseRelations(relText);
    
    // 过滤出存在于名册中的有效NPC节点，最多取前8个避免拥挤
    const validLinks = links.filter(l => names.includes(l.name)).slice(0, 8);
    
    if (!validLinks.length) return '<div class="npcpv-empty compact">暂无网状关系。<br>格式示例：张三(宿敌)、李四(旧友)</div>';
    
    const center = { x: 130, y: 85 };
    const r = 62; // 半径
    
    const positions = validLinks.map((l, i) => {
        const angle = (i / validLinks.length) * Math.PI * 2 - Math.PI/2;
        return { 
           x: center.x + Math.cos(angle) * r, 
           y: center.y + Math.sin(angle) * r, 
           name: l.name, 
           label: l.label 
        };
    });
    
    const lines = positions.map(p => {
        const midX = (center.x + p.x)/2;
        const midY = (center.y + p.y)/2;
        return `<line x1="${center.x}" y1="${center.y}" x2="${p.x}" y2="${p.y}"></line>
                <rect x="${midX-16}" y="${midY-8}" width="32" height="16" fill="#fbfdfb" rx="4"></rect>
                <text x="${midX}" y="${midY+3}" text-anchor="middle" class="npcpv-graph-edge">${esc(p.label).slice(0,4)}</text>`;
    }).join('');
    
    const circles = positions.map(p => `
        <g class="npcpv-graph-node" data-target="${esc(p.name)}">
          <circle cx="${p.x}" cy="${p.y}" r="20"></circle>
          <text x="${p.x}" y="${p.y+4}" text-anchor="middle">${esc(p.name).slice(0,4)}</text>
        </g>`).join('');
        
    const centerCircle = `
        <g>
          <circle cx="${center.x}" cy="${center.y}" r="26" class="core"></circle>
          <text x="${center.x}" y="${center.y+4}" text-anchor="middle">${esc(selected['NPC名称']).slice(0,4)}</text>
        </g>`;

    return `<svg class="npcpv-graph" viewBox="0 0 260 170">${lines}${circles}${centerCircle}</svg>`;
  }

  function getChatTextForAi() {
    try {
      const th = window.TavernHelper;
      if (th?.getLastMessageId && th?.getChatMessages) {
        const last = th.getLastMessageId();
        const messages = th.getChatMessages(`0-${last}`, { include_swipes: false }) || [];
        return messages.slice(-30).map(m => `${m.is_user?'User':'Char'}: ${m.message || m.mes || m.content || ''}`).join('\n\n');
      }
      const ctx = window.SillyTavern?.getContext?.();
      if (Array.isArray(ctx?.chat)) return ctx.chat.slice(-30).map(m => `${m.is_user?'User':'Char'}: ${m.mes || m.message || m.content || ''}`).join('\n\n');
    } catch (err) { console.warn('[NPC预览表] 提取聊天记录失败', err); }
    return '';
  }

  async function doAISync(isSilent = false) {
    const cfg = buttonSettings();
    if (!window.AutoCardUpdaterAPI?.callAI) {
       if(!isSilent) showNotice('AI同步需要神数据库插件提供 AutoCardUpdaterAPI.callAI，请确保插件已启用并配置了模型。');
       return;
    }
    
    if(!isSilent) toggleLoading(true, '正在提取聊天剧情...');
    const chat = getChatTextForAi();
    if (!chat) {
       if(!isSilent) { toggleLoading(false); showNotice('未读取到有效聊天记录。'); }
       return;
    }
    
    try {
       const response = await window.AutoCardUpdaterAPI.callAI([
        { role: 'system', content: '你是NPC提取器。仅输出JSON数组，包含字段：NPC名称, 势力, 身份, 好感度, 状态(online/offline/away/danger/missing), 心情(calm/happy/angry/sad/love/fear等), 备注, 首次登场, 登场事件, NPC关系。若没有信息填空字符串。必须严格按JSON数组返回，不解释。' },
        { role: 'user', content: `请从以下最新聊天记录中整理活跃的NPC状态更新，输出JSON：\n\n${chat}` },
       ], { maxTokens: 4000 });
       
       let list = [];
       try { 
           const raw = response.match(/\[[\s\S]*\]/)?.[0] || response;
           list = JSON.parse(raw); 
       } catch(e) { 
           if(!isSilent) showNotice('模型返回的格式非JSON：' + response.slice(0, 100)); 
           toggleLoading(false);
           return; 
       }
       
       if(!Array.isArray(list)) { toggleLoading(false); return; }
       
       let ok = 0;
       for (const item of list) {
          if (!item['NPC名称']) continue;
          window.NPCPreviewOpen.update(item['NPC名称'], {
             '势力': item['势力'], '身份': item['身份'], '好感度': item['好感度'],
             '状态': item['状态'], '心情': item['心情'], '备注': item['备注'],
             '首次登场': item['首次登场'], '登场事件': item['登场事件'], 'NPC关系': item['NPC关系']
          });
          ok++;
       }
       if(!isSilent) {
          toggleLoading(false);
          showNotice(`AI同步完成：成功识别并更新了 ${ok} 个 NPC 的状态。`);
       }
    } catch(err) {
       if(!isSilent) {
          toggleLoading(false);
          showNotice('调用大模型API失败：' + (err.message || '未知错误'));
       }
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
        '历史': parseHistory(getVarSync(VAR_PREFIX + key + '_历史', '[]')) || []
      });
    }
    rows = result.sort((a, b) => (ex[a['NPC名称']]?.order ?? 999999) - (ex[b['NPC名称']]?.order ?? 999999));
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
     if(attrMap[field]) {
         setVarSync(VAR_PREFIX + key + attrMap[field], value);
     }
     
     if (field === '好感度') {
         const historyRaw = parseHistory(getVarSync(VAR_PREFIX + key + '_历史', '[]'));
         const history = Array.isArray(historyRaw) ? historyRaw : [];
         history.push({ time: new Date().toISOString(), value: Number(value) || 0 });
         setVarSync(VAR_PREFIX + key + '_历史', JSON.stringify(history.slice(-80)));
     }
     
     loadRowsSync();
     render();
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
    for (const row of rows) {
      const group = row['势力'] || '未分组';
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group).push(row);
    }
    if (!grouped.size) return '<div class="npcpv-empty" style="grid-column:1/-1">名册空空如也<br>点击右上角「+ 新NPC」</div>';
    return Array.from(grouped.entries()).map(([group, list]) => `<div class="npcpv-group"><button class="npcpv-group-title" data-group="${esc(group)}">${collapsed[group] ? '▸' : '▾'} ${esc(group)} <span>${list.length}</span></button><div class="npcpv-group-cards ${collapsed[group] ? 'collapsed' : ''}">${list.map(r => cardHtml(r, selected && String(r.id) === String(selected.id))).join('')}</div></div>`).join('');
  }

  function detailHtml(row) {
    const name = row['NPC名称'] || '?';
    const aff = Number(row['好感度']) || 0;
    const mood = moodOf(row['心情']);
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
    
    <div class="npcpv-section"><div class="npcpv-label">社交关系网 <span class="npcpv-small">格式：名字(关系)、名字(关系)</span></div>
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
    const factions = ['全部', ...Array.from(new Set(rows.map(r => r['势力']).filter(Boolean))).sort()];
    
    const styleAttr = `width:${panelW ? panelW + 'px' : 'min(860px, 92vw)'}; height:${panelH ? panelH + 'px' : 'min(680px, 88vh)'}; left:${panelX}px; top:${panelY}px; transform: none !important; margin: 0;`;
    const viewClass = selected ? 'view-detail' : 'view-list';
    
    root.innerHTML = `<div class="npcpv-root ${viewClass}" style="${styleAttr}"><div class="npcpv-modal">
      <div class="npcpv-header">
         <div class="npcpv-title">NPC 面板 <span class="npcpv-mode">纯变量引擎</span></div>
         <div class="npcpv-actions">
           <button class="npcpv-btn primary" data-action="api-settings">🔌 API与说明</button>
           <button class="npcpv-btn" data-action="add">+ 新NPC</button>
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
    root.querySelector('[data-action="add"]')?.addEventListener('click', showAddDialog);
    root.querySelector('[data-action="clear-all"]')?.addEventListener('click', () => { if(confirm('彻底抹除所有NPC？')) { saveRegistry([]); loadRowsSync(); render(); } });
    root.querySelector('[data-action="api-settings"]')?.addEventListener('click', showApiDocsDialog);
    
    root.querySelector('[data-action="search"]')?.addEventListener('input', e => { query = e.target.value; render(); });
    root.querySelectorAll('[data-filter]').forEach(btn => btn.addEventListener('click', () => { filter = btn.dataset.filter; render(); }));
    root.querySelectorAll('[data-group]').forEach(btn => btn.addEventListener('click', () => { toggleGroup(btn.dataset.group); render(); }));
    
    root.querySelectorAll('.npcpv-card').forEach(card => {
      card.addEventListener('click', () => { selectedId = card.dataset.id; render(); });
      card.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', card.dataset.id));
      card.addEventListener('dragover', e => e.preventDefault());
      card.addEventListener('drop', e => { e.preventDefault(); reorderNpc(e.dataTransfer.getData('text/plain'), card.dataset.id); });
    });
    
    // 关系网图节点穿透点击
    root.querySelectorAll('.npcpv-node.clickable').forEach(node => {
      node.addEventListener('click', () => {
         const tName = node.getAttribute('data-npc');
         const tNpc = rows.find(r => r['NPC名称'] === tName);
         if(tNpc) { selectedId = tNpc.id; render(); }
         else showToast(`系统内暂无名为 [${tName}] 的详细档案`);
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
    render();
  }

  function showAddDialog() {
    showSubDialog(`<h3>添加新角色</h3><div class="npcpv-form"><input class="npcpv-input" id="npc-add-name" placeholder="NPC名称 (必填)"><input class="npcpv-input" id="npc-add-faction" placeholder="所属阵营"><input class="npcpv-input" id="npc-add-identity" placeholder="表面身份"></div><div class="npcpv-dialog-actions"><button class="npcpv-btn" data-subclose="1">取消</button><button class="npcpv-btn primary" id="npc-add-ok">添加入册</button></div>`, () => {
      document.getElementById('npc-add-ok').onclick = () => {
        const name = document.getElementById('npc-add-name').value.trim();
        if (!name) return;
        window.NPCPreviewAPI.update(name, { '势力': document.getElementById('npc-add-faction').value.trim(), '身份': document.getElementById('npc-add-identity').value.trim() });
        closeSubDialog();
      };
    });
  }

  function showApiDocsDialog() {
    const cfg = buttonSettings();
    showSubDialog(`
      <h3>🔌 状态扫描器与 API</h3>
      <div class="npcpv-api-docs">
        <details open>
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
        <label class="npcpv-label">独立大模型 API (脱离框架依赖)</label>
        <input class="npcpv-input" id="cfg-url" placeholder="API Base URL" value="${esc(cfg.apiUrl)}">
        <input class="npcpv-input" id="cfg-key" type="password" placeholder="API Key (sk-...)" value="${esc(cfg.apiKey)}">
        <input class="npcpv-input" id="cfg-model" placeholder="Model (例如 gpt-4o-mini)" value="${esc(cfg.apiModel)}">
        
        <label class="npcpv-label" style="margin-top:8px;">后台自动同步间隔 (聊天轮次)</label>
        <input class="npcpv-input" id="cfg-interval" type="number" min="0" max="100" value="${cfg.autoSyncInterval}" placeholder="设为 0 则关闭自动同步">
        <div class="npcpv-small">设为 0 仅保留下方手动分析。设为 N，则每聊 N 句话插件自动静默调用上述 API。</div>
      </div>
      
      <div class="npcpv-dialog-actions" style="margin-top:20px; justify-content: space-between;">
        <button class="npcpv-btn" id="cfg-manual-sync" style="background:#e3f2fd; color:#1976d2; border-color:#bbdefb;">⚡ 立即手动提取一次</button>
        <div style="display:flex; gap:8px;">
           <button class="npcpv-btn" data-subclose="1">取消</button>
           <button class="npcpv-btn primary" id="cfg-save">保存配置</button>
        </div>
      </div>
    `, () => {
      document.getElementById('cfg-save').onclick = () => {
         saveButtonSettings({
            ...buttonSettings(),
            apiUrl: document.getElementById('cfg-url').value.trim(),
            apiKey: document.getElementById('cfg-key').value.trim(),
            apiModel: document.getElementById('cfg-model').value.trim(),
            autoSyncInterval: parseInt(document.getElementById('cfg-interval').value) || 0
         });
         closeSubDialog();
         showToast('系统配置已生效');
      };
      document.getElementById('cfg-manual-sync').onclick = () => {
         closeSubDialog();
         window.NPCPreviewAPI.syncNow();
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
          saveAvatars(av); render();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  // 面板拖拽
  function startPanelDrag(e) {
    if (['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'DETAILS', 'SUMMARY'].includes(e.target.tagName)) return;
    if (e.target.closest('.npcpv-card, .npcpv-chip, .npcpv-close, .npcpv-actions, .clickable, code')) return;
    
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
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up);
  }

  function ensureButton() {
    if (document.getElementById(BUTTON_ID) || !document.body) return;
    const btn = document.createElement('button');
    btn.id = BUTTON_ID; btn.className = 'npcpv-open-button';
    btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>`;
    btn.addEventListener('pointerdown', startButtonDrag);
    document.body.appendChild(btn); applyButtonSettings();
  }

  function keepButtonVisible() {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    const size = 46;
    const x = Math.max(8, Math.min(window.innerWidth - size - 8, parseFloat(btn.style.left) || window.innerWidth-60));
    const y = Math.max(8, Math.min(window.innerHeight - size - 8, parseFloat(btn.style.top) || window.innerHeight-100));
    btn.style.left = x + 'px'; btn.style.top = y + 'px'; btn.style.right = 'auto'; btn.style.bottom = 'auto';
  }

  function applyButtonSettings() {
    const btn = document.getElementById(BUTTON_ID);
    if (btn) btn.style.background = buttonSettings().color || '#43a047';
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
      btn.style.left = Math.max(4, Math.min(window.innerWidth - 46 - 4, buttonDrag.left + (ev.clientX - buttonDrag.startX))) + 'px';
      btn.style.top = Math.max(4, Math.min(window.innerHeight - 46 - 4, buttonDrag.top + (ev.clientY - buttonDrag.startY))) + 'px';
    };
    const up = () => {
      if (buttonDrag && !buttonDrag.moved) {
          if (document.getElementById(PANEL_ID)) closePanel();
          else { loadRowsSync(); openPanel(); }
      }
      setTimeout(() => { buttonDrag = null; }, 0);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
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

  // 保证 window.NPCPreviewAPI 能被全局访问 (绑定在 IIFE 中是为了防止污染被清除)
  window.NPCPreviewOpen = { update: window.NPCPreviewAPI.update }; // 兼容遗留调用

  function boot() {
    updateViewportVars(); ensureButton(); keepButtonVisible();
    if(!window._npcpv_obs) {
        window._npcpv_obs = new MutationObserver(() => { if (!document.getElementById(BUTTON_ID)) ensureButton(); });
        window._npcpv_obs.observe(document.body, { childList: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  window.addEventListener('resize', () => { updateViewportVars(); keepButtonVisible(); });
  setTimeout(boot, 500);

})();