const MOVE_MS = 150; // on-page indicator travel time between spots
const INDICATOR_ID = "__ac_indicator__";
const MARKER_CLASS = "__ac_marker__";
const BOX_CLASS = "__ac_box__";
const DEFAULT_BOX_SIZE = 30;
// A frame only wins a spot capture if the mouse was in IT within this many ms.
// This is what makes multi-frame pages (iframes) safe: an ad/tracker iframe the
// mouse never entered stays permanently stale and never captures; a frame the
// mouse passed through a while ago (but isn't under the cursor right now) also
// loses out to whichever frame the cursor is actually in.
const RECENCY_WINDOW_MS = 2000;
// Identifies which document (top page vs. a specific iframe) captured a given
// spot, so that with all_frames enabled, only the frame that actually owns a
// spot renders its marker or clicks it — otherwise every frame on the page
// would render/click the same raw coordinates against its own viewport.
const FRAME_HREF = location.href;
function ownsSpot(spot) {
  return spot.frameHref ? spot.frameHref === FRAME_HREF : window === window.top;
}

let running = false;
let timerId = null;
let durationTimerId = null;
let mouseX = 0;
let mouseY = 0;
let lastMoveTime = 0;
let clicksFired = 0;
let currentSpotIndex = 0;
let spots = [];
let settings = { button: 0, duration: 0, clickCount: 0 };

document.addEventListener(
  "mousemove",
  (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    lastMoveTime = Date.now();
  },
  true
);

// ----- VISUAL INDICATOR + SPOT MARKERS (on-page only — no real OS cursor movement) -----

function ensureIndicator() {
  let el = document.getElementById(INDICATOR_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = INDICATOR_ID;
    el.style.cssText = `
      position:fixed; width:16px; height:16px; margin:-8px 0 0 -8px;
      border-radius:50%; background:rgba(255,60,60,0.55); border:2px solid #fff;
      box-shadow:0 0 6px rgba(0,0,0,0.5); pointer-events:none; z-index:2147483647;
      transition:left ${MOVE_MS}ms linear, top ${MOVE_MS}ms linear; left:-100px; top:-100px;
    `;
    document.body.appendChild(el);
  }
  el.style.display = "block";
  return el;
}

function moveIndicatorTo(x, y) {
  const el = ensureIndicator();
  el.style.left = x + "px";
  el.style.top = y + "px";
}

function hideIndicator() {
  const el = document.getElementById(INDICATOR_ID);
  if (el) el.style.display = "none";
}

function renderMarkers(spotsArr) {
  document.querySelectorAll("." + MARKER_CLASS + ", ." + BOX_CLASS).forEach((n) => n.remove());
  (spotsArr || []).forEach((s, i) => {
    if (!ownsSpot(s)) return;
    if (s.mode === "box") {
      const w = s.boxWidth || DEFAULT_BOX_SIZE;
      const h = s.boxHeight || DEFAULT_BOX_SIZE;
      const b = document.createElement("div");
      b.className = BOX_CLASS;
      b.style.cssText = `
        position:fixed; left:${s.x - w / 2}px; top:${s.y - h / 2}px; width:${w}px; height:${h}px;
        border:1px dashed rgba(40,120,255,0.85); background:rgba(40,120,255,0.12);
        pointer-events:none; z-index:2147483645;
      `;
      document.body.appendChild(b);
    }

    const m = document.createElement("div");
    m.className = MARKER_CLASS;
    m.textContent = String(i + 1);
    m.style.cssText = `
      position:fixed; left:${s.x}px; top:${s.y}px; margin:-9px 0 0 -9px;
      width:18px; height:18px; border-radius:50%; background:rgba(40,120,255,0.85);
      color:#fff; font:bold 10px/18px sans-serif; text-align:center;
      pointer-events:none; z-index:2147483646; box-shadow:0 0 4px rgba(0,0,0,0.5);
    `;
    document.body.appendChild(m);
  });
}

function showToast(text) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = `
    position:fixed; left:50%; top:24px; transform:translateX(-50%);
    background:rgba(0,0,0,0.8); color:#fff; font:12px sans-serif; padding:6px 12px;
    border-radius:6px; z-index:2147483647; pointer-events:none;
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

browser.storage.local.get("spots").then((r) => renderMarkers(r.spots || []));
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.spots) {
    renderMarkers(changes.spots.newValue || []);
  }
});

// ----- SPOT CAPTURE (Alt+Shift+S) -----

async function captureSpot() {
  if (Date.now() - lastMoveTime > RECENCY_WINDOW_MS) {
    showToast("Move the mouse a little first, then try again");
    return { captured: false };
  }
  const { spots: existing = [], defaultMinInterval = 100, defaultMaxInterval = 100 } =
    await browser.storage.local.get(["spots", "defaultMinInterval", "defaultMaxInterval"]);
  const spot = {
    x: mouseX,
    y: mouseY,
    minInterval: defaultMinInterval,
    maxInterval: defaultMaxInterval,
    mode: "point",
    frameHref: FRAME_HREF,
  };
  const updated = [...existing, spot];
  await browser.storage.local.set({ spots: updated });
  showToast(`Spot ${updated.length} captured`);
  return { captured: true, spots: updated };
}

// ----- CLICK CYCLE -----

function randomDelay(spot) {
  const lo = Math.max(10, spot.minInterval);
  const hi = Math.max(lo, spot.maxInterval);
  const random = Math.floor(lo + Math.random() * (hi - lo));
  return (spot.fixedDelay || 0) + random;
}

function pickClickPoint(spot) {
  if (spot.mode === "box") {
    const w = spot.boxWidth || DEFAULT_BOX_SIZE;
    const h = spot.boxHeight || DEFAULT_BOX_SIZE;
    return {
      x: Math.round(spot.x + (Math.random() - 0.5) * w),
      y: Math.round(spot.y + (Math.random() - 0.5) * h),
    };
  }
  return { x: spot.x, y: spot.y };
}

function fireClickAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return;
  const opts = {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: settings.button,
  };
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.dispatchEvent(new MouseEvent("click", opts));
}

function runStep() {
  if (!running) return;
  if (!spots.length) {
    stop();
    return;
  }
  const spot = spots[currentSpotIndex];
  const point = pickClickPoint(spot);
  moveIndicatorTo(point.x, point.y);
  timerId = setTimeout(() => {
    if (!running) return;
    fireClickAt(point.x, point.y);
    clicksFired++;
    if (settings.clickCount > 0 && clicksFired >= settings.clickCount) {
      stop();
      return;
    }
    const delay = randomDelay(spot);
    currentSpotIndex = (currentSpotIndex + 1) % spots.length;
    timerId = setTimeout(runStep, delay);
  }, MOVE_MS);
}

function start(newSettings) {
  if (newSettings) settings = newSettings;
  spots = (settings.spots || []).filter(ownsSpot);
  if (running || !spots.length) return;
  running = true;
  clicksFired = 0;
  currentSpotIndex = 0;
  ensureIndicator();
  runStep();
  if (settings.duration > 0) {
    durationTimerId = setTimeout(stop, settings.duration * 1000);
  }
}

function stop() {
  running = false;
  clearTimeout(timerId);
  clearTimeout(durationTimerId);
  timerId = null;
  durationTimerId = null;
  hideIndicator();
}

browser.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case "toggle":
      running ? stop() : start();
      return Promise.resolve({ running });
    case "start":
      start(msg.settings);
      return Promise.resolve({ running });
    case "stop":
      stop();
      return Promise.resolve({ running });
    case "getStatus":
      return Promise.resolve({ running });
    case "captureSpot":
      return captureSpot();
  }
});
