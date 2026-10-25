function message(worker, type) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Service Worker did not respond')); }, 15000);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
    worker.postMessage({ type }, [channel.port2]);
  });
}

export function startOfflineSupport() {
  const panel = document.querySelector('#offline-panel');
  const status = document.querySelector('#offline-status');
  const connection = document.querySelector('#connection-status');
  const button = document.querySelector('#offline-retry');
  let registration;
  let checking = false;
  let attempt = 0;
  let installFailed = false;
  const observedRegistrations = new WeakSet();
  const observedWorkers = new WeakSet();
  function setState(state) {
    panel.dataset.state = state;
    document.querySelector('#offline-badge').textContent = { preparing: '準備中', ready: '準備完了', update: '更新あり', error: '要確認', unsupported: '非対応' }[state];
    if (['update', 'error', 'unsupported'].includes(state)) document.querySelector('#offline-details').open = true;
  }
  function network() {
    connection.textContent = navigator.onLine ? '接続状態：オンライン（通信できることを保証しません）' : '接続状態：オフライン。保存済みの予定・記録を利用できます。';
  }
  async function renderStatus() {
    const current = ++attempt;
    // A first installation may briefly be waiting before its first activation.
    if (registration?.waiting && registration.active) {
      status.textContent = '新しい版の準備ができました。現在は開いている画面の版を利用中です。入力を保存してから、このアプリの全タブ・ウィンドウを閉じ、開き直すと切り替わります。自動再読込はしません。';
      setState('update'); return;
    }
    if (registration?.installing) { status.textContent = 'オフライン用のアプリを準備しています。完了までオンラインでお待ちください。'; setState('preparing'); return; }
    if (!registration?.active && !installFailed) { status.textContent = 'オフライン用のアプリを準備しています。完了までオンラインでお待ちください。'; setState('preparing'); return; }
    if (registration?.active) {
      try {
        const state = await message(registration.active, 'SHELL_STATUS');
        if (current !== attempt) return;
        if (state.complete) {
          status.textContent = installFailed
            ? '新しい版の準備に失敗しました。現在の版と保存済みデータはそのまま利用できます。オンラインで再試行してください。'
            : `オフライン準備完了。${navigator.serviceWorker.controller ? '保存済みの予定閲覧・編集・訪問記録を利用できます。' : '現在の画面は切り替わりません。入力を保存し、このアプリの全タブ・ウィンドウを閉じて開き直すと、準備した版を利用できます。'}`;
          setState(installFailed ? 'error' : 'ready'); return;
        }
      } catch { if (current !== attempt) return; }
    }
    status.textContent = 'オフライン準備が完了していません。オンラインで「準備・更新を再確認」を押してください。旅行データは削除しません。';
    setState('error');
  }
  function observe(worker) {
    if (!worker || observedWorkers.has(worker)) return;
    observedWorkers.add(worker);
    let installed = ['installed', 'activating', 'activated'].includes(worker.state);
    worker.addEventListener('statechange', () => {
      if (['installed', 'activating', 'activated'].includes(worker.state)) installed = true;
      // A successfully installed worker can become redundant during normal replacement.
      if (worker.state === 'redundant' && !installed) installFailed = true;
      void renderStatus();
    });
  }
  async function register() {
    registration = await navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: new URL('../', import.meta.url).href, updateViaCache: 'none' });
    if (!observedRegistrations.has(registration)) {
      observedRegistrations.add(registration);
      registration.addEventListener('updatefound', () => { installFailed = false; observe(registration.installing); void renderStatus(); });
    }
    observe(registration.installing);
    void renderStatus();
  }
  async function retry() {
    if (checking) return;
    checking = true; button.disabled = true; installFailed = false; attempt++;
    status.textContent = 'オフライン準備と更新を再確認しています…'; setState('preparing');
    try {
      // A failed first installation may leave the old registration unregistered.
      await register();
      await registration.update();
      if (registration.active && !registration.waiting && !registration.installing) await message(registration.active, 'REPAIR_SHELL');
      await renderStatus();
    } catch { status.textContent = '通信またはアプリの準備を確認できませんでした。現在の画面・旅行データは保持しています。オンラインで再試行してください。'; setState('error'); }
    finally { checking = false; button.disabled = false; }
  }
  network();
  window.addEventListener('offline', network);
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    status.textContent = 'この環境ではオフライン起動を準備できません。HTTPSまたはlocalhostの対応ブラウザで利用してください。';
    setState('unsupported'); button.hidden = true; return;
  }
  button.addEventListener('click', () => void retry());
  window.addEventListener('online', () => { network(); void retry(); });
  navigator.serviceWorker.addEventListener('controllerchange', () => void renderStatus());
  void register().catch(() => { status.textContent = 'オフライン準備に失敗しました。オンラインで再試行してください。旅行データは初期化していません。'; setState('error'); });
}
