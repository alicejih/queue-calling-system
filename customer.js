/**
 * 智慧叫號排隊系統 - 顧客端邏輯 (Customer / Public Display Logic)
 * 專為現場顧客、候診/等候大螢幕、取號平板設計
 */

const customerElements = {
  // 大看板
  currentNumberDisplay: document.getElementById('currentNumberDisplay'),
  displaySubtext: document.getElementById('displaySubtext'),
  activeCounterBadge: document.getElementById('activeCounterBadge'),

  // 取號區
  getTicketBtn: document.getElementById('getTicketBtn'),
  lastTicketNumber: document.getElementById('lastTicketNumber'),
  lastTicketTime: document.getElementById('lastTicketTime'),
  waitingCountDisplay: document.getElementById('waitingCountDisplay'),
  totalIssuedDisplay: document.getElementById('totalIssuedDisplay'),
  liveClock: document.getElementById('liveClock'),

  // 等候進度看板 (只讀，不可標記完成)
  waitingGrid: document.getElementById('waitingGrid'),
  emptyWaitingNotice: document.getElementById('emptyWaitingNotice'),
  waitingBadgeCount: document.getElementById('waitingBadgeCount'),

  // 頂部控制項
  voiceToggleBtn: document.getElementById('voiceToggleBtn'),
  voiceStatusText: document.getElementById('voiceStatusText'),
  soundToggleBtn: document.getElementById('soundToggleBtn'),
  soundStatusText: document.getElementById('soundStatusText'),
  fullscreenBtn: document.getElementById('fullscreenBtn'),

  // 取號成功彈窗
  ticketModal: document.getElementById('ticketModal'),
  modalTicketNumber: document.getElementById('modalTicketNumber'),
  modalTicketMeta: document.getElementById('modalTicketMeta'),
  modalCloseBtn: document.getElementById('modalCloseBtn'),
  currentYear: document.getElementById('currentYear')
};

function initCustomerView() {
  loadState();
  setupCustomerEventListeners();
  updateClock();
  setInterval(updateClock, 1000);
  setInterval(updateDurations, 30000);

  renderCustomerUI();
  updateAudioControlsUI();

  if (customerElements.currentYear) {
    customerElements.currentYear.textContent = new Date().getFullYear();
  }

  // 監聽來自管理端後台的即時操作 (叫號、標記完成、重置等)
  listenToSyncEvents((event) => {
    if (event.type === 'CALL_NUMBER') {
      triggerCallingEffect(event.number, event.counter);
    }
    renderCustomerUI();
  });
}

