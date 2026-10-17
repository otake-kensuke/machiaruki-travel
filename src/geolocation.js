export const GPS_TIMEOUT_MS = 12000;

const messages = {
  1: '位置情報の利用が許可されていません。座標なしで記録できます。',
  2: '現在地を取得できませんでした。座標なしで記録できます。',
  3: '位置情報の取得がタイムアウトしました。座標なしで記録できます。'
};

export function positionLocation(position) {
  const coords = position?.coords;
  if (!coords || !Number.isFinite(coords.latitude) || Math.abs(coords.latitude) > 90 || !Number.isFinite(coords.longitude) || Math.abs(coords.longitude) > 180 || !Number.isFinite(coords.accuracy) || coords.accuracy < 0 || !Number.isFinite(position.timestamp) || Number.isNaN(new Date(position.timestamp).valueOf())) throw new Error('位置情報の値が不正です。');
  return { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, capturedAt: new Date(position.timestamp).toISOString() };
}

// One request per explicit recording/retry action. Never starts at module load.
export function startPositionRequest({ geolocation = globalThis.navigator?.geolocation, timeoutMs = GPS_TIMEOUT_MS } = {}) {
  let finished = false;
  let timer;
  let complete;
  const promise = new Promise(resolve => {
    complete = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(result);
    };
  });
  const fail = code => complete({ status: 'error', code, message: messages[code] || messages[2] });
  timer = setTimeout(() => fail(3), timeoutMs);
  if (!geolocation?.getCurrentPosition) fail(2);
  else {
    try {
      geolocation.getCurrentPosition(position => {
        if (finished) return;
        try { complete({ status: 'success', location: positionLocation(position) }); }
        catch { fail(2); }
      }, error => fail(error?.code || 2), { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs });
    } catch { fail(2); }
  }
  // The browser API has no abort primitive. Ignore late callbacks and stop our timer.
  return { promise, cancel: () => complete({ status: 'cancelled' }) };
}
