(() => {
  const DEFAULT_SETTINGS = {
    selfLabel: "ME", otherLabel: "FRIEND", selfDisplayName: "", otherDisplayName: "",
    startDate: "", endDate: "", everythingMode: false, includeTimestamps: false, ignoreReactions: true
  };
  const STORE_KEYS = ["settings", "messages", "recordingState"];
  const overlayId = "discord-dm-log-exporter-overlay";
  let settings = DEFAULT_SETTINGS;
  let messages = [];
  let recordingState = "idle";
  let seenKeys = new Set();
  let observer;
  let totalSeen = 0;
  let lastSpeaker = settings.otherLabel;
  let lastIsoDate = "";

  init();

  async function init() {
    const stored = await chrome.storage.local.get(STORE_KEYS);
    settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
    messages = stored.messages || [];
    recordingState = stored.recordingState || "idle";
    seenKeys = new Set(messages.map(messageKey));
    renderOverlay();
    observePageChanges();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.settings) settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
      if (changes.messages) messages = changes.messages.newValue || [];
      if (changes.recordingState) recordingState = changes.recordingState.newValue || "idle";
      seenKeys = new Set(messages.map(messageKey));
      renderOverlay();
    });
  }

  function observePageChanges() {
    observer = new MutationObserver(() => {
      renderOverlay();
      if (recordingState === "recording" && isOneOnOneDm()) captureLoadedMessages();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function isOneOnOneDm() {
    if (!location.pathname.startsWith("/channels/@me/")) return false;
    if (location.pathname === "/channels/@me" || location.pathname === "/channels/@me/") return false;
    const recipients = document.querySelectorAll('[class*="recipients"], [aria-label*="Group"], [aria-label*="group"]');
    const guildMarkers = document.querySelector('[aria-label*="Server"], [data-list-id="guildsnav"] [aria-selected="true"]');
    return recipients.length === 0 && !location.pathname.includes("/threads/") && !guildMarkers;
  }

  function renderOverlay() {
    let overlay = document.getElementById(overlayId);
    if (!overlay) {
      overlay = document.createElement("aside");
      overlay.id = overlayId;
      overlay.innerHTML = `<style>
        #${overlayId}{position:fixed;right:18px;bottom:18px;z-index:2147483647;width:320px;background:#1f2330;color:#fff;border:1px solid #5865f2;border-radius:12px;box-shadow:0 10px 30px #0008;font:14px/1.4 Arial,sans-serif;padding:14px}
        #${overlayId} h2{font-size:16px;margin:0 0 8px} #${overlayId} p{margin:7px 0;white-space:pre-line} #${overlayId} button{border:0;border-radius:7px;padding:8px 10px;margin:6px 6px 0 0;background:#5865f2;color:#fff;font-weight:700;cursor:pointer} #${overlayId} button.secondary{background:#4b5563} #${overlayId} button.danger{background:#b91c1c}
      </style><div data-body></div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener("click", handleOverlayClick);
    }
    const body = overlay.querySelector("[data-body]");
    if (!isOneOnOneDm()) {
      body.innerHTML = `<h2>Discord DM Log Exporter</h2><p>This extension is designed only for one-on-one Discord DMs.\n\nServer channels, group chats, threads, forums, and voice channels are not supported.</p>`;
      return;
    }
    const mode = settings.everythingMode ? "EVERYTHING" : "Date Range";
    const range = settings.everythingMode ? "" : `<p>Date range: ${settings.startDate || "not set"} to ${settings.endDate || "not set"}</p>`;
    if (recordingState === "recording") {
      body.innerHTML = `<h2>Recording…</h2><p>Total messages seen: ${totalSeen}</p><p>Messages saved/exportable: ${messages.length}</p><button data-action="stop">Stop Recording</button>`;
    } else if (recordingState === "stopped") {
      body.innerHTML = `<h2>Recording stopped.</h2><p>${messages.length} messages ready to export.</p><button data-action="export">Export TXT</button><button class="danger" data-action="clear">Clear</button>`;
    } else {
      body.innerHTML = `<h2>Discord DM Log Exporter</h2><p>Current mode: ${mode}</p>${range}<p>${instructionText()}</p><button data-action="start">Start Recording</button><button class="secondary" data-action="cancel">Cancel</button>`;
    }
  }

  async function handleOverlayClick(event) {
    const action = event.target?.dataset?.action;
    if (!action) return;
    if (action === "start") { totalSeen = 0; messages = []; seenKeys.clear(); await chrome.storage.local.set({ messages, recordingState: "recording" }); captureLoadedMessages(); }
    if (action === "stop") await chrome.storage.local.set({ recordingState: "stopped" });
    if (action === "clear" || action === "cancel") { messages = []; seenKeys.clear(); await chrome.storage.local.set({ messages: [], recordingState: "idle" }); }
    if (action === "export") exportTranscript();
  }

  function instructionText() {
    return settings.everythingMode
      ? "Scroll up to the very first day you two started chatting.\n\nOnce the earliest messages are loaded, click ‘Start Recording.’"
      : "Scroll up to the day you set as the start date.\n\nIdeally, scroll a few messages prior to that date, since sometimes Discord may not expose the exact first message clearly if you start on the exact day.\n\nOnce you are in position, click ‘Start Recording.’";
  }

  async function captureLoadedMessages() {
    const nodes = [...document.querySelectorAll('[id^="chat-messages-"], [role="article"]')];
    const newMessages = [];
    for (const node of nodes) {
      const parsed = parseMessage(node);
      if (!parsed) continue;
      totalSeen += 1;
      if (!settings.everythingMode && !isInsideRange(parsed.isoDate)) continue;
      const key = messageKey(parsed);
      if (!seenKeys.has(key)) { seenKeys.add(key); newMessages.push(parsed); }
    }
    if (newMessages.length) {
      messages = [...messages, ...newMessages].sort((a, b) => (a.isoDate || "").localeCompare(b.isoDate || ""));
      await chrome.storage.local.set({ messages });
    }
    renderOverlay();
  }

  function parseMessage(node) {
    const timestamp = node.querySelector('time[datetime]')?.getAttribute("datetime") || "";
    const dividerDate = findNearestDateDivider(node);
    const isoDate = timestamp ? new Date(timestamp).toISOString() : dividerDate;
    const authorText = getAuthor(node);
    const speaker = authorText ? speakerFor(authorText, node) : lastSpeaker;
    const text = getMessageText(node);
    const markers = getMarkers(node, speaker);
    const body = [text, ...markers].filter(Boolean).join("\n").trim();
    if (!body) return null;
    if (speaker) lastSpeaker = speaker;
    if (isoDate) lastIsoDate = isoDate;
    const id = node.id || node.getAttribute("data-list-item-id") || "";
    return { id, speaker, text: body, isoDate: isoDate || lastIsoDate };
  }

  function getAuthor(node) {
    const labelled = node.getAttribute("aria-label") || node.querySelector("[aria-label*=\"Message from\"]")?.getAttribute("aria-label") || "";
    const fromMatch = labelled.match(/Message from ([^,]+)/i);
    return (fromMatch?.[1] || node.querySelector('[class*="username"], h3 span')?.textContent || "").trim();
  }
  function speakerFor(authorText, node) {
    const author = authorText.toLowerCase();
    if (settings.selfDisplayName && author.includes(settings.selfDisplayName.toLowerCase())) return settings.selfLabel;
    if (settings.otherDisplayName && author.includes(settings.otherDisplayName.toLowerCase())) return settings.otherLabel;
    const currentUser = document.querySelector('[class*="nameTag"] [class*="username"], [aria-label="User area"] [class*="username"]')?.textContent?.trim().toLowerCase();
    if (currentUser && author.includes(currentUser)) return settings.selfLabel;
    return settings.otherLabel;
  }
  function getMessageText(node) {
    const parts = [...node.querySelectorAll('[class*="messageContent"]')]
      .map((el) => el.innerText.replace(/\s*\(edited\)$/i, "").trim())
      .filter(Boolean);
    return parts.join("\n");
  }
  function getMarkers(node, speaker) {
    const markers = [];
    const files = node.querySelectorAll('a[href*="cdn.discordapp.com"], [class*="attachment"], [class*="imageWrapper"]');
    const voice = node.querySelectorAll('[class*="voiceMessage"], [aria-label*="Voice message"]');
    if (voice.length) markers.push(voice.length === 1 ? "[VOICE MESSAGE]" : `[${voice.length} VOICE MESSAGES]`);
    if (files.length && !voice.length) markers.push(`[${speaker} SENT A FILE]`);
    return markers;
  }
  function findNearestDateDivider(node) {
    let previous = node.previousElementSibling;
    while (previous) {
      const text = previous.textContent?.trim() || "";
      const parsed = Date.parse(text);
      if (parsed && /\d{4}|today|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(text)) {
        return new Date(parsed).toISOString();
      }
      previous = previous.previousElementSibling;
    }
    return "";
  }

  function isInsideRange(isoDate) {
    if (!isoDate) return false;
    const day = isoDate.slice(0, 10);
    return (!settings.startDate || day >= settings.startDate) && (!settings.endDate || day <= settings.endDate);
  }
  function messageKey(message) { return message.id || [message.speaker, message.isoDate, message.text].join("|"); }
  function exportTranscript() {
    const transcript = formatTranscript(messages, settings.includeTimestamps);
    const filename = `discord-dm-log-${new Date().toISOString().slice(0, 10)}.txt`;
    chrome.runtime.sendMessage({ type: "DOWNLOAD_TRANSCRIPT", text: transcript, filename });
  }
  function formatTranscript(items, includeTimestamps) {
    const blocks = [];
    let current;
    for (const item of items) {
      const stamp = includeTimestamps && item.isoDate ? `[${item.isoDate.slice(0, 16).replace("T", " ")}]\n` : "";
      if (!current || current.speaker !== item.speaker || stamp) {
        current = { speaker: item.speaker, lines: [], stamp };
        blocks.push(current);
      }
      current.lines.push(item.text);
    }
    return blocks.map((block) => `${block.stamp}${block.speaker}:\n${block.lines.join("\n\n")}`).join("\n\n");
  }
})();
