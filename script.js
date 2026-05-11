/* ══════════════════════════════════════════════
   SecureBank ATM — Engine (TypeScript)
══════════════════════════════════════════════ */
// ─── AUDIO ───────────────────────────────────
let audioCtx = null;
function getAudio() {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext ||
            window
                .webkitAudioContext;
        audioCtx = new AudioContextClass();
    }
    return audioCtx;
}
function playTone(freq = 880, dur = 0.07, type = 'sine', vol = 0.15) {
    try {
        const c = getAudio();
        const o = c.createOscillator();
        const g = c.createGain();
        o.connect(g);
        g.connect(c.destination);
        o.type = type;
        o.frequency.value = freq;
        g.gain.setValueAtTime(vol, c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
        o.start();
        o.stop(c.currentTime + dur);
    }
    catch (_) { }
}
function playClick() { playTone(1200, 0.05, 'square', 0.08); }
function playSuccess() { playTone(880, 0.1); setTimeout(() => playTone(1100, 0.15), 120); }
function playError() { playTone(220, 0.25, 'sawtooth', 0.1); }
function playLogout() { playTone(660, 0.15); setTimeout(() => playTone(440, 0.2), 160); }
// ─── DATA ────────────────────────────────────
function loadData() {
    try {
        const raw = localStorage.getItem('atmData_v4');
        if (raw)
            return JSON.parse(raw);
    }
    catch (_) { }
    return {};
}
function saveData() {
    localStorage.setItem('atmData_v4', JSON.stringify(atmData));
}
function genAcctNo() {
    return ('SB-' +
        Math.floor(1000 + Math.random() * 9000) +
        '-' +
        Math.floor(1000 + Math.random() * 9000));
}
let atmData = loadData();
let currentUser = null;
// ─── CLOCK ───────────────────────────────────
function updateClock() {
    const n = new Date();
    document.getElementById('clock').textContent =
        n.toLocaleTimeString('en-US', { hour12: false });
    document.getElementById('dateDisplay').textContent =
        n.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
setInterval(updateClock, 1000);
updateClock();
// ─── SESSION TIMEOUT (2 min) ──────────────────
let sessionSecs = 120;
let sessionInterval = null;
function startSession() {
    sessionSecs = 120;
    document.getElementById('sessionBar').classList.add('active');
    if (sessionInterval)
        clearInterval(sessionInterval);
    sessionInterval = setInterval(() => {
        sessionSecs--;
        const m = String(Math.floor(sessionSecs / 60)).padStart(2, '0');
        const s = String(sessionSecs % 60).padStart(2, '0');
        document.getElementById('sessionTimer').textContent = `${m}:${s}`;
        if (sessionSecs <= 0) {
            clearInterval(sessionInterval);
            sessionTimeout();
        }
    }, 1000);
}
function stopSession() {
    if (sessionInterval)
        clearInterval(sessionInterval);
    document.getElementById('sessionBar').classList.remove('active');
}
function resetSession() { sessionSecs = 120; }
document.addEventListener('click', () => { if (currentUser)
    resetSession(); });
function sessionTimeout() {
    showLoading('SESSION EXPIRED...', 800).then(() => {
        doLogout();
        showAlert('loginAlert', 'Session timed out for security.', 'info');
    });
}
// ─── NAVIGATION ──────────────────────────────
function goTo(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById(pageId);
    if (el)
        el.classList.add('active');
    hideAllAlerts();
    if (pageId === 'page-deposit')
        document.getElementById('depositAmount').value = '';
    if (pageId === 'page-withdraw')
        document.getElementById('withdrawAmount').value = '';
    if (pageId === 'page-transfer') {
        populateTransferRecipients();
        document.getElementById('transferAmount').value = '';
    }
    if (pageId === 'page-bills') {
        selectedBill = '';
        document.querySelectorAll('.bill-card').forEach(b => b.classList.remove('selected'));
        document.getElementById('billAmountSection').style.display = 'none';
        document.getElementById('billPayBtn').style.display = 'none';
    }
    if (pageId === 'page-history')
        renderHistory();
    if (pageId === 'page-dashboard')
        refreshDashboard();
}
function hideAllAlerts() {
    document.querySelectorAll('.alert').forEach(a => {
        a.classList.remove('show', 'error', 'success', 'info');
        a.textContent = '';
    });
}
function showAlert(id, msg, type = 'error') {
    const el = document.getElementById(id);
    el.className = `alert ${type} show`;
    el.innerHTML =
        (type === 'error' ? '⚠ ' : type === 'success' ? '✔ ' : 'ℹ ') + msg;
    setTimeout(() => el.classList.remove('show'), 4500);
}
function showLoading(msg = 'PROCESSING...', ms = 1200) {
    return new Promise(resolve => {
        document.getElementById('loadingText').textContent = msg;
        document.getElementById('loadingOverlay').classList.add('active');
        setTimeout(() => {
            document.getElementById('loadingOverlay').classList.remove('active');
            resolve();
        }, ms);
    });
}
// ─── USER SELECTOR (LOGIN) ───────────────────
let selectedUserKey = null;
let pinBuffer = '';
function buildUserSelector() {
    const c = document.getElementById('userSelector');
    c.innerHTML = '';
    const keys = Object.keys(atmData);
    if (keys.length === 0) {
        c.innerHTML = '<div class="no-users-msg">No accounts yet. Create one below ↓</div>';
        return;
    }
    keys.forEach(key => {
        const u = atmData[key];
        const isLocked = !!(u.lockedUntil && Date.now() < u.lockedUntil);
        const btn = document.createElement('button');
        btn.className = 'user-btn' + (selectedUserKey === key ? ' selected' : '') + (isLocked ? ' locked' : '');
        btn.id = `ubtn-${key}`;
        btn.innerHTML = `<strong>${u.name.split(' ')[0]}</strong>${u.acct}${isLocked ? '<span class="lock-badge">🔒 LOCKED</span>' : ''}`;
        btn.onclick = () => { if (isLocked) {
            showAlert('loginAlert', 'This account is locked. Wait for the timer to expire.', 'error');
            playError();
            return;
        } selectUser(key); };
        c.appendChild(btn);
    });
}
function selectUser(key) {
    selectedUserKey = key;
    playClick();
    document.querySelectorAll('.user-btn').forEach(b => b.classList.remove('selected'));
    const el = document.getElementById(`ubtn-${key}`);
    if (el)
        el.classList.add('selected');
    pinBuffer = '';
    updatePinDots('d');
}
// ─── PIN PAD (LOGIN) ──────────────────────────
function updatePinDots(prefix) {
    for (let i = 0; i < 4; i++) {
        const d = document.getElementById(`${prefix}${i}`);
        if (d)
            d.classList.toggle('filled', i < pinBuffer.length);
    }
}
function pinKey(k) {
    if (!selectedUserKey) {
        showAlert('loginAlert', 'Please select an account first.', 'error');
        playError();
        return;
    }
    if (pinBuffer.length >= 4)
        return;
    playClick();
    pinBuffer += k;
    updatePinDots('d');
    if (pinBuffer.length === 4)
        setTimeout(pinEnter, 200);
}
function pinClear() { playClick(); pinBuffer = pinBuffer.slice(0, -1); updatePinDots('d'); }
function pinEnter() {
    var _a;
    if (!selectedUserKey) {
        showAlert('loginAlert', 'Please select an account first.', 'error');
        playError();
        return;
    }
    if (pinBuffer.length < 4) {
        showAlert('loginAlert', 'PIN must be exactly 4 digits.', 'error');
        playError();
        return;
    }
    const user = atmData[selectedUserKey];
    // ── lockout check ──
    const now = Date.now();
    if (user.lockedUntil && now < user.lockedUntil) {
        const secsLeft = Math.ceil((user.lockedUntil - now) / 1000);
        const m = Math.floor(secsLeft / 60), s = secsLeft % 60;
        playError();
        showAlert('loginAlert', `Account locked. Try again in ${m}:${String(s).padStart(2, '0')}.`, 'error');
        pinBuffer = '';
        updatePinDots('d');
        return;
    }
    if (pinBuffer !== user.pin) {
        user.failedAttempts = ((_a = user.failedAttempts) !== null && _a !== void 0 ? _a : 0) + 1;
        const remaining = 3 - user.failedAttempts;
        if (user.failedAttempts >= 3) {
            user.lockedUntil = Date.now() + 5 * 60 * 1000;
            user.failedAttempts = 0;
            saveData();
            buildUserSelector();
            playError();
            showAlert('loginAlert', 'Too many wrong PINs. Account locked for 5 minutes.', 'error');
        }
        else {
            saveData();
            playError();
            showAlert('loginAlert', `Incorrect PIN. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`, 'error');
        }
        pinBuffer = '';
        updatePinDots('d');
        return;
    }
    // success — reset failed attempts
    user.failedAttempts = 0;
    user.lockedUntil = 0;
    saveData();
    currentUser = selectedUserKey;
    pinBuffer = '';
    updatePinDots('d');
    showLoading('AUTHENTICATING...', 1400).then(() => {
        playSuccess();
        document.getElementById('sessionName').textContent = atmData[currentUser].name;
        startSession();
        refreshDashboard();
        goTo('page-dashboard');
    });
}
// ─── REGISTER FLOW ───────────────────────────
let regStep = 1;
let regTempPin = '';
let regPinBuf = '';
let regConfBuf = '';
const regLabels = [
    'Step 1 – Personal Details',
    'Step 2 – Set Your PIN',
    'Step 3 – Confirm PIN',
];
function showRegStep(n) {
    regStep = n;
    document.getElementById('regStep1').style.display = n === 1 ? '' : 'none';
    document.getElementById('regStep2').style.display = n === 2 ? '' : 'none';
    document.getElementById('regStep3').style.display = n === 3 ? '' : 'none';
    document.getElementById('regNextBtn').style.display = n === 1 ? '' : 'none';
    document.getElementById('regStepLabel').textContent = regLabels[n - 1];
    [0, 1, 2].forEach(i => {
        const el = document.getElementById(`rs${i}`);
        if (i < n - 1)
            el.className = 'reg-step done';
        else if (i === n - 1)
            el.className = 'reg-step active';
        else
            el.className = 'reg-step';
    });
    regPinBuf = '';
    regConfBuf = '';
    updateRegDots('rp');
    updateRegDots('rc');
}
function regNext() {
    const name = document.getElementById('regName').value.trim();
    const bal = parseFloat(document.getElementById('regBalance').value);
    if (!name || name.length < 2) {
        showAlert('regAlert', 'Please enter a valid full name.', 'error');
        playError();
        return;
    }
    if (isNaN(bal) || bal < 100) {
        showAlert('regAlert', 'Minimum opening balance is $100.', 'error');
        playError();
        return;
    }
    showRegStep(2);
    playClick();
}
function regBack() {
    if (regStep === 1) {
        goTo('page-login');
        return;
    }
    showRegStep(regStep - 1);
}
function updateRegDots(prefix) {
    const buf = prefix === 'rp' ? regPinBuf : regConfBuf;
    for (let i = 0; i < 4; i++) {
        const d = document.getElementById(`${prefix}${i}`);
        if (d)
            d.classList.toggle('filled', i < buf.length);
    }
}
function regPinKey(k) {
    if (regPinBuf.length >= 4)
        return;
    playClick();
    regPinBuf += k;
    updateRegDots('rp');
    if (regPinBuf.length === 4)
        setTimeout(regPinNext, 200);
}
function regPinClear() { playClick(); regPinBuf = regPinBuf.slice(0, -1); updateRegDots('rp'); }
function regPinNext() {
    if (regPinBuf.length < 4) {
        showAlert('regAlert', 'PIN must be 4 digits.', 'error');
        playError();
        return;
    }
    regTempPin = regPinBuf;
    showRegStep(3);
    playClick();
    showAlert('regAlert', 'PIN set! Now confirm it.', 'info');
}
function regConfKey(k) {
    if (regConfBuf.length >= 4)
        return;
    playClick();
    regConfBuf += k;
    updateRegDots('rc');
    if (regConfBuf.length === 4)
        setTimeout(regConfirm, 200);
}
function regConfClear() { playClick(); regConfBuf = regConfBuf.slice(0, -1); updateRegDots('rc'); }
function regConfirm() {
    if (regConfBuf.length < 4) {
        showAlert('regAlert', 'Please enter all 4 digits.', 'error');
        playError();
        return;
    }
    if (regConfBuf !== regTempPin) {
        showAlert('regAlert', 'PINs do not match. Start over.', 'error');
        playError();
        showRegStep(2);
        return;
    }
    const name = document.getElementById('regName').value.trim();
    const bal = parseFloat(document.getElementById('regBalance').value);
    const key = 'usr_' + Date.now();
    atmData[key] = { name, pin: regTempPin, balance: bal, acct: genAcctNo(), transactions: [] };
    saveData();
    showLoading('CREATING ACCOUNT...', 1600).then(() => {
        playSuccess();
        document.getElementById('regName').value = '';
        document.getElementById('regBalance').value = '';
        buildUserSelector();
        selectUser(key);
        showRegStep(1);
        goTo('page-login');
        showAlert('loginAlert', `Account created! Welcome, ${name}. Please log in.`, 'success');
    });
}
// ─── DASHBOARD ───────────────────────────────
function refreshDashboard() {
    if (!currentUser)
        return;
    const u = atmData[currentUser];
    document.getElementById('dashBalance').textContent = fmt(u.balance);
    document.getElementById('dashUser').textContent = u.name;
    document.getElementById('dashAcct').textContent = u.acct;
}
function fmt(n) {
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// ─── DEPOSIT ─────────────────────────────────
function setAmount(val) {
    playClick();
    const active = document.querySelector('.page.active');
    if (active && active.id === 'page-deposit')
        document.getElementById('depositAmount').value = String(val);
    if (active && active.id === 'page-withdraw')
        document.getElementById('withdrawAmount').value = String(val);
}
function deposit() {
    const raw = document.getElementById('depositAmount').value.trim();
    if (!raw || isNaN(Number(raw))) {
        showAlert('depositAlert', 'Please enter a valid amount.', 'error');
        playError();
        return;
    }
    const amount = parseFloat(raw);
    if (amount <= 0) {
        showAlert('depositAlert', 'Amount must be above $0.', 'error');
        playError();
        return;
    }
    if (amount > 50000) {
        showAlert('depositAlert', 'Max single deposit is $50,000.', 'error');
        playError();
        return;
    }
    showLoading('COUNTING NOTES...', 1400).then(() => {
        atmData[currentUser].balance += amount;
        addTx('deposit', amount);
        saveData();
        playSuccess();
        refreshDashboard();
        showReceipt('Deposit', amount);
    });
}
// ─── WITHDRAW ────────────────────────────────
function withdraw() {
    const raw = document.getElementById('withdrawAmount').value.trim();
    if (!raw || isNaN(Number(raw))) {
        showAlert('withdrawAlert', 'Please enter a valid amount.', 'error');
        playError();
        return;
    }
    const amount = parseFloat(raw);
    if (amount <= 0) {
        showAlert('withdrawAlert', 'Amount must be above $0.', 'error');
        playError();
        return;
    }
    const u = atmData[currentUser];
    if (amount > u.balance) {
        showAlert('withdrawAlert', `Insufficient funds. Balance: $${fmt(u.balance)}`, 'error');
        playError();
        return;
    }
    if (amount > 10000) {
        showAlert('withdrawAlert', 'Max single withdrawal is $10,000.', 'error');
        playError();
        return;
    }
    if (amount % 5 !== 0) {
        showAlert('withdrawAlert', 'Amount must be in multiples of $5.', 'error');
        playError();
        return;
    }
    showLoading('DISPENSING CASH...', 1600).then(() => {
        atmData[currentUser].balance -= amount;
        addTx('withdraw', amount);
        saveData();
        playSuccess();
        refreshDashboard();
        showReceipt('Withdrawal', amount);
    });
}
// ─── RECEIPT ─────────────────────────────────
function showReceipt(type, amount) {
    const u = atmData[currentUser];
    const now = new Date().toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
    });
    const sign = type === 'Deposit' ? '+' : '-';
    document.getElementById('receiptBox').innerHTML = `
    <div class="receipt-row"><span>SecureBank ATM</span><span>${now}</span></div>
    <div class="receipt-divider"></div>
    <div class="receipt-row"><span>Account</span><span>${u.acct}</span></div>
    <div class="receipt-row"><span>Name</span><span>${u.name}</span></div>
    <div class="receipt-divider"></div>
    <div class="receipt-row highlight"><span>${type}</span><span>${sign}$${fmt(amount)}</span></div>
    <div class="receipt-divider"></div>
    <div class="receipt-row"><span>New Balance</span><span>$${fmt(u.balance)}</span></div>
    <div class="receipt-divider"></div>
    <div class="receipt-row" style="color:var(--text-muted);font-size:9px;justify-content:center">Thank you for banking with SecureBank</div>`;
    goTo('page-receipt');
}
// ─── TRANSACTIONS ────────────────────────────
function addTx(type, amount) {
    const tx = {
        type,
        amount,
        balance: atmData[currentUser].balance,
        date: new Date().toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
        }),
    };
    atmData[currentUser].transactions.unshift(tx);
    if (atmData[currentUser].transactions.length > 50) {
        atmData[currentUser].transactions.pop();
    }
}
function renderHistory() {
    var _a, _b;
    const list = document.getElementById('txList');
    list.innerHTML = '';
    const txs = (_b = (_a = atmData[currentUser]) === null || _a === void 0 ? void 0 : _a.transactions) !== null && _b !== void 0 ? _b : [];
    if (!txs.length) {
        list.innerHTML = `<div class="tx-empty"><div class="tx-empty-icon">📭</div>No transactions yet</div>`;
        return;
    }
    txs.forEach(tx => {
        var _a, _b, _c;
        const item = document.createElement('div');
        item.className = 'tx-item';
        const icons = { deposit: '💵', withdraw: '💸', 'pin-change': '🔐', 'transfer-out': '🔄', 'transfer-in': '📥', bill: '💰' };
        const labels = { deposit: 'Deposit', withdraw: 'Withdrawal', 'pin-change': 'PIN Changed', 'transfer-out': `Transfer → ${(_a = tx.to) !== null && _a !== void 0 ? _a : ''}`, 'transfer-in': `Transfer ← ${(_b = tx.from) !== null && _b !== void 0 ? _b : ''}`, bill: `Bill – ${(_c = tx.billName) !== null && _c !== void 0 ? _c : ''}` };
        const sign = tx.type === 'deposit' || tx.type === 'transfer-in' ? '+' : tx.type === 'withdraw' || tx.type === 'transfer-out' || tx.type === 'bill' ? '-' : '';
        const showAmt = tx.type !== 'pin-change';
        item.innerHTML = `
      <div class="tx-left">
        <div class="tx-icon ${tx.type}">${icons[tx.type] || '💳'}</div>
        <div><div class="tx-type">${labels[tx.type] || tx.type}</div><div class="tx-meta">${tx.date}</div></div>
      </div>
      <div class="tx-amount ${tx.type}">${showAmt ? sign + '$' + fmt(tx.amount) : '—'}</div>`;
        list.appendChild(item);
    });
}
// ─── LOGOUT ──────────────────────────────────
function doLogout() {
    currentUser = null;
    selectedUserKey = null;
    pinBuffer = '';
    updatePinDots('d');
    stopSession();
    buildUserSelector();
    goTo('page-login');
}
function logout() {
    playLogout();
    showLoading('LOGGING OUT...', 800).then(doLogout);
}
// ─── CHANGE PIN ──────────────────────────────
let cpBuffer = '';
let cpStep = 0;
let cpNewPin = '';
const cpLabels = [
    'Step 1 – Enter Current PIN',
    'Step 2 – Enter New PIN',
    'Step 3 – Confirm New PIN',
];
function updateCPDots() {
    for (let i = 0; i < 4; i++) {
        const d = document.getElementById(`cp${i}`);
        if (d)
            d.classList.toggle('filled', i < cpBuffer.length);
    }
}
function updateCPSteps() {
    [0, 1, 2].forEach(i => {
        const el = document.getElementById(`cpStep${i}`);
        if (i < cpStep)
            el.className = 'pin-step done';
        else if (i === cpStep)
            el.className = 'pin-step active';
        else
            el.className = 'pin-step';
    });
    document.getElementById('cpLabel').textContent = cpLabels[cpStep];
}
function resetCP() {
    cpBuffer = '';
    cpStep = 0;
    cpNewPin = '';
    updateCPDots();
    updateCPSteps();
    hideAllAlerts();
}
function cpKey(k) {
    if (cpBuffer.length >= 4)
        return;
    playClick();
    cpBuffer += k;
    updateCPDots();
    if (cpBuffer.length === 4)
        setTimeout(cpEnter, 200);
}
function cpClear() { playClick(); cpBuffer = cpBuffer.slice(0, -1); updateCPDots(); }
function cpEnter() {
    if (cpBuffer.length < 4) {
        showAlert('cpAlert', 'Please enter all 4 digits.', 'error');
        playError();
        return;
    }
    if (cpStep === 0) {
        if (cpBuffer !== atmData[currentUser].pin) {
            showAlert('cpAlert', 'Current PIN is incorrect.', 'error');
            playError();
            cpBuffer = '';
            updateCPDots();
            return;
        }
        cpStep = 1;
        cpBuffer = '';
        updateCPDots();
        updateCPSteps();
        showAlert('cpAlert', 'Verified! Enter your new PIN.', 'info');
    }
    else if (cpStep === 1) {
        cpNewPin = cpBuffer;
        cpStep = 2;
        cpBuffer = '';
        updateCPDots();
        updateCPSteps();
        showAlert('cpAlert', 'Re-enter new PIN to confirm.', 'info');
    }
    else {
        if (cpBuffer !== cpNewPin) {
            showAlert('cpAlert', 'PINs do not match. Start over.', 'error');
            playError();
            resetCP();
            return;
        }
        showLoading('UPDATING PIN...', 1000).then(() => {
            atmData[currentUser].pin = cpNewPin;
            addTx('pin-change', 0);
            saveData();
            playSuccess();
            resetCP();
            showAlert('cpAlert', 'PIN changed successfully!', 'success');
            setTimeout(() => goTo('page-dashboard'), 2000);
        });
    }
}
// ─── FUND TRANSFER ───────────────────────────
function populateTransferRecipients() {
    const sel = document.getElementById('transferRecipient');
    sel.innerHTML = '<option value="">— Select recipient account —</option>';
    Object.keys(atmData).forEach(key => {
        if (key === currentUser)
            return;
        const u = atmData[key];
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = `${u.name}  (${u.acct})`;
        sel.appendChild(opt);
    });
}
function setTransferAmount(val) {
    playClick();
    document.getElementById('transferAmount').value = String(val);
}
function transfer() {
    const recipientKey = document.getElementById('transferRecipient').value;
    const raw = document.getElementById('transferAmount').value.trim();
    if (!recipientKey) {
        showAlert('transferAlert', 'Please select a recipient account.', 'error');
        playError();
        return;
    }
    if (!raw || isNaN(Number(raw))) {
        showAlert('transferAlert', 'Please enter a valid amount.', 'error');
        playError();
        return;
    }
    const amount = parseFloat(raw);
    if (amount <= 0) {
        showAlert('transferAlert', 'Amount must be above $0.', 'error');
        playError();
        return;
    }
    const sender = atmData[currentUser];
    if (amount > sender.balance) {
        showAlert('transferAlert', `Insufficient funds. Balance: $${fmt(sender.balance)}`, 'error');
        playError();
        return;
    }
    if (amount > 25000) {
        showAlert('transferAlert', 'Max single transfer is $25,000.', 'error');
        playError();
        return;
    }
    const recipient = atmData[recipientKey];
    showLoading('PROCESSING TRANSFER...', 1600).then(() => {
        sender.balance -= amount;
        recipient.balance += amount;
        const recipientName = recipient.name;
        const senderName = sender.name;
        // record outgoing
        const txOut = { type: 'transfer-out', amount, balance: sender.balance, to: recipientName,
            date: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) };
        sender.transactions.unshift(txOut);
        if (sender.transactions.length > 50)
            sender.transactions.pop();
        // record incoming on recipient
        const txIn = { type: 'transfer-in', amount, balance: recipient.balance, from: senderName,
            date: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) };
        recipient.transactions.unshift(txIn);
        if (recipient.transactions.length > 50)
            recipient.transactions.pop();
        saveData();
        playSuccess();
        refreshDashboard();
        // show receipt
        const now = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
        document.getElementById('receiptBox').innerHTML = `
      <div class="receipt-row"><span>SecureBank ATM</span><span>${now}</span></div>
      <div class="receipt-divider"></div>
      <div class="receipt-row"><span>From</span><span>${senderName}</span></div>
      <div class="receipt-row"><span>To</span><span>${recipientName}</span></div>
      <div class="receipt-divider"></div>
      <div class="receipt-row highlight"><span>Transferred</span><span>-$${fmt(amount)}</span></div>
      <div class="receipt-divider"></div>
      <div class="receipt-row"><span>New Balance</span><span>$${fmt(sender.balance)}</span></div>
      <div class="receipt-divider"></div>
      <div class="receipt-row" style="color:var(--text-muted);font-size:9px;justify-content:center">Thank you for banking with SecureBank</div>`;
        goTo('page-receipt');
    });
}
// ─── BILL PAYMENT ─────────────────────────────
let selectedBill = '';
const billNames = { mobile: 'Mobile Top-up', electricity: 'Electricity', internet: 'Internet', rent: 'Rent' };
function selectBill(type) {
    playClick();
    selectedBill = type;
    document.querySelectorAll('.bill-card').forEach(b => b.classList.remove('selected'));
    const el = document.getElementById(`bill-${type}`);
    if (el)
        el.classList.add('selected');
    document.getElementById('billAmountSection').style.display = '';
    document.getElementById('billPayBtn').style.display = '';
    document.getElementById('billAmount').value = '';
}
function setBillAmount(val) {
    playClick();
    document.getElementById('billAmount').value = String(val);
}
function payBill() {
    var _a;
    if (!selectedBill) {
        showAlert('billAlert', 'Please select a bill type.', 'error');
        playError();
        return;
    }
    const raw = document.getElementById('billAmount').value.trim();
    if (!raw || isNaN(Number(raw))) {
        showAlert('billAlert', 'Please enter a valid amount.', 'error');
        playError();
        return;
    }
    const amount = parseFloat(raw);
    if (amount <= 0) {
        showAlert('billAlert', 'Amount must be above $0.', 'error');
        playError();
        return;
    }
    const u = atmData[currentUser];
    if (amount > u.balance) {
        showAlert('billAlert', `Insufficient funds. Balance: $${fmt(u.balance)}`, 'error');
        playError();
        return;
    }
    const billName = (_a = billNames[selectedBill]) !== null && _a !== void 0 ? _a : selectedBill;
    showLoading('PROCESSING PAYMENT...', 1400).then(() => {
        atmData[currentUser].balance -= amount;
        const tx = { type: 'bill', amount, balance: atmData[currentUser].balance, billName,
            date: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) };
        atmData[currentUser].transactions.unshift(tx);
        if (atmData[currentUser].transactions.length > 50)
            atmData[currentUser].transactions.pop();
        saveData();
        playSuccess();
        refreshDashboard();
        const now = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
        document.getElementById('receiptBox').innerHTML = `
      <div class="receipt-row"><span>SecureBank ATM</span><span>${now}</span></div>
      <div class="receipt-divider"></div>
      <div class="receipt-row"><span>Account</span><span>${u.acct}</span></div>
      <div class="receipt-row"><span>Bill Type</span><span>${billName}</span></div>
      <div class="receipt-divider"></div>
      <div class="receipt-row highlight"><span>Paid</span><span>-$${fmt(amount)}</span></div>
      <div class="receipt-divider"></div>
      <div class="receipt-row"><span>New Balance</span><span>$${fmt(atmData[currentUser].balance)}</span></div>
      <div class="receipt-divider"></div>
      <div class="receipt-row" style="color:var(--text-muted);font-size:9px;justify-content:center">Thank you for banking with SecureBank</div>`;
        goTo('page-receipt');
    });
}
// ─── INIT ─────────────────────────────────────
function init() {
    showRegStep(1);
    buildUserSelector();
}
init();
