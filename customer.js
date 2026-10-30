/**
 * 智慧叫號排隊系統 - 顧客手機查號專屬邏輯 (Mobile Customer Queue Portal)
 * 專為顧客使用自己手機查閱、線上領取號碼牌、即時追蹤進度設計
 */

const MY_TICKET_STORAGE_KEY = 'MY_CUSTOMER_TICKET_NUMBER';

const customerElements = {
  // 我的號碼牌區塊
  noTicketBox: document.getElementById('noTicketBox'),
  hasTicketBox: document.getElementById('hasTicketBox'),
  myTicketNumDisplay: document.getElementById('myTicketNumDisplay'),
  myTicketStatusBox: document.getElementById('myTicketStatusBox'),
  myStatusIcon: document.getElementById('myStatusIcon'),
  myStatusTitle: document.getElementById('myStatusTitle'),
  myStatusDesc: document.getElementById('myStatusDesc'),
  myProgressBarFill: document.getElementById('myProgressBarFill'),
  resetMyTicketBtn: document.getElementById('resetMyTicketBtn'),

  // 手機取號與手動追蹤
  getTicketBtn: document.getElementById('getTicketBtn'),
  manualTicketInput: document.getElementById('manualTicketInput'),
  trackManualTicketBtn: document.getElementById('trackManualTicketBtn'),

  // 現場看板
  currentNumberDisplay: document.getElementById('currentNumberDisplay'),
  displaySubtext: document.getElementById('displaySubtext'),
  activeCounterBadge: document.getElementById('activeCounterBadge'),
  waitingCountDisplay: document.getElementById('waitingCountDisplay'),
  totalIssuedDisplay: document.getElementById('totalIssuedDisplay'),
  liveClock: document.getElementById('liveClock'),

  // 現場等候名單
  waitingGrid: document.getElementById('waitingGrid'),
  emptyWaitingNotice: document.getElementById('emptyWaitingNotice'),
  waitingBadgeCount: document.getElementById('waitingBadgeCount'),

  // 頂部控制項
  voiceToggleBtn: document.getElementById('voiceToggleBtn'),
  voiceStatusText: document.getElementById('voiceStatusText'),
  soundToggleBtn: document.getElementById('soundToggleBtn'),
  soundStatusText: document.getElementById('soundStatusText'),

  // 彈窗
  ticketModal: document.getElementById('ticketModal'),
  modalTicketNumber: document.getElementById('modalTicketNumber'),
  modalTicketMeta: document.getElementById('modalTicketMeta'),
  modalCloseBtn: document.getElementById('modalCloseBtn'),
  currentYear: document.getElementById('currentYear')
};

// 記錄這隻手機當前追蹤的號碼
let myTrackedNumber = null;
let lastNotifiedCallNumber = null;

