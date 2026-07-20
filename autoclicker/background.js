browser.commands.onCommand.addListener(async (command) => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const messageType =
    command === "toggle-autoclick" ? "toggle" : command === "stop-autoclick" ? "stop" : null;
  if (!messageType) return;

  try {
    await browser.tabs.sendMessage(tab.id, { type: messageType });
  } catch (e) {
    // content script not loaded on this page (e.g. about: pages)
  }
});
