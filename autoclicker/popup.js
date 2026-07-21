const defaultMinInput = document.getElementById("defaultMin");
const defaultMaxInput = document.getElementById("defaultMax");
const buttonSelect = document.getElementById("button");
const durationInput = document.getElementById("duration");
const clickCountInput = document.getElementById("clickCount");
const spotListEl = document.getElementById("spotList");
const noSpotsEl = document.getElementById("noSpots");
const clearSpotsBtn = document.getElementById("clearSpots");
const toggleBtn = document.getElementById("toggle");
const quitBtn = document.getElementById("quit");
const profileNameInput = document.getElementById("profileName");
const saveProfileBtn = document.getElementById("saveProfile");
const profileSelect = document.getElementById("profileSelect");
const loadProfileBtn = document.getElementById("loadProfile");
const deleteProfileBtn = document.getElementById("deleteProfile");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");

const DEFAULT_BOX_SIZE = 30;

let running = false;
let spots = [];
let profiles = {};

async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function render() {
  toggleBtn.textContent = running ? "Stop" : "Start";
  statusDot.classList.toggle("on", running);
  statusText.textContent = running ? "Running" : "Idle";
}

async function persistSpots() {
  await browser.storage.local.set({ spots });
}

function renderSpotList() {
  spotListEl.innerHTML = "";
  noSpotsEl.style.display = spots.length ? "none" : "block";

  spots.forEach((spot, i) => {
    if (!spot.mode) spot.mode = "point";

    const card = document.createElement("div");
    card.className = "spot-card";

    // ---- head: index, coords, reorder/remove ----
    const head = document.createElement("div");
    head.className = "spot-head";

    const idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = i + 1 + ".";
    head.appendChild(idx);

    const headSpacer = document.createElement("span");
    headSpacer.style.flex = "1";
    head.appendChild(headSpacer);

    const upBtn = document.createElement("button");
    upBtn.textContent = "↑";
    upBtn.disabled = i === 0;
    upBtn.addEventListener("click", () => {
      [spots[i - 1], spots[i]] = [spots[i], spots[i - 1]];
      persistSpots();
      renderSpotList();
    });
    head.appendChild(upBtn);

    const downBtn = document.createElement("button");
    downBtn.textContent = "↓";
    downBtn.disabled = i === spots.length - 1;
    downBtn.addEventListener("click", () => {
      [spots[i + 1], spots[i]] = [spots[i], spots[i + 1]];
      persistSpots();
      renderSpotList();
    });
    head.appendChild(downBtn);

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      spots.splice(i, 1);
      persistSpots();
      renderSpotList();
    });
    head.appendChild(removeBtn);

    card.appendChild(head);

    // ---- coordinates (editable — in case a capture landed slightly off, or
    // you know the exact pixel you want without hovering to capture it) ----
    const coordsRow = document.createElement("div");
    coordsRow.className = "spot-coords";

    const coordXLabel = document.createElement("span");
    coordXLabel.textContent = "X";
    coordsRow.appendChild(coordXLabel);

    const xInput = document.createElement("input");
    xInput.type = "number";
    xInput.value = spot.x;
    xInput.title = "X coordinate (px)";
    coordsRow.appendChild(xInput);

    const coordYLabel = document.createElement("span");
    coordYLabel.textContent = "Y";
    coordsRow.appendChild(coordYLabel);

    const yInput = document.createElement("input");
    yInput.type = "number";
    yInput.value = spot.y;
    yInput.title = "Y coordinate (px)";
    coordsRow.appendChild(yInput);

    xInput.addEventListener("change", () => {
      spot.x = parseInt(xInput.value, 10) || 0;
      xInput.value = spot.x;
      persistSpots();
    });
    yInput.addEventListener("change", () => {
      spot.y = parseInt(yInput.value, 10) || 0;
      yInput.value = spot.y;
      persistSpots();
    });

    card.appendChild(coordsRow);

    // ---- mode: Point vs Box ----
    const modeRow = document.createElement("div");
    modeRow.className = "spot-mode";
    const groupName = "mode-" + i;

    const pointLabel = document.createElement("label");
    const pointRadio = document.createElement("input");
    pointRadio.type = "radio";
    pointRadio.name = groupName;
    pointRadio.checked = spot.mode === "point";
    pointLabel.appendChild(pointRadio);
    pointLabel.appendChild(document.createTextNode("Point"));
    modeRow.appendChild(pointLabel);

    const boxLabel = document.createElement("label");
    const boxRadio = document.createElement("input");
    boxRadio.type = "radio";
    boxRadio.name = groupName;
    boxRadio.checked = spot.mode === "box";
    boxLabel.appendChild(boxRadio);
    boxLabel.appendChild(document.createTextNode("Box"));
    modeRow.appendChild(boxLabel);

    card.appendChild(modeRow);

    // ---- box width/height (only shown in Box mode) ----
    const boxSizeRow = document.createElement("div");
    boxSizeRow.className = "spot-box-size";
    boxSizeRow.style.display = spot.mode === "box" ? "flex" : "none";

    const widthInput = document.createElement("input");
    widthInput.type = "number";
    widthInput.min = "2";
    widthInput.value = spot.boxWidth || DEFAULT_BOX_SIZE;
    widthInput.title = "Box width (px)";
    widthInput.placeholder = "Width";
    boxSizeRow.appendChild(widthInput);

    const xLabel = document.createElement("span");
    xLabel.textContent = "×";
    boxSizeRow.appendChild(xLabel);

    const heightInput = document.createElement("input");
    heightInput.type = "number";
    heightInput.min = "2";
    heightInput.value = spot.boxHeight || DEFAULT_BOX_SIZE;
    heightInput.title = "Box height (px)";
    heightInput.placeholder = "Height";
    boxSizeRow.appendChild(heightInput);

    widthInput.addEventListener("change", () => {
      spot.boxWidth = Math.max(2, parseInt(widthInput.value, 10) || DEFAULT_BOX_SIZE);
      persistSpots();
    });
    heightInput.addEventListener("change", () => {
      spot.boxHeight = Math.max(2, parseInt(heightInput.value, 10) || DEFAULT_BOX_SIZE);
      persistSpots();
    });

    card.appendChild(boxSizeRow);

    pointRadio.addEventListener("change", () => {
      if (pointRadio.checked) {
        spot.mode = "point";
        boxSizeRow.style.display = "none";
        persistSpots();
      }
    });
    boxRadio.addEventListener("change", () => {
      if (boxRadio.checked) {
        spot.mode = "box";
        if (!spot.boxWidth) spot.boxWidth = DEFAULT_BOX_SIZE;
        if (!spot.boxHeight) spot.boxHeight = DEFAULT_BOX_SIZE;
        widthInput.value = spot.boxWidth;
        heightInput.value = spot.boxHeight;
        boxSizeRow.style.display = "flex";
        persistSpots();
      }
    });

    // ---- fixed delay (added on top of the random interval below) ----
    const fixedRow = document.createElement("div");
    fixedRow.className = "spot-fixed";

    const fixedLabel = document.createElement("span");
    fixedLabel.textContent = "Fixed delay";
    fixedRow.appendChild(fixedLabel);

    const fixedInput = document.createElement("input");
    fixedInput.type = "number";
    fixedInput.min = "0";
    fixedInput.value = spot.fixedDelay || 0;
    fixedInput.title = "Fixed delay, added to the random interval below (ms)";
    fixedRow.appendChild(fixedInput);

    const fixedMsLabel = document.createElement("span");
    fixedMsLabel.textContent = "ms";
    fixedRow.appendChild(fixedMsLabel);

    fixedInput.addEventListener("change", () => {
      spot.fixedDelay = Math.max(0, parseInt(fixedInput.value, 10) || 0);
      persistSpots();
    });

    card.appendChild(fixedRow);

    // ---- random interval (added on top of the fixed delay above) ----
    const intervalRow = document.createElement("div");
    intervalRow.className = "spot-interval";

    const plusLabel = document.createElement("span");
    plusLabel.textContent = "+ Random";
    intervalRow.appendChild(plusLabel);

    const minInput = document.createElement("input");
    minInput.type = "number";
    minInput.min = "10";
    minInput.value = spot.minInterval;
    minInput.title = "Min interval (ms)";
    intervalRow.appendChild(minInput);

    const dash = document.createElement("span");
    dash.textContent = "–";
    intervalRow.appendChild(dash);

    const maxInput = document.createElement("input");
    maxInput.type = "number";
    maxInput.min = "10";
    maxInput.value = spot.maxInterval;
    maxInput.title = "Max interval (ms)";
    intervalRow.appendChild(maxInput);

    const msLabel = document.createElement("span");
    msLabel.textContent = "ms";
    intervalRow.appendChild(msLabel);

    minInput.addEventListener("change", () => {
      spot.minInterval = Math.max(10, parseInt(minInput.value, 10) || 10);
      if (spot.maxInterval < spot.minInterval) {
        spot.maxInterval = spot.minInterval;
        maxInput.value = spot.maxInterval;
      }
      persistSpots();
    });
    maxInput.addEventListener("change", () => {
      spot.maxInterval = Math.max(spot.minInterval, parseInt(maxInput.value, 10) || spot.minInterval);
      maxInput.value = spot.maxInterval;
      persistSpots();
    });

    card.appendChild(intervalRow);

    spotListEl.appendChild(card);
  });
}

