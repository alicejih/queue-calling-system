/**
 * 智慧叫號排隊系統 - 顧客手機查號專屬邏輯 (Live Customer Calling Board)
 * 專為顧客在手機隨時查閱現場叫號進度、輸入自己號碼即時計算差幾人設計
 */

const customerElements = {
  // 現場叫號大看板
  currentNumberDisplay: document.getElementById('currentNumberDisplay'),
  displaySubtext: document.getElementById('displaySubtext'),
  activeCounterBadge: document.getElementById('activeCounterBadge'),
  waitingCountDisplay: document.getElementById('waitingCountDisplay'),
  totalIssuedDisplay: document.getElementById('totalIssuedDisplay'),
  liveClock: document.getElementById('liveClock'),

  // 顧客號碼牌查詢與計算
  myNumberInput: document.getElementById('myNumberInput'),
  checkMyNumberBtn: document.getElementById('checkMyNumberBtn'),
  clearMyNumberBtn: document.getElementById('clearMyNumberBtn'),
  myResultBox: document.getElementById('myResultBox'),
  myResultMainText: document.getElementById('myResultMainText'),
  myResultSubText: document.getElementById('myResultSubText'),

  // 頂部控制項 (語音與音效開關)
  voiceToggleBtn: document.getElementById('voiceToggleBtn'),
  voiceStatusText: document.getElementById('voiceStatusText'),
  soundToggleBtn: document.getElementById('soundToggleBtn'),
  soundStatusText: document.getElementById('soundStatusText')
};

const CUSTOMER_SAVED_NUMBER_KEY = 'CUSTOMER_TRACKED_NUMBER_V1';
let lastNotifiedCallNumber = null;

function initCustomerView() {
  loadState();

  // 還原先前輸入的號碼牌
  const savedNum = localStorage.getItem(CUSTOMER_SAVED_NUMBER_KEY);
  if (savedNum && customerElements.myNumberInput) {
    customerElements.myNumberInput.value = savedNum;
  }

  setupCustomerEventListeners();
  updateClock();
  setInterval(updateClock, 1000);

  renderCustomerUI();
  updateMyNumberStatus();
  updateAudioControlsUI();

  // 監聽來自店家櫃檯後台的即時叫號操作 (支援本地、Google 試算表即時雙向連線)
  listenToSyncEvents((event) => {
    renderCustomerUI();
    updateMyNumberStatus();

    // 叫號跳動與提示廣播
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

  const myNumStr = customerElements.myNumberInput ? customerElements.myNumberInput.value.trim() : '';
  const myNum = myNumStr ? parseInt(myNumStr, 10) : null;

  // 若輪到這支手機輸入的號碼，加強震動！
  if (myNum && myNum === calledNum) {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate([400, 200, 400, 200, 400]);
      } catch (e) {}
    }
    playDingDong(true);
    speakCall(calledNum, counter || appState.settings.counter, true);
  } else {
    // 一般叫號提醒
    playDingDong();
    speakCall(calledNum, counter || appState.settings.counter);
  }
}

// 核心計算：顧客輸入自己的號碼牌，即時計算前面還差幾個人
function updateMyNumberStatus() {
  const input = customerElements.myNumberInput;
  if (!input) return;

  const valStr = input.value.trim();
  const resultBox = customerElements.myResultBox;
  const mainText = customerElements.myResultMainText;
  const subText = customerElements.myResultSubText;
  const clearBtn = customerElements.clearMyNumberBtn;

  if (!valStr || isNaN(valStr)) {
    if (resultBox) resultBox.classList.add('hidden');
    if (clearBtn) clearBtn.classList.add('hidden');
    return;
  }

  const myNum = parseInt(valStr, 10);
  if (myNum <= 0) {
    if (resultBox) resultBox.classList.add('hidden');
    return;
  }

  // 儲存號碼到本地快取
  localStorage.setItem(CUSTOMER_SAVED_NUMBER_KEY, String(myNum));
  if (clearBtn) clearBtn.classList.remove('hidden');
  if (resultBox) {
    resultBox.classList.remove('hidden');
    resultBox.style.display = 'block';
  }

  const cur = appState.currentNumber;
  const waitingList = Array.isArray(appState.waitingList) ? appState.waitingList : [];

  // 情況 1：輪到我了！
  if (cur !== null && myNum === cur) {
    resultBox.style.background = 'rgba(16, 185, 129, 0.22)';
    resultBox.style.border = '1.5px solid #10b981';
    resultBox.style.color = '#34d399';
    mainText.innerHTML = '🎉 輪到您了！請前往櫃檯辦理';
    subText.textContent = `您持有的號碼為 ${formatNumber(myNum)} 號，請立即至【${appState.settings.counter || '1 號櫃檯'}】辦理！`;
    return;
  }

  // 情況 2：號碼已過號
  if (cur !== null && myNum < cur) {
    resultBox.style.background = 'rgba(239, 68, 68, 0.18)';
    resultBox.style.border = '1.5px solid #ef4444';
    resultBox.style.color = '#f87171';
    mainText.innerHTML = `⚠️ 您的號碼 ${formatNumber(myNum)} 號可能已過號`;
    subText.textContent = `現場目前叫至 ${formatNumber(cur)} 號，若您已在現場請向櫃檯人員洽詢辦理！`;
    return;
  }

  // 情況 3：排隊等候中，計算目前還差幾個人
  resultBox.style.background = 'rgba(59, 130, 246, 0.18)';
  resultBox.style.border = '1.5px solid #3b82f6';
  resultBox.style.color = '#60a5fa';

  let ahead = 0;
  // 若隊列中含有該號碼，隊列排序位置即為前面人數
  const idxInWait = waitingList.findIndex(t => t.number === myNum);
  if (idxInWait !== -1) {
    ahead = idxInWait;
  } else {
    // 若號碼不在隊列物件中，以目前叫號比對差額計算
    if (cur !== null) {
      ahead = Math.max(0, myNum - cur);
    } else {
      ahead = myNum;
    }
  }

  if (ahead === 0) {
    mainText.innerHTML = '⚡ 下一位即將輪到您！';
    subText.textContent = `您是第 ${formatNumber(myNum)} 號，請在櫃檯附近準備！`;
  } else {
    mainText.innerHTML = `⏳ 目前前面還差 <strong style="font-size: 1.6rem; color: #fbbf24; font-family: 'Share Tech Mono', monospace; text-shadow: 0 0 10px rgba(251,191,36,0.3);">${ahead}</strong> 個人`;
    subText.textContent = `您的號碼牌：${formatNumber(myNum)} 號 ｜ 現場叫至：${cur !== null ? formatNumber(cur) + ' 號' : '待命中'}`;
  }
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

  // 查詢我的號碼牌按鈕與即時輸入事件
  if (customerElements.checkMyNumberBtn) {
    customerElements.checkMyNumberBtn.addEventListener('click', updateMyNumberStatus);
  }
  if (customerElements.myNumberInput) {
    customerElements.myNumberInput.addEventListener('input', updateMyNumberStatus);
    customerElements.myNumberInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') updateMyNumberStatus();
    });
  }
  if (customerElements.clearMyNumberBtn) {
    customerElements.clearMyNumberBtn.addEventListener('click', () => {
      customerElements.myNumberInput.value = '';
      localStorage.removeItem(CUSTOMER_SAVED_NUMBER_KEY);
      updateMyNumberStatus();
    });
  }

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