function initCustomerView() {
  loadState();

  // 從手機本地儲存讀取這隻手機先前領取或追蹤的號碼
  const cachedMyNum = localStorage.getItem(MY_TICKET_STORAGE_KEY);
  if (cachedMyNum) {
    myTrackedNumber = parseInt(cachedMyNum, 10);
  }

  setupCustomerEventListeners();
  updateClock();
  setInterval(updateClock, 1000);
  setInterval(updateDurations, 30000);

  renderCustomerUI();
  updateAudioControlsUI();

  if (customerElements.currentYear) {
    customerElements.currentYear.textContent = new Date().getFullYear();
  }

  // 監聽來自店家櫃檯後台的即時叫號操作
  listenToSyncEvents((event) => {
    renderCustomerUI();

    // 如果輪到這隻手機的號碼，或正在叫號 (支援本地與 Google 試算表同步)
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

function updateDurations() {
  const badges = document.querySelectorAll('.item-wait-badge');
  badges.forEach(badge => {
    const ts = Number(badge.getAttribute('data-ts'));
    if (ts) {
      badge.textContent = calculateWaitDurationText(ts);
    }
  });
}

// 收到叫號事件時的顧客端處理
function handleIncomingCallEvent(calledNum, counter) {
  // 畫面數字閃爍
  if (customerElements.currentNumberDisplay) {
    customerElements.currentNumberDisplay.classList.remove('flash');
    void customerElements.currentNumberDisplay.offsetWidth;
    customerElements.currentNumberDisplay.classList.add('flash');
  }

  // 檢查是否輪到這隻手機的號碼！
  if (myTrackedNumber && myTrackedNumber === calledNum) {
    // 震動手機！(如果手機支援震動 API)
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate([400, 200, 400, 200, 400]);
      } catch (e) {}
    }

    // 播放提示音與真人廣播
    playDingDong(true);
    speakCall(calledNum, counter || appState.settings.counter, true);
  } else {
    // 一般叫號（非我的號碼時，若有開提示音則播放輕音）
    playDingDong();
    speakCall(calledNum, counter || appState.settings.counter);
  }
}

// 顧客在手機上點「立即線上領取號碼牌」
function handleCustomerTakeTicket() {
  loadState(); // 確保讀取最新發號流水號與等候名單

  // 嚴格一機一號鎖定：若這隻手機已持有有效號碼牌，禁止再次取號
  if (myTrackedNumber) {
    alert(`您目前已持有排隊號碼牌【${formatNumber(myTrackedNumber)} 號】！\n為維護現場公平秩序，每位顧客每部手機僅能領取一張有效號碼牌。\n若需重新領號，請待本次服務完成。`);
    return;
  }

  if (customerElements.getTicketBtn) {
    customerElements.getTicketBtn.disabled = true;
  }

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
  const waitPeople = appState.waitingList.length - 1;
  logActivity('顧客手機線上取號', currentNum, '', waitPeople > 0 ? `前方等候 ${waitPeople} 人` : '無人等候');
  saveState('TICKET_TAKEN', { ticket });

  // 鎖定這隻手機的專屬號碼
  setMyTrackedNumber(currentNum);

  // 顯示彈窗提示
  customerElements.modalTicketNumber.textContent = formatNumber(currentNum);
  customerElements.modalTicketMeta.textContent = waitPeople > 0
    ? `前面還有 ${waitPeople} 位在等候，手機將為您即時提醒！`
    : `目前無人等候，即將為您辦理！`;

  customerElements.ticketModal.classList.remove('hidden');
  playSuccessChime();
  renderCustomerUI();

  setTimeout(() => {
    if (customerElements.getTicketBtn) {
      customerElements.getTicketBtn.disabled = false;
    }
  }, 1000);
}

// 手動輸入已拿到的紙本號碼牌
function handleTrackManualTicket() {
  if (myTrackedNumber) {
    alert(`您目前已持有追蹤號碼牌【${formatNumber(myTrackedNumber)} 號】！\n若需追蹤其他號碼，請先確認是否已完成服務。`);
    return;
  }

  const val = parseInt(customerElements.manualTicketInput.value, 10);
  if (!val || val <= 0) {
    alert('請輸入正確的排隊號碼（例如：5）');
    return;
  }
  setMyTrackedNumber(val);
  customerElements.manualTicketInput.value = '';
  renderCustomerUI();
}

// 設定當前追蹤的號碼
function setMyTrackedNumber(num) {
  myTrackedNumber = num;
  localStorage.setItem(MY_TICKET_STORAGE_KEY, String(num));
}

// 結束本次排隊 (僅在完成服務或確認過號後可用)
function handleResetMyTicket() {
  const isCompleted = appState.completedList && appState.completedList.some(t => t.number === myTrackedNumber);
  const cur = appState.currentNumber;
  const isPassed = (cur !== null && cur > myTrackedNumber && !appState.waitingList.some(t => t.number === myTrackedNumber));

  if (isCompleted || isPassed) {
    if (confirm('確定要結束本次號碼牌並重新取號嗎？')) {
      myTrackedNumber = null;
      localStorage.removeItem(MY_TICKET_STORAGE_KEY);
      renderCustomerUI();
    }
  } else {
    alert('您的號碼牌仍在排隊隊列中，服務完成後將自動開放重新取號！');
  }
}

// 渲染顧客端手機畫面
function renderCustomerUI() {
  // 1. 現場目前叫號看板
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
      customerElements.activeCounterBadge.textContent = '待命中';
    }
    customerElements.displaySubtext.textContent = appState.waitingList.length > 0
      ? `目前有 ${appState.waitingList.length} 位貴賓等候中`
      : '目前暫無叫號中顧客';
    customerElements.displaySubtext.classList.remove('highlight');
  }

  // 統計數字
  customerElements.waitingCountDisplay.textContent = appState.waitingList.length;
  customerElements.totalIssuedDisplay.textContent = appState.lastIssuedNumber;
  if (customerElements.waitingBadgeCount) {
    customerElements.waitingBadgeCount.textContent = appState.waitingList.length;
  }

  // 2. 核心：顧客的手機號碼牌卡片狀態 (My Ticket Box)
  renderMyTicketCard();

  // 3. 現場等候名單
  renderMobileQueueList();
}

