/**
 * 智慧叫號排隊系統 (Queue Calling System)
 * 核心功能：
 * 1. 取號功能 (自動發號、號碼小票、人數統計)
 * 2. 目前顯示到幾號看板 (大字號碼、櫃檯設定、上一號/下一號/重叫)
 * 3. 點擊列表號碼即代表「這一號好了」(完成移入已完成列表)
 * 4. 內建 Web Audio 叮咚提示音 + Web Speech 真人語音播報
 * 5. 本地儲存 (LocalStorage) 資料不遺失
 */

// 狀態管理物件
const state = {
  currentNumber: null, // 目前叫號中的號碼
  lastIssuedNumber: 0, // 今天最新取到的流水號
  waitingList: [],     // 等候中清單 [{ id, number, time, timestamp }]
  completedList: [],   // 已完成清單 [{ id, number, time, completedTime, duration }]
  settings: {
    voiceEnabled: true,
    soundEnabled: true,
    counter: '1 號櫃檯'
  }
};

const STORAGE_KEY = 'QUEUE_SYSTEM_DATA_V1';

// DOM 元素引用
const elements = {
  // 看板
  currentNumberDisplay: document.getElementById('currentNumberDisplay'),
  displaySubtext: document.getElementById('displaySubtext'),
  counterSelect: document.getElementById('counterSelect'),
  callPrevBtn: document.getElementById('callPrevBtn'),
  repeatCallBtn: document.getElementById('repeatCallBtn'),
  callNextBtn: document.getElementById('callNextBtn'),

  // 取號
  getTicketBtn: document.getElementById('getTicketBtn'),
  lastTicketNumber: document.getElementById('lastTicketNumber'),
  lastTicketTime: document.getElementById('lastTicketTime'),
  waitingCountDisplay: document.getElementById('waitingCountDisplay'),
  totalIssuedDisplay: document.getElementById('totalIssuedDisplay'),
  liveClock: document.getElementById('liveClock'),

  // 清單
  waitingGrid: document.getElementById('waitingGrid'),
  emptyWaitingNotice: document.getElementById('emptyWaitingNotice'),
  completedTableBody: document.getElementById('completedTableBody'),
  emptyCompletedNotice: document.getElementById('emptyCompletedNotice'),
  waitingListContainer: document.getElementById('waitingListContainer'),
  completedListContainer: document.getElementById('completedListContainer'),
  tabWaitingCount: document.getElementById('tabWaitingCount'),
  tabCompletedCount: document.getElementById('tabCompletedCount'),
  tabBtns: document.querySelectorAll('.tab-btn'),

  // 控制項
  voiceToggleBtn: document.getElementById('voiceToggleBtn'),
  voiceStatusText: document.getElementById('voiceStatusText'),
  soundToggleBtn: document.getElementById('soundToggleBtn'),
  soundStatusText: document.getElementById('soundStatusText'),
  fullscreenBtn: document.getElementById('fullscreenBtn'),
  resetAllBtn: document.getElementById('resetAllBtn'),

  // 取號彈窗
  ticketModal: document.getElementById('ticketModal'),
  modalTicketNumber: document.getElementById('modalTicketNumber'),
  modalTicketMeta: document.getElementById('modalTicketMeta'),
  modalCloseBtn: document.getElementById('modalCloseBtn'),
  currentYear: document.getElementById('currentYear')
};

// 初始化
function init() {
  loadData();
  setupEventListeners();
  updateLiveClock();
  setInterval(updateLiveClock, 1000);
  setInterval(updateWaitingDurations, 30000); // 每 30 秒更新等待時間字樣
  renderAll();

  if (elements.currentYear) {
    elements.currentYear.textContent = new Date().getFullYear();
  }
}

// 格式化號碼 (例如 5 -> "005")
function formatNumber(num) {
  if (num === null || num === undefined) return '---';
  return String(num).padStart(3, '0');
}

// 取得當前時間字串 HH:mm:ss
function getTimeString(date = new Date()) {
  return date.toTimeString().split(' ')[0];
}

// 更新時鐘
function updateLiveClock() {
  if (elements.liveClock) {
    elements.liveClock.textContent = getTimeString();
  }
}

// 儲存資料到 LocalStorage
function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// 從 LocalStorage 載入資料
function loadData() {
  const cached = localStorage.getItem(STORAGE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      state.currentNumber = parsed.currentNumber ?? null;
      state.lastIssuedNumber = parsed.lastIssuedNumber ?? 0;
      state.waitingList = parsed.waitingList ?? [];
      state.completedList = parsed.completedList ?? [];
      if (parsed.settings) {
        state.settings = { ...state.settings, ...parsed.settings };
      }
    } catch (e) {
      console.error('Failed to parse cached queue data', e);
    }
  }

  // 套用設定到 UI
  if (elements.counterSelect) {
    elements.counterSelect.value = state.settings.counter;
  }
  updateVoiceUI();
  updateSoundUI();
}

