/**
 * 智慧叫號排隊系統 - 管理端 / 櫃檯控制台邏輯 (Operator & Admin Console Logic)
 * 專為櫃檯人員、店員、護理師與後台管理設計
 */

const adminElements = {
  // 叫號控制台
  adminCurrentNumber: document.getElementById('adminCurrentNumber'),
  adminCounterSelect: document.getElementById('adminCounterSelect'),
  adminCallNextBtn: document.getElementById('adminCallNextBtn'),
  adminCallPrevBtn: document.getElementById('adminCallPrevBtn'),
  adminRepeatCallBtn: document.getElementById('adminRepeatCallBtn'),
  adminIssueTicketBtn: document.getElementById('adminIssueTicketBtn'),
  adminStatusSummary: document.getElementById('adminStatusSummary'),

  // 清單區
  waitingGrid: document.getElementById('adminWaitingGrid'),
  emptyWaitingNotice: document.getElementById('adminEmptyWaitingNotice'),
  completedTableBody: document.getElementById('adminCompletedTableBody'),
  emptyCompletedNotice: document.getElementById('adminEmptyCompletedNotice'),
  waitingListContainer: document.getElementById('waitingListContainer'),
  completedListContainer: document.getElementById('completedListContainer'),

  // 計數器標籤
  tabWaitingCount: document.getElementById('tabWaitingCount'),
  tabCompletedCount: document.getElementById('tabCompletedCount'),
  adminWaitingTotal: document.getElementById('adminWaitingTotal'),
  adminIssuedTotal: document.getElementById('adminIssuedTotal'),
  adminCompletedTotal: document.getElementById('adminCompletedTotal'),
  tabBtns: document.querySelectorAll('.tab-btn'),

  // 頂部控制項
  voiceToggleBtn: document.getElementById('voiceToggleBtn'),
  voiceStatusText: document.getElementById('voiceStatusText'),
  soundToggleBtn: document.getElementById('soundToggleBtn'),
  soundStatusText: document.getElementById('soundStatusText'),
  openCustomerViewBtn: document.getElementById('openCustomerViewBtn'),
  resetAllBtn: document.getElementById('resetAllBtn'),
  currentYear: document.getElementById('currentYear')
};

function initAdminView() {
  loadState();
  setupAdminEventListeners();
  setInterval(updateDurations, 30000);

  if (adminElements.adminCounterSelect) {
    adminElements.adminCounterSelect.value = appState.settings.counter || '1 號櫃檯';
  }

  renderAdminUI();
  updateAudioControlsUI();

  if (adminElements.currentYear) {
    adminElements.currentYear.textContent = new Date().getFullYear();
  }

  // 監聽顧客端或其他視窗更新
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
  getAudioContext();
  appState.currentNumber = number;
  const currentCounter = appState.settings.counter || '1 號櫃檯';

  saveState('CALL_NUMBER', {
    number: number,
    counter: currentCounter
  });

  renderAdminUI();

  // 本地也播放
  playDingDong();
  speakCall(number, currentCounter);
}

// 叫下一號
function adminCallNext() {
  if (appState.waitingList.length === 0) {
    alert('目前沒有等候中的號碼！可點擊上方「櫃檯代客發號」。');
    return;
  }

  let targetTicket = null;
  if (appState.currentNumber === null) {
    targetTicket = appState.waitingList[0];
  } else {
    const currentIndex = appState.waitingList.findIndex(t => t.number === appState.currentNumber);
    if (currentIndex !== -1 && currentIndex + 1 < appState.waitingList.length) {
      targetTicket = appState.waitingList[currentIndex + 1];
    } else {
      targetTicket = appState.waitingList.find(t => t.number > (appState.currentNumber || 0)) || appState.waitingList[0];
    }
  }

  if (targetTicket) {
    adminCall(targetTicket.number);
  }
}

// 上一號
function adminCallPrev() {
  if (appState.waitingList.length === 0) return;
  const currentIndex = appState.waitingList.findIndex(t => t.number === appState.currentNumber);
  if (currentIndex > 0) {
    adminCall(appState.waitingList[currentIndex - 1].number);
  } else {
    adminCall(appState.waitingList[0].number);
  }
}

