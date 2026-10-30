/**
 * 智慧叫號排隊系統 - 共用核心通訊與狀態模組 (Google 試算表專屬架構)
 * 1. 支援 Google 試算表 (Google Sheets / Google Apps Script) 作為全自動線上資料庫與 CSV 報表
 * 2. 支援 BroadcastChannel 與 LocalStorage (同機同瀏覽器 0ms 即時同步)
 * 3. 100% 掌握在自己的 Google 帳號下，高安全性、高隱私性、永久免費
 */

const STORAGE_KEY = 'QUEUE_SYSTEM_DATA_V1';
const SHEET_API_STORAGE_KEY = 'QUEUE_SHEET_API_URL_V1';
const CHANNEL_NAME = 'QUEUE_SYSTEM_SYNC_CHANNEL';

// 預設狀態
const defaultState = {
  currentNumber: null,
  lastIssuedNumber: 0,
  waitingList: [],
  completedList: [],
  activityLogs: [],
  settings: {
    voiceEnabled: true,
    soundEnabled: true,
    counter: '1 號櫃檯',
    sheetApiUrl: '' // Google 試算表 Web App 網址
  }
};

let appState = JSON.parse(JSON.stringify(defaultState));
let broadcastChannel = null;
let onGlobalSyncCallback = null;
let lastKnownStateString = '';
let isFetchingFromSheet = false;

// 初始化廣播通道 (同機分頁即時同步)
try {
  if (typeof BroadcastChannel !== 'undefined') {
    broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
  }
} catch (e) {
  console.warn('BroadcastChannel not supported', e);
}

// 格式化號碼 (例如 5 -> "005")
function formatNumber(num) {
  if (num === null || num === undefined || num === '') return '---';
  return String(num).padStart(3, '0');
}

// 取得當前時間字串 HH:mm:ss
function getTimeString(date = new Date()) {
  return date.toTimeString().split(' ')[0];
}

// 計算等候時間文字
function calculateWaitDurationText(timestamp) {
  const mins = Math.floor((Date.now() - timestamp) / 60000);
  if (mins <= 0) return '剛取號';
  if (mins < 60) return `等候 ${mins} 分鐘`;
  const hours = Math.floor(mins / 60);
  return `等候 ${hours} 時 ${mins % 60} 分`;
}

// 讀取 Google 試算表網址 (優先度：1. 網址參數 ?api= ➔ 2. 全域 config.js ➔ 3. 本地儲存)
function getSheetApiUrl() {
  try {
    const urlParam = new URLSearchParams(window.location.search).get('api');
    if (urlParam) {
      localStorage.setItem(SHEET_API_STORAGE_KEY, urlParam.trim());
      return urlParam.trim();
    }
  } catch (e) {}

  if (typeof QUEUE_CONFIG !== 'undefined' && QUEUE_CONFIG.scriptApiUrl) {
    return QUEUE_CONFIG.scriptApiUrl.trim();
  }

  return localStorage.getItem(SHEET_API_STORAGE_KEY) || appState.settings.sheetApiUrl || '';
}

// 設定 Google 試算表網址
function setSheetApiUrl(url) {
  const cleanUrl = (url || '').trim();
  localStorage.setItem(SHEET_API_STORAGE_KEY, cleanUrl);
  appState.settings.sheetApiUrl = cleanUrl;
  saveState('SETTINGS_UPDATED');
  updateSheetSyncStatus();
  fetchLatestFromSheet();
}

// 載入本地狀態
function loadState() {
  const cached = localStorage.getItem(STORAGE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      appState.currentNumber = parsed.currentNumber ?? null;
      appState.lastIssuedNumber = parsed.lastIssuedNumber ?? 0;
      appState.waitingList = Array.isArray(parsed.waitingList) ? parsed.waitingList : [];
      appState.completedList = Array.isArray(parsed.completedList) ? parsed.completedList : [];
      appState.activityLogs = Array.isArray(parsed.activityLogs) ? parsed.activityLogs : [];
      if (parsed.settings) {
        appState.settings = { ...defaultState.settings, ...parsed.settings };
      }
      lastKnownStateString = cached;
    } catch (e) {
      console.error('Failed to load state from localStorage', e);
    }
  }

  // 試算表網址獨立讀取
  const sheetUrl = localStorage.getItem(SHEET_API_STORAGE_KEY);
  if (sheetUrl) {
    appState.settings.sheetApiUrl = sheetUrl;
  }

  return appState;
}

