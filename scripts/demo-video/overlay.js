// Injected at runtime by record.mjs via page.addScriptTag({ content: ... })
// -- recording-only presentation chrome. Never imported by, or shipped
// with, the real app; this file is not part of any Next.js route or
// bundle. Exposes window.__demo.caption()/hideCaption()/ripple() for
// record.mjs to call between/around real page.click() calls.
(function () {
  const ROOT_ID = "__demo_overlay_root__";
  let root = document.getElementById(ROOT_ID);
  if (root) return; // already injected (defensive -- record.mjs injects once per navigation)

  root = document.createElement("div");
  root.id = ROOT_ID;
  root.style.cssText = "position:fixed;inset:0;z-index:2147483000;pointer-events:none;";
  document.body.appendChild(root);

  const captionBox = document.createElement("div");
  captionBox.style.cssText = [
    "position:absolute",
    "left:50%",
    "top:14px",
    "transform:translateX(-50%)",
    "max-width:88%",
    "background:rgba(20,20,22,0.92)",
    "color:#fff",
    "font:600 15px/1.4 system-ui,-apple-system,sans-serif",
    "padding:10px 16px",
    "border-radius:12px",
    "box-shadow:0 6px 20px rgba(0,0,0,0.35)",
    "opacity:0",
    "transition:opacity 220ms ease",
    "text-align:center",
  ].join(";");
  root.appendChild(captionBox);

  let typeToken = 0;

  /** Progressive left-to-right reveal; resolves once the full sentence is visible. */
  function caption(text, { charDelayMs = 22 } = {}) {
    const myToken = ++typeToken;
    captionBox.style.opacity = "1";
    captionBox.textContent = "";
    return new Promise((resolve) => {
      let i = 0;
      function tick() {
        if (myToken !== typeToken) return; // superseded by a newer caption() call
        captionBox.textContent = text.slice(0, i);
        i += 1;
        if (i <= text.length) {
          setTimeout(tick, charDelayMs);
        } else {
          resolve();
        }
      }
      tick();
    });
  }

  function hideCaption() {
    typeToken += 1;
    captionBox.style.opacity = "0";
  }

  /** Tap indicator: a ring that expands and fades at the given viewport coordinates. */
  function ripple(x, y) {
    const ring = document.createElement("div");
    ring.style.cssText = [
      "position:absolute",
      `left:${x}px`,
      `top:${y}px`,
      "width:16px",
      "height:16px",
      "margin-left:-8px",
      "margin-top:-8px",
      "border-radius:50%",
      "border:3px solid rgba(16,163,127,0.9)",
      "background:rgba(16,163,127,0.25)",
      "animation:__demo_ripple 650ms ease-out forwards",
    ].join(";");
    root.appendChild(ring);
    setTimeout(() => ring.remove(), 700);
  }

  const style = document.createElement("style");
  style.textContent = `
    @keyframes __demo_ripple {
      0%   { transform: scale(0.4); opacity: 0.9; }
      70%  { transform: scale(2.6); opacity: 0.35; }
      100% { transform: scale(3.2); opacity: 0; }
    }
  `;
  document.head.appendChild(style);

  window.__demo = { caption, hideCaption, ripple };
})();