function renderProfileOptions() {
  profileSelect.innerHTML = "";
  const names = Object.keys(profiles);
  if (!names.length) {
    const opt = document.createElement("option");
    opt.textContent = "(no saved profiles)";
    opt.disabled = true;
    profileSelect.appendChild(opt);
    return;
  }
  names.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    profileSelect.appendChild(opt);
  });
}

async function init() {
  const stored = await browser.storage.local.get({
    defaultMinInterval: 100,
    defaultMaxInterval: 100,
    button: 0,
    duration: 0,
    clickCount: 0,
    spots: [],
    profiles: {},
  });
  defaultMinInput.value = stored.defaultMinInterval;
  defaultMaxInput.value = stored.defaultMaxInterval;
  buttonSelect.value = stored.button;
  durationInput.value = stored.duration || "";
  clickCountInput.value = stored.clickCount || "";
  spots = stored.spots;
  profiles = stored.profiles;
  renderSpotList();
  renderProfileOptions();

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

defaultMinInput.addEventListener("change", () => {
  browser.storage.local.set({
    defaultMinInterval: Math.max(10, parseInt(defaultMinInput.value, 10) || 100),
  });
});
defaultMaxInput.addEventListener("change", () => {
  browser.storage.local.set({
    defaultMaxInterval: Math.max(10, parseInt(defaultMaxInput.value, 10) || 100),
  });
});

clearSpotsBtn.addEventListener("click", async () => {
  spots = [];
  await persistSpots();
  renderSpotList();
});

toggleBtn.addEventListener("click", async () => {
  if (!running && spots.length === 0) {
    alert(
      "No spots captured yet. Hover your target on the page and press Alt+Shift+S (Option+Shift+S on Mac) to add one."
    );
    return;
  }
  const settings = {
    spots,
    button: parseInt(buttonSelect.value, 10),
    duration: Math.max(0, parseInt(durationInput.value, 10) || 0),
    clickCount: Math.max(0, parseInt(clickCountInput.value, 10) || 0),
  };
  await browser.storage.local.set({
    button: settings.button,
    duration: settings.duration,
    clickCount: settings.clickCount,
  });

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

saveProfileBtn.addEventListener("click", async () => {
  const name = profileNameInput.value.trim();
  if (!name) {
    alert("Enter a profile name first.");
    return;
  }
  profiles[name] = {
    spots,
    button: parseInt(buttonSelect.value, 10),
    duration: Math.max(0, parseInt(durationInput.value, 10) || 0),
    clickCount: Math.max(0, parseInt(clickCountInput.value, 10) || 0),
    defaultMinInterval: Math.max(10, parseInt(defaultMinInput.value, 10) || 100),
    defaultMaxInterval: Math.max(10, parseInt(defaultMaxInput.value, 10) || 100),
  };
  await browser.storage.local.set({ profiles });
  renderProfileOptions();
  profileSelect.value = name;
});

loadProfileBtn.addEventListener("click", async () => {
  const name = profileSelect.value;
  const profile = profiles[name];
  if (!profile) return;
  spots = (profile.spots || []).map((s) => ({ ...s }));
  buttonSelect.value = profile.button ?? 0;
  durationInput.value = profile.duration || "";
  clickCountInput.value = profile.clickCount || "";
  defaultMinInput.value = profile.defaultMinInterval ?? 100;
  defaultMaxInput.value = profile.defaultMaxInterval ?? 100;
  await browser.storage.local.set({
    spots,
    button: profile.button ?? 0,
    duration: profile.duration || 0,
    clickCount: profile.clickCount || 0,
    defaultMinInterval: profile.defaultMinInterval ?? 100,
    defaultMaxInterval: profile.defaultMaxInterval ?? 100,
  });
  renderSpotList();
});

deleteProfileBtn.addEventListener("click", async () => {
  const name = profileSelect.value;
  if (!name || !profiles[name]) return;
  if (!confirm(`Delete profile "${name}"?`)) return;
  delete profiles[name];
  await browser.storage.local.set({ profiles });
  renderProfileOptions();
});

init();
