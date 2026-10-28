// Lets the ERP be installed as an app. It never stores pages or data: everything always comes live from the server,
// so nobody works on an old copy.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
