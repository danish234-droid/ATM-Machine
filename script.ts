/* ══════════════════════════════════════════════
   SecureBank ATM — Engine (TypeScript)
══════════════════════════════════════════════ */

// ─── TYPES & INTERFACES ──────────────────────

type TxType = 'deposit' | 'withdraw' | 'pin-change' | 'transfer-out' | 'transfer-in' | 'bill';
type AlertType = 'error' | 'success' | 'info';

interface Transaction {
  type: TxType;
  amount: number;
  balance: number;
  date: string;
}

interface UserAccount {
  name: string;
  pin: string;
  balance: number;
  acct: string;
  transactions: Transaction[];
  failedAttempts?: number;
  lockedUntil?: number;
}

interface AtmDataStore {
  [key: string]: UserAccount;
}

// ─── AUDIO ───────────────────────────────────

let audioCtx: AudioContext | null = null;

function getAudio(): AudioContext {
  if (!audioCtx) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  return audioCtx;
}

function playTone(
  freq: number = 880,
  dur: number = 0.07,
  type: OscillatorType = 'sine',
  vol: number = 0.15
): void {
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
  } catch (_) {}
}

function playClick(): void   { playTone(1200, 0.05, 'square', 0.08); }
function playSuccess(): void { playTone(880, 0.1); setTimeout(() => playTone(1100, 0.15), 120); }
function playError(): void   { playTone(220, 0.25, 'sawtooth', 0.1); }
function playLogout(): void  { playTone(660, 0.15); setTimeout(() => playTone(440, 0.2), 160); }

// ─── DATA ────────────────────────────────────

function loadData(): AtmDataStore {
  try {
    const raw = localStorage.getItem('atmData_v4');
    if (raw) return JSON.parse(raw) as AtmDataStore;
  } catch (_) {}
  return {};
}

function saveData(): void {
  localStorage.setItem('atmData_v4', JSON.stringify(atmData));
}

function genAcctNo(): string {
  return (
    'SB-' +
    Math.floor(1000 + Math.random() * 9000) +
    '-' +
    Math.floor(1000 + Math.random() * 9000)
  );
}

let atmData: AtmDataStore = loadData();
let currentUser: string | null = null;

// ─── CLOCK ───────────────────────────────────

function updateClock(): void {
  const n = new Date();
  (document.getElementById('clock') as HTMLElement).textContent =
    n.toLocaleTimeString('en-US', { hour12: false });
  (document.getElementById('dateDisplay') as HTMLElement).textContent =
    n.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
setInterval(updateClock, 1000);
updateClock();

// ─── SESSION TIMEOUT (2 min) ──────────────────

let sessionSecs: number = 120;
let sessionInterval: ReturnType<typeof setInterval> | null = null;

function startSession(): void {
  sessionSecs = 120;
  document.getElementById('sessionBar')!.classList.add('active');
  if (sessionInterval) clearInterval(sessionInterval);
  sessionInterval = setInterval(() => {
    sessionSecs--;
    const m = String(Math.floor(sessionSecs / 60)).padStart(2, '0');
    const s = String(sessionSecs % 60).padStart(2, '0');
    (document.getElementById('sessionTimer') as HTMLElement).textContent = `${m}:${s}`;
    if (sessionSecs <= 0) {
      clearInterval(sessionInterval!);
      sessionTimeout();
    }
  }, 1000);
}

function stopSession(): void {
  if (sessionInterval) clearInterval(sessionInterval);
  document.getElementById('sessionBar')!.classList.remove('active');
}

function resetSession(): void { sessionSecs = 120; }

document.addEventListener('click', () => { if (currentUser) resetSession(); });

function sessionTimeout(): void {
  showLoading('SESSION EXPIRED...', 800).then(() => {
    doLogout();
    showAlert('loginAlert', 'Session timed out for security.', 'info');
  });
}

// ─── NAVIGATION ──────────────────────────────

function goTo(pageId: string): void {
  document.querySelectorAll<HTMLElement>('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById(pageId);
  if (el) el.classList.add('active');
  hideAllAlerts();
  if (pageId === 'page-deposit')
    (document.getElementById('depositAmount') as HTMLInputElement).value = '';
  if (pageId === 'page-withdraw')
    (document.getElementById('withdrawAmount') as HTMLInputElement).value = '';
  if (pageId === 'page-transfer')  { populateTransferRecipients(); (document.getElementById('transferAmount') as HTMLInputElement).value = ''; }
  if (pageId === 'page-bills')     { selectedBill = ''; document.querySelectorAll<HTMLElement>('.bill-card').forEach(b => b.classList.remove('selected')); (document.getElementById('billAmountSection') as HTMLElement).style.display = 'none'; (document.getElementById('billPayBtn') as HTMLElement).style.display = 'none'; }
  if (pageId === 'page-history')   renderHistory();
  if (pageId === 'page-dashboard') refreshDashboard();
}

function hideAllAlerts(): void {
  document.querySelectorAll<HTMLElement>('.alert').forEach(a => {
    a.classList.remove('show', 'error', 'success', 'info');
    a.textContent = '';
  });
}

function showAlert(id: string, msg: string, type: AlertType = 'error'): void {
  const el = document.getElementById(id) as HTMLElement;
  el.className = `alert ${type} show`;
  el.innerHTML =
    (type === 'error' ? '⚠ ' : type === 'success' ? '✔ ' : 'ℹ ') + msg;
  setTimeout(() => el.classList.remove('show'), 4500);
}

function showLoading(msg: string = 'PROCESSING...', ms: number = 1200): Promise<void> {
  return new Promise(resolve => {
    (document.getElementById('loadingText') as HTMLElement).textContent = msg;
    document.getElementById('loadingOverlay')!.classList.add('active');
    setTimeout(() => {
      document.getElementById('loadingOverlay')!.classList.remove('active');
      resolve();
    }, ms);
  });
}

// ─── USER SELECTOR (LOGIN) ───────────────────

let selectedUserKey: string | null = null;
let pinBuffer: string = '';

function buildUserSelector(): void {
  const c = document.getElementById('userSelector') as HTMLElement;
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
    btn.onclick = () => { if (isLocked) { showAlert('loginAlert', 'This account is locked. Wait for the timer to expire.', 'error'); playError(); return; } selectUser(key); };
    c.appendChild(btn);
  });
}