// 重新叫號
function adminRepeatCall() {
  if (appState.currentNumber === null) {
    if (appState.waitingList.length > 0) {
      adminCall(appState.waitingList[0].number);
    } else {
      alert('目前尚無叫號中的號碼！');
    }
    return;
  }
  adminCall(appState.currentNumber);
}

// 櫃檯代客發號
function adminIssueTicket() {
  getAudioContext();
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

  renderAdminUI();
  playSuccessChime();
}

// 核心功能 3：點擊列表號碼代表這一號好了！
function markTicketCompleted(ticketId) {
  const index = appState.waitingList.findIndex(t => t.id === ticketId);
  if (index === -1) return;

  const ticket = appState.waitingList[index];
  const now = new Date();
  const durationMinutes = Math.max(1, Math.round((now.getTime() - ticket.timestamp) / 60000));

  // 從等候移至已完成
  appState.waitingList.splice(index, 1);
  appState.completedList.unshift({
    ...ticket,
    completedTime: getTimeString(now),
    duration: durationMinutes
  });

  playSuccessChime();

  // 若標記完成的是目前叫號中的號碼，自動順延
  if (appState.currentNumber === ticket.number) {
    if (appState.waitingList.length > 0) {
      const nextTicket = appState.waitingList[0];
      appState.currentNumber = nextTicket.number;
      setTimeout(() => {
        adminCall(nextTicket.number);
      }, 350);
    } else {
      appState.currentNumber = null;
    }
  }

  saveState('TICKET_COMPLETED', { ticketId });
  renderAdminUI();
}

// 誤按復原
function undoCompleted(ticketId) {
  const idx = appState.completedList.findIndex(t => t.id === ticketId);
  if (idx === -1) return;
  const item = appState.completedList.splice(idx, 1)[0];
  appState.waitingList.push({
    id: item.id,
    number: item.number,
    time: item.time,
    timestamp: item.timestamp
  });

  appState.waitingList.sort((a, b) => a.number - b.number);
  saveState('TICKET_RESTORED');
  renderAdminUI();
}

// 渲染管理端介面
function renderAdminUI() {
  // 1. 叫號面板
  if (appState.currentNumber !== null) {
    adminElements.adminCurrentNumber.textContent = formatNumber(appState.currentNumber);
    adminElements.adminStatusSummary.textContent = `正呼叫 ${formatNumber(appState.currentNumber)} 號至 ${appState.settings.counter || '1 號櫃檯'}`;
    adminElements.adminStatusSummary.className = 'admin-status-text active';
  } else {
    adminElements.adminCurrentNumber.textContent = '---';
    adminElements.adminStatusSummary.textContent = appState.waitingList.length > 0
      ? `等待叫號：尚有 ${appState.waitingList.length} 位顧客等候中`
      : '目前無待辦號碼，可點「代客發號」或等候顧客抽號';
    adminElements.adminStatusSummary.className = 'admin-status-text';
  }

  // 2. 統計數據
  if (adminElements.tabWaitingCount) adminElements.tabWaitingCount.textContent = appState.waitingList.length;
  if (adminElements.tabCompletedCount) adminElements.tabCompletedCount.textContent = appState.completedList.length;
  if (adminElements.adminWaitingTotal) adminElements.adminWaitingTotal.textContent = appState.waitingList.length;
  if (adminElements.adminIssuedTotal) adminElements.adminIssuedTotal.textContent = appState.lastIssuedNumber;
  if (adminElements.adminCompletedTotal) adminElements.adminCompletedTotal.textContent = appState.completedList.length;

  // 3. 等候清單（點擊代表這一號好了）
  adminElements.waitingGrid.innerHTML = '';
  if (appState.waitingList.length === 0) {
    adminElements.emptyWaitingNotice.classList.remove('hidden');
  } else {
    adminElements.emptyWaitingNotice.classList.add('hidden');
    appState.waitingList.forEach(ticket => {
      const isCurrent = (ticket.number === appState.currentNumber);
      const card = document.createElement('div');
      card.className = `ticket-item-card admin-interactive ${isCurrent ? 'is-current' : ''}`;
      card.title = `點擊卡片標記「${formatNumber(ticket.number)} 號」服務完成`;

      card.innerHTML = `
        <span class="ticket-badge-current">${isCurrent ? '🔔 叫號中' : '等候中'}</span>
        <div class="card-num-row">
          <span class="item-num">${formatNumber(ticket.number)}</span>
          <span class="item-wait-badge" data-ts="${ticket.timestamp}">${calculateWaitDurationText(ticket.timestamp)}</span>
        </div>
        <div class="item-time-info">取號時間：${ticket.time}</div>
        
        <div class="admin-card-actions">
          <button class="call-this-btn" type="button" title="直接廣播叫此號">
            📢 叫此號
          </button>
          <button class="click-to-finish-btn" type="button" title="標記完成">
            ✅ 這號好了
          </button>
        </div>
      `;

      // 點擊「叫此號」
      const callBtn = card.querySelector('.call-this-btn');
      callBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        adminCall(ticket.number);
      });

      // 點擊卡片或「這號好了」標記完成
      card.addEventListener('click', () => {
        markTicketCompleted(ticket.id);
      });

      adminElements.waitingGrid.appendChild(card);
    });
  }

  // 4. 已完成清單
  adminElements.completedTableBody.innerHTML = '';
  if (appState.completedList.length === 0) {
    adminElements.emptyCompletedNotice.classList.remove('hidden');
  } else {
    adminElements.emptyCompletedNotice.classList.add('hidden');
    appState.completedList.forEach(ticket => {
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

      adminElements.completedTableBody.appendChild(tr);
    });
  }
}

