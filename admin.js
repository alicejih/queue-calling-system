/**
 * 智慧叫號排隊系統 - 櫃檯管理控制台 (Operator Console Logic)
 * 專為櫃檯人員設計：極簡 3 大按鈕（發號碼、重新叫號、這號好了自動跳下一號）
 */

const adminElements = {
  // 叫號控制台
  adminCurrentNumber: document.getElementById('adminCurrentNumber'),
  adminCounterSelect: document.getElementById('adminCounterSelect'),
  adminIssueTicketBtn: document.getElementById('adminIssueTicketBtn'),
  adminRepeatCallBtn: document.getElementById('adminRepeatCallBtn'),
  adminCompleteAndNextBtn: document.getElementById('adminCompleteAndNextBtn'),
  adminStatusSummary: document.getElementById('adminStatusSummary'),

  // 清單區
  waitingGrid: document.getElementById('adminWaitingGrid'),
  emptyWaitingNotice: document.getElementById('adminEmptyWaitingNotice'),
  waitingListContainer: document.getElementById('waitingListContainer'),

  // 計數器標籤
  tabWaitingCount: document.getElementById('tabWaitingCount'),
  adminWaitingTotal: document.getElementById('adminWaitingTotal'),
  adminIssuedTotal: document.getElementById('adminIssuedTotal'),
  adminCompletedTotal: document.getElementById('adminCompletedTotal'),

  // 頂部控制項
  voiceToggleBtn: document.getElementById('voiceToggleBtn'),
  voiceStatusText: document.getElementById('voiceStatusText'),
  soundToggleBtn: document.getElementById('soundToggleBtn'),
  soundStatusText: document.getElementById('soundStatusText'),
  openCustomerViewBtn: document.getElementById('openCustomerViewBtn'),
  resetAllBtn: document.getElementById('resetAllBtn')
};

const ADMIN_PIN_KEY = 'ADMIN_PIN_CODE_V1';
const ADMIN_AUTH_KEY = 'ADMIN_SESSION_AUTH_OK';

function setupAdminAuth() {
  const overlay = document.getElementById('adminAuthOverlay');
  const pinInput = document.getElementById('adminPinInput');
  const loginBtn = document.getElementById('adminLoginBtn');
  const errorMsg = document.getElementById('adminPinError');

  if (sessionStorage.getItem(ADMIN_AUTH_KEY) === 'true') {
    if (overlay) overlay.classList.add('hidden');
    return;
  }

  function verifyPin() {
    const entered = (pinInput ? pinInput.value : '').trim();
    const correctPin = localStorage.getItem(ADMIN_PIN_KEY) || '8888';

    if (entered === correctPin) {
      sessionStorage.setItem(ADMIN_AUTH_KEY, 'true');
      if (overlay) overlay.classList.add('hidden');
      if (errorMsg) errorMsg.style.display = 'none';
    } else {
      if (errorMsg) {
        errorMsg.style.display = 'block';
        errorMsg.textContent = 'PIN 碼錯誤！請重新輸入';
      }
      if (pinInput) {
        pinInput.value = '';
        pinInput.focus();
      }
    }
  }

  if (loginBtn) loginBtn.addEventListener('click', verifyPin);
  if (pinInput) {
    pinInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') verifyPin();
    });
    setTimeout(() => pinInput.focus(), 300);
  }
}

function initAdminView() {
  setupAdminAuth();
  loadState();
  setupAdminEventListeners();
  setInterval(updateDurations, 30000);

  if (adminElements.adminCounterSelect) {
    adminElements.adminCounterSelect.value = appState.settings.counter || '1 號櫃檯';
  }

  renderAdminUI();
  updateAudioControlsUI();

  // 監聽顧客端或其他視窗更新 (包含跨裝置 Google 試算表同步)
  listenToSyncEvents((event) => {
    renderAdminUI();
  });
}

function updateDurations() {
  const badges = document.querySelectorAll('.item-wait-badge');
  badges.forEach(badge => {
    const ts = Number(badge.getAttribute('data-ts'));
    if (ts) {
      badge.textContent = calculateWaitDurationText(ts);
    }
  });
}

