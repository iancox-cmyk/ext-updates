const minIntervalInput = document.getElementById("minInterval");
const maxIntervalInput = document.getElementById("maxInterval");
const buttonSelect = document.getElementById("button");
const durationInput = document.getElementById("duration");
const toggleBtn = document.getElementById("toggle");
let running = false;

async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function render() {
  toggleBtn.textContent = running ? "Stop" : "Start";
}

async function init() {
  const stored = await browser.storage.local.get({
    minInterval: 100,
    maxInterval: 100,
    button: 0,
    duration: 0,
  });
  minIntervalInput.value = stored.minInterval;
  maxIntervalInput.value = stored.maxInterval;
  buttonSelect.value = stored.button;
  durationInput.value = stored.duration;

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

init();