/* ============================
 * 提示音效與語音播報 (Web Audio API & Web Speech API)
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

// 播放清脆的「叮咚～」兩聲排隊叫號提示音
function playDingDong() {
  if (!state.settings.soundEnabled) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // 第一音 (高音 660Hz E5)
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

    // 第二音 (低音 523Hz C5)
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

// 播放完成「完成了」輕巧按鍵音
function playSuccessChime() {
  if (!state.settings.soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.2); // A5
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  } catch (err) {}
}

// 語音叫號朗讀
function speakCall(number, counter) {
  if (!state.settings.voiceEnabled) return;
  if (!('speechSynthesis' in window)) return;

  // 語音內容：「請 005 號至 1 號櫃檯」
  const text = `請 ${number} 號，至 ${counter} 辦理。`;

  // 先取消前一個還在講的
  window.speechSynthesis.cancel();

  // 稍作延遲，讓叮咚音響完再發音
  setTimeout(() => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-TW';
    utterance.rate = 0.95; // 稍慢穩健語速
    utterance.pitch = 1.05;

    // 尋找繁體中文語音
    const voices = window.speechSynthesis.getVoices();
    const zhVoice = voices.find(v => v.lang.includes('zh-TW') || v.lang.includes('cmn-Hant-TW')) 
      || voices.find(v => v.lang.includes('zh'));
    if (zhVoice) {
      utterance.voice = zhVoice;
    }

    window.speechSynthesis.speak(utterance);
  }, 700);
}

/* ============================
 * 核心功能 1: 取號功能
 * ============================ */
function takeTicket() {
  getAudioContext(); // 確保瀏覽器解鎖音訊上下文
  state.lastIssuedNumber += 1;
  const currentNum = state.lastIssuedNumber;
  const now = new Date();

  const ticket = {
    id: 'T-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
    number: currentNum,
    time: getTimeString(now),
    timestamp: now.getTime()
  };

  state.waitingList.push(ticket);
  saveData();
  renderAll();

  // 顯示剛領取的資訊
  const formatted = formatNumber(currentNum);
  elements.modalTicketNumber.textContent = formatted;
  const waitPeople = state.waitingList.length - 1;
  elements.modalTicketMeta.textContent = waitPeople > 0 
    ? `前面還有 ${waitPeople} 人在等候，請留意廣播叫號` 
    : `目前無人等候，即將為您叫號`;

  elements.ticketModal.classList.remove('hidden');
  playSuccessChime();
}

/* ============================
 * 核心功能 2: 叫號功能（目前顯示到幾號）
 * ============================ */
function callNumber(num) {
  state.currentNumber = num;
  saveData();
  renderDisplayBoard();
  renderWaitingList(); // 更新清單中誰是正在叫號中

  // 閃爍動畫
  elements.currentNumberDisplay.classList.remove('flash');
  void elements.currentNumberDisplay.offsetWidth; // trigger reflow
  elements.currentNumberDisplay.classList.add('flash');

  // 音效與語音
  playDingDong();
  speakCall(num, state.settings.counter);
}

// 叫下一號 (取等候清單第一個)
function callNext() {
  if (state.waitingList.length === 0) {
    alert('目前沒有等候中的號碼！請先點擊「按此取號」。');
    return;
  }

  // 找到當前叫號在清單中的位置，若不在或沒叫過，就叫清單第 1 個
  let targetTicket = null;
  if (state.currentNumber === null) {
    targetTicket = state.waitingList[0];
  } else {
    const currentIndex = state.waitingList.findIndex(t => t.number === state.currentNumber);
    if (currentIndex !== -1 && currentIndex + 1 < state.waitingList.length) {
      targetTicket = state.waitingList[currentIndex + 1];
    } else {
      // 若目前的號碼已經是清單最後一個，或不在清單，取隊列首個未叫號
      targetTicket = state.waitingList.find(t => t.number > (state.currentNumber || 0)) || state.waitingList[0];
    }
  }

  if (targetTicket) {
    callNumber(targetTicket.number);
  }
}

// 上一號
function callPrev() {
  if (state.waitingList.length === 0) return;
  const currentIndex = state.waitingList.findIndex(t => t.number === state.currentNumber);
  if (currentIndex > 0) {
    callNumber(state.waitingList[currentIndex - 1].number);
  } else {
    // 預設切換為清單第一個
    callNumber(state.waitingList[0].number);
  }
}

// 重新叫號
function repeatCall() {
  if (state.currentNumber === null) {
    if (state.waitingList.length > 0) {
      callNumber(state.waitingList[0].number);
    } else {
      alert('目前尚無叫號中的號碼！');
    }
    return;
  }
  callNumber(state.currentNumber);
}

