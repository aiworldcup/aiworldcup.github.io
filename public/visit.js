(function () {
  var endpoint = window.WCA_EVENTS_ENDPOINT || window.WCA_ANALYTICS_ENDPOINT || '';
  if (!endpoint || !/^https?:\/\//.test(endpoint)) return;

  function id(key) {
    try {
      var existing = localStorage.getItem(key);
      if (existing) return existing;
      var bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      var value = Array.prototype.map.call(bytes, function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
      localStorage.setItem(key, value);
      return value;
    } catch (_) {
      return String(Date.now()) + Math.random().toString(16).slice(2);
    }
  }

  function send() {
    var payload = {
      visitorId: id('wca_visitor_id'),
      sessionId: id('wca_session_id_' + new Date().toISOString().slice(0, 10)),
      path: location.pathname + location.search + location.hash,
      title: document.title,
      referrer: document.referrer,
      screenWidth: window.innerWidth || screen.width,
      language: navigator.language || '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    };
    var body = JSON.stringify(payload);
    var url = endpoint.replace(/\/$/, '') + '/api/collect';
    if (navigator.sendBeacon) {
      var blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(url, blob)) return;
    }
    fetch(url, {
      method: 'POST',
      mode: 'cors',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: body
    }).catch(function () {});
  }

  if (document.visibilityState === 'prerender') {
    document.addEventListener('visibilitychange', function onVisible() {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onVisible);
      send();
    });
  } else {
    send();
  }
})();