// 叫指定號碼
function adminCall(number) {
  loadState();
  getAudioContext();
  appState.currentNumber = number;
  const currentCounter = appState.settings.counter || '1 號櫃檯';

  // 標記隊列中的此號碼為已叫號
  if (Array.isArray(appState.waitingList)) {
    const t = appState.waitingList.find(x => x.number === number);
    if (t) {
      t.called = true;
      t.status = '🔔 已叫號(可取件)';
      t.calledTime = getTimeString();
    }
  }

  logActivity('叫號呼叫', number, currentCounter, '櫃檯廣播叫號');

  saveState('CALL_NUMBER', {
    number: number,
    counter: currentCounter
  });

  renderAdminUI();

  // 播放提示音與真人廣播
  playDingDong();
  speakCall(number, currentCounter);
}

// ★ 核心功能 1：發號碼牌
function adminIssueTicket() {
  loadState();
  getAudioContext();
  appState.lastIssuedNumber += 1;
  const currentNum = appState.lastIssuedNumber;
  const now = new Date();

  const ticket = {
    id: 'T-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
    number: currentNum,
    time: getTimeString(now),
    timestamp: now.getTime(),
    status: '⏳ 等候中',
    called: false
  };

  if (!Array.isArray(appState.waitingList)) {
    appState.waitingList = [];
  }
  appState.waitingList.push(ticket);
  logActivity('發號碼牌', currentNum, appState.settings.counter, '發放新號碼牌');
  saveState('TICKET_TAKEN', { ticket });

  // 若目前無叫號中顧客，直接自動叫出此號！
  if (appState.currentNumber === null) {
    adminCall(currentNum);
  } else {
    renderAdminUI();
    playSuccessChime();
  }
}

// ★ 核心功能 2：重新叫號
function adminRepeatCall() {
  loadState();
  if (appState.currentNumber === null) {
    if (appState.waitingList && appState.waitingList.length > 0) {
      adminCall(appState.waitingList[0].number);
    } else {
      alert('目前尚無叫號中的號碼！請先點擊「1. 發號碼牌」。');
    }
    return;
  }

  logActivity('重新叫號', appState.currentNumber, appState.settings.counter, '再次廣播');
  adminCall(appState.currentNumber);
}

// ★ 核心功能 3：這號好了 (當選擇這個的時候自動跳下一號碼)
function adminCompleteAndNext() {
  loadState();
  getAudioContext();

  const cur = appState.currentNumber;
  if (cur === null) {
    // 若當前無叫號，但等候隊列有號碼，直接叫第一位
    if (appState.waitingList && appState.waitingList.length > 0) {
      const nextTicket = appState.waitingList[0];
      adminCall(nextTicket.number);
      return;
    } else {
      alert('目前暫無叫號中顧客！點擊「1. 發號碼牌」即可發出新號碼。');
      return;
    }
  }

  // 1. 完成當前叫號
  const now = new Date();
  const ticketIndex = appState.waitingList.findIndex(t => t.number === cur);
  let completedTicket = null;
  if (ticketIndex !== -1) {
    completedTicket = appState.waitingList.splice(ticketIndex, 1)[0];
  } else {
    completedTicket = {
      id: 'T-' + cur,
      number: cur,
      time: getTimeString(now),
      timestamp: now.getTime()
    };
  }

  if (!Array.isArray(appState.completedList)) {
    appState.completedList = [];
  }
  appState.completedList.unshift({
    ...completedTicket,
    completedTime: getTimeString(now),
    counter: appState.settings.counter || '1 號櫃檯'
  });

  logActivity('這號好了(服務完成)', cur, appState.settings.counter, '完成並跳下一號');

  // 2. 自動判斷下一號碼
  let nextNumberToCall = null;
  if (appState.waitingList && appState.waitingList.length > 0) {
    // 隊列中下一位
    nextNumberToCall = appState.waitingList[0].number;
  } else if (appState.lastIssuedNumber > cur) {
    // 連續發號的下一號
    nextNumberToCall = cur + 1;
  }

  if (nextNumberToCall !== null) {
    appState.currentNumber = nextNumberToCall;
    saveState('TICKET_COMPLETED', {
      ticketId: completedTicket.id,
      number: cur,
      nextNumber: nextNumberToCall
    });
    // 呼叫下一號
    setTimeout(() => {
      adminCall(nextNumberToCall);
    }, 150);
  } else {
    // 隊列已全部服務完成
    appState.currentNumber = null;
    saveState('TICKET_COMPLETED', {
      ticketId: completedTicket.id,
      number: cur,
      nextNumber: null
    });
    renderAdminUI();
    playSuccessChime();
  }
}

