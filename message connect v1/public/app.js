// Roblox Web Relay - Client Application Logic

(function () {
  'use strict';

  // State Management
  const state = {
    apiBase: localStorage.getItem('rblx_api_base') || window.location.origin,
    secretKey: localStorage.getItem('rblx_secret_key') || '',
    pollInterval: parseInt(localStorage.getItem('rblx_poll_interval')) || 1000,
    soundEnabled: localStorage.getItem('rblx_sound') !== 'false',
    autoScroll: localStorage.getItem('rblx_autoscroll') !== 'false',
    lastTimestamp: 0,
    filter: 'all',
    messages: [],
    clients: [],
    pollTimer: null,
    isInitialLoad: true,
    audioCtx: null
  };

  // DOM Elements
  const el = {
    statusPill: document.getElementById('statusPill'),
    statusText: document.getElementById('statusText'),
    latencyBadge: document.getElementById('latencyBadge'),
    latencyValue: document.getElementById('latencyValue'),
    clientCountBadge: document.getElementById('clientCountBadge'),
    clientsList: document.getElementById('clientsList'),
    messagesContainer: document.getElementById('messagesContainer'),
    messageCounter: document.getElementById('messageCounter'),
    jumpBottomBtn: document.getElementById('jumpBottomBtn'),
    
    // Forms & Inputs
    chatForm: document.getElementById('chatForm'),
    authorInput: document.getElementById('authorInput'),
    messageInput: document.getElementById('messageInput'),
    modeChatBtn: document.getElementById('modeChatBtn'),
    modeLuauBtn: document.getElementById('modeLuauBtn'),
    luauForm: document.getElementById('luauForm'),
    luauCodeInput: document.getElementById('luauCodeInput'),
    btnExecuteLuau: document.getElementById('btnExecuteLuau'),
    btnInsertTemplate: document.getElementById('btnInsertTemplate'),
    
    // Header & Modals
    btnRobloxScript: document.getElementById('btnRobloxScript'),
    btnClearChat: document.getElementById('btnClearChat'),
    btnSettings: document.getElementById('btnSettings'),
    scriptModal: document.getElementById('scriptModal'),
    btnCloseScriptModal: document.getElementById('btnCloseScriptModal'),
    modalServerUrl: document.getElementById('modalServerUrl'),
    robloxScriptContent: document.getElementById('robloxScriptContent'),
    btnCopyScript: document.getElementById('btnCopyScript'),
    copyScriptText: document.getElementById('copyScriptText'),
    
    // Settings Modal
    settingsModal: document.getElementById('settingsModal'),
    btnCloseSettingsModal: document.getElementById('btnCloseSettingsModal'),
    cfgApiUrl: document.getElementById('cfgApiUrl'),
    cfgSecretKey: document.getElementById('cfgSecretKey'),
    cfgPollInterval: document.getElementById('cfgPollInterval'),
    cfgSoundToggle: document.getElementById('cfgSoundToggle'),
    cfgAutoScroll: document.getElementById('cfgAutoScroll'),
    btnSaveSettings: document.getElementById('btnSaveSettings')
  };

  // Web Audio Synthetic Sound Engine
  function playSound(type) {
    if (!state.soundEnabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!state.audioCtx) state.audioCtx = new AudioContext();
      if (state.audioCtx.state === 'suspended') state.audioCtx.resume();

      const ctx = state.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;

      if (type === 'receive') {
        // Soft double-chime for incoming Roblox message
        osc.type = 'sine';
        osc.frequency.setValueAtTime(620, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.22);
      } else if (type === 'send') {
        // High crisp blip
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.08);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === 'command') {
        // Tech zap sound
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.linearRampToValueAtTime(1100, now + 0.15);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
      }
    } catch (_) {
      // Audio context might fail on un-interacted browser session
    }
  }

  // API Request Helper
  async function apiFetch(endpoint, options = {}) {
    const url = `${state.apiBase.replace(/\/$/, '')}/api/${endpoint.replace(/^\//, '')}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(state.secretKey ? { 'x-secret-key': state.secretKey } : {}),
      ...(options.headers || {})
    };

    const startTime = performance.now();
    try {
      const res = await fetch(url, { ...options, headers });
      const latency = Math.round(performance.now() - startTime);
      el.latencyValue.textContent = `${latency} ms`;
      
      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        throw new Error(errorJson.error || `HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      el.latencyValue.textContent = `Error`;
      throw err;
    }
  }

  // Polling Function
  async function pollUpdates() {
    try {
      // 1. Fetch Messages
      const msgData = await apiFetch(`messages?since=${state.lastTimestamp}&limit=60`);
      if (msgData && msgData.messages && msgData.messages.length > 0) {
        let hasNewRobloxMsg = false;

        for (const msg of msgData.messages) {
          // Avoid duplicates
          if (!state.messages.some(m => m.id === msg.id)) {
            state.messages.push(msg);
            renderMessage(msg);

            if (msg.sender === 'roblox' && !state.isInitialLoad) {
              hasNewRobloxMsg = true;
            }
          }
          if (msg.timestamp > state.lastTimestamp) {
            state.lastTimestamp = msg.timestamp;
          }
        }

        if (hasNewRobloxMsg) {
          playSound('receive');
        }

        updateMessageCounter();
        if (state.autoScroll) scrollToBottom();
      }

      // 2. Fetch Active Clients
      const clientsData = await apiFetch('clients');
      if (clientsData && clientsData.clients) {
        state.clients = clientsData.clients;
        renderClients(state.clients);
      }

      // Update Header Status
      if (state.clients.length > 0) {
        el.statusPill.className = 'status-pill online';
        el.statusText.textContent = `${state.clients.length} Roblox Online`;
      } else {
        el.statusPill.className = 'status-pill';
        el.statusText.textContent = 'Waiting for Roblox...';
      }

      state.isInitialLoad = false;
    } catch (err) {
      console.warn("Polling sync issue:", err.message);
      el.statusPill.className = 'status-pill offline';
      el.statusText.textContent = 'Offline / Connecting';
    } finally {
      // Schedule next poll
      state.pollTimer = setTimeout(pollUpdates, state.pollInterval);
    }
  }

  // Render Messages
  function renderMessage(msg) {
    // Check if matches active filter
    const row = document.createElement('div');
    row.className = `msg-row ${msg.sender} ${msg.type}`;
    row.dataset.type = msg.type;
    row.dataset.id = msg.id;

    if (state.filter !== 'all' && msg.type !== state.filter) {
      row.style.display = 'none';
    }

    let badgeHtml = '';
    if (msg.sender === 'web') {
      badgeHtml = `<span class="badge badge-web">Web Operator</span>`;
    } else if (msg.sender === 'roblox') {
      badgeHtml = `<span class="badge badge-roblox">Roblox Player</span>`;
    } else if (msg.type === 'command') {
      badgeHtml = `<span class="badge badge-cmd">Remote Command</span>`;
    }

    let bubbleContent = '';
    if (msg.type === 'output') {
      bubbleContent = `
        <div class="terminal-header">
          <span>&gt; ROBLOX_STDOUT [${escapeHtml(msg.author)}]</span>
          <span>${msg.timeStr}</span>
        </div>
        <div class="terminal-body">${escapeHtml(msg.text)}</div>
      `;
    } else {
      bubbleContent = escapeHtml(msg.text);
    }

    row.innerHTML = `
      <div class="msg-meta">
        ${badgeHtml}
        <strong class="msg-author">${escapeHtml(msg.author)}</strong>
        <span class="msg-time">${msg.timeStr || ''}</span>
      </div>
      <div class="msg-bubble">${bubbleContent}</div>
    `;

    el.messagesContainer.appendChild(row);
  }

  // Render Clients in Sidebar
  function renderClients(clients) {
    el.clientCountBadge.textContent = `${clients.length} Active`;

    if (clients.length === 0) {
      el.clientsList.innerHTML = `
        <div class="empty-clients-state">
          <div class="radar-pulse"></div>
          <p>Waiting for Roblox script...</p>
          <small>Run <code>roblox_script.lua</code> in Roblox</small>
        </div>
      `;
      return;
    }

    el.clientsList.innerHTML = clients.map(c => {
      const initial = (c.username || 'R').charAt(0).toUpperCase();
      const hp = c.health !== undefined ? Math.round(c.health) : 100;
      const maxHp = c.maxHealth || 100;
      const hpPercent = Math.min(Math.max((hp / maxHp) * 100, 0), 100);

      return `
        <div class="client-card" data-username="${escapeHtml(c.username)}">
          <div class="client-header">
            <div class="client-avatar">${initial}</div>
            <div class="client-details">
              <div class="client-name">${escapeHtml(c.username)}</div>
              <div class="client-sub">UID: ${c.userId || 'Unknown'}</div>
            </div>
          </div>
          <div class="health-bar-container" title="Health: ${hp} / ${maxHp}">
            <div class="health-bar-fill" style="width: ${hpPercent}%;"></div>
          </div>
          <div class="client-stats-row">
            <span>FPS: ${c.fps || 60}</span>
            <span>Ping: ${c.ping || 0}ms</span>
            <span>Job: ${c.jobId ? c.jobId.slice(0, 6) + '...' : 'Studio'}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // Scroll Helpers
  function scrollToBottom() {
    el.messagesContainer.scrollTop = el.messagesContainer.scrollHeight;
  }

  el.messagesContainer.addEventListener('scroll', () => {
    const fromBottom = el.messagesContainer.scrollHeight - el.messagesContainer.scrollTop - el.messagesContainer.clientHeight;
    if (fromBottom > 120) {
      el.jumpBottomBtn.style.display = 'flex';
    } else {
      el.jumpBottomBtn.style.display = 'none';
    }
  });

  el.jumpBottomBtn.addEventListener('click', () => {
    scrollToBottom();
    el.jumpBottomBtn.style.display = 'none';
  });

  function updateMessageCounter() {
    el.messageCounter.textContent = `${state.messages.length} messages`;
  }

  // Escape HTML helper
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Send Message Handler
  el.chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = el.messageInput.value.trim();
    const author = el.authorInput.value.trim() || 'Web Operator';
    if (!text) return;

    el.messageInput.value = '';
    playSound(text.startsWith('/') ? 'command' : 'send');

    try {
      await apiFetch('messages', {
        method: 'POST',
        body: JSON.stringify({
          text,
          author,
          sender: 'web',
          type: text.startsWith('/') ? 'command' : 'chat'
        })
      });
      // Force instant poll
      if (state.pollTimer) clearTimeout(state.pollTimer);
      pollUpdates();
    } catch (err) {
      alert(`Failed to send message: ${err.message}`);
    }
  });

  // Quick Command Chips
  document.querySelectorAll('.cmd-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const cmd = chip.dataset.cmd;
      if (!cmd) return;
      el.messageInput.value = cmd;
      el.messageInput.focus();
    });
  });

  // Filter Tabs
  document.querySelectorAll('.filter-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter = btn.dataset.filter;

      // Apply filter to DOM rows
      document.querySelectorAll('.msg-row').forEach(row => {
        if (state.filter === 'all' || row.dataset.type === state.filter) {
          row.style.display = 'flex';
        } else {
          row.style.display = 'none';
        }
      });
    });
  });

  // Mode Switcher (Chat vs Luau)
  el.modeChatBtn.addEventListener('click', () => {
    el.modeChatBtn.classList.add('active');
    el.modeLuauBtn.classList.remove('active');
    el.chatForm.style.display = 'flex';
    el.luauForm.style.display = 'none';
  });

  el.modeLuauBtn.addEventListener('click', () => {
    el.modeLuauBtn.classList.add('active');
    el.modeChatBtn.classList.remove('active');
    el.chatForm.style.display = 'none';
    el.luauForm.style.display = 'block';
  });

  // Luau Example Template
  const luauTemplates = [
    `-- Set Super Speed\nlocal char = game.Players.LocalPlayer.Character\nif char and char:FindFirstChild('Humanoid') then\n    char.Humanoid.WalkSpeed = 80\nend\nreturn 'WalkSpeed updated to 80!'`,
    `-- Teleport 20 studs up\nlocal root = game.Players.LocalPlayer.Character and game.Players.LocalPlayer.Character:FindFirstChild('HumanoidRootPart')\nif root then\n    root.CFrame = root.CFrame + Vector3.new(0, 20, 0)\nend\nreturn 'Teleported up 20 studs!'`,
    `-- Broadcast Chat in Roblox\ngame:GetService('ReplicatedStorage').DefaultChatSystemChatEvents.SayMessageRequest:FireServer('Hello from remote operator!', 'All')\nreturn 'Sent message in Roblox chat!'`
  ];
  let templateIndex = 0;

  el.btnInsertTemplate.addEventListener('click', () => {
    el.luauCodeInput.value = luauTemplates[templateIndex % luauTemplates.length];
    templateIndex++;
  });

  // Luau Remote Execution Button
  el.btnExecuteLuau.addEventListener('click', async () => {
    const code = el.luauCodeInput.value.trim();
    if (!code) {
      alert("Please enter Luau code to execute!");
      return;
    }

    playSound('command');
    try {
      await apiFetch('commands', {
        method: 'POST',
        body: JSON.stringify({
          command: 'eval',
          args: code,
          raw: `:eval ${code}`,
          sender: el.authorInput.value || 'Web Operator'
        })
      });

      // Switch to All or Output tab to watch result
      document.querySelector('.tab-btn[data-filter="all"]').click();
      if (state.pollTimer) clearTimeout(state.pollTimer);
      pollUpdates();
    } catch (err) {
      alert(`Execution queue failed: ${err.message}`);
    }
  });

  // Clear Chat History Button
  el.btnClearChat.addEventListener('click', async () => {
    if (!confirm("Are you sure you want to clear chat history?")) return;
    try {
      await apiFetch('clear', { method: 'POST' });
      state.messages = [];
      el.messagesContainer.innerHTML = '';
      state.lastTimestamp = 0;
      updateMessageCounter();
      if (state.pollTimer) clearTimeout(state.pollTimer);
      pollUpdates();
    } catch (err) {
      alert(`Clear failed: ${err.message}`);
    }
  });

  // Roblox Script Modal Handling
  el.btnRobloxScript.addEventListener('click', async () => {
    el.scriptModal.style.display = 'flex';
    const serverUrl = state.apiBase.replace(/\/$/, '');
    el.modalServerUrl.value = serverUrl;

    // Load roblox_script.lua file and replace URL placeholder
    try {
      const res = await fetch('/roblox_script.lua');
      if (res.ok) {
        let code = await res.text();
        code = code.replace(/SERVER_URL\s*=\s*"[^"]*"/, `SERVER_URL = "${serverUrl}"`);
        el.robloxScriptContent.textContent = code;
      } else {
        el.robloxScriptContent.textContent = `-- Please check roblox_script.lua in your project root\n-- Set SERVER_URL = "${serverUrl}"`;
      }
    } catch (_) {
      el.robloxScriptContent.textContent = `-- Set SERVER_URL = "${serverUrl}" in roblox_script.lua`;
    }
  });

  el.btnCloseScriptModal.addEventListener('click', () => {
    el.scriptModal.style.display = 'none';
  });

  // Copy Roblox Script
  el.btnCopyScript.addEventListener('click', () => {
    const text = el.robloxScriptContent.textContent;
    navigator.clipboard.writeText(text).then(() => {
      el.copyScriptText.textContent = "Copied to Clipboard!";
      setTimeout(() => {
        el.copyScriptText.textContent = "Copy Lua Code";
      }, 2000);
    });
  });

  // Settings Modal Handling
  el.btnSettings.addEventListener('click', () => {
    el.cfgApiUrl.value = state.apiBase;
    el.cfgSecretKey.value = state.secretKey;
    el.cfgPollInterval.value = state.pollInterval.toString();
    el.cfgSoundToggle.checked = state.soundEnabled;
    el.cfgAutoScroll.checked = state.autoScroll;
    el.settingsModal.style.display = 'flex';
  });

  el.btnCloseSettingsModal.addEventListener('click', () => {
    el.settingsModal.style.display = 'none';
  });

  el.btnSaveSettings.addEventListener('click', () => {
    state.apiBase = el.cfgApiUrl.value.trim() || window.location.origin;
    state.secretKey = el.cfgSecretKey.value.trim();
    state.pollInterval = parseInt(el.cfgPollInterval.value) || 1000;
    state.soundEnabled = el.cfgSoundToggle.checked;
    state.autoScroll = el.cfgAutoScroll.checked;

    localStorage.setItem('rblx_api_base', state.apiBase);
    localStorage.setItem('rblx_secret_key', state.secretKey);
    localStorage.setItem('rblx_poll_interval', state.pollInterval);
    localStorage.setItem('rblx_sound', state.soundEnabled);
    localStorage.setItem('rblx_autoscroll', state.autoScroll);

    el.settingsModal.style.display = 'none';
    if (state.pollTimer) clearTimeout(state.pollTimer);
    pollUpdates();
  });

  // Close modals on backdrop click
  window.addEventListener('click', (e) => {
    if (e.target === el.scriptModal) el.scriptModal.style.display = 'none';
    if (e.target === el.settingsModal) el.settingsModal.style.display = 'none';
  });

  // Initial Boot
  pollUpdates();
})();