// 取得「已經叫號但還未更改狀態為好了」的所有號碼（可直接到櫃檯領取）
function getCalledPendingPickupNumbers() {
  const result = [];
  const waitingList = Array.isArray(appState.waitingList) ? appState.waitingList : [];

  waitingList.forEach(t => {
    const isCur = (appState.currentNumber !== null && t.number === appState.currentNumber);
    const isMarkedCalled = (t.called === true || (t.status && (t.status.includes('叫號') || t.status.includes('可取') || t.status.includes('可領'))));
    if (isCur || isMarkedCalled) {
      if (!result.includes(t.number)) {
        result.push(t.number);
      }
    }
  });

  // 若當前叫號存在且不在 completedList 中，確保也納入清單
  if (appState.currentNumber !== null && !result.includes(appState.currentNumber)) {
    const isCompleted = Array.isArray(appState.completedList) && appState.completedList.some(c => c.number === appState.currentNumber);
    if (!isCompleted) {
      result.push(appState.currentNumber);
    }
  }

  result.sort((a, b) => a - b);
  return result;
}

// 套用外部傳入的新狀態
function applyIncomingState(incomingState, eventType = 'STATE_SYNC', extraData = {}) {
  if (!incomingState) return;

  appState.currentNumber = incomingState.currentNumber ?? null;
  appState.lastIssuedNumber = incomingState.lastIssuedNumber ?? 0;
  appState.waitingList = Array.isArray(incomingState.waitingList) ? incomingState.waitingList : [];
  appState.completedList = Array.isArray(incomingState.completedList) ? incomingState.completedList : [];
  if (Array.isArray(incomingState.activityLogs)) {
    appState.activityLogs = incomingState.activityLogs;
  }
  if (incomingState.settings) {
    appState.settings = { ...appState.settings, ...incomingState.settings };
  }

  const serialized = JSON.stringify(appState);
  lastKnownStateString = serialized;
  localStorage.setItem(STORAGE_KEY, serialized);

  if (onGlobalSyncCallback) {
    onGlobalSyncCallback({
      type: eventType,
      state: appState,
      ...extraData
    });
  }
}

// 儲存狀態並同步推播至 BroadcastChannel 與 Google 試算表
function saveState(broadcastType = 'STATE_CHANGED', extraData = {}) {
  const serialized = JSON.stringify(appState);
  lastKnownStateString = serialized;
  localStorage.setItem(STORAGE_KEY, serialized);

  const payload = {
    type: broadcastType,
    state: appState,
    timestamp: Date.now(),
    ...extraData
  };

  // 1. 同機廣播 (BroadcastChannel)
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(payload);
    } catch (e) {
      console.warn('BroadcastChannel error:', e);
    }
  }

  // 2. 同步發送至 Google 試算表 (Google Apps Script Web App)
  postToGoogleSheet(broadcastType, extraData);
}

// 非同步寫入 Google 試算表
function postToGoogleSheet(action, extraData = {}) {
  const apiUrl = getSheetApiUrl();
  if (!apiUrl) return;

  let sheetAction = 'SYNC_ALL';
  let sheetPayload = { state: appState };

  if (action === 'CALL_NUMBER') {
    sheetAction = 'CALL_NUMBER';
    sheetPayload = {
      number: extraData.number,
      counter: extraData.counter || appState.settings.counter,
      note: '櫃檯叫號'
    };
  } else if (action === 'TICKET_TAKEN') {
    sheetAction = 'TAKE_TICKET';
    sheetPayload = { ticket: extraData.ticket };
  } else if (action === 'TICKET_COMPLETED') {
    sheetAction = 'COMPLETE_TICKET';
    sheetPayload = {
      ticketId: extraData.ticketId,
      number: appState.currentNumber,
      counter: appState.settings.counter
    };
  } else if (action === 'RESET_ALL') {
    sheetAction = 'RESET';
    sheetPayload = {};
  }

  try {
    fetch(apiUrl, {
      method: 'POST',
      mode: 'no-cors', // 繞過 Google Apps Script 重定向 CORS 限制
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: sheetAction,
        payload: sheetPayload
      })
    }).catch(err => console.warn('Post to Google Sheet failed:', err));
  } catch (e) {
    console.warn('Google Sheet request error:', e);
  }
}

// 定時從 Google 試算表抓取最新資料 (支援 Apps Script Web App 與 公開 GViz JSONP 雙軌抓取)
function fetchLatestFromSheet() {
  if (isFetchingFromSheet) return;

  const apiUrl = getSheetApiUrl();
  if (apiUrl) {
    // 軌道 1: 透過 Google Apps Script 讀取
    isFetchingFromSheet = true;
    fetch(apiUrl)
      .then(res => res.json())
      .then(data => {
        isFetchingFromSheet = false;
        if (data && data.status === 'success') {
          applySheetData(data);
        }
      })
      .catch(err => {
        isFetchingFromSheet = false;
        console.warn('Apps Script fetch failed, falling back to GViz JSONP', err);
        fetchFromPublicSpreadsheetGviz();
      });
  } else {
    // 軌道 2: 直接透過 Google Visualization API (JSONP，免 API 金鑰、免 CORS 限制) 讀取公開試算表！
    fetchFromPublicSpreadsheetGviz();
  }
}

