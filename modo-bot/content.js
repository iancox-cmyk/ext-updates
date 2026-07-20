(function () {
  "use strict";

  // =========================================================================
  // CONFIG (per-profile, stored in browser.storage.local — NOT in source)
  // =========================================================================
  // Schema:
  //   accountLabel   string   e.g. "alice@company.com" — identifies which profile fired
  //   targetPrice    string   e.g. "$239.99"
  //   cardNumber     string   "XXXX XXXX XXXX XXXX"
  //   cardHolder     string   "FIRST LAST"
  //   expiry         string   "MM/YY"
  //   cvv            string   "123"
  //   webhookUrl     string   optional; POST destination for structured logs
  //   windowStart    string   "HH:MM" — earliest fire time (default "03:20")
  //   windowEnd      string   "HH:MM" — latest fire time (default "03:40")
  //
  // To wipe config in this profile: use the "Reset" button in the config modal.

  const CONFIG_KEY = "modo_bot_config";
  const SESSION_KEY = "modo_bot_triggered";
  const LOG_KEY = "modo_bot_log"; // ring buffer of recent runs
  // ----- END-TO-END RETRY (shared by TEST button and scheduled fire) -----
  const ATTEMPT_KEY = "modo_bot_attempt"; // survives reloads so the counter persists across retries
  const SUCCESS_KEY = "modo_bot_success"; // set once a purchase confirms — blocks any further retries
  const MAX_ATTEMPTS = 5; // full Store→Buy→CVV→Pay runs before giving up
  const RETRY_GAP = 7000; // wait between a failed attempt and the next (ms)

  async function loadConfig() {
    const data = await browser.storage.local.get(CONFIG_KEY);
    return data[CONFIG_KEY] || null;
  }
  async function saveConfig(cfg) {
    await browser.storage.local.set({ [CONFIG_KEY]: cfg });
  }

  // =========================================================================
  // STRUCTURED LOGGING
  // =========================================================================
  async function appendLog(entry) {
    const data = await browser.storage.local.get(LOG_KEY);
    const existing = data[LOG_KEY] || [];
    existing.push(entry);
    // keep last 200 runs locally
    const trimmed = existing.slice(-200);
    await browser.storage.local.set({ [LOG_KEY]: trimmed });
    console.log("[ModoBot] LOG", entry);
  }

  function postToWebhook(url, entry) {
    if (!url) return;
    browser.runtime
      .sendMessage({ type: "webhook", url, entry })
      .then((r) => console.log("[ModoBot] webhook", r))
      .catch((e) => console.error("[ModoBot] webhook err", e));
  }

  function logEvent(cfg, status, extras = {}) {
    const entry = {
      ts: new Date().toISOString(),
      account: cfg.accountLabel || "(unlabeled)",
      target_time: cfg._scheduledTime || null,
      target_price: cfg.targetPrice,
      status: status, // 'fired' | 'card_found' | 'success' | 'fail' | 'unknown'
      url: location.href,
      ...extras,
    };
    appendLog(entry);
    postToWebhook(cfg.webhookUrl, entry);
  }

  // =========================================================================
  // CONFIG UI (modal shown when no config or when user clicks "Configure")
  // =========================================================================
  function showConfigModal(existing) {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.style.cssText =
        "position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:99999;display:flex;align-items:center;justify-content:center;";
      const modal = document.createElement("div");
      modal.style.cssText =
        "background:#1e1e1e;color:#eee;font-family:system-ui,sans-serif;padding:24px;border-radius:10px;min-width:380px;max-width:520px;box-shadow:0 10px 40px rgba(0,0,0,0.6);";
      const e = existing || {};
      modal.innerHTML = `
                <h2 style="margin:0 0 16px;font-size:18px;">Modo Bot — Profile Config</h2>
                <p style="font-size:11px;color:#aaa;margin:0 0 16px;">Stored in this browser's extension storage for THIS profile only. Not in the script source.</p>
                <div style="display:grid;grid-template-columns:130px 1fr;gap:8px;font-size:12px;">
                    <label>Account label</label><input id="mb_label" value="${e.accountLabel || ""}" placeholder="alice@company.com">
                    <label>Target price</label><input id="mb_price" value="${e.targetPrice || "$239.99"}">
                    <label>Window start</label><input id="mb_start" value="${e.windowStart || "03:20"}">
                    <label>Window end</label><input id="mb_end" value="${e.windowEnd || "03:40"}">
                    <label>Card number</label><input id="mb_cn" value="${e.cardNumber || ""}" placeholder="XXXX XXXX XXXX XXXX">
                    <label>Cardholder</label><input id="mb_ch" value="${e.cardHolder || ""}">
                    <label>Expiry MM/YY</label><input id="mb_exp" value="${e.expiry || ""}">
                    <label>CVV</label><input id="mb_cvv" value="${e.cvv || ""}" type="password">
                    <label>Webhook URL</label><input id="mb_hook" value="${e.webhookUrl || ""}" placeholder="optional, e.g. http://localhost:8787/log">
                </div>
                <p style="font-size:11px;color:#e8c87a;margin:14px 0 0;">
                    ⚠ Card data in browser storage is at the same risk level as having it in the script.
                    Long-term, prefer letting Chrome autofill card # / name / expiry and only storing CVV here.
                </p>
                <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;">
                    <button id="mb_cancel" style="padding:8px 14px;background:#444;color:#eee;border:none;border-radius:6px;cursor:pointer;">Cancel</button>
                    <button id="mb_reset" style="padding:8px 14px;background:#7a3030;color:#eee;border:none;border-radius:6px;cursor:pointer;">Reset</button>
                    <button id="mb_save" style="padding:8px 14px;background:#2e7d32;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Save</button>
                </div>
            `;
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      modal.querySelectorAll("input").forEach((i) => {
        i.style.cssText =
          "padding:6px 8px;background:#2a2a2a;color:#eee;border:1px solid #444;border-radius:4px;font-size:12px;font-family:monospace;";
      });

      modal.querySelector("#mb_cancel").onclick = () => {
        backdrop.remove();
        resolve(null);
      };
      modal.querySelector("#mb_reset").onclick = async () => {
        if (confirm("Wipe config for this profile?")) {
          await browser.storage.local.remove(CONFIG_KEY);
          backdrop.remove();
          resolve(null);
        }
      };
      modal.querySelector("#mb_save").onclick = async () => {
        const cfg = {
          accountLabel: modal.querySelector("#mb_label").value.trim(),
          targetPrice: modal.querySelector("#mb_price").value.trim(),
          windowStart: modal.querySelector("#mb_start").value.trim() || "03:20",
          windowEnd: modal.querySelector("#mb_end").value.trim() || "03:40",
          cardNumber: modal.querySelector("#mb_cn").value.trim(),
          cardHolder: modal.querySelector("#mb_ch").value.trim(),
          expiry: modal.querySelector("#mb_exp").value.trim(),
          cvv: modal.querySelector("#mb_cvv").value.trim(),
          webhookUrl: modal.querySelector("#mb_hook").value.trim(),
        };
        await saveConfig(cfg);
        backdrop.remove();
        resolve(cfg);
      };
    });
  }

  // =========================================================================
  // SCHEDULER
  // =========================================================================
  function randomTimeInWindow(startHHMM, endHHMM) {
    const [sh, sm] = startHHMM.split(":").map(Number);
    const [eh, em] = endHHMM.split(":").map(Number);
    const startSecs = sh * 3600 + sm * 60;
    const endSecs = eh * 3600 + em * 60;
    const total = Math.floor(Math.random() * (endSecs - startSecs + 1)) + startSecs;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
  }

  // =========================================================================
  // MAIN
  // =========================================================================
  async function main() {
    let cfg = await loadConfig();
    if (!cfg || !cfg.cvv) {
      console.warn("[ModoBot] No config for this profile. Opening config modal.");
      cfg = await showConfigModal(cfg);
      if (!cfg) {
        console.warn("[ModoBot] Config canceled. Bot inactive in this profile.");
        return;
      }
    }

    const TARGET_TIME = randomTimeInWindow(cfg.windowStart || "03:20", cfg.windowEnd || "03:40");
    cfg._scheduledTime = TARGET_TIME;

    console.log(`[ModoBot] account=${cfg.accountLabel} scheduled=${TARGET_TIME} price=${cfg.targetPrice}`);

    // ----- OVERLAY -----
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;align-items:flex-end;gap:6px;";

    const labelBar = document.createElement("div");
    labelBar.style.cssText =
      "background:rgba(0,0,0,0.75);color:#7ec8ff;font-family:monospace;font-size:11px;padding:5px 10px;border-radius:6px;";
    labelBar.innerHTML = `<span style="color:#aaa;">account:</span> ${cfg.accountLabel || "(unlabeled)"}`;
    overlay.appendChild(labelBar);

    const statusBar = document.createElement("div");
    statusBar.style.cssText =
      "background:rgba(0,0,0,0.75);color:#6fcf97;font-family:monospace;font-size:11px;padding:5px 10px;border-radius:6px;";
    statusBar.innerHTML = `<span style="color:#aaa;">scheduled:</span> ${TARGET_TIME} <span style="color:#aaa;">price:</span> ${cfg.targetPrice}`;
    overlay.appendChild(statusBar);

    const countdownBar = document.createElement("div");
    countdownBar.style.cssText =
      "background:rgba(0,0,0,0.75);color:#e8c87a;font-family:monospace;font-size:11px;padding:5px 10px;border-radius:6px;";
    overlay.appendChild(countdownBar);

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:6px;";
    const testBtn = document.createElement("button");
    testBtn.innerText = "TEST";
    testBtn.style.cssText =
      "padding:8px 12px;background:#c93030;color:#fff;border:2px solid #fff;font-weight:700;cursor:pointer;border-radius:6px;font-size:11px;";
    testBtn.onclick = () => {
      console.log("[ModoBot] Test triggered. Refreshing...");
      sessionStorage.removeItem(ATTEMPT_KEY); // fresh run → reset the retry counter
      sessionStorage.removeItem(SUCCESS_KEY);
      sessionStorage.setItem(SESSION_KEY, "true");
      location.reload();
    };
    const cfgBtn = document.createElement("button");
    cfgBtn.innerText = "CONFIG";
    cfgBtn.style.cssText =
      "padding:8px 12px;background:#444;color:#fff;border:1px solid #888;cursor:pointer;border-radius:6px;font-size:11px;";
    cfgBtn.onclick = async () => {
      const updated = await showConfigModal(await loadConfig());
      if (updated) location.reload();
    };
    btnRow.appendChild(cfgBtn);
    btnRow.appendChild(testBtn);
    overlay.appendChild(btnRow);

    document.body.appendChild(overlay);

    setInterval(() => {
      const now = new Date();
      const curr = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      const [th, tm, ts] = TARGET_TIME.split(":").map(Number);
      const target = th * 3600 + tm * 60 + ts;
      let diff = target - curr;
      if (diff < 0) diff += 86400;
      const h = String(Math.floor(diff / 3600)).padStart(2, "0");
      const m = String(Math.floor((diff % 3600) / 60)).padStart(2, "0");
      const s = String(diff % 60).padStart(2, "0");
      countdownBar.innerHTML = `<span style="color:#aaa;">fires in:</span> ${h}:${m}:${s}`;
    }, 1000);

    // ----- HELPERS -----
    // NOTE: do NOT pass view:window in MouseEvent — a sandboxed window
    // isn't a valid Window reference and the constructor throws. view is optional.
    function triggerClick(el) {
      try {
        ["mousedown", "mouseup", "click"].forEach((type) => {
          el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
        });
      } catch (e) {
        // Final fallback: pointer events
        try {
          ["pointerdown", "pointerup", "click"].forEach((type) => {
            el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
          });
        } catch (e2) {}
      }
    }

    // Multi-strategy click: native click first, then closest clickable parent, then synthetic.
    // For real <button>/<a> elements, native .click() is what fires React handlers correctly.
    function robustClick(el) {
      if (!el) return false;
      // 1. Native click on the element itself — works for <button>, <a>, [role="button"]
      try {
        el.click();
      } catch (e) {}
      // 2. Native click on closest clickable ancestor (catches the case where el is a child <span>/<p>)
      try {
        const ancestor =
          el.closest && el.closest('button, a, [role="button"], .MuiButtonBase-root, [data-testid*="click" i]');
        if (ancestor && ancestor !== el) {
          try {
            ancestor.click();
          } catch (e) {}
        }
      } catch (e) {}
      // 3. Synthetic events as last resort (now safe — no view:window)
      try {
        triggerClick(el);
      } catch (e) {}
      return true;
    }

    // Find the Store button via several strategies. Returns first match or null.
    function findStoreButton() {
      const isStoreText = (el) => el && el.innerText && el.innerText.trim().toLowerCase() === "store";
      const strategies = [
        // 1. Original: .MuiTypography-link span/a with text "Store"
        () => [...document.querySelectorAll(".MuiTypography-link")].find(isStoreText),
        // 2. span specifically (matches your DOM: <span class="MuiTypography-root MuiTypography-link css-14k6bi6">Store</span>)
        () => [...document.querySelectorAll("span.MuiTypography-link, span.MuiTypography-root")].find(isStoreText),
        // 3. Any element whose class contains "Typography-link" (case-insensitive, ignores generated css-* hash)
        () => [...document.querySelectorAll('[class*="Typography-link"], [class*="typography-link"]')].find(isStoreText),
        // 4. Any anchor or button labeled "Store"
        () => [...document.querySelectorAll("a, button")].find(isStoreText),
        // 5. Anchor with /store in the href
        () => document.querySelector('a[href$="/store"], a[href*="/store?"], a[href*="/store/"]'),
        // 6. Any visible element with exact text "Store" (broadest)
        () => [...document.querySelectorAll("span, a, button, div, p, li")].find((el) => isStoreText(el) && el.offsetParent !== null),
        // 7. data-testid containing "store"
        () => document.querySelector('[data-testid*="store" i]'),
      ];
      for (const s of strategies) {
        try {
          const el = s();
          if (el) {
            console.log("[ModoBot] Store found via strategy", strategies.indexOf(s) + 1, el);
            return el;
          }
        } catch (e) {}
      }
      return null;
    }

    // True once the store has actually populated (i.e. it's NOT the blank-load state).
    // A loaded store shows package cards / price headings / a findable buy button.
    function storeHasContent() {
      if (document.querySelector('[data-testid="buy-package-card"]')) return true;
      const hasPriceHeading = [...document.querySelectorAll("h3,h4,h5,h6")].some(
        (el) => el.offsetParent !== null && /\d/.test(el.innerText || "")
      );
      if (hasPriceHeading) return true;
      if (findBuyButtonByPrice(cfg.targetPrice)) return true;
      return false;
    }

    // Dispatch an Escape keypress to dismiss the (blank) store overlay — the manual fix
    // that forces the store to re-load when you press Store again.
    function pressEscape() {
      const opts = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true };
      const target = document.activeElement || document.body;
      for (const el of [target, document, document.body]) {
        try {
          el.dispatchEvent(new KeyboardEvent("keydown", opts));
          el.dispatchEvent(new KeyboardEvent("keyup", opts));
        } catch (e) {}
      }
    }

    // Normalize a price string for fuzzy comparison: strip whitespace, $, commas; lowercase.
    // "$ 84.99" / "$84.99" / "84.99 USD" / " $84.99" all → "84.99"
    function normalizePrice(s) {
      if (s == null) return "";
      return String(s)
        .replace(/[\s$,€£¥]/g, "")
        .replace(/usd|cad|eur/gi, "")
        .trim()
        .toLowerCase();
    }

    // Find the buy-package card matching the target price.
    // Tries 6 strategies, in order of specificity.
    function findTargetCard(targetPrice) {
      const target = normalizePrice(targetPrice);
      const isDealMode = !target || target === "deal" || target === "any" || target === "*";
      const cards = [...document.querySelectorAll('[data-testid="buy-package-card"]')];

      // Helper: pull all price texts inside a card.
      const cardPrices = (card) =>
        [...card.querySelectorAll("h1, h2, h3, h4, h5, h6, p, span")]
          .map((el) => el.innerText && el.innerText.trim())
          .filter(Boolean);

      const strategies = [
        // 1. Exact match on h4 or h5 within a card (original behavior)
        () => cards.find((card) => [...card.querySelectorAll("h4, h5")].some((el) => el.innerText.trim() === targetPrice)),
        // 2. Normalized match on h4 only (h4 is the active sale price in the current DOM)
        () => cards.find((card) => [...card.querySelectorAll("h4")].some((el) => normalizePrice(el.innerText) === target)),
        // 3. Normalized match on h4 or h5
        () => cards.find((card) => [...card.querySelectorAll("h4, h5")].some((el) => normalizePrice(el.innerText) === target)),
        // 4. DEAL MODE: pick the first card with a [type="limited"] element (any limited deal)
        () => (isDealMode ? cards.find((card) => card.querySelector('[type="limited"]')) : null),
        // 5. Normalized match anywhere in the card's price-bearing text
        () => cards.find((card) => cardPrices(card).some((t) => normalizePrice(t) === target)),
        // 6. Card-wrapper-agnostic: find any h4/h5 with the price, then climb to a card-like ancestor
        () => {
          const headings = [...document.querySelectorAll("h4, h5")];
          const match = headings.find((el) => normalizePrice(el.innerText) === target);
          if (!match) return null;
          return (
            match.closest('[data-testid*="card"], [data-testid*="package"], .MuiCard-root, .MuiPaper-root, .MuiStack-root') ||
            match.parentElement
          );
        },
      ];
      for (let i = 0; i < strategies.length; i++) {
        try {
          const card = strategies[i]();
          if (card) {
            console.log(`[ModoBot] Buy card found via strategy ${i + 1}`, card);
            return card;
          }
        } catch (e) {}
      }
      return null;
    }

    // Find the actual clickable element within a buy card.
    function findBuyButton(card) {
      if (!card) return null;
      const strategies = [
        // 1. Original click-area data-testid
        () => card.querySelector('[data-testid="buy-package-card-click-area"]'),
        // 2. Any data-testid containing "click" or "buy"
        () => card.querySelector('[data-testid*="click"], [data-testid*="buy" i]'),
        // 3. A <button> inside the card
        () => card.querySelector("button"),
        // 4. role="button" inside the card
        () => card.querySelector('[role="button"]'),
        // 5. An anchor with /buy or /checkout
        () => card.querySelector('a[href*="buy"], a[href*="checkout"], a[href*="package"]'),
        // 6. MuiButtonBase-root (MUI's clickable base)
        () => card.querySelector(".MuiButtonBase-root"),
        // 7. The card itself if it shows a pointer cursor
        () => (getComputedStyle(card).cursor === "pointer" ? card : null),
      ];
      for (let i = 0; i < strategies.length; i++) {
        try {
          const btn = strategies[i]();
          if (btn) {
            console.log(`[ModoBot] Buy button found via strategy ${i + 1}`, btn);
            return btn;
          }
        } catch (e) {}
      }
      return null;
    }

    // Find the buy button by locating the target PRICE anywhere on screen, then climbing
    // to the nearest clickable element. No hashed classes, no nth-child — survives redesigns.
    // Works whether the price sits in a card, a MuiDialog modal, an iframe-free overlay, etc.
    function findBuyButtonByPrice(targetPrice) {
      const target = normalizePrice(targetPrice);
      const isDealMode = !target || ["deal", "any", "*"].includes(target);

      const isVisible = (el) => {
        if (!(el instanceof Element) || !el.offsetParent) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      // Look inside any open dialog/modal first (the buy popup), then fall back to the whole page.
      const dialogs = [...document.querySelectorAll(".MuiDialog-root, .MuiModal-root, [role=\"dialog\"]")].filter(isVisible);
      const scopes = dialogs.length ? [...dialogs, document] : [document];

      const CLICKABLE = 'button, [role="button"], a[href], [data-testid*="click" i], [data-testid*="buy" i], .MuiButtonBase-root';

      // From a price node, walk UP to 12 ancestors and return the first visible clickable inside.
      const climbToButton = (start) => {
        let node = start;
        for (let i = 0; i < 12 && node; i++) {
          const btn = node.querySelector && node.querySelector(CLICKABLE);
          if (btn && isVisible(btn)) return btn;
          node = node.parentElement;
        }
        return (start.closest && start.closest(CLICKABLE)) || null;
      };

      for (const scope of scopes) {
        // DEAL mode: no specific price — just take the first visible actionable button in scope.
        if (isDealMode) {
          const btn = [...scope.querySelectorAll('button, [role="button"], .MuiButtonBase-root')].find(isVisible);
          if (btn) {
            console.log("[ModoBot] Buy button (deal mode):", btn);
            return btn;
          }
          continue;
        }
        // Every visible element whose ENTIRE text normalizes to the target price.
        // Handles "$" and the number living in separate child text nodes/spans.
        // Sort leaf-most first (shortest raw text) so we anchor on the price itself, not a wrapper.
        const matches = [...scope.querySelectorAll("h1,h2,h3,h4,h5,h6,p,span,div,strong,b")]
          .filter((el) => isVisible(el) && normalizePrice(el.textContent) === target)
          .sort((a, b) => a.textContent.length - b.textContent.length);
        for (const priceNode of matches) {
          const btn = climbToButton(priceNode);
          if (btn) {
            console.log("[ModoBot] Buy button via price anchor:", priceNode, "→", btn);
            return btn;
          }
        }
      }
      return null;
    }

    // Find the CVV input via stable attributes (React IDs like "_r_59_" change every render — don't use #id).
    // Searches the main document AND same-origin iframes.
    function findCvvField() {
      const selectors = [
        'input[name="securityCode"]', // most stable in current Modo DOM
        'input[autocomplete="cc-csc"]', // standard credit-card CSC autocomplete
        'input[placeholder*="CVV" i]',
        'input[placeholder*="CVC" i]',
        'input[aria-label*="CVV" i]',
        'input[aria-label*="CVC" i]',
        'input[name*="cvv" i]',
        'input[name*="cvc" i]',
        'input[name*="security" i]',
        'input[id*="cvv" i]',
        'input[id*="cvc" i]',
      ];
      // Search main document first
      for (const sel of selectors) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            console.log("[ModoBot] CVV found via", sel);
            return el;
          }
        } catch (e) {}
      }
      // Then same-origin iframes (cross-origin will throw and be skipped)
      for (const iframe of document.querySelectorAll("iframe")) {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow.document;
          if (!doc) continue;
          for (const sel of selectors) {
            const el = doc.querySelector(sel);
            if (el) {
              console.log("[ModoBot] CVV found in iframe via", sel);
              return el;
            }
          }
        } catch (e) {
          /* cross-origin */
        }
      }
      return null;
    }

    // Find the Pay-now button via multiple strategies.
    // Current DOM: <p class="MuiTypography-root MuiTypography-body1 css-9zmhhi">Pay now</p>
    // The <p> is just text — actual click handler usually sits on a parent button/MuiButtonBase.
    function findPayNowButton() {
      const isPayNowText = (el) => el && el.innerText && el.innerText.trim().toLowerCase() === "pay now";
      const strategies = [
        // 1. <p> with MuiTypography-root and text "Pay now" (current DOM)
        () => [...document.querySelectorAll("p.MuiTypography-root")].find(isPayNowText),
        // 2. Any <p> with text "Pay now"
        () => [...document.querySelectorAll("p")].find(isPayNowText),
        // 3. Any button/anchor with text "Pay now"
        () => [...document.querySelectorAll('button, a, [role="button"]')].find(isPayNowText),
        // 4. Element whose class contains "Typography" with text "Pay now"
        () => [...document.querySelectorAll('[class*="Typography"]')].find(isPayNowText),
        // 5. data-testid containing "pay"
        () => document.querySelector('[data-testid*="pay" i]:not([data-testid*="paypal" i])'),
        // 6. Broad text search across visible elements
        () => [...document.querySelectorAll("span, p, button, a, div")].find((el) => isPayNowText(el) && el.offsetParent !== null),
        // 7. Case variants ("PAY NOW", "Pay Now")
        () => [...document.querySelectorAll("p, span, button, a")].find((el) => el.innerText && /^pay now$/i.test(el.innerText.trim())),
      ];
      for (let i = 0; i < strategies.length; i++) {
        try {
          const el = strategies[i]();
          if (el) {
            console.log(`[ModoBot] Pay-now found via strategy ${i + 1}`, el);
            return el;
          }
        } catch (e) {}
      }
      return null;
    }

    // Poll until predicate returns truthy or timeout elapses.
    function waitFor(fn, { timeout = 15000, interval = 250 } = {}) {
      return new Promise((resolve, reject) => {
        const t0 = Date.now();
        const tick = () => {
          let result;
          try {
            result = fn();
          } catch (e) {}
          if (result) return resolve(result);
          if (Date.now() - t0 > timeout) return reject(new Error("timeout"));
          setTimeout(tick, interval);
        };
        tick();
      });
    }

    async function clickPayNow() {
      let payNowBtn;
      try {
        // Poll up to 8s for Pay now to appear (modal animation, network delay, etc.)
        payNowBtn = await waitFor(findPayNowButton, { timeout: 8000, interval: 250 });
      } catch (e) {
        console.error("[ModoBot] Pay now button not found after 8s.");
        logEvent(cfg, "fail", { reason: "pay_now_not_found" });
        return "fail";
      }
      console.log("[ModoBot] Clicking Pay now (robust)...");
      robustClick(payNowBtn);
      logEvent(cfg, "pay_clicked");
      return watchForOutcome();
    }

    async function fillCvvAndSubmit() {
      let cvvField;
      try {
        // Poll up to 8s — handles modal animation + iframe load time
        cvvField = await waitFor(findCvvField, { timeout: 8000, interval: 300 });
      } catch (e) {
        console.error("[ModoBot] CVV field not found after 8s.");
        logEvent(cfg, "fail", { reason: "cvv_not_found" });
        return "fail";
      }
      console.log("[ModoBot] CVV field found, filling...");
      // Focus first so React's controlled inputs register the change
      triggerClick(cvvField);
      cvvField.focus();
      await new Promise((r) => setTimeout(r, 100));
      // Use the native value setter so React picks up the change (controlled inputs need this)
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      nativeSetter.call(cvvField, cfg.cvv);
      cvvField.dispatchEvent(new Event("input", { bubbles: true }));
      cvvField.dispatchEvent(new Event("change", { bubbles: true }));
      cvvField.dispatchEvent(new Event("blur", { bubbles: true }));
      logEvent(cfg, "cvv_filled");
      await new Promise((r) => setTimeout(r, 500));
      return clickPayNow();
    }

    // ----- OUTCOME WATCHER -----
    // Polls for up to 30s after Pay now click for a success or failure signal.
    // Resolves 'success' | 'fail' | 'unknown' so the retry supervisor can decide whether to try again.
    function watchForOutcome() {
      return new Promise((resolve) => {
        const t0 = Date.now();
        const startUrl = location.href;
        const interval = setInterval(() => {
          const elapsed = Date.now() - t0;
          if (elapsed > 30000) {
            clearInterval(interval);
            logEvent(cfg, "unknown", { reason: "outcome_timeout" });
            return resolve("unknown");
          }
          // Success signals (best-effort — adjust selectors based on real Modo flow)
          const urlChanged = location.href !== startUrl && /(order|success|confirmation|receipt|complete|thank)/i.test(location.href);
          const successText =
            !!document.body && /(order placed|thank you|purchase successful|receipt|confirmation)/i.test(document.body.innerText);
          const errorText = !!document.body && /(declined|failed|insufficient|expired card|invalid)/i.test(document.body.innerText);

          if (urlChanged || successText) {
            clearInterval(interval);
            const orderIdMatch = document.body.innerText.match(/order[\s#:]+([A-Z0-9-]{4,})/i);
            logEvent(cfg, "success", { order_id: orderIdMatch ? orderIdMatch[1] : null, ms: elapsed });
            return resolve("success");
          } else if (errorText) {
            clearInterval(interval);
            logEvent(cfg, "fail", { reason: "error_text_detected", ms: elapsed });
            return resolve("fail");
          }
        }, 1000);
      });
    }

    // ----- CORE PURCHASE -----
    async function executePurchase(isTest = false) {
      console.log(isTest ? "[ModoBot] Test run..." : "[ModoBot] Scheduled run...");
      logEvent(cfg, "fired", { test: isTest });

      // Poll up to 12s for a buy target. PRIMARY: price-anchored finder (locates the
      // target price anywhere on screen / in the buy modal, then climbs to its button).
      // FALLBACK: legacy card-based lookup for older DOM layouts.
      let buyBtn = null;
      try {
        buyBtn = await waitFor(
          () => {
            const byPrice = findBuyButtonByPrice(cfg.targetPrice);
            if (byPrice) return byPrice;
            const card = findTargetCard(cfg.targetPrice);
            return card ? findBuyButton(card) : null;
          },
          { timeout: 12000, interval: 300 }
        );
      } catch (e) {
        console.error("[ModoBot] No buy button found for target price.");
        console.log(
          "[ModoBot] Prices currently visible:",
          [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,span")]
            .map((el) => el.innerText && el.innerText.trim())
            .filter((t) => t && /\d/.test(t) && t.length < 12)
        );
        logEvent(cfg, "fail", { reason: "buy_button_not_found", target: cfg.targetPrice });
        return "fail";
      }
      logEvent(cfg, "card_found");

      // Fill card # / name / expiry if those fields are present on this view.
      const cardNumField = document.querySelector("#cardNumber");
      const nameField = document.querySelector("#cardName");
      const expiryField = document.querySelector("#cardExpiry");
      if (cardNumField) {
        cardNumField.value = cfg.cardNumber;
        cardNumField.dispatchEvent(new Event("input", { bubbles: true }));
        cardNumField.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (nameField) {
        nameField.value = cfg.cardHolder;
        nameField.dispatchEvent(new Event("input", { bubbles: true }));
        nameField.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (expiryField) {
        expiryField.value = cfg.expiry;
        expiryField.dispatchEvent(new Event("input", { bubbles: true }));
        expiryField.dispatchEvent(new Event("change", { bubbles: true }));
      }

      console.log("[ModoBot] Clicking buy button (robust)...");
      robustClick(buyBtn);
      logEvent(cfg, "buy_clicked");
      console.log("[ModoBot] Buy clicked, waiting for CVV modal...");
      await new Promise((r) => setTimeout(r, 1500));
      return fillCvvAndSubmit();
    }

    // ----- POST-REFRESH KICKOFF + END-TO-END RETRY SUPERVISOR -----
    // The TEST button and the scheduled fire BOTH land here (both set SESSION_KEY then reload),
    // so this one block is the shared purchase path for test and live runs alike.
    // Each pass runs a full Store -> Buy -> CVV -> Pay sequence. On anything short of a
    // confirmed success we wait RETRY_GAP (7s) and reload for another pass, up to MAX_ATTEMPTS (5).
    // The attempt counter lives in sessionStorage so it survives each reload. A success sets
    // SUCCESS_KEY, which stops all further retries.
    if (sessionStorage.getItem(SESSION_KEY)) {
      sessionStorage.removeItem(SESSION_KEY);

      const MAX_STORE_RETRIES = 3; // inner Store-button polls per pass, 10s apart
      const RETRY_DELAY = 10000; // wait between inner Store polls (ms)

      // One full purchase pass. Resolves 'success' | 'fail' | 'unknown'.
      async function attemptStore(pollAttempt = 0) {
        let storeBtn;
        try {
          // Poll up to 12s for the Store button — handles slow page hydration after refresh
          storeBtn = await waitFor(findStoreButton, { timeout: 12000, interval: 300 });
        } catch (e) {
          if (pollAttempt < MAX_STORE_RETRIES) {
            console.warn(
              `[ModoBot] Store button not found (poll ${pollAttempt + 1}/${MAX_STORE_RETRIES + 1}). Retrying in ${(RETRY_DELAY / 1000).toFixed(0)}s...`
            );
            await new Promise((r) => setTimeout(r, RETRY_DELAY));
            return attemptStore(pollAttempt + 1);
          }
          console.error(`[ModoBot] Store button not found after ${MAX_STORE_RETRIES + 1} polls.`);
          logEvent(cfg, "fail", { reason: "store_btn_not_found" });
          return "fail";
        }
        console.log("[ModoBot] Clicking Store button (robust)...");
        robustClick(storeBtn);
        logEvent(cfg, "store_clicked");

        // ----- BLANK-STORE RECOVERY -----
        // Wait for the store to populate. If it loads blank, press Escape and re-open
        // the store (your manual fix), up to MAX_BLANK_RECOVERIES times.
        const MAX_BLANK_RECOVERIES = 3;
        let contentReady = false;
        try {
          await waitFor(storeHasContent, { timeout: 4000, interval: 300 });
          contentReady = true;
        } catch (e) {
          /* blank so far */
        }

        for (let r = 1; !contentReady && r <= MAX_BLANK_RECOVERIES; r++) {
          console.warn(`[ModoBot] Store looks blank. Recovery ${r}/${MAX_BLANK_RECOVERIES}: Escape + re-open Store...`);
          pressEscape();
          await new Promise((res) => setTimeout(res, 600)); // let the overlay close
          const reBtn = findStoreButton();
          if (reBtn) robustClick(reBtn);
          logEvent(cfg, "store_reopened", { recovery: r });
          try {
            await waitFor(storeHasContent, { timeout: 5000, interval: 300 });
            contentReady = true;
          } catch (e) {
            /* still blank — loop */
          }
        }
        if (contentReady) {
          console.log("[ModoBot] Store content loaded.");
        } else {
          console.warn("[ModoBot] Store still blank after recoveries; proceeding — outer retry will reload if needed.");
        }

        const purchaseDelay = Math.floor(Math.random() * 3000) + 3000;
        console.log(`[ModoBot] Store ready. Purchase in ${(purchaseDelay / 1000).toFixed(1)}s...`);
        await new Promise((r) => setTimeout(r, purchaseDelay));
        return executePurchase(false);
      }

      const attempt = parseInt(sessionStorage.getItem(ATTEMPT_KEY) || "0", 10);
      // First fire waits 15-20s (human-like + page hydration). Retries are snappier — the
      // reload + 7s gap already elapsed, and attemptStore polls for Store on its own.
      const storeDelay = attempt === 0 ? Math.floor(Math.random() * 5000) + 15000 : 3000;
      console.log(`[ModoBot] Attempt ${attempt + 1}/${MAX_ATTEMPTS}. Searching for Store in ${(storeDelay / 1000).toFixed(1)}s...`);

      setTimeout(async () => {
        const result = await attemptStore(0);

        if (result === "success") {
          sessionStorage.setItem(SUCCESS_KEY, "true");
          sessionStorage.removeItem(ATTEMPT_KEY);
          console.log(`[ModoBot] ✅ Purchase confirmed on attempt ${attempt + 1}. No further retries.`);
          return;
        }

        if (attempt + 1 < MAX_ATTEMPTS) {
          console.warn(`[ModoBot] Attempt ${attempt + 1} did not confirm (${result}). Retrying in ${(RETRY_GAP / 1000).toFixed(0)}s...`);
          sessionStorage.setItem(ATTEMPT_KEY, String(attempt + 1));
          setTimeout(() => {
            sessionStorage.setItem(SESSION_KEY, "true");
            location.reload();
          }, RETRY_GAP);
        } else {
          console.error(`[ModoBot] All ${MAX_ATTEMPTS} attempts exhausted without a confirmed purchase.`);
          sessionStorage.removeItem(ATTEMPT_KEY);
          logEvent(cfg, "fail", { reason: "all_attempts_exhausted" });
        }
      }, storeDelay);
    }

    // ----- SCHEDULER -----
    const timeChecker = setInterval(() => {
      const now = new Date();
      const curr = [now.getHours(), now.getMinutes(), now.getSeconds()].map((v) => String(v).padStart(2, "0")).join(":");
      // Don't fire if a retry sequence is already running (ATTEMPT_KEY) or a purchase
      // already confirmed (SUCCESS_KEY) — avoids colliding with the retry supervisor.
      if (curr === TARGET_TIME && !sessionStorage.getItem(ATTEMPT_KEY) && !sessionStorage.getItem(SUCCESS_KEY)) {
        clearInterval(timeChecker);
        console.log(`[ModoBot] Target ${TARGET_TIME} reached. Refreshing...`);
        sessionStorage.removeItem(ATTEMPT_KEY); // fresh run → reset the retry counter
        sessionStorage.removeItem(SUCCESS_KEY);
        sessionStorage.setItem(SESSION_KEY, "true");
        location.reload();
      }
    }, 1000);
  }

  main();
})();