function updateClock() {
  if (customerElements.liveClock) {
    customerElements.liveClock.textContent = getTimeString();
  }
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

// 觸發大螢幕叫號特效與廣播
function triggerCallingEffect(number, counter) {
  // 畫面數字跳動與發光閃爍
  if (customerElements.currentNumberDisplay) {
    customerElements.currentNumberDisplay.classList.remove('flash');
    void customerElements.currentNumberDisplay.offsetWidth; // 強制重繪
    customerElements.currentNumberDisplay.classList.add('flash');
  }

  // 播放叮咚與語音
  playDingDong();
  speakCall(number, counter || appState.settings.counter);
}

// 顧客取號動作
function handleCustomerTakeTicket() {
  getAudioContext(); // 解鎖瀏覽器音效限制

  appState.lastIssuedNumber += 1;
  const currentNum = appState.lastIssuedNumber;
  const now = new Date();

  const ticket = {
    id: 'T-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
    number: currentNum,
    time: getTimeString(now),
    timestamp: now.getTime()
  };

  appState.waitingList.push(ticket);
  saveState('TICKET_TAKEN', { ticket });

  renderCustomerUI();

  // 彈窗顯示號碼
  const formatted = formatNumber(currentNum);
  customerElements.modalTicketNumber.textContent = formatted;
  const waitPeople = appState.waitingList.length - 1;
  customerElements.modalTicketMeta.textContent = waitPeople > 0
    ? `前面還有 ${waitPeople} 位在等候，請留意現場叫號大螢幕！`
    : `目前無人等候，請留意即將為您叫號！`;

  customerElements.ticketModal.classList.remove('hidden');
  playSuccessChime();
}

// 渲染顧客端畫面
function renderCustomerUI() {
  // 1. 叫號大看板
  if (appState.currentNumber !== null) {
    customerElements.currentNumberDisplay.textContent = formatNumber(appState.currentNumber);
    if (customerElements.activeCounterBadge) {
      customerElements.activeCounterBadge.textContent = appState.settings.counter || '1 號櫃檯';
    }
    customerElements.displaySubtext.textContent = `請 ${formatNumber(appState.currentNumber)} 號至 ${appState.settings.counter || '櫃檯'} 辦理`;
    customerElements.displaySubtext.classList.add('highlight');
  } else {
    customerElements.currentNumberDisplay.textContent = '---';
    if (customerElements.activeCounterBadge) {
      customerElements.activeCounterBadge.textContent = '櫃檯待命中';
    }
    customerElements.displaySubtext.textContent = appState.waitingList.length > 0
      ? `目前有 ${appState.waitingList.length} 位貴賓等候中，請稍候`
      : '目前暫無叫號中顧客，歡迎點擊右側按鈕取號';
    customerElements.displaySubtext.classList.remove('highlight');
  }

  // 2. 取號統計
  customerElements.waitingCountDisplay.textContent = appState.waitingList.length;
  customerElements.totalIssuedDisplay.textContent = appState.lastIssuedNumber;
  if (customerElements.waitingBadgeCount) {
    customerElements.waitingBadgeCount.textContent = appState.waitingList.length;
  }

  if (appState.lastIssuedNumber > 0) {
    customerElements.lastTicketNumber.textContent = formatNumber(appState.lastIssuedNumber);
    const lastItem = appState.waitingList.find(t => t.number === appState.lastIssuedNumber);
    customerElements.lastTicketTime.textContent = lastItem ? `取號時間 ${lastItem.time}` : '已開始服務';
  } else {
    customerElements.lastTicketNumber.textContent = '--';
    customerElements.lastTicketTime.textContent = '今日尚無取號';
  }

  // 3. 現場等候號碼進度（純展示，顧客不可標記完成）
  customerElements.waitingGrid.innerHTML = '';
  if (appState.waitingList.length === 0) {
    customerElements.emptyWaitingNotice.classList.remove('hidden');
  } else {
    customerElements.emptyWaitingNotice.classList.add('hidden');
    appState.waitingList.forEach(ticket => {
      const isCurrent = (ticket.number === appState.currentNumber);
      const card = document.createElement('div');
      card.className = `ticket-item-card customer-view ${isCurrent ? 'is-current' : ''}`;

      card.innerHTML = `
        <span class="ticket-badge-current">${isCurrent ? '🔔 叫號中' : '⏳ 等候中'}</span>
        <div class="card-num-row">
          <span class="item-num">${formatNumber(ticket.number)}</span>
          <span class="item-wait-badge" data-ts="${ticket.timestamp}">${calculateWaitDurationText(ticket.timestamp)}</span>
        </div>
        <div class="item-time-info">取號時間：${ticket.time}</div>
        <div class="customer-card-status">
          ${isCurrent ? '★ 請至櫃檯辦理 ★' : '請留意叫號廣播'}
        </div>
      `;

      customerElements.waitingGrid.appendChild(card);
    });
  }
}

function updateAudioControlsUI() {
  if (customerElements.voiceToggleBtn) {
    if (appState.settings.voiceEnabled) {
      customerElements.voiceToggleBtn.classList.add('active');
      customerElements.voiceStatusText.textContent = '開啟';
    } else {
      customerElements.voiceToggleBtn.classList.remove('active');
      customerElements.voiceStatusText.textContent = '靜音';
    }
  }

  if (customerElements.soundToggleBtn) {
    if (appState.settings.soundEnabled) {
      customerElements.soundToggleBtn.classList.add('active');
      customerElements.soundStatusText.textContent = '開啟';
    } else {
      customerElements.soundToggleBtn.classList.remove('active');
      customerElements.soundStatusText.textContent = '靜音';
    }
  }
}

function setupCustomerEventListeners() {
  // 取號
  customerElements.getTicketBtn.addEventListener('click', handleCustomerTakeTicket);

  // 關閉小票彈窗
  customerElements.modalCloseBtn.addEventListener('click', () => {
    customerElements.ticketModal.classList.add('hidden');
  });
  customerElements.ticketModal.addEventListener('click', (e) => {
    if (e.target === customerElements.ticketModal) {
      customerElements.ticketModal.classList.add('hidden');
    }
  });

  // 音效與語音
  if (customerElements.voiceToggleBtn) {
    customerElements.voiceToggleBtn.addEventListener('click', () => {
      appState.settings.voiceEnabled = !appState.settings.voiceEnabled;
      updateAudioControlsUI();
      saveState('SETTINGS_UPDATED');
    });
  }

  if (customerElements.soundToggleBtn) {
    customerElements.soundToggleBtn.addEventListener('click', () => {
      appState.settings.soundEnabled = !appState.settings.soundEnabled;
      updateAudioControlsUI();
      saveState('SETTINGS_UPDATED');
      if (appState.settings.soundEnabled) playDingDong();
    });
  }

  // 全螢幕
  if (customerElements.fullscreenBtn) {
    customerElements.fullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        if (document.exitFullscreen) document.exitFullscreen();
      }
    });
  }
}

window.addEventListener('DOMContentLoaded', initCustomerView);