// 渲染「我的號碼牌」狀態卡片
function renderMyTicketCard() {
  if (!myTrackedNumber) {
    // 尚未領取或輸入號碼
    customerElements.noTicketBox.classList.remove('hidden');
    customerElements.hasTicketBox.classList.add('hidden');
    return;
  }

  // 已有號碼
  customerElements.noTicketBox.classList.add('hidden');
  customerElements.hasTicketBox.classList.remove('hidden');
  customerElements.myTicketNumDisplay.textContent = formatNumber(myTrackedNumber);

  const cur = appState.currentNumber;
  const isServingMe = (cur !== null && cur === myTrackedNumber);
  const myIndexInWait = appState.waitingList.findIndex(t => t.number === myTrackedNumber);
  const isCompleted = appState.completedList && appState.completedList.some(t => t.number === myTrackedNumber);

  customerElements.myTicketStatusBox.className = 'my-status-box';

  if (isServingMe) {
    // ★ 輪到我了！★
    customerElements.myTicketStatusBox.classList.add('calling-status');
    customerElements.myStatusIcon.textContent = '🔔';
    customerElements.myStatusTitle.textContent = '輪到您了！請前往辦理';
    customerElements.myStatusDesc.textContent = `請攜帶您的號碼牌，立即前往【${appState.settings.counter || '1 號櫃檯'}】辦理！`;
    customerElements.myProgressBarFill.style.width = '100%';
    if (customerElements.resetMyTicketBtn) customerElements.resetMyTicketBtn.classList.add('hidden');
  } else if (myIndexInWait !== -1) {
    // 還在等候隊列中
    customerElements.myTicketStatusBox.classList.add('waiting-status');
    customerElements.myStatusIcon.textContent = '⏳';
    const ahead = myIndexInWait;
    if (ahead === 0) {
      customerElements.myStatusTitle.textContent = '下一位即將輪到您！';
      customerElements.myStatusDesc.textContent = '您是隊列中的第一位，請至櫃檯附近準備！';
      customerElements.myProgressBarFill.style.width = '85%';
    } else {
      customerElements.myStatusTitle.textContent = `前面還有 ${ahead} 位貴賓等候中`;
      const estMin = ahead * 3;
      customerElements.myStatusDesc.textContent = `預估等候時間約 ${estMin} 分鐘，您可以先至附近休息。`;
      customerElements.myProgressBarFill.style.width = `${Math.max(15, 100 - (ahead * 15))}%`;
    }
    if (customerElements.resetMyTicketBtn) customerElements.resetMyTicketBtn.classList.add('hidden');
  } else if (isCompleted) {
    // 已經服務完成
    customerElements.myTicketStatusBox.classList.add('done-status');
    customerElements.myStatusIcon.textContent = '✅';
    customerElements.myStatusTitle.textContent = '服務已完成';
    customerElements.myStatusDesc.textContent = '感謝您的光臨，您的業務已於今日順利辦理完成！';
    customerElements.myProgressBarFill.style.width = '100%';
    if (customerElements.resetMyTicketBtn) {
      customerElements.resetMyTicketBtn.classList.remove('hidden');
      customerElements.resetMyTicketBtn.textContent = '✅ 服務已完成，結束本次排隊 / 取新號碼';
    }
  } else if (cur !== null && cur > myTrackedNumber) {
    // 可能已過號
    customerElements.myTicketStatusBox.classList.add('passed-status');
    customerElements.myStatusIcon.textContent = '⚠️';
    customerElements.myStatusTitle.textContent = '號碼可能已過號';
    customerElements.myStatusDesc.textContent = `現場目前叫至 ${formatNumber(cur)} 號，若您已在現場，請向櫃檯人員洽詢辦理。`;
    customerElements.myProgressBarFill.style.width = '100%';
    if (customerElements.resetMyTicketBtn) {
      customerElements.resetMyTicketBtn.classList.remove('hidden');
      customerElements.resetMyTicketBtn.textContent = '⚠️ 此號已過號，結束並重新取號';
    }
  } else {
    // 剛登錄
    customerElements.myTicketStatusBox.classList.add('waiting-status');
    customerElements.myStatusIcon.textContent = '⏳';
    customerElements.myStatusTitle.textContent = '號碼牌已登錄';
    customerElements.myStatusDesc.textContent = '系統隨時為您追蹤現場最新叫號進度！';
    customerElements.myProgressBarFill.style.width = '20%';
    if (customerElements.resetMyTicketBtn) customerElements.resetMyTicketBtn.classList.add('hidden');
  }
}