function selectUser(key: string): void {
  selectedUserKey = key;
  playClick();
  document.querySelectorAll<HTMLElement>('.user-btn').forEach(b => b.classList.remove('selected'));
  const el = document.getElementById(`ubtn-${key}`);
  if (el) el.classList.add('selected');
  pinBuffer = '';
  updatePinDots('d');
}

// ─── PIN PAD (LOGIN) ──────────────────────────

function updatePinDots(prefix: string): void {
  for (let i = 0; i < 4; i++) {
    const d = document.getElementById(`${prefix}${i}`);
    if (d) d.classList.toggle('filled', i < pinBuffer.length);
  }
}

function pinKey(k: string): void {
  if (!selectedUserKey) { showAlert('loginAlert', 'Please select an account first.', 'error'); playError(); return; }
  if (pinBuffer.length >= 4) return;
  playClick();
  pinBuffer += k;
  updatePinDots('d');
  if (pinBuffer.length === 4) setTimeout(pinEnter, 200);
}

function pinClear(): void { playClick(); pinBuffer = pinBuffer.slice(0, -1); updatePinDots('d'); }

function pinEnter(): void {
  if (!selectedUserKey) { showAlert('loginAlert', 'Please select an account first.', 'error'); playError(); return; }
  if (pinBuffer.length < 4) { showAlert('loginAlert', 'PIN must be exactly 4 digits.', 'error'); playError(); return; }
  const user = atmData[selectedUserKey];

  // ── lockout check ──
  const now = Date.now();
  if (user.lockedUntil && now < user.lockedUntil) {
    const secsLeft = Math.ceil((user.lockedUntil - now) / 1000);
    const m = Math.floor(secsLeft / 60), s = secsLeft % 60;
    playError();
    showAlert('loginAlert', `Account locked. Try again in ${m}:${String(s).padStart(2,'0')}.`, 'error');
    pinBuffer = ''; updatePinDots('d'); return;
  }

  if (pinBuffer !== user.pin) {
    user.failedAttempts = (user.failedAttempts ?? 0) + 1;
    const remaining = 3 - user.failedAttempts;
    if (user.failedAttempts >= 3) {
      user.lockedUntil = Date.now() + 5 * 60 * 1000;
      user.failedAttempts = 0;
      saveData(); buildUserSelector();
      playError();
      showAlert('loginAlert', 'Too many wrong PINs. Account locked for 5 minutes.', 'error');
    } else {
      saveData();
      playError();
      showAlert('loginAlert', `Incorrect PIN. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`, 'error');
    }
    pinBuffer = ''; updatePinDots('d'); return;
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
    (document.getElementById('sessionName') as HTMLElement).textContent = atmData[currentUser!].name;
    startSession();
    refreshDashboard();
    goTo('page-dashboard');
  });
}