// 點擊等候隊列中特定卡片直接呼叫該號
function callSpecificWaitingTicket(number) {
  adminCall(number);
}

// 完成指定號碼牌（店家直接點選此號做好了）
function adminCompleteSpecificTicket(number) {
  loadState();
  getAudioContext();

  const ticketIndex = appState.waitingList.findIndex(t => t.number === number);
  let completedTicket = null;
  if (ticketIndex !== -1) {
    completedTicket = appState.waitingList.splice(ticketIndex, 1)[0];
  } else {
    completedTicket = {
      id: 'T-' + number,
      number: number,
      time: getTimeString(),
      timestamp: Date.now()
    };
  }

  if (!Array.isArray(appState.completedList)) {
    appState.completedList = [];
  }
  const now = new Date();
  appState.completedList.unshift({
    ...completedTicket,
    completedTime: getTimeString(now),
    counter: appState.settings.counter || '1 號櫃檯'
  });

  logActivity('這號好了(單號完成)', number, appState.settings.counter, `號碼 ${number} 完成辦理/取件`);

  // 若剛好完成的是目前叫號 currentNumber，自動跳下一號
  if (appState.currentNumber === number) {
    if (appState.waitingList && appState.waitingList.length > 0) {
      appState.currentNumber = appState.waitingList[0].number;
    } else {
      appState.currentNumber = null;
    }
  }

  saveState('TICKET_COMPLETED', {
    ticketId: completedTicket.id,
    number: number,
    nextNumber: appState.currentNumber
  });

  renderAdminUI();
  playSuccessChime();
}

// 渲染管理端介面
function renderAdminUI() {
  // 目前叫號
  if (adminElements.adminCurrentNumber) {
    if (appState.currentNumber !== null) {
      adminElements.adminCurrentNumber.textContent = formatNumber(appState.currentNumber);
      if (adminElements.adminStatusSummary) {
        adminElements.adminStatusSummary.textContent = `🔔 正在為 ${formatNumber(appState.currentNumber)} 號辦理中`;
        adminElements.adminStatusSummary.className = 'admin-status-text active';
      }
    } else {
      adminElements.adminCurrentNumber.textContent = '---';
      if (adminElements.adminStatusSummary) {
        const waitLen = Array.isArray(appState.waitingList) ? appState.waitingList.length : 0;
        adminElements.adminStatusSummary.textContent = waitLen > 0
          ? `目前無叫號中顧客（隊列有 ${waitLen} 人等候）`
          : '目前暫無叫號中顧客';
        adminElements.adminStatusSummary.className = 'admin-status-text';
      }
    }
  }

  // 頂部統計指標
  const waitLen = Array.isArray(appState.waitingList) ? appState.waitingList.length : 0;
  const completedLen = Array.isArray(appState.completedList) ? appState.completedList.length : 0;

  if (adminElements.adminWaitingTotal) adminElements.adminWaitingTotal.textContent = waitLen;
  if (adminElements.tabWaitingCount) adminElements.tabWaitingCount.textContent = waitLen;
  if (adminElements.adminIssuedTotal) adminElements.adminIssuedTotal.textContent = appState.lastIssuedNumber || 0;
  if (adminElements.adminCompletedTotal) adminElements.adminCompletedTotal.textContent = completedLen;

  // 渲染現場等候名單
  renderAdminWaitingGrid();
}

