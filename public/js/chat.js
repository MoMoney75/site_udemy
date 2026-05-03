(function () {
  const dock = document.getElementById("chat-dock");
  const fab = document.getElementById("chat-fab");
  const panel = document.getElementById("chat-panel");
  const closeBtn = document.getElementById("chat-close");
  const navOpen = document.getElementById("nav-chat-open");
  const messagesEl = document.getElementById("chat-messages");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send");

  if (!dock || !fab || !panel || !messagesEl || !form || !input || !sendBtn) {
    return;
  }

  function readErrorFromBody(data) {
    if (!data || typeof data !== "object") return null;
    if (typeof data.error === "string" && data.error.trim()) return data.error.trim();
    if (data.error && typeof data.error.message === "string" && data.error.message.trim()) {
      return data.error.message.trim();
    }
    if (typeof data.message === "string" && data.message.trim()) return data.message.trim();
    return null;
  }

  function isCannotPostHtml(text) {
    return (
      typeof text === "string" &&
      text.includes("Cannot POST") &&
      text.includes("<!DOCTYPE html>")
    );
  }

  function chatUrlCandidates() {
    const fromWindow = (window.__CHAT_API__ && String(window.__CHAT_API__).trim()) || "";
    if (fromWindow) {
      return [fromWindow.replace(/\/$/, "")];
    }
    if (window.location.protocol === "file:") {
      return ["http://127.0.0.1:3000/api/chat", "http://localhost:3000/api/chat"];
    }
    const same = new URL("/api/chat", window.location.origin).toString();
    const out = [same];
    const host = window.location.hostname;
    const isLocal =
      host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "";
    if (isLocal && !same.includes(":3000")) {
      out.push("http://127.0.0.1:3000/api/chat");
      out.push("http://localhost:3000/api/chat");
    }
    return out;
  }

  async function postChat(messages) {
    const urls = chatUrlCandidates();
    let last = { res: null, raw: "" };
    for (const url of urls) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const raw = await res.text();
      last = { res, raw };
      if (isCannotPostHtml(raw)) {
        continue;
      }
      return { res, raw, url };
    }
    return last;
  }

  const conversation = [];
  let emptyHint = null;

  function ensureEmptyHint() {
    if (emptyHint) return;
    emptyHint = document.createElement("p");
    emptyHint.className = "chat-empty";
    emptyHint.textContent =
      "Ask about Mauricio’s career path, technical training, automotive background, or how to get in touch.";
    messagesEl.appendChild(emptyHint);
  }

  function clearEmptyHint() {
    if (emptyHint && emptyHint.parentNode) {
      emptyHint.remove();
    }
    emptyHint = null;
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendBubble(role, text) {
    const div = document.createElement("div");
    div.className = `chat-bubble chat-bubble--${role}`;
    div.textContent = text;
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function setOpen(open) {
    panel.hidden = !open;
    fab.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      ensureEmptyHint();
      requestAnimationFrame(() => {
        input.focus();
        scrollToBottom();
      });
    }
  }

  function toggle() {
    setOpen(panel.hidden);
  }

  fab.addEventListener("click", toggle);
  closeBtn?.addEventListener("click", () => setOpen(false));
  navOpen?.addEventListener("click", () => setOpen(true));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) {
      setOpen(false);
      fab.focus();
    }
  });

  ensureEmptyHint();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    clearEmptyHint();
    conversation.push({ role: "user", content: text });
    appendBubble("user", text);
    input.value = "";

    const typing = document.createElement("div");
    typing.className = "chat-bubble chat-bubble--typing";
    typing.textContent = "Thinking…";
    messagesEl.appendChild(typing);
    scrollToBottom();

    sendBtn.disabled = true;
    input.disabled = true;

    try {
      const { res, raw } = await postChat(conversation);
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = {};
      }
      typing.remove();

      if (!res.ok) {
        let errText = readErrorFromBody(data);
        if (!errText && isCannotPostHtml(raw)) {
          errText =
            "This page is not being served by Express, so /api/chat does not exist. Run `npm start` in the project folder and open http://localhost:3000 — or set window.__CHAT_API__ to your API URL before loading chat.";
        }
        if (!errText && raw && raw.trim().length) {
          errText = raw.trim().slice(0, 280);
        }
        if (!errText) {
          errText = `Request failed (${res.status}). Use http://localhost:3000 with npm start.`;
        }
        appendBubble("error", errText);
        return;
      }

      const reply = typeof data.message === "string" ? data.message : "";
      if (!reply) {
        appendBubble(
          "error",
          readErrorFromBody(data) || "Empty response from the model."
        );
        return;
      }

      conversation.push({ role: "assistant", content: reply });
      appendBubble("assistant", reply);
    } catch {
      typing.remove();
      appendBubble("error", "Network error. Check your connection and try again.");
    } finally {
      sendBtn.disabled = false;
      input.disabled = false;
      input.focus();
    }
  });
})();
