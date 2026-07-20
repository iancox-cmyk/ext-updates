let running = false;
let timerId = null;
let durationTimerId = null;
let mouseX = 0;
let mouseY = 0;
let clicksFired = 0;
let settings = { minInterval: 100, maxInterval: 100, button: 0, duration: 0, clickCount: 0 };

document.addEventListener(
  "mousemove",
  (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  },
  true
);

function randomDelay() {
  const lo = Math.max(10, settings.minInterval);
  const hi = Math.max(lo, settings.maxInterval);
  return Math.floor(lo + Math.random() * (hi - lo));
}

function fireClick() {
  const el = document.elementFromPoint(mouseX, mouseY);
  if (!el) return;
  const opts = {
    bubbles: true,
    cancelable: true,
    clientX: mouseX,
    clientY: mouseY,
    button: settings.button,
  };
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.dispatchEvent(new MouseEvent("click", opts));
}

function scheduleNext() {
  if (!running) return;
  timerId = setTimeout(() => {
    fireClick();
    clicksFired++;
    if (settings.clickCount > 0 && clicksFired >= settings.clickCount) {
      stop();
      return;
    }
    scheduleNext();
  }, randomDelay());
}

function start(newSettings) {
  if (newSettings) settings = newSettings;
  if (running) return;
  running = true;
  clicksFired = 0;
  scheduleNext();
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
  }
});
