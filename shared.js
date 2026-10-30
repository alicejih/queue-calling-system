/**
 * 智慧叫號排隊系統 - 共用模組 (Shared Core Module)
 * 負責：狀態儲存 (LocalStorage)、跨視窗廣播通訊 (BroadcastChannel)、音效與中文語音
 */

const STORAGE_KEY = 'QUEUE_SYSTEM_DATA_V1';
const CHANNEL_NAME = 'QUEUE_SYSTEM_SYNC_CHANNEL';

// 初始狀態
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

// 初始化 BroadcastChannel
try {
  if (typeof BroadcastChannel !== 'undefined') {
    broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
  }
} catch (e) {
  console.warn('BroadcastChannel not supported, relying on storage events', e);
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

// 載入資料
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
    } catch (e) {
      console.error('Failed to load state from localStorage', e);
    }
  }
  return appState;
}

// 儲存資料並通知其他視窗
function saveState(broadcastType = 'STATE_CHANGED', extraData = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  
  const payload = {
    type: broadcastType,
    state: appState,
    timestamp: Date.now(),
    ...extraData
  };

  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(payload);
    } catch (e) {
      console.warn('Broadcast error:', e);
    }
  }
}

// 監聽跨視窗事件
function listenToSyncEvents(onUpdateCallback) {
  if (broadcastChannel) {
    broadcastChannel.onmessage = (event) => {
      loadState();
      if (onUpdateCallback) {
        onUpdateCallback(event.data);
      }
    };
  }

  // 備用 storage 監聽器
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      loadState();
      if (onUpdateCallback) {
        onUpdateCallback({ type: 'STORAGE_UPDATE', state: appState });
      }
    }
  });
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

    // 第一音 (高音 660Hz)
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

    // 第二音 (低音 523Hz)
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