// 渲染等候隊列卡片
function renderAdminWaitingGrid() {
  if (!adminElements.waitingGrid) return;
  adminElements.waitingGrid.innerHTML = '';

  const waitingList = Array.isArray(appState.waitingList) ? appState.waitingList : [];

  if (waitingList.length === 0) {
    if (adminElements.emptyWaitingNotice) adminElements.emptyWaitingNotice.classList.remove('hidden');
  } else {
    if (adminElements.emptyWaitingNotice) adminElements.emptyWaitingNotice.classList.add('hidden');

    waitingList.forEach((ticket, idx) => {
      const isCurrent = (ticket.number === appState.currentNumber);
      const isCalled = ticket.called || isCurrent;
      const card = document.createElement('div');
      card.className = `ticket-item-card ${isCurrent ? 'is-current' : ''}`;

      card.innerHTML = `
        <span class="ticket-badge-current" style="${!isCurrent && isCalled ? 'background: #059669; color: #fff;' : ''}">
          ${isCurrent ? '🔔 目前叫號中' : (isCalled ? '🛎️ 已叫號(待取件)' : `等候順位 第 ${idx + 1} 位`)}
        </span>
        <div class="card-num-row">
          <span class="item-num">${formatNumber(ticket.number)}</span>
          <span class="item-wait-badge" data-ts="${ticket.timestamp}">${calculateWaitDurationText(ticket.timestamp)}</span>
        </div>
        <div class="item-time-info">取號時間：${ticket.time}</div>
        <div class="card-actions-row" style="display: flex; gap: 8px; margin-top: 10px;">
          <button type="button" class="btn-call-this" style="flex: 1; padding: 7px 8px; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; background: #2563eb; color: #fff; border: none; display: flex; align-items: center; justify-content: center; gap: 4px;">
            📢 叫此號
          </button>
          <button type="button" class="btn-done-this" style="flex: 1.2; padding: 7px 8px; border-radius: 8px; font-size: 0.85rem; font-weight: 700; cursor: pointer; background: #059669; color: #fff; border: none; display: flex; align-items: center; justify-content: center; gap: 4px;">
            ✅ 這號好了
          </button>
        </div>
      `;

      // 點擊「叫此號」
      const callBtn = card.querySelector('.btn-call-this');
      if (callBtn) {
        callBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          adminCall(ticket.number);
        });
      }

      // 點擊「這號好了」
      const doneBtn = card.querySelector('.btn-done-this');
      if (doneBtn) {
        doneBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          adminCompleteSpecificTicket(ticket.number);
        });
      }

      adminElements.waitingGrid.appendChild(card);
    });
  }
}

function updateAudioControlsUI() {
  if (adminElements.voiceToggleBtn) {
    if (appState.settings.voiceEnabled) {
      adminElements.voiceToggleBtn.classList.add('active');
    } else {
      adminElements.voiceToggleBtn.classList.remove('active');
    }
  }

  if (adminElements.soundToggleBtn) {
    if (appState.settings.soundEnabled) {
      adminElements.soundToggleBtn.classList.add('active');
    } else {
      adminElements.soundToggleBtn.classList.remove('active');
    }
  }
}