/* ============================
 * 核心功能 3: 列表按下去代表這一號好了！
 * ============================ */
function markTicketCompleted(ticketId) {
  const index = state.waitingList.findIndex(t => t.id === ticketId);
  if (index === -1) return;

  const ticket = state.waitingList[index];
  const now = new Date();
  const durationMinutes = Math.max(1, Math.round((now.getTime() - ticket.timestamp) / 60000));

  // 移出等候清單，加入已完成清單
  state.waitingList.splice(index, 1);
  state.completedList.unshift({
    ...ticket,
    completedTime: getTimeString(now),
    duration: durationMinutes
  });

  // 音效反饋
  playSuccessChime();

  // 如果點選完成的剛好是目前看板顯示的號碼，看板狀態更新
  if (state.currentNumber === ticket.number) {
    if (state.waitingList.length > 0) {
      // 自動提示或順延下一位
      const nextTicket = state.waitingList[0];
      state.currentNumber = nextTicket.number;
      // 廣播下一位
      setTimeout(() => {
        callNumber(nextTicket.number);
      }, 400);
    } else {
      state.currentNumber = null;
    }
  }

  saveData();
  renderAll();
}

// 復原 (從已完成放回等候)
function undoCompleted(ticketId) {
  const idx = state.completedList.findIndex(t => t.id === ticketId);
  if (idx === -1) return;
  const item = state.completedList.splice(idx, 1)[0];
  state.waitingList.push({
    id: item.id,
    number: item.number,
    time: item.time,
    timestamp: item.timestamp
  });
  // 重新按號碼升冪排序
  state.waitingList.sort((a, b) => a.number - b.number);
  saveData();
  renderAll();
}

/* ============================
 * 畫面渲染函式
 * ============================ */
function renderAll() {
  renderDisplayBoard();
  renderTicketStats();
  renderWaitingList();
  renderCompletedList();
}

// 渲染核心 2：叫號大看板
function renderDisplayBoard() {
  if (state.currentNumber !== null) {
    elements.currentNumberDisplay.textContent = formatNumber(state.currentNumber);
    elements.displaySubtext.textContent = `請 ${formatNumber(state.currentNumber)} 號至 ${state.settings.counter} 辦理`;
    elements.displaySubtext.classList.add('highlight');
  } else {
    elements.currentNumberDisplay.textContent = '---';
    elements.displaySubtext.textContent = state.waitingList.length > 0
      ? `隊列中尚有 ${state.waitingList.length} 人等候，請點擊「叫下一號」`
      : '目前暫無叫號中顧客';
    elements.displaySubtext.classList.remove('highlight');
  }
}

// 渲染取號區統計與小票
function renderTicketStats() {
  elements.waitingCountDisplay.textContent = state.waitingList.length;
  elements.totalIssuedDisplay.textContent = state.lastIssuedNumber;
  elements.tabWaitingCount.textContent = state.waitingList.length;
  elements.tabCompletedCount.textContent = state.completedList.length;

  if (state.lastIssuedNumber > 0) {
    elements.lastTicketNumber.textContent = formatNumber(state.lastIssuedNumber);
    const lastItem = state.waitingList.find(t => t.number === state.lastIssuedNumber);
    elements.lastTicketTime.textContent = lastItem ? `取號時間 ${lastItem.time}` : '已完成服務';
  } else {
    elements.lastTicketNumber.textContent = '--';
    elements.lastTicketTime.textContent = '今日尚無取號';
  }
}

// 計算等候經過時間文字
function calculateWaitDurationText(timestamp) {
  const mins = Math.floor((Date.now() - timestamp) / 60000);
  if (mins <= 0) return '剛取號';
  if (mins < 60) return `等候 ${mins} 分鐘`;
  const hours = Math.floor(mins / 60);
  return `等候 ${hours} 時 ${mins % 60} 分`;
}

function updateWaitingDurations() {
  const badges = document.querySelectorAll('.item-wait-badge');
  badges.forEach(badge => {
    const ts = Number(badge.getAttribute('data-ts'));
    if (ts) {
      badge.textContent = calculateWaitDurationText(ts);
    }
  });
}

