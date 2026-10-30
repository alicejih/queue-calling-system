/**
 * 智慧叫號排隊系統 - 共用核心通訊與狀態模組 (Shared Core Module)
 * 支援三重即時同步保障：
 * 1. BroadcastChannel（同設備不同分頁 0ms 即時廣播）
 * 2. LocalStorage StorageEvent + 輪詢（本地持久化與分頁監聽）
 * 3. 雲端 WebSocket MQTT（跨手機、平板、電腦全球即時雙向連動）
 */

const STORAGE_KEY = 'QUEUE_SYSTEM_DATA_V1';
const CHANNEL_NAME = 'QUEUE_SYSTEM_SYNC_CHANNEL';
const MQTT_BROKER_URL = 'wss://broker.emqx.io:8084/mqtt';
const MQTT_TOPIC = 'alicejih/queue_calling_system_2026/events';

// 產生每個視窗專屬 Client ID，防止自己重複處理自己送出的雲端廣播
const CLIENT_ID = 'client_' + Math.random().toString(36).substring(2, 9);

// 預設狀態
const defaultState = {
  currentNumber: null,
  lastIssuedNumber: 0,
  waitingList: [],
  completedList: [],
  settings: {
    voiceEnabled: true,
    soundEnabled: true,
    counter: '1 號櫃檯'
  }
};

let appState = JSON.parse(JSON.stringify(defaultState));
let broadcastChannel = null;
let mqttClient = null;
let onGlobalSyncCallback = null;
let lastKnownStateString = '';

// 初始化廣播通道
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
      if (parsed.settings) {
        appState.settings = { ...defaultState.settings, ...parsed.settings };
      }
      lastKnownStateString = cached;
    } catch (e) {
      console.error('Failed to load state from localStorage', e);
    }
  }
  return appState;
}

// 套用外部傳入的新狀態
function applyIncomingState(incomingState, eventType = 'STATE_SYNC', extraData = {}) {
  if (!incomingState) return;

  appState.currentNumber = incomingState.currentNumber ?? null;
  appState.lastIssuedNumber = incomingState.lastIssuedNumber ?? 0;
  appState.waitingList = Array.isArray(incomingState.waitingList) ? incomingState.waitingList : [];
  appState.completedList = Array.isArray(incomingState.completedList) ? incomingState.completedList : [];
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

// 儲存狀態並同步推播至 BroadcastChannel 與 MQTT 雲端
function saveState(broadcastType = 'STATE_CHANGED', extraData = {}) {
  const serialized = JSON.stringify(appState);
  lastKnownStateString = serialized;
  localStorage.setItem(STORAGE_KEY, serialized);

  const payload = {
    senderId: CLIENT_ID,
    type: broadcastType,
    state: appState,
    timestamp: Date.now(),
    ...extraData
  };

  // 1. 同機同瀏覽器廣播 (BroadcastChannel)
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(payload);
    } catch (e) {
      console.warn('BroadcastChannel error:', e);
    }
  }

  // 2. 跨裝置雲端推播 (MQTT over WebSocket)
  if (mqttClient && mqttClient.connected) {
    try {
      mqttClient.publish(MQTT_TOPIC, JSON.stringify(payload), { qos: 1 });
    } catch (e) {
      console.warn('MQTT publish error:', e);
    }
  }
}

// 設定全域監聽器（BroadcastChannel, StorageEvent, Polling, MQTT）
function listenToSyncEvents(callback) {
  onGlobalSyncCallback = callback;

  // 1. 監聽 BroadcastChannel
  if (broadcastChannel) {
    broadcastChannel.onmessage = (event) => {
      const data = event.data;
      if (data && data.senderId === CLIENT_ID) return; // 忽略自己發的

      if (data && data.state) {
        applyIncomingState(data.state, data.type, data);
      } else {
        loadState();
        if (onGlobalSyncCallback) onGlobalSyncCallback(data);
      }
    };
  }

  // 2. 監聽 LocalStorage 跨分頁 StorageEvent
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
  });

  // 3. 備援輪詢（每 1.5 秒檢查一次 localStorage 是否有被其他頁籤修改）
  setInterval(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && raw !== lastKnownStateString) {
      loadState();
      if (onGlobalSyncCallback) {
        onGlobalSyncCallback({ type: 'POLL_SYNC', state: appState });
      }
    }
  }, 1500);

  // 4. 啟動跨裝置 MQTT 雲端連線
  setupMqttConnection();
}

// 建立 MQTT 跨設備連線
function setupMqttConnection() {
  if (typeof mqtt === 'undefined') {
    console.info('MQTT library not loaded yet; relying on local broadcast.');
    return;
  }

  try {
    mqttClient = mqtt.connect(MQTT_BROKER_URL, {
      clientId: CLIENT_ID,
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 3000
    });

    mqttClient.on('connect', () => {
      console.log('🟢 MQTT 跨裝置同步已連線');
      updateCloudSyncStatus(true);
      mqttClient.subscribe(MQTT_TOPIC, { qos: 1 }, (err) => {
        if (!err) {
          // 向其他在線設備請求最新狀態
          mqttClient.publish(MQTT_TOPIC, JSON.stringify({
            senderId: CLIENT_ID,
            type: 'REQUEST_LATEST_STATE'
          }));
        }
      });
    });

    mqttClient.on('message', (topic, message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.senderId === CLIENT_ID) return; // 忽略自己發布的訊息

        // 其他裝置剛進來要求最新狀態 -> 若我們手上有資料就回應給他
        if (data.type === 'REQUEST_LATEST_STATE') {
          if (appState.lastIssuedNumber > 0 || appState.waitingList.length > 0) {
            mqttClient.publish(MQTT_TOPIC, JSON.stringify({
              senderId: CLIENT_ID,
              type: 'STATE_SYNC',
              state: appState
            }));
          }
          return;
        }

        // 收到其他裝置的狀態更新
        if (data.state) {
          applyIncomingState(data.state, data.type, data);
        }
      } catch (e) {
        console.warn('MQTT message parse error', e);
      }
    });

    mqttClient.on('error', () => {
      updateCloudSyncStatus(false);
    });

    mqttClient.on('offline', () => {
      updateCloudSyncStatus(false);
    });
  } catch (err) {
    console.warn('Failed to initialize MQTT client', err);
    updateCloudSyncStatus(false);
  }
}

// 更新畫面上的同步狀態燈
function updateCloudSyncStatus(isConnected) {
  const badge = document.getElementById('cloudSyncBadge');
  if (badge) {
    if (isConnected) {
      badge.className = 'cloud-sync-badge connected';
      badge.innerHTML = '<span class="dot"></span> 跨裝置同步中';
      badge.title = '已連線雲端：手機與電腦隨時雙向即時同步';
    } else {
      badge.className = 'cloud-sync-badge local';
      badge.innerHTML = '<span class="dot"></span> 本地連線中';
      badge.title = '同台設備雙向即時同步';
    }
  }
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

// 完成提示音
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

// 真人語音朗讀
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