// ─── REGISTER FLOW ───────────────────────────

let regStep: number = 1;
let regTempPin: string = '';
let regPinBuf: string = '';
let regConfBuf: string = '';

const regLabels: string[] = [
  'Step 1 – Personal Details',
  'Step 2 – Set Your PIN',
  'Step 3 – Confirm PIN',
];

function showRegStep(n: number): void {
  regStep = n;
  (document.getElementById('regStep1') as HTMLElement).style.display = n === 1 ? '' : 'none';
  (document.getElementById('regStep2') as HTMLElement).style.display = n === 2 ? '' : 'none';
  (document.getElementById('regStep3') as HTMLElement).style.display = n === 3 ? '' : 'none';
  (document.getElementById('regNextBtn') as HTMLElement).style.display = n === 1 ? '' : 'none';
  (document.getElementById('regStepLabel') as HTMLElement).textContent = regLabels[n - 1];
  [0, 1, 2].forEach(i => {
    const el = document.getElementById(`rs${i}`) as HTMLElement;
    if (i < n - 1) el.className = 'reg-step done';
    else if (i === n - 1) el.className = 'reg-step active';
    else el.className = 'reg-step';
  });
  regPinBuf = '';
  regConfBuf = '';
  updateRegDots('rp');
  updateRegDots('rc');
}

function regNext(): void {
  const name = (document.getElementById('regName') as HTMLInputElement).value.trim();
  const bal = parseFloat((document.getElementById('regBalance') as HTMLInputElement).value);
  if (!name || name.length < 2) { showAlert('regAlert', 'Please enter a valid full name.', 'error'); playError(); return; }
  if (isNaN(bal) || bal < 100) { showAlert('regAlert', 'Minimum opening balance is $100.', 'error'); playError(); return; }
  showRegStep(2);
  playClick();
}

function regBack(): void {
  if (regStep === 1) { goTo('page-login'); return; }
  showRegStep(regStep - 1);
}

function updateRegDots(prefix: 'rp' | 'rc'): void {
  const buf = prefix === 'rp' ? regPinBuf : regConfBuf;
  for (let i = 0; i < 4; i++) {
    const d = document.getElementById(`${prefix}${i}`);
    if (d) d.classList.toggle('filled', i < buf.length);
  }
}

function regPinKey(k: string): void {
  if (regPinBuf.length >= 4) return;
  playClick();
  regPinBuf += k;
  updateRegDots('rp');
  if (regPinBuf.length === 4) setTimeout(regPinNext, 200);
}

function regPinClear(): void { playClick(); regPinBuf = regPinBuf.slice(0, -1); updateRegDots('rp'); }

function regPinNext(): void {
  if (regPinBuf.length < 4) { showAlert('regAlert', 'PIN must be 4 digits.', 'error'); playError(); return; }
  regTempPin = regPinBuf;
  showRegStep(3);
  playClick();
  showAlert('regAlert', 'PIN set! Now confirm it.', 'info');
}

function regConfKey(k: string): void {
  if (regConfBuf.length >= 4) return;
  playClick();
  regConfBuf += k;
  updateRegDots('rc');
  if (regConfBuf.length === 4) setTimeout(regConfirm, 200);
}

function regConfClear(): void { playClick(); regConfBuf = regConfBuf.slice(0, -1); updateRegDots('rc'); }

function regConfirm(): void {
  if (regConfBuf.length < 4) { showAlert('regAlert', 'Please enter all 4 digits.', 'error'); playError(); return; }
  if (regConfBuf !== regTempPin) { showAlert('regAlert', 'PINs do not match. Start over.', 'error'); playError(); showRegStep(2); return; }
  const name = (document.getElementById('regName') as HTMLInputElement).value.trim();
  const bal  = parseFloat((document.getElementById('regBalance') as HTMLInputElement).value);
  const key  = 'usr_' + Date.now();
  atmData[key] = { name, pin: regTempPin, balance: bal, acct: genAcctNo(), transactions: [] };
  saveData();
  showLoading('CREATING ACCOUNT...', 1600).then(() => {
    playSuccess();
    (document.getElementById('regName') as HTMLInputElement).value = '';
    (document.getElementById('regBalance') as HTMLInputElement).value = '';
    buildUserSelector();
    selectUser(key);
    showRegStep(1);
    goTo('page-login');
    showAlert('loginAlert', `Account created! Welcome, ${name}. Please log in.`, 'success');
  });
}