function setupAdminEventListeners() {
  // 櫃檯切換
  if (adminElements.adminCounterSelect) {
    adminElements.adminCounterSelect.addEventListener('change', (e) => {
      appState.settings.counter = e.target.value;
      saveState('SETTINGS_UPDATED');
      renderAdminUI();
    });
  }

  // ★ 3 大核心按鈕綁定 ★
  // 1. 發號碼
  if (adminElements.adminIssueTicketBtn) {
    adminElements.adminIssueTicketBtn.addEventListener('click', adminIssueTicket);
  }

  // 2. 重新叫號
  if (adminElements.adminRepeatCallBtn) {
    adminElements.adminRepeatCallBtn.addEventListener('click', adminRepeatCall);
  }

  // 3. 這號好了 (自動跳下一號碼)
  if (adminElements.adminCompleteAndNextBtn) {
    adminElements.adminCompleteAndNextBtn.addEventListener('click', adminCompleteAndNext);
  }

  // 語音與音效開關
  if (adminElements.voiceToggleBtn) {
    adminElements.voiceToggleBtn.addEventListener('click', () => {
      appState.settings.voiceEnabled = !appState.settings.voiceEnabled;
      updateAudioControlsUI();
      saveState('SETTINGS_UPDATED');
    });
  }

  if (adminElements.soundToggleBtn) {
    adminElements.soundToggleBtn.addEventListener('click', () => {
      appState.settings.soundEnabled = !appState.settings.soundEnabled;
      updateAudioControlsUI();
      saveState('SETTINGS_UPDATED');
      if (appState.settings.soundEnabled) playDingDong();
    });
  }

  // 顧客手機查號 QR Code 彈窗
  const showQrBtn = document.getElementById('showQrCodeBtn');
  const qrModal = document.getElementById('qrModal');
  const closeQrBtn = document.getElementById('closeQrModalBtn');
  const copyUrlBtn = document.getElementById('copyCustomerUrlBtn');
  const qrImage = document.getElementById('qrImage');
  const qrText = document.getElementById('qrCustomerUrlText');

  function getCustomerPortalUrl() {
    let baseUrl = window.location.origin + window.location.pathname.replace(/admin\.html.*$/, 'index.html');
    if (!baseUrl.startsWith('http')) {
      baseUrl = 'https://alicejih.github.io/queue-calling-system/';
    }
    const apiUrl = getSheetApiUrl();
    if (apiUrl) {
      return `${baseUrl}?api=${encodeURIComponent(apiUrl)}`;
    }
    return baseUrl;
  }

  if (showQrBtn && qrModal) {
    showQrBtn.addEventListener('click', () => {
      const url = getCustomerPortalUrl();
      if (qrImage) {
        qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;
      }
      if (qrText) {
        qrText.textContent = url;
      }
      qrModal.classList.remove('hidden');
    });
  }
  if (copyUrlBtn) {
    copyUrlBtn.addEventListener('click', () => {
      const url = getCustomerPortalUrl();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          alert('📋 顧客查號專用網址已複製！您可以發送至 LINE 或公告。');
        }).catch(() => {
          prompt('請複製以下顧客查號連結：', url);
        });
      } else {
        prompt('請複製以下顧客查號連結：', url);
      }
    });
  }
  if (closeQrBtn && qrModal) {
    closeQrBtn.addEventListener('click', () => {
      qrModal.classList.add('hidden');
    });
  }
  if (qrModal) {
    qrModal.addEventListener('click', (e) => {
      if (e.target === qrModal) qrModal.classList.add('hidden');
    });
  }

  // Google 試算表連線設定彈窗
  const openSheetBtn = document.getElementById('openSheetSettingsBtn');
  const sheetModal = document.getElementById('sheetSettingsModal');
  const closeSheetBtn = document.getElementById('closeSheetModalBtn');
  const saveSheetBtn = document.getElementById('saveSheetUrlBtn');
  const sheetInput = document.getElementById('sheetApiUrlInput');

  if (openSheetBtn && sheetModal) {
    openSheetBtn.addEventListener('click', () => {
      if (sheetInput) sheetInput.value = getSheetApiUrl();
      sheetModal.classList.remove('hidden');
    });
  }
  if (closeSheetBtn && sheetModal) {
    closeSheetBtn.addEventListener('click', () => {
      sheetModal.classList.add('hidden');
    });
  }
  if (sheetModal) {
    sheetModal.addEventListener('click', (e) => {
      if (e.target === sheetModal) sheetModal.classList.add('hidden');
    });
  }
  if (saveSheetBtn && sheetInput) {
    saveSheetBtn.addEventListener('click', () => {
      const url = sheetInput.value.trim();
      setSheetApiUrl(url);
      alert(url ? '🎉 成功綁定 Google 試算表！系統已啟動雙向自動同步與 CSV 寫入。' : '已清除 Google 試算表網址，切換為本地模式。');
      if (sheetModal) sheetModal.classList.add('hidden');
      renderAdminUI();
    });
  }

  // 打開顧客端網頁
  if (adminElements.openCustomerViewBtn) {
    adminElements.openCustomerViewBtn.addEventListener('click', () => {
      window.open('index.html', 'CustomerWindow');
    });
  }

  // 今日重置歸零
  if (adminElements.resetAllBtn) {
    adminElements.resetAllBtn.addEventListener('click', () => {
      if (confirm('確定要清空今天所有號碼與排隊紀錄並歸零嗎？此動作將同步清除現場大螢幕！')) {
        logActivity('系統歸零重置', '--', '--', '清空今日排隊資料');
        appState.currentNumber = null;
        appState.lastIssuedNumber = 0;
        appState.waitingList = [];
        appState.completedList = [];
        saveState('RESET_ALL');
        renderAdminUI();
      }
    });
  }
}

window.addEventListener('DOMContentLoaded', initAdminView);
