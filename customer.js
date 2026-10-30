/**
 * 智慧叫號排隊系統 - 顧客手機查號專屬邏輯 (Live Customer Calling Board)
 * 專為顧客在手機隨時查閱現場叫號進度設計，簡潔、即時、無額外繁雜操作
 */

const customerElements = {
  // 現場叫號大看板
  currentNumberDisplay: document.getElementById('currentNumberDisplay'),
  displaySubtext: document.getElementById('displaySubtext'),
  activeCounterBadge: document.getElementById('activeCounterBadge'),
  waitingCountDisplay: document.getElementById('waitingCountDisplay'),
  totalIssuedDisplay: document.getElementById('totalIssuedDisplay'),
  liveClock: document.getElementById('liveClock'),

  // 頂部控制項 (語音與音效開關)
  voiceToggleBtn: document.getElementById('voiceToggleBtn'),
  voiceStatusText: document.getElementById('voiceStatusText'),
  soundToggleBtn: document.getElementById('soundToggleBtn'),
  soundStatusText: document.getElementById('soundStatusText'),

  currentYear: document.getElementById('currentYear')
};

let lastNotifiedCallNumber = null;

function initCustomerView() {
  loadState();
  setupCustomerEventListeners();
  updateClock();
  setInterval(updateClock, 1000);

  renderCustomerUI();
  updateAudioControlsUI();

  if (customerElements.currentYear) {
    customerElements.currentYear.textContent = new Date().getFullYear();
  }

  // 監聽來自店家櫃檯後台的即時叫號操作 (支援本地與 Google 試算表雲端同步)
  listenToSyncEvents((event) => {
    renderCustomerUI();

    // 叫號跳動與廣播
    if (event.type === 'CALL_NUMBER' || event.type === 'SHEET_SYNC_UPDATE') {
      if (event.number !== null && event.number !== undefined && event.number !== lastNotifiedCallNumber) {
        lastNotifiedCallNumber = event.number;
        handleIncomingCallEvent(event.number, event.counter);
      }
    }
  });
}

function updateClock() {
  if (customerElements.liveClock) {
    customerElements.liveClock.textContent = getTimeString();
  }
}

// 收到叫號事件時的顧客端處理
function handleIncomingCallEvent(calledNum, counter) {
  // 畫面數字閃爍動畫
  if (customerElements.currentNumberDisplay) {
    customerElements.currentNumberDisplay.classList.remove('flash');
    void customerElements.currentNumberDisplay.offsetWidth;
    customerElements.currentNumberDisplay.classList.add('flash');
  }

  // 震動手機提醒 (若手機瀏覽器支援)
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate([300, 150, 300]);
    } catch (e) {}
  }

  // 播放提示音與語音叫號
  playDingDong();
  speakCall(calledNum, counter || appState.settings.counter);
}

// 渲染現場叫號看板
function renderCustomerUI() {
  if (!customerElements.currentNumberDisplay) return;

  if (appState.currentNumber !== null) {
    customerElements.currentNumberDisplay.textContent = formatNumber(appState.currentNumber);
    if (customerElements.activeCounterBadge) {
      customerElements.activeCounterBadge.textContent = appState.settings.counter || '1 號櫃檯';
    }
    if (customerElements.displaySubtext) {
      customerElements.displaySubtext.textContent = `請 ${formatNumber(appState.currentNumber)} 號至 ${appState.settings.counter || '櫃檯'} 辦理`;
      customerElements.displaySubtext.classList.add('highlight');
    }
  } else {
    customerElements.currentNumberDisplay.textContent = '---';
    if (customerElements.activeCounterBadge) {
      customerElements.activeCounterBadge.textContent = '待命中';
    }
    if (customerElements.displaySubtext) {
      const waitCount = Array.isArray(appState.waitingList) ? appState.waitingList.length : 0;
      customerElements.displaySubtext.textContent = waitCount > 0
        ? `目前現場有 ${waitCount} 位貴賓等候中`
        : '目前暫無叫號中顧客';
      customerElements.displaySubtext.classList.remove('highlight');
    }
  }

  // 統計數字
  if (customerElements.waitingCountDisplay) {
    customerElements.waitingCountDisplay.textContent = Array.isArray(appState.waitingList) ? appState.waitingList.length : 0;
  }
  if (customerElements.totalIssuedDisplay) {
    customerElements.totalIssuedDisplay.textContent = appState.lastIssuedNumber || 0;
  }
}

function updateAudioControlsUI() {
  if (customerElements.voiceToggleBtn) {
    if (appState.settings.voiceEnabled) {
      customerElements.voiceToggleBtn.classList.add('active');
    } else {
      customerElements.voiceToggleBtn.classList.remove('active');
    }
  }

  if (customerElements.soundToggleBtn) {
    if (appState.settings.soundEnabled) {
      customerElements.soundToggleBtn.classList.add('active');
    } else {
      customerElements.soundToggleBtn.classList.remove('active');
    }
  }
}

function setupCustomerEventListeners() {
  // 首次點擊啟用 AudioContext
  document.body.addEventListener('click', () => {
    getAudioContext();
  }, { once: true });

  // 語音廣播開關
  if (customerElements.voiceToggleBtn) {
    customerElements.voiceToggleBtn.addEventListener('click', () => {
      appState.settings.voiceEnabled = !appState.settings.voiceEnabled;
      updateAudioControlsUI();
      saveState('SETTINGS_UPDATED');
    });
  }

  // 音效開關
  if (customerElements.soundToggleBtn) {
    customerElements.soundToggleBtn.addEventListener('click', () => {
      appState.settings.soundEnabled = !appState.settings.soundEnabled;
      updateAudioControlsUI();
      saveState('SETTINGS_UPDATED');
      if (appState.settings.soundEnabled) playDingDong();
    });
  }
}

window.addEventListener('DOMContentLoaded', initCustomerView);