// ─── DASHBOARD ───────────────────────────────

function refreshDashboard(): void {
  if (!currentUser) return;
  const u = atmData[currentUser];
  (document.getElementById('dashBalance') as HTMLElement).textContent = fmt(u.balance);
  (document.getElementById('dashUser') as HTMLElement).textContent    = u.name;
  (document.getElementById('dashAcct') as HTMLElement).textContent    = u.acct;
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── DEPOSIT ─────────────────────────────────

function setAmount(val: number): void {
  playClick();
  const active = document.querySelector<HTMLElement>('.page.active');
  if (active && active.id === 'page-deposit')
    (document.getElementById('depositAmount') as HTMLInputElement).value = String(val);
  if (active && active.id === 'page-withdraw')
    (document.getElementById('withdrawAmount') as HTMLInputElement).value = String(val);
}

function deposit(): void {
  const raw = (document.getElementById('depositAmount') as HTMLInputElement).value.trim();
  if (!raw || isNaN(Number(raw))) { showAlert('depositAlert', 'Please enter a valid amount.', 'error'); playError(); return; }
  const amount = parseFloat(raw);
  if (amount <= 0)     { showAlert('depositAlert', 'Amount must be above $0.', 'error'); playError(); return; }
  if (amount > 50000)  { showAlert('depositAlert', 'Max single deposit is $50,000.', 'error'); playError(); return; }
  showLoading('COUNTING NOTES...', 1400).then(() => {
    atmData[currentUser!].balance += amount;
    addTx('deposit', amount);
    saveData();
    playSuccess();
    refreshDashboard();
    showReceipt('Deposit', amount);
  });
}

// ─── WITHDRAW ────────────────────────────────

function withdraw(): void {
  const raw = (document.getElementById('withdrawAmount') as HTMLInputElement).value.trim();
  if (!raw || isNaN(Number(raw))) { showAlert('withdrawAlert', 'Please enter a valid amount.', 'error'); playError(); return; }
  const amount = parseFloat(raw);
  if (amount <= 0) { showAlert('withdrawAlert', 'Amount must be above $0.', 'error'); playError(); return; }
  const u = atmData[currentUser!];
  if (amount > u.balance) { showAlert('withdrawAlert', `Insufficient funds. Balance: $${fmt(u.balance)}`, 'error'); playError(); return; }
  if (amount > 10000)     { showAlert('withdrawAlert', 'Max single withdrawal is $10,000.', 'error'); playError(); return; }
  if (amount % 5 !== 0)   { showAlert('withdrawAlert', 'Amount must be in multiples of $5.', 'error'); playError(); return; }
  showLoading('DISPENSING CASH...', 1600).then(() => {
    atmData[currentUser!].balance -= amount;
    addTx('withdraw', amount);
    saveData();
    playSuccess();
    refreshDashboard();
    showReceipt('Withdrawal', amount);
  });
}

// ─── RECEIPT ─────────────────────────────────

function showReceipt(type: string, amount: number): void {
  const u = atmData[currentUser!];
  const now = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
  const sign = type === 'Deposit' ? '+' : '-';
  (document.getElementById('receiptBox') as HTMLElement).innerHTML = `
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

function addTx(type: TxType, amount: number): void {
  const tx: Transaction = {
    type,
    amount,
    balance: atmData[currentUser!].balance,
    date: new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
    }),
  };
  atmData[currentUser!].transactions.unshift(tx);
  if (atmData[currentUser!].transactions.length > 50) {
    atmData[currentUser!].transactions.pop();
  }
}

function renderHistory(): void {
  const list = document.getElementById('txList') as HTMLElement;
  list.innerHTML = '';
  const txs: Transaction[] = atmData[currentUser!]?.transactions ?? [];
  if (!txs.length) {
    list.innerHTML = `<div class="tx-empty"><div class="tx-empty-icon">📭</div>No transactions yet</div>`;
    return;
  }
  txs.forEach(tx => {
    const item = document.createElement('div');
    item.className = 'tx-item';
    const icons:  Record<string, string> = { deposit: '💵', withdraw: '💸', 'pin-change': '🔐', 'transfer-out': '🔄', 'transfer-in': '📥', bill: '💰' };
    const labels: Record<string, string> = { deposit: 'Deposit', withdraw: 'Withdrawal', 'pin-change': 'PIN Changed', 'transfer-out': `Transfer → ${(tx as any).to ?? ''}`, 'transfer-in': `Transfer ← ${(tx as any).from ?? ''}`, bill: `Bill – ${(tx as any).billName ?? ''}` };
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

function doLogout(): void {
  currentUser = null;
  selectedUserKey = null;
  pinBuffer = '';
  updatePinDots('d');
  stopSession();
  buildUserSelector();
  goTo('page-login');
}

function logout(): void {
  playLogout();
  showLoading('LOGGING OUT...', 800).then(doLogout);
}

// ─── CHANGE PIN ──────────────────────────────

let cpBuffer: string = '';
let cpStep: number = 0;
let cpNewPin: string = '';

const cpLabels: string[] = [
  'Step 1 – Enter Current PIN',
  'Step 2 – Enter New PIN',
  'Step 3 – Confirm New PIN',
];

function updateCPDots(): void {
  for (let i = 0; i < 4; i++) {
    const d = document.getElementById(`cp${i}`);
    if (d) d.classList.toggle('filled', i < cpBuffer.length);
  }
}

function updateCPSteps(): void {
  [0, 1, 2].forEach(i => {
    const el = document.getElementById(`cpStep${i}`) as HTMLElement;
    if (i < cpStep) el.className = 'pin-step done';
    else if (i === cpStep) el.className = 'pin-step active';
    else el.className = 'pin-step';
  });
  (document.getElementById('cpLabel') as HTMLElement).textContent = cpLabels[cpStep];
}

function resetCP(): void {
  cpBuffer = '';
  cpStep = 0;
  cpNewPin = '';
  updateCPDots();
  updateCPSteps();
  hideAllAlerts();
}

function cpKey(k: string): void {
  if (cpBuffer.length >= 4) return;
  playClick();
  cpBuffer += k;
  updateCPDots();
  if (cpBuffer.length === 4) setTimeout(cpEnter, 200);
}

function cpClear(): void { playClick(); cpBuffer = cpBuffer.slice(0, -1); updateCPDots(); }

function cpEnter(): void {
  if (cpBuffer.length < 4) { showAlert('cpAlert', 'Please enter all 4 digits.', 'error'); playError(); return; }
  if (cpStep === 0) {
    if (cpBuffer !== atmData[currentUser!].pin) {
      showAlert('cpAlert', 'Current PIN is incorrect.', 'error');
      playError();
      cpBuffer = '';
      updateCPDots();
      return;
    }
    cpStep = 1; cpBuffer = ''; updateCPDots(); updateCPSteps();
    showAlert('cpAlert', 'Verified! Enter your new PIN.', 'info');
  } else if (cpStep === 1) {
    cpNewPin = cpBuffer; cpStep = 2; cpBuffer = ''; updateCPDots(); updateCPSteps();
    showAlert('cpAlert', 'Re-enter new PIN to confirm.', 'info');
  } else {
    if (cpBuffer !== cpNewPin) { showAlert('cpAlert', 'PINs do not match. Start over.', 'error'); playError(); resetCP(); return; }
    showLoading('UPDATING PIN...', 1000).then(() => {
      atmData[currentUser!].pin = cpNewPin;
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

function populateTransferRecipients(): void {
  const sel = document.getElementById('transferRecipient') as HTMLSelectElement;
  sel.innerHTML = '<option value="">— Select recipient account —</option>';
  Object.keys(atmData).forEach(key => {
    if (key === currentUser) return;
    const u = atmData[key];
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = `${u.name}  (${u.acct})`;
    sel.appendChild(opt);
  });
}

function setTransferAmount(val: number): void {
  playClick();
  (document.getElementById('transferAmount') as HTMLInputElement).value = String(val);
}

function transfer(): void {
  const recipientKey = (document.getElementById('transferRecipient') as HTMLSelectElement).value;
  const raw = (document.getElementById('transferAmount') as HTMLInputElement).value.trim();
  if (!recipientKey) { showAlert('transferAlert', 'Please select a recipient account.', 'error'); playError(); return; }
  if (!raw || isNaN(Number(raw))) { showAlert('transferAlert', 'Please enter a valid amount.', 'error'); playError(); return; }
  const amount = parseFloat(raw);
  if (amount <= 0) { showAlert('transferAlert', 'Amount must be above $0.', 'error'); playError(); return; }
  const sender = atmData[currentUser!];
  if (amount > sender.balance) { showAlert('transferAlert', `Insufficient funds. Balance: $${fmt(sender.balance)}`, 'error'); playError(); return; }
  if (amount > 25000) { showAlert('transferAlert', 'Max single transfer is $25,000.', 'error'); playError(); return; }
  const recipient = atmData[recipientKey];
  showLoading('PROCESSING TRANSFER...', 1600).then(() => {
    sender.balance -= amount;
    recipient.balance += amount;
    const recipientName = recipient.name;
    const senderName   = sender.name;
    // record outgoing
    const txOut: any = { type: 'transfer-out', amount, balance: sender.balance, to: recipientName,
      date: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) };
    sender.transactions.unshift(txOut);
    if (sender.transactions.length > 50) sender.transactions.pop();
    // record incoming on recipient
    const txIn: any = { type: 'transfer-in', amount, balance: recipient.balance, from: senderName,
      date: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) };
    recipient.transactions.unshift(txIn);
    if (recipient.transactions.length > 50) recipient.transactions.pop();
    saveData(); playSuccess(); refreshDashboard();
    // show receipt
    const now = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    (document.getElementById('receiptBox') as HTMLElement).innerHTML = `
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

let selectedBill: string = '';
const billNames: Record<string, string> = { mobile: 'Mobile Top-up', electricity: 'Electricity', internet: 'Internet', rent: 'Rent' };

function selectBill(type: string): void {
  playClick();
  selectedBill = type;
  document.querySelectorAll<HTMLElement>('.bill-card').forEach(b => b.classList.remove('selected'));
  const el = document.getElementById(`bill-${type}`);
  if (el) el.classList.add('selected');
  (document.getElementById('billAmountSection') as HTMLElement).style.display = '';
  (document.getElementById('billPayBtn') as HTMLElement).style.display = '';
  (document.getElementById('billAmount') as HTMLInputElement).value = '';
}

function setBillAmount(val: number): void {
  playClick();
  (document.getElementById('billAmount') as HTMLInputElement).value = String(val);
}

function payBill(): void {
  if (!selectedBill) { showAlert('billAlert', 'Please select a bill type.', 'error'); playError(); return; }
  const raw = (document.getElementById('billAmount') as HTMLInputElement).value.trim();
  if (!raw || isNaN(Number(raw))) { showAlert('billAlert', 'Please enter a valid amount.', 'error'); playError(); return; }
  const amount = parseFloat(raw);
  if (amount <= 0) { showAlert('billAlert', 'Amount must be above $0.', 'error'); playError(); return; }
  const u = atmData[currentUser!];
  if (amount > u.balance) { showAlert('billAlert', `Insufficient funds. Balance: $${fmt(u.balance)}`, 'error'); playError(); return; }
  const billName = billNames[selectedBill] ?? selectedBill;
  showLoading('PROCESSING PAYMENT...', 1400).then(() => {
    atmData[currentUser!].balance -= amount;
    const tx: any = { type: 'bill', amount, balance: atmData[currentUser!].balance, billName,
      date: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) };
    atmData[currentUser!].transactions.unshift(tx);
    if (atmData[currentUser!].transactions.length > 50) atmData[currentUser!].transactions.pop();
    saveData(); playSuccess(); refreshDashboard();
    const now = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    (document.getElementById('receiptBox') as HTMLElement).innerHTML = `
      <div class="receipt-row"><span>SecureBank ATM</span><span>${now}</span></div>
      <div class="receipt-divider"></div>
      <div class="receipt-row"><span>Account</span><span>${u.acct}</span></div>
      <div class="receipt-row"><span>Bill Type</span><span>${billName}</span></div>
      <div class="receipt-divider"></div>
      <div class="receipt-row highlight"><span>Paid</span><span>-$${fmt(amount)}</span></div>
      <div class="receipt-divider"></div>
      <div class="receipt-row"><span>New Balance</span><span>$${fmt(atmData[currentUser!].balance)}</span></div>
      <div class="receipt-divider"></div>
      <div class="receipt-row" style="color:var(--text-muted);font-size:9px;justify-content:center">Thank you for banking with SecureBank</div>`;
    goTo('page-receipt');
  });
}

// ─── INIT ─────────────────────────────────────

function init(): void {
  showRegStep(1);
  buildUserSelector();
}
init();