// 渲染現場等候名單 (手機簡潔版)
function renderMobileQueueList() {
  customerElements.waitingGrid.innerHTML = '';
  if (appState.waitingList.length === 0) {
    customerElements.emptyWaitingNotice.classList.remove('hidden');
  } else {
    customerElements.emptyWaitingNotice.classList.add('hidden');
    appState.waitingList.forEach(ticket => {
      const isCurrent = (ticket.number === appState.currentNumber);
      const isMine = (myTrackedNumber && ticket.number === myTrackedNumber);
      const card = document.createElement('div');
      card.className = `ticket-item-card customer-view ${isCurrent ? 'is-current' : ''} ${isMine ? 'is-mine' : ''}`;

      card.innerHTML = `
        <span class="ticket-badge-current">
          ${isMine ? '★ 您的號碼' : (isCurrent ? '🔔 叫號中' : '等候中')}
        </span>
        <div class="card-num-row">
          <span class="item-num">${formatNumber(ticket.number)}</span>
          <span class="item-wait-badge" data-ts="${ticket.timestamp}">${calculateWaitDurationText(ticket.timestamp)}</span>
        </div>
        <div class="item-time-info">取號時間：${ticket.time}</div>
      `;

      customerElements.waitingGrid.appendChild(card);
    });
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
  // 線上取號
  customerElements.getTicketBtn.addEventListener('click', handleCustomerTakeTicket);

  // 手動追蹤紙本號碼
  customerElements.trackManualTicketBtn.addEventListener('click', handleTrackManualTicket);
  customerElements.manualTicketInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleTrackManualTicket();
  });

  // 結束本次排隊 / 取新號碼 (僅在完成服務或確認過號後生效)
  if (customerElements.resetMyTicketBtn) {
    customerElements.resetMyTicketBtn.addEventListener('click', handleResetMyTicket);
  }

  // 關閉小票彈窗
  customerElements.modalCloseBtn.addEventListener('click', () => {
    customerElements.ticketModal.classList.add('hidden');
  });
  customerElements.ticketModal.addEventListener('click', (e) => {
    if (e.target === customerElements.ticketModal) {
      customerElements.ticketModal.classList.add('hidden');
    }
  });

  // 音效與語音開關
  customerElements.voiceToggleBtn.addEventListener('click', () => {
    appState.settings.voiceEnabled = !appState.settings.voiceEnabled;
    updateAudioControlsUI();
    saveState('SETTINGS_UPDATED');
  });

  customerElements.soundToggleBtn.addEventListener('click', () => {
    appState.settings.soundEnabled = !appState.settings.soundEnabled;
    updateAudioControlsUI();
    saveState('SETTINGS_UPDATED');
    if (appState.settings.soundEnabled) playDingDong();
  });
}

window.addEventListener('DOMContentLoaded', initCustomerView);
