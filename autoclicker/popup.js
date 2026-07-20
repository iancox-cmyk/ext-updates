const minIntervalInput = document.getElementById("minInterval");
const maxIntervalInput = document.getElementById("maxInterval");
const buttonSelect = document.getElementById("button");
const durationInput = document.getElementById("duration");
const clickCountInput = document.getElementById("clickCount");
const toggleBtn = document.getElementById("toggle");
const quitBtn = document.getElementById("quit");
let running = false;

async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function render() {
  toggleBtn.textContent = running ? "Stop" : "Start";
}

async function init() {
  // minInterval/maxInterval deliberately have no stored default — leaving them
  // unset keeps the Min/Max placeholders visible until the user has actually
  // typed something (or a previous session already saved a value).
  const stored = await browser.storage.local.get({
    button: 0,
    duration: 0,
    clickCount: 0,
  });
  const interval = await browser.storage.local.get(["minInterval", "maxInterval"]);
  if (interval.minInterval != null) minIntervalInput.value = interval.minInterval;
  if (interval.maxInterval != null) maxIntervalInput.value = interval.maxInterval;
  buttonSelect.value = stored.button;
  durationInput.value = stored.duration || "";
  clickCountInput.value = stored.clickCount || "";

  const tab = await getActiveTab();
  if (tab) {
    try {
      const status = await browser.tabs.sendMessage(tab.id, { type: "getStatus" });
      running = !!(status && status.running);
    } catch (e) {
      // content script not present on this page
    }
  }
  render();
}

toggleBtn.addEventListener("click", async () => {
  const minInterval = Math.max(10, parseInt(minIntervalInput.value, 10) || 100);
  const maxInterval = Math.max(minInterval, parseInt(maxIntervalInput.value, 10) || minInterval);
  const settings = {
    minInterval,
    maxInterval,
    button: parseInt(buttonSelect.value, 10),
    duration: Math.max(0, parseInt(durationInput.value, 10) || 0),
    clickCount: Math.max(0, parseInt(clickCountInput.value, 10) || 0),
  };
  await browser.storage.local.set(settings);

  const tab = await getActiveTab();
  if (!tab) return;
  try {
    if (!running) {
      await browser.tabs.sendMessage(tab.id, { type: "start", settings });
    } else {
      await browser.tabs.sendMessage(tab.id, { type: "stop" });
    }
    running = !running;
    render();
  } catch (e) {
    alert("Reload this page first — the extension can't reach it yet.");
  }
});

quitBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  try {
    await browser.tabs.sendMessage(tab.id, { type: "stop" });
  } catch (e) {
    // content script not present on this page — nothing running there anyway
  }
  running = false;
  render();
});

init();