// 渲染核心 3：等候列表（點擊卡片代表這一號好了）
function renderWaitingList() {
  elements.waitingGrid.innerHTML = '';

  if (state.waitingList.length === 0) {
    elements.emptyWaitingNotice.classList.remove('hidden');
    return;
  }
  elements.emptyWaitingNotice.classList.add('hidden');

  state.waitingList.forEach(ticket => {
    const isCurrent = (ticket.number === state.currentNumber);
    const card = document.createElement('div');
    card.className = `ticket-item-card ${isCurrent ? 'is-current' : ''}`;
    card.title = `點擊此卡片，代表「${formatNumber(ticket.number)} 號」已經好了！`;

    card.innerHTML = `
      <span class="ticket-badge-current">叫號中</span>
      <div class="card-num-row">
        <span class="item-num">${formatNumber(ticket.number)}</span>
        <span class="item-wait-badge" data-ts="${ticket.timestamp}">${calculateWaitDurationText(ticket.timestamp)}</span>
      </div>
      <div class="item-time-info">取號時間：${ticket.time}</div>
      <button class="click-to-finish-btn" type="button">
        <span>✅</span> 點擊代表這號好了
      </button>
    `;

    // 關鍵需求 3: 點擊代表這號好了！
    card.addEventListener('click', (e) => {
      markTicketCompleted(ticket.id);
    });

    elements.waitingGrid.appendChild(card);
  });
}

// 渲染已完成列表
function renderCompletedList() {
  elements.completedTableBody.innerHTML = '';

  if (state.completedList.length === 0) {
    elements.emptyCompletedNotice.classList.remove('hidden');
    return;
  }
  elements.emptyCompletedNotice.classList.add('hidden');

  state.completedList.forEach(ticket => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="num-tag">${formatNumber(ticket.number)}</span></td>
      <td>${ticket.time}</td>
      <td>${ticket.completedTime}</td>
      <td>約 ${ticket.duration} 分鐘</td>
      <td>
        <button class="undo-btn" data-id="${ticket.id}" title="誤按復原">↩ 復原</button>
      </td>
    `;

    tr.querySelector('.undo-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      undoCompleted(ticket.id);
    });

    elements.completedTableBody.appendChild(tr);
  });
}

/* ============================
 * 事件監聽綁定
 * ============================ */
function setupEventListeners() {
  // 取號按鈕
  elements.getTicketBtn.addEventListener('click', takeTicket);

  // 關閉取號成功彈窗
  elements.modalCloseBtn.addEventListener('click', () => {
    elements.ticketModal.classList.add('hidden');
  });
  elements.ticketModal.addEventListener('click', (e) => {
    if (e.target === elements.ticketModal) {
      elements.ticketModal.classList.add('hidden');
    }
  });

  // 叫號控制
  elements.callNextBtn.addEventListener('click', callNext);
  elements.callPrevBtn.addEventListener('click', callPrev);
  elements.repeatCallBtn.addEventListener('click', repeatCall);

  // 櫃檯變更
  elements.counterSelect.addEventListener('change', (e) => {
    state.settings.counter = e.target.value;
    saveData();
    renderDisplayBoard();
  });

  // 頁籤切換 (等候中 / 已完成)
  elements.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const tab = btn.dataset.tab;
      if (tab === 'waiting') {
        elements.waitingListContainer.classList.remove('hidden');
        elements.completedListContainer.classList.add('hidden');
      } else {
        elements.waitingListContainer.classList.add('hidden');
        elements.completedListContainer.classList.remove('hidden');
      }
    });
  });

  // 語音開關
  elements.voiceToggleBtn.addEventListener('click', () => {
    state.settings.voiceEnabled = !state.settings.voiceEnabled;
    updateVoiceUI();
    saveData();
  });

  // 提示音開關
  elements.soundToggleBtn.addEventListener('click', () => {
    state.settings.soundEnabled = !state.settings.soundEnabled;
    updateSoundUI();
    saveData();
    if (state.settings.soundEnabled) playDingDong();
  });

  // 全螢幕切換
  elements.fullscreenBtn.addEventListener('click', toggleFullScreen);

  // 重置按鈕
  elements.resetAllBtn.addEventListener('click', () => {
    if (confirm('確定要清空今天所有叫號與取號記錄並歸零嗎？')) {
      state.currentNumber = null;
      state.lastIssuedNumber = 0;
      state.waitingList = [];
      state.completedList = [];
      saveData();
      renderAll();
    }
  });
}

function updateVoiceUI() {
  if (state.settings.voiceEnabled) {
    elements.voiceToggleBtn.classList.add('active');
    elements.voiceStatusText.textContent = '開啟';
  } else {
    elements.voiceToggleBtn.classList.remove('active');
    elements.voiceStatusText.textContent = '靜音';
  }
}

function updateSoundUI() {
  if (state.settings.soundEnabled) {
    elements.soundToggleBtn.classList.add('active');
    elements.soundStatusText.textContent = '開啟';
  } else {
    elements.soundToggleBtn.classList.remove('active');
    elements.soundStatusText.textContent = '靜音';
  }
}

function toggleFullScreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.warn(`Error attempting to enable full-screen: ${err.message}`);
    });
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
}

// 頁面加載完成後啟動
window.addEventListener('DOMContentLoaded', init);
