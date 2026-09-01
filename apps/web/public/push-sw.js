self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Pi Web", body: event.data?.text() || "New activity" };
  }
  const title = typeof payload.title === "string" ? payload.title : "Pi Web";
  const options = {
    body: typeof payload.body === "string" ? payload.body : "",
    tag: typeof payload.tag === "string" ? payload.tag : "pi-web-notification",
    renotify: payload.renotify === true,
    requireInteraction: payload.requireInteraction === true,
    icon: typeof payload.icon === "string" ? payload.icon : "/pwa-192.png",
    badge: typeof payload.badge === "string" ? payload.badge : "/pwa-192.png",
    data:
      payload.data && typeof payload.data === "object"
        ? payload.data
        : { href: "/notifications" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const href =
    typeof data.href === "string" && data.href.startsWith("/")
      ? data.href
      : "/notifications";
  event.waitUntil(
    (async () => {
      if (typeof data.notificationId === "string") {
        await fetch(
          `/api/notifications/${encodeURIComponent(data.notificationId)}/read`,
          { method: "POST", credentials: "same-origin" }
        ).catch(() => undefined);
      }
      const target = new URL(href, self.location.origin).href;
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true
      });
      for (const client of windows) {
        if ("focus" in client) {
          await client.navigate(target);
          return await client.focus();
        }
      }
      return await self.clients.openWindow(target);
    })()
  );
});