// 直接透過 Google Visualization API (JSONP 無 CORS 限制) 讀取公開 Google 試算表之「工作區」
function fetchFromPublicSpreadsheetGviz() {
  if (isFetchingFromSheet) return;
  const sheetId = (typeof QUEUE_CONFIG !== 'undefined' && QUEUE_CONFIG.spreadsheetId) || '1ysyfQCF1XrjR5Ps2tfQexaeUi5gdNdy0Xrl6GwD7KJs';
  if (!sheetId) return;

  isFetchingFromSheet = true;
  const callbackName = '__gvizQueueCallback';

  // 防卡死計時器 (若 3 秒內未回傳自動解鎖)
  const timer = setTimeout(() => {
    isFetchingFromSheet = false;
    const el = document.getElementById('gviz-jsonp-script');
    if (el) el.remove();
  }, 3000);

  // 設定全域回呼
  window[callbackName] = function(json) {
    clearTimeout(timer);
    isFetchingFromSheet = false;
    try {
      parseAndApplyGvizData(json);
    } catch (e) {
      console.warn('Error parsing GViz data:', e);
    } finally {
      const el = document.getElementById('gviz-jsonp-script');
      if (el) el.remove();
    }
  };

  const existing = document.getElementById('gviz-jsonp-script');
  if (existing) existing.remove();

  const script = document.createElement('script');
  script.id = 'gviz-jsonp-script';
  script.src = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=responseHandler:${callbackName}&sheet=%E5%B7%A5%E4%BD%9C%E5%8D%80&_t=${Date.now()}`;
  script.onerror = function() {
    clearTimeout(timer);
    isFetchingFromSheet = false;
    const el = document.getElementById('gviz-jsonp-script');
    if (el) el.remove();
  };
  document.body.appendChild(script);
}

// 解析 Google Visualization API 回傳之 table 結構
function parseAndApplyGvizData(json) {
  if (!json || !json.table || !Array.isArray(json.table.rows)) return;
  const rows = json.table.rows;
  if (rows.length === 0) return;

  // 第 1 列 (對應試算表之第 2 列 A2:I2)
  const row0 = rows[0]?.c || [];
  const curNumRaw = row0[0]?.v;
  const curNumber = (curNumRaw !== undefined && curNumRaw !== null && curNumRaw !== '') ? parseInt(curNumRaw, 10) : null;
  const counter = row0[1]?.v ? String(row0[1].v) : '1 號櫃檯';
  const lastIssuedRaw = row0[2]?.v;
  const lastIssued = (lastIssuedRaw !== undefined && lastIssuedRaw !== null) ? parseInt(lastIssuedRaw, 10) : 0;

  // 等候名單 (E:I 欄位)
  const waitingList = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]?.c;
    if (r && r.length >= 5) {
      const numRaw = r[4]?.v;
      if (numRaw !== undefined && numRaw !== null && numRaw !== '' && !isNaN(numRaw)) {
        const time = r[5]?.f || r[5]?.v || '';
        const status = r[6]?.v ? String(r[6].v) : '等候中';
        const ticketId = r[7]?.v ? String(r[7].v) : ('T-' + numRaw);
        const ts = r[8]?.v ? Number(r[8].v) : Date.now();

        const num = parseInt(numRaw, 10);
        const isCalled = status.includes('叫號') || status.includes('可取') || status.includes('可領') || status === 'CALLED' || (curNumber !== null && num === curNumber);

        waitingList.push({
          number: num,
          time: String(time),
          status: status,
          called: isCalled,
          id: String(ticketId),
          timestamp: ts || Date.now()
        });
      }
    }
  }

  applySheetData({
    currentNumber: curNumber,
    lastIssuedNumber: lastIssued,
    counter: counter,
    waitingList: waitingList
  });
}

// 套用試算表回傳之資料
function applySheetData(data) {
  let changed = false;

  if (data.currentNumber !== undefined && data.currentNumber !== appState.currentNumber) {
    appState.currentNumber = data.currentNumber;
    changed = true;
  }
  if (data.lastIssuedNumber !== undefined && data.lastIssuedNumber > appState.lastIssuedNumber) {
    appState.lastIssuedNumber = data.lastIssuedNumber;
    changed = true;
  }
  if (data.counter && data.counter !== appState.settings.counter) {
    appState.settings.counter = data.counter;
    changed = true;
  }
  if (Array.isArray(data.waitingList)) {
    if (JSON.stringify(data.waitingList) !== JSON.stringify(appState.waitingList)) {
      appState.waitingList = data.waitingList;
      changed = true;
    }
  }

  if (changed) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    if (onGlobalSyncCallback) {
      onGlobalSyncCallback({
        type: 'SHEET_SYNC_UPDATE',
        state: appState,
        number: appState.currentNumber,
        counter: appState.settings.counter
      });
    }
  }
  updateSheetSyncStatus(true);
}

// 設定全域事件監聽
function listenToSyncEvents(callback) {
  onGlobalSyncCallback = callback;

  // 1. BroadcastChannel 監聽 (同機分頁)
  if (broadcastChannel) {
    broadcastChannel.onmessage = (event) => {
      const data = event.data;
      if (data && data.state) {
        applyIncomingState(data.state, data.type, data);
      } else {
        loadState();
        if (onGlobalSyncCallback) onGlobalSyncCallback(data);
      }
    };
  }

  // 2. StorageEvent 監聽
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY && event.newValue) {
      try {
        const parsed = JSON.parse(event.newValue);
        applyIncomingState(parsed, 'STORAGE_UPDATE');
      } catch (e) {
        loadState();
        if (onGlobalSyncCallback) onGlobalSyncCallback({ type: 'STORAGE_UPDATE' });
      }
    }
    if (event.key === SHEET_API_STORAGE_KEY) {
      updateSheetSyncStatus();
      fetchLatestFromSheet();
    }
  });

  // 3. 每 1.2 秒自動向 Google 試算表與本地 storage 抓取最新狀態 (確保跨裝置零時差)
  setInterval(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && raw !== lastKnownStateString) {
      loadState();
      if (onGlobalSyncCallback) {
        onGlobalSyncCallback({ type: 'POLL_SYNC', state: appState });
      }
    }

    // 每 1.2 秒自動同步 Google 試算表最新進度
    fetchLatestFromSheet();
  }, 1200);

  updateSheetSyncStatus();
}

// 更新畫面上的同步狀態燈
function updateSheetSyncStatus(isConnected = null) {
  const badge = document.getElementById('cloudSyncBadge');
  if (!badge) return;

  const url = getSheetApiUrl();
  if (url) {
    if (isConnected === false) {
      badge.className = 'cloud-sync-badge local';
      badge.innerHTML = '<span class="dot"></span> 試算表連線中...';
      badge.title = '正在連線至 Google 試算表';
    } else {
      badge.className = 'cloud-sync-badge connected';
      badge.innerHTML = '<span class="dot"></span> Google 試算表同步中';
      badge.title = '已綁定您的專屬 Google 試算表，資料 100% 安全儲存於您的雲端硬碟';
    }
  } else {
    badge.className = 'cloud-sync-badge local';
    badge.innerHTML = '<span class="dot"></span> 本地連線中';
    badge.title = '同台設備雙向即時同步（可至管理端綁定 Google 試算表）';
  }
}

// 寫入動作紀錄 (寫入本機歷史紀錄，同時準備匯出)
function logActivity(action, number, counter = '', note = '') {
  const now = new Date();
  const logItem = {
    id: 'LOG-' + now.getTime() + '-' + Math.random().toString(36).substring(2, 5),
    time: getTimeString(now),
    date: now.toLocaleDateString('zh-TW'),
    action: action,
    number: formatNumber(number),
    counter: counter || appState.settings.counter || '1 號櫃檯',
    note: note,
    timestamp: now.getTime()
  };

  if (!Array.isArray(appState.activityLogs)) {
    appState.activityLogs = [];
  }
  appState.activityLogs.unshift(logItem);

  if (appState.activityLogs.length > 500) {
    appState.activityLogs.pop();
  }

  return logItem;
}

/* ============================
 * 音訊與語音播放 (Web Audio API & Web Speech API)
 * ============================ */
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// 叮咚提示音
function playDingDong(force = false) {
  if (!force && !appState.settings.soundEnabled) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.6);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(523.25, now + 0.35);
    gain2.gain.setValueAtTime(0.3, now + 0.35);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.35);
    osc2.stop(now + 1.1);
  } catch (err) {
    console.warn('音效播放失敗:', err);
  }
}

// 完成音
function playSuccessChime() {
  if (!appState.settings.soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(587.33, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.2);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  } catch (err) {}
}

// 真人中文語音朗讀
function speakCall(number, counter, force = false) {
  if (!force && !appState.settings.voiceEnabled) return;
  if (!('speechSynthesis' in window)) return;

  const text = `請 ${formatNumber(number)} 號，至 ${counter || '櫃檯'} 辦理。`;

  window.speechSynthesis.cancel();

  setTimeout(() => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-TW';
    utterance.rate = 0.95;
    utterance.pitch = 1.05;

    const voices = window.speechSynthesis.getVoices();
    const zhVoice = voices.find(v => v.lang.includes('zh-TW') || v.lang.includes('cmn-Hant-TW')) 
      || voices.find(v => v.lang.includes('zh'));
    if (zhVoice) {
      utterance.voice = zhVoice;
    }

    window.speechSynthesis.speak(utterance);
  }, 700);
}
