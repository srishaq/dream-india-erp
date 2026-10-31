// Lets the ERP and DreamComm be installed as apps, and shows DreamComm notifications on the phone.
// It never stores pages or data: everything always comes live from the server, so nobody works on an old copy.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

// A DreamComm message arrived (sent encrypted by the ERP through the phone's push service).
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'DreamComm', body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    // the chat is open and on screen: the app shows it itself, no notification needed
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const looking = wins.some((w) => w.visibilityState === 'visible' && w.focused && new URL(w.url).pathname.startsWith('/chat') && (!d.room || new URL(w.url).hash === '#r' + d.room));
    if (looking) return;
    await self.registration.showNotification(d.title || 'DreamComm', {
      body: d.body || '', tag: d.tag || 'dreamcomm', renotify: true,
      icon: '/dreamcomm-192.png?v=1', badge: '/dreamcomm-badge.png?v=1',
      data: { url: d.url || '/chat', room: d.room || null },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { url = '/chat', room = null } = e.notification.data || {};
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const chat = wins.find((w) => new URL(w.url).pathname.startsWith('/chat'));
    if (chat) { await chat.focus(); chat.postMessage({ open: room }); return; }
    await self.clients.openWindow(url);
  })());
});
