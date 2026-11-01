/*!
 * Payus embed: pay buttons and inline checkouts for any website.
 *
 *   <script src="https://YOUR-PAYUS/embed.js" async
 *           data-to="@dinar" data-link="coffee"></script>
 *
 * Attributes (on the script tag, or on any element with data-payus-pay):
 *   data-to       "@username" to pay (required unless data-invoice)
 *   data-link     payment link slug of that user (optional)
 *   data-amount   amount for open-amount pages (optional)
 *   data-invoice  public invoice token (instead of data-to)
 *   data-mode     "button" (default, opens a dialog) or "inline"
 *   data-label    button text (default "Pay")
 *   data-theme    "light" | "dark"
 *
 * Events, dispatched on the script/host element and bubbling to document:
 *   payus:ready, payus:payer-says-paid, payus:paid (detail.invoice), payus:close
 *
 * Payments go straight to the payee. Nothing about them passes through this
 * page.
 */
(() => {
  const script = document.currentScript;
  const ORIGIN = new URL(script.src).origin;

  function frameUrl(cfg) {
    const params = new URLSearchParams();
    if (cfg.theme) params.set("theme", cfg.theme);
    let path;
    if (cfg.invoice) {
      if (!/^[A-Za-z0-9_-]{32}$/.test(cfg.invoice)) return null;
      path = `/embed/i/${cfg.invoice}`;
    } else {
      const user = (cfg.to || "").replace(/^@/, "").toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(user)) return null;
      path = `/embed/pay/${user}`;
      if (cfg.link) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cfg.link)) return null;
        path += `/${cfg.link}`;
      } else if (cfg.amount && /^\d{1,8}(\.\d{1,8})?$/.test(cfg.amount)) {
        params.set("amount", cfg.amount);
      }
    }
    const qs = params.toString();
    return `${ORIGIN}${path}${qs ? `?${qs}` : ""}`;
  }

  function makeFrame(src, title) {
    const frame = document.createElement("iframe");
    frame.src = src;
    frame.title = title;
    frame.loading = "lazy";
    // Scripts and storage for the widget itself, popups for the pay flow
    // (a payment link); it can't navigate the host page on its own.
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation");
    frame.setAttribute("allow", "clipboard-write");
    frame.style.cssText =
      "width:100%;border:0;display:block;min-height:420px;background:transparent;color-scheme:normal";
    return frame;
  }

  function emit(host, type, detail) {
    host.dispatchEvent(
      new CustomEvent(type, { detail: detail || {}, bubbles: true }),
    );
  }

  // Only messages from Payus, from this widget's own iframe, are trusted.
  function listen(frame, host, onClose) {
    function onMessage(event) {
      if (event.origin !== ORIGIN || event.source !== frame.contentWindow)
        return;
      const data = event.data || {};
      if (data.type === "payus:resize" && Number.isFinite(data.height))
        frame.style.height = `${Math.min(Math.max(data.height, 240), 2000)}px`;
      else if (data.type === "payus:ready") emit(host, "payus:ready");
      else if (data.type === "payus:payer-says-paid")
        emit(host, "payus:payer-says-paid");
      else if (data.type === "payus:paid")
        emit(host, "payus:paid", { invoice: String(data.invoice || "") });
    }
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (onClose) onClose();
    };
  }

  function openDialog(src, host, label) {
    const previous = document.activeElement;
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgba(10,10,10,.55);padding:16px";
    const box = document.createElement("div");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", label);
    box.style.cssText =
      "position:relative;width:min(480px,100%);max-height:92vh;overflow:auto;border-radius:20px;background:#151310;box-shadow:0 24px 60px rgba(0,0,0,.35)";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close");
    close.style.cssText =
      "position:absolute;top:8px;right:10px;z-index:1;width:36px;height:36px;border:0;border-radius:50%;background:rgba(255,255,255,.12);color:#faf7f0;font-size:22px;line-height:1;cursor:pointer";
    const frame = makeFrame(src, label);
    box.append(close, frame);
    overlay.append(box);

    let stop = () => {};
    function done() {
      stop();
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      if (previous && previous.focus) previous.focus();
      emit(host, "payus:close");
    }
    function onKey(e) {
      if (e.key === "Escape") done();
    }
    close.addEventListener("click", done);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done();
    });
    document.addEventListener("keydown", onKey);
    stop = listen(frame, host);
    document.body.append(overlay);
    close.focus();
  }

  function mount(host, cfg) {
    const src = frameUrl(cfg);
    const label = cfg.label || "Pay";
    if (!src) {
      console.error("[payus] embed: set data-to=\"@username\" or data-invoice");
      return;
    }
    if (cfg.mode === "inline") {
      const frame = makeFrame(src, label);
      host.after ? host.after(frame) : host.parentNode.append(frame);
      listen(frame, host);
      return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = "payus-pay-button";
    button.style.cssText =
      "display:inline-flex;align-items:center;gap:8px;padding:12px 20px;border:0;border-radius:999px;background:#151310;color:#faf7f0;font:600 15px/1.2 system-ui,sans-serif;cursor:pointer";
    button.addEventListener("click", () => openDialog(src, host, label));
    if (host === script) script.after(button);
    else host.append(button);
  }

  const config = (el) => ({
    to: el.dataset.to,
    link: el.dataset.link,
    amount: el.dataset.amount,
    invoice: el.dataset.invoice,
    mode: el.dataset.mode,
    label: el.dataset.label,
    theme: el.dataset.theme,
  });

  if (script.dataset.to || script.dataset.invoice) mount(script, config(script));
  for (const el of document.querySelectorAll("[data-payus-pay]"))
    if (!el.dataset.payusMounted) {
      el.dataset.payusMounted = "1";
      mount(el, config(el));
    }
})();
