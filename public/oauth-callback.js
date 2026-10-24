// Receives the OAuth 2.0 response from Google on MyVault's own origin and hands it back to
// the app over a same-origin BroadcastChannel. The access token is removed from the URL
// immediately so it does not remain in browser history.
(function () {
  var hash = location.hash.charAt(0) === '#' ? location.hash.slice(1) : '';
  var query = location.search.charAt(0) === '?' ? location.search.slice(1) : '';
  var params = new URLSearchParams(hash || query);
  history.replaceState(null, '', location.pathname);
  var payload = {};
  params.forEach(function (value, key) { payload[key] = value; });
  var msg = document.getElementById('msg');
  var mode = null;
  try { mode = sessionStorage.getItem('myvault.oauthMode'); } catch (e) { /* storage blocked */ }

  function storeAndReturn() {
    try {
      sessionStorage.setItem('myvault.oauthResult', JSON.stringify({ payload: payload, at: Date.now() }));
      sessionStorage.removeItem('myvault.oauthMode');
    } catch (e) { /* storage blocked */ }
    location.replace('/');
  }

  if (mode === 'redirect') {
    storeAndReturn();
    return;
  }
  try {
    var channel = new BroadcastChannel('myvault-oauth');
    channel.postMessage({ type: 'myvault-oauth', payload: payload });
    channel.close();
  } catch (e) { /* BroadcastChannel unsupported */ }
  if (msg) msg.textContent = payload.error ? 'Google connection was not completed. You can close this window.' : 'Connected. You can close this window.';
  window.close();
  // If this window could not be closed (not a popup), fall back to the redirect hand-off.
  setTimeout(storeAndReturn, 1200);
})();
