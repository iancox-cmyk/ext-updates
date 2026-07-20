browser.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "webhook") return;
  return fetch(msg.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msg.entry),
  })
    .then((r) => ({ ok: r.ok, status: r.status }))
    .catch((e) => ({ ok: false, error: String(e) }));
});