function updateAudioControlsUI() {
  if (adminElements.voiceToggleBtn) {
    if (appState.settings.voiceEnabled) {
      adminElements.voiceToggleBtn.classList.add('active');
      adminElements.voiceStatusText.textContent = '開啟';
    } else {
      adminElements.voiceToggleBtn.classList.remove('active');
      adminElements.voiceStatusText.textContent = '靜音';
    }
  }

  if (adminElements.soundToggleBtn) {
    if (appState.settings.soundEnabled) {
      adminElements.soundToggleBtn.classList.add('active');
      adminElements.soundStatusText.textContent = '開啟';
    } else {
      adminElements.soundToggleBtn.classList.remove('active');
      adminElements.soundStatusText.textContent = '靜音';
    }
  }
}

function setupAdminEventListeners() {
  // 叫號控制
  adminElements.adminCallNextBtn.addEventListener('click', adminCallNext);
  adminElements.adminCallPrevBtn.addEventListener('click', adminCallPrev);
  adminElements.adminRepeatCallBtn.addEventListener('click', adminRepeatCall);
  adminElements.adminIssueTicketBtn.addEventListener('click', adminIssueTicket);

  // 櫃檯切換
  adminElements.adminCounterSelect.addEventListener('change', (e) => {
    appState.settings.counter = e.target.value;
    saveState('SETTINGS_UPDATED');
    renderAdminUI();
  });

  // 頁籤切換
  adminElements.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      adminElements.tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const tab = btn.dataset.tab;
      if (tab === 'waiting') {
        adminElements.waitingListContainer.classList.remove('hidden');
        adminElements.completedListContainer.classList.add('hidden');
      } else {
        adminElements.waitingListContainer.classList.add('hidden');
        adminElements.completedListContainer.classList.remove('hidden');
      }
    });
  });

  // 音效與語音
  adminElements.voiceToggleBtn.addEventListener('click', () => {
    appState.settings.voiceEnabled = !appState.settings.voiceEnabled;
    updateAudioControlsUI();
    saveState('SETTINGS_UPDATED');
  });

  adminElements.soundToggleBtn.addEventListener('click', () => {
    appState.settings.soundEnabled = !appState.settings.soundEnabled;
    updateAudioControlsUI();
    saveState('SETTINGS_UPDATED');
    if (appState.settings.soundEnabled) playDingDong();
  });

  // 打開顧客大看板 (在新視窗開啟，方便雙螢幕顯示)
  if (adminElements.openCustomerViewBtn) {
    adminElements.openCustomerViewBtn.addEventListener('click', () => {
      window.open('index.html', 'CustomerDisplayWindow');
    });
  }

  // 重置歸零
  adminElements.resetAllBtn.addEventListener('click', () => {
    if (confirm('確定要清空今天所有號碼與排隊紀錄並歸零嗎？此動作將同步清除現場大螢幕！')) {
      appState.currentNumber = null;
      appState.lastIssuedNumber = 0;
      appState.waitingList = [];
      appState.completedList = [];
      saveState('RESET_ALL');
      renderAdminUI();
    }
  });
}

window.addEventListener('DOMContentLoaded', initAdminView);
