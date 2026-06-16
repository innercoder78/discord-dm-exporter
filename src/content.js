(() => {
  const DEFAULT_SETTINGS = {
    selfLabel: "ME",
    otherLabel: "FRIEND",
    selfDisplayName: "",
    otherDisplayName: "",
    startDate: "",
    endDate: "",
    everythingMode: false,
    includeTimestamps: false,
    ignoreReactions: true,
    allowUnknownDateRange: false
  };
  const STORE_KEYS = ["settings", "messages", "recordingState", "captureCounter"];
  const overlayId = "discord-dm-log-exporter-overlay";
  const unsupportedText = "This extension is designed only for one-on-one Discord DMs.\n\nServer channels, group chats, threads, forums, and voice channels are not supported.";
  const missingDatesText = "Date Range mode requires both a start date and an end date.\n\nChoose both dates, or check EVERYTHING.";
  const unknownWarningText = "Some loaded messages cannot be confidently mapped to either configured Discord display name. UNKNOWN messages are skipped in Date Range mode unless you explicitly continue.";
  let settings = DEFAULT_SETTINGS;
  let messages = [];
  let recordingState = "idle";
  let seenKeys = new Set();
  let totalSeen = 0;
  let captureCounter = 0;
  let lastSpeaker = "UNKNOWN";
  let lastIsoDate = "";
  let unknownWarningAccepted = false;
  let unknownSkipped = 0;

  init();

  async function init() {
    const stored = await chrome.storage.local.get(STORE_KEYS);
    settings = normalizeSettings(stored.settings);
    messages = stored.messages || [];
    recordingState = stored.recordingState || "idle";
    captureCounter = Number(stored.captureCounter || messages.length || 0);
    seenKeys = new Set(messages.map(messageKey));
    renderOverlay();
    observePageChanges();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.settings) settings = normalizeSettings(changes.settings.newValue);
      if (changes.messages) messages = changes.messages.newValue || [];
      if (changes.recordingState) recordingState = changes.recordingState.newValue || "idle";
      if (changes.captureCounter) captureCounter = Number(changes.captureCounter.newValue || 0);
      seenKeys = new Set(messages.map(messageKey));
      renderOverlay();
    });
  }

  function normalizeSettings(value) {
    return { ...DEFAULT_SETTINGS, ...(value || {}), ignoreReactions: true, allowUnknownDateRange: Boolean(value?.allowUnknownDateRange) };
  }

  function observePageChanges() {
    const observer = new MutationObserver(() => {
      renderOverlay();
      if (recordingState === "recording" && canRecordNow()) captureLoadedMessages();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function dmStatus() {
    if (location.origin !== "https://discord.com") return { ok: false, reason: "not-discord" };
    const match = location.pathname.match(/^\/channels\/@me\/([^/]+)\/?$/);
    if (!match) return { ok: false, reason: "unsupported-path" };

    const chatRoot = document.querySelector('[role="log"], [data-list-id="chat-messages"], main');
    const groupIndicators = [
      '[aria-label*="Group DM" i]',
      '[class*="recipients"]',
      '[class*="privateChannelRecipientsInviteButtonIcon"]'
    ];
    if (groupIndicators.some((selector) => document.querySelector(selector))) return { ok: false, reason: "group-dm" };
    if (!chatRoot) return { ok: false, reason: "unknown" };

    return { ok: true, reason: "one-on-one-dm", channelId: match[1] };
  }

  function hasRequiredDates() {
    return settings.everythingMode || Boolean(settings.startDate && settings.endDate);
  }

  function canRecordNow() {
    return dmStatus().ok && hasRequiredDates();
  }

  function renderOverlay() {
    let overlay = document.getElementById(overlayId);
    if (!overlay) {
      overlay = document.createElement("aside");
      overlay.id = overlayId;
      overlay.innerHTML = `<style>
        #${overlayId}{position:fixed;right:18px;bottom:18px;z-index:2147483647;width:340px;background:#1f2330;color:#fff;border:1px solid #5865f2;border-radius:12px;box-shadow:0 10px 30px #0008;font:14px/1.4 Arial,sans-serif;padding:14px}
        #${overlayId} h2{font-size:16px;margin:0 0 8px} #${overlayId} p{margin:7px 0;white-space:pre-line} #${overlayId} button{border:0;border-radius:7px;padding:8px 10px;margin:6px 6px 0 0;background:#5865f2;color:#fff;font-weight:700;cursor:pointer} #${overlayId} button.secondary{background:#4b5563} #${overlayId} button.danger{background:#b91c1c} #${overlayId} .warn{background:#3b2a16;border:1px solid #fdba74;border-radius:8px;padding:8px}
      </style><div data-body></div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener("click", handleOverlayClick);
    }

    const body = overlay.querySelector("[data-body]");
    if (!dmStatus().ok) {
      body.innerHTML = `<h2>Discord DM Log Exporter</h2><p>${unsupportedText}</p>`;
      return;
    }

    const mode = settings.everythingMode ? "EVERYTHING" : "Date Range";
    const range = settings.everythingMode ? "" : `<p>Date range: ${settings.startDate || "not set"} to ${settings.endDate || "not set"}</p>`;
    const mapping = `<p>Labels: self = ${escapeHtml(settings.selfLabel)}, other = ${escapeHtml(settings.otherLabel)}</p><p>Display-name hints: self = ${escapeHtml(settings.selfDisplayName || "not set")}, other = ${escapeHtml(settings.otherDisplayName || "not set")}</p>`;
    const displayNameWarning = (!settings.selfDisplayName || !settings.otherDisplayName) ? `<p class="warn">For best results, enter both Discord display names. If these are blank, speaker detection may be less accurate.</p>` : "";
    const dateWarning = !hasRequiredDates() ? `<p class="warn">${missingDatesText}</p>` : "";

    if (recordingState === "recording") {
      const unknownWarning = unknownSkipped ? `<p class="warn">${unknownWarningText}</p><button data-action="accept-unknown">Continue with UNKNOWN messages</button>` : "";
      body.innerHTML = `<h2>Recording…</h2><p>Total messages seen: ${totalSeen}</p><p>Messages saved/exportable: ${messages.length}</p>${unknownWarning}<button data-action="stop">Stop Recording</button>`;
    } else if (recordingState === "stopped") {
      body.innerHTML = `<h2>Recording stopped.</h2><p>${messages.length} messages ready to export.</p><button data-action="export">Export TXT</button><button class="danger" data-action="clear">Clear</button>`;
    } else {
      const disabled = hasRequiredDates() ? "" : "disabled";
      body.innerHTML = `<h2>Discord DM Log Exporter</h2><p>Current mode: ${mode}</p>${range}${mapping}${displayNameWarning}${dateWarning}<p>${instructionText()}</p><button data-action="start" ${disabled}>Start Recording</button><button class="secondary" data-action="cancel">Cancel</button>`;
    }
  }

  async function handleOverlayClick(event) {
    const action = event.target?.dataset?.action;
    if (!action) return;
    if (action === "start") {
      if (!canRecordNow()) { renderOverlay(); return; }
      totalSeen = 0;
      captureCounter = 0;
      messages = [];
      seenKeys.clear();
      lastSpeaker = "UNKNOWN";
      lastIsoDate = "";
      unknownWarningAccepted = false;
      unknownSkipped = 0;
      await chrome.storage.local.set({ messages, captureCounter, recordingState: "recording" });
      captureLoadedMessages();
    }
    if (action === "stop") await chrome.storage.local.set({ recordingState: "stopped" });
    if (action === "clear" || action === "cancel") {
      messages = [];
      seenKeys.clear();
      await chrome.storage.local.set({ messages: [], captureCounter: 0, recordingState: "idle" });
    }
    if (action === "export") exportTranscript();
    if (action === "accept-unknown") { unknownWarningAccepted = true; captureLoadedMessages(); renderOverlay(); }
  }

  function instructionText() {
    return settings.everythingMode
      ? "Scroll up to the very first day you two started chatting.\n\nOnce the earliest messages are loaded, click ‘Start Recording.’"
      : "Scroll up to the day you set as the start date.\n\nIdeally, scroll a few messages prior to that date, since sometimes Discord may not expose the exact first message clearly if you start on the exact day.\n\nOnce you are in position, click ‘Start Recording.’";
  }

  async function captureLoadedMessages() {
    const nodes = [...document.querySelectorAll('[id^="chat-messages-"], [role="article"]')];
    const newMessages = [];
    nodes.forEach((node, domIndex) => {
      const parsed = parseMessage(node, domIndex);
      if (!parsed) return;
      totalSeen += 1;
      if (!settings.everythingMode && !isInsideRange(parsed.isoDate)) return;
      if (!settings.everythingMode && parsed.speaker === "UNKNOWN" && !settings.allowUnknownDateRange && !unknownWarningAccepted) { unknownSkipped += 1; return; }
      const key = messageKey(parsed);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        captureCounter += 1;
        newMessages.push({ ...parsed, captureIndex: captureCounter });
      }
    });

    if (newMessages.length) {
      messages = [...messages, ...newMessages].sort(compareMessages);
      await chrome.storage.local.set({ messages, captureCounter });
    }
    renderOverlay();
  }

  function parseMessage(node, domIndex) {
    if (isReactionOrControl(node)) return null;
    const timestamp = node.querySelector('time[datetime]')?.getAttribute("datetime") || "";
    const dividerDate = findNearestDateDivider(node);
    const isoDate = timestamp ? new Date(timestamp).toISOString() : dividerDate;
    const authorText = getAuthor(node);
    const speaker = authorText ? speakerFor(authorText) : lastSpeaker;
    const text = getMessageText(node);
    const markers = getMarkers(node, speaker);
    const body = [text, ...markers].filter(Boolean).join("\n").trim();
    if (!body) return null;
    if (speaker) lastSpeaker = speaker;
    if (isoDate) lastIsoDate = isoDate;
    const id = node.id || node.getAttribute("data-list-item-id") || "";
    return { id, speaker, text: body, isoDate: isoDate || lastIsoDate, domIndex };
  }

  function getAuthor(node) {
    const labelled = node.getAttribute("aria-label") || node.querySelector("[aria-label*=\"Message from\"]")?.getAttribute("aria-label") || "";
    const fromMatch = labelled.match(/Message from ([^,]+)/i);
    return (fromMatch?.[1] || node.querySelector('[class*="username"], h3 span')?.textContent || "").trim();
  }

  function speakerFor(authorText) {
    const author = authorText.toLowerCase();
    if (settings.selfDisplayName && author.includes(settings.selfDisplayName.toLowerCase())) return settings.selfLabel;
    if (settings.otherDisplayName && author.includes(settings.otherDisplayName.toLowerCase())) return settings.otherLabel;
    const currentUser = document.querySelector('[class*="nameTag"] [class*="username"], [aria-label="User area"] [class*="username"]')?.textContent?.trim().toLowerCase();
    if (currentUser && author.includes(currentUser)) return settings.selfLabel;
    return "UNKNOWN";
  }

  function getMessageText(node) {
    const ignoredSelectors = '[class*="reaction"], [aria-label*="reaction" i], [aria-label*="React" i], [class*="button"], [role="button"], [class*="buttons"], [class*="operations"]';
    return [...node.querySelectorAll('[class*="messageContent"]')]
      .map((el) => {
        const clone = el.cloneNode(true);
        clone.querySelectorAll(ignoredSelectors).forEach((ignored) => ignored.remove());
        return (clone.innerText || clone.textContent || "").replace(/\s*\(edited\)$/i, "").trim();
      })
      .filter(Boolean)
      .join("\n");
  }

  function getMarkers(node, speaker) {
    const markers = [];
    const files = node.querySelectorAll('a[href*="cdn.discordapp.com"], [class*="attachment"], [class*="imageWrapper"]');
    const voice = node.querySelectorAll('[class*="voiceMessage"], [aria-label*="Voice message" i]');
    if (voice.length) markers.push(voice.length === 1 ? "[VOICE MESSAGE]" : `[${voice.length} VOICE MESSAGES]`);
    if (files.length && !voice.length) markers.push(`[${speaker} SENT A FILE]`);
    return markers;
  }

  function isReactionOrControl(node) {
    return Boolean(node.matches('[class*="reaction"], [aria-label*="reaction" i], [class*="buttons"], [class*="operations"]'));
  }

  function findNearestDateDivider(node) {
    let previous = node.previousElementSibling;
    while (previous) {
      const text = (previous.textContent || "").trim();
      const parsed = parseDividerDate(text);
      if (parsed) return parsed;
      previous = previous.previousElementSibling;
    }
    return "";
  }

  function parseDividerDate(text) {
    if (!text) return "";
    const lower = text.toLowerCase();
    const now = new Date();
    if (/^today\b/.test(lower)) return startOfDay(now).toISOString();
    if (/^yesterday\b/.test(lower)) {
      const yesterday = startOfDay(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return yesterday.toISOString();
    }
    if (!/\d{4}|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december/i.test(text)) return "";
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString();
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function isInsideRange(isoDate) {
    if (!isoDate) return false;
    const day = isoDate.slice(0, 10);
    return day >= settings.startDate && day <= settings.endDate;
  }

  function compareMessages(a, b) {
    if (a.isoDate && b.isoDate && a.isoDate !== b.isoDate) return a.isoDate.localeCompare(b.isoDate);
    return (a.captureIndex ?? a.domIndex ?? 0) - (b.captureIndex ?? b.domIndex ?? 0);
  }

  function messageKey(message) {
    return message.id || [message.speaker, message.isoDate, message.text].join("|");
  }

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

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
  }
})();
