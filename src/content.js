(() => {
  const extensionState = window.__discordDmLogExporter || {};
  window.__discordDmLogExporter = extensionState;

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
  let overlayVisible = false;
  let messageObserver = extensionState.messageObserver || null;
  let observedMessageContainer = extensionState.observedMessageContainer || null;
  let captureScheduled = false;
  let captureTimeoutId = extensionState.captureTimeoutId || 0;
  let lastCaptureStartedAt = extensionState.lastCaptureStartedAt || 0;
  let lastOverlaySignature = extensionState.lastOverlaySignature || "";
  const minCaptureIntervalMs = 750;

  init();

  async function init() {
    const stored = await chrome.storage.local.get(STORE_KEYS);
    settings = normalizeSettings(stored.settings);
    messages = stored.messages || [];
    recordingState = stored.recordingState || "idle";
    captureCounter = Number(stored.captureCounter || messages.length || 0);
    seenKeys = new Set(messages.map(messageKey));
    overlayVisible = recordingState === "recording" || recordingState === "stopped";
    registerRuntimeMessageListener();
    registerStorageChangeListener();
    renderOverlay();
    if (recordingState === "recording") startMessageObserver();
  }

  function registerRuntimeMessageListener() {
    if (extensionState.messageListener) {
      chrome.runtime.onMessage.removeListener(extensionState.messageListener);
    }
    extensionState.messageListener = handleRuntimeMessage;
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  }

  function handleRuntimeMessage(message, sender, sendResponse) {
    if (message?.type === "SHOW_RECORDING_OVERLAY") {
      overlayVisible = true;
      renderOverlay();
      sendResponse({ ok: true });
      return true;
    }
    return false;
  }

  function registerStorageChangeListener() {
    if (extensionState.storageChangeListener) {
      chrome.storage.onChanged.removeListener(extensionState.storageChangeListener);
    }
    extensionState.storageChangeListener = handleStorageChange;
    chrome.storage.onChanged.addListener(handleStorageChange);
  }

  function handleStorageChange(changes, area) {
    if (area !== "local") return;
    if (changes.settings) settings = normalizeSettings(changes.settings.newValue);
    if (changes.messages) messages = changes.messages.newValue || [];
    if (changes.recordingState) recordingState = changes.recordingState.newValue || "idle";
    if (changes.captureCounter) captureCounter = Number(changes.captureCounter.newValue || 0);
    seenKeys = new Set(messages.map(messageKey));
    if (changes.recordingState) {
      if (recordingState === "recording") startMessageObserver();
      else stopMessageObserver();
    }
    renderOverlay();
  }

  function normalizeSettings(value) {
    return { ...DEFAULT_SETTINGS, ...(value || {}), ignoreReactions: true, allowUnknownDateRange: Boolean(value?.allowUnknownDateRange) };
  }

  function startMessageObserver() {
    stopMessageObserver();
    if (recordingState !== "recording") return;
    const target = findMessageListContainer();
    if (!target) {
      scheduleCapture();
      return;
    }
    observedMessageContainer = target;
    extensionState.observedMessageContainer = target;
    messageObserver = new MutationObserver((mutations) => {
      if (recordingState !== "recording") return;
      const hasRelevantMutation = mutations.some((mutation) => !isInsideOverlay(mutation.target));
      if (hasRelevantMutation) scheduleCapture();
    });
    messageObserver.observe(target, { childList: true, subtree: true });
    extensionState.messageObserver = messageObserver;
    scheduleCapture();
  }

  function stopMessageObserver() {
    if (messageObserver) messageObserver.disconnect();
    if (captureTimeoutId) window.clearTimeout(captureTimeoutId);
    messageObserver = null;
    observedMessageContainer = null;
    captureScheduled = false;
    captureTimeoutId = 0;
    extensionState.messageObserver = null;
    extensionState.observedMessageContainer = null;
    extensionState.captureTimeoutId = 0;
  }

  function findMessageListContainer() {
    const selectors = [
      '[data-list-id="chat-messages"]',
      'ol[aria-label*="Messages" i]',
      '[role="log"]'
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && !isInsideOverlay(element)) return element;
    }
    const message = document.querySelector('[id^="chat-messages-"], [role="article"]');
    return message?.closest('[data-list-id], ol, [role="log"], main') || null;
  }

  function scheduleCapture() {
    if (recordingState !== "recording" || captureScheduled) return;
    captureScheduled = true;
    const elapsed = Date.now() - lastCaptureStartedAt;
    const delay = Math.max(minCaptureIntervalMs - elapsed, 0);
    captureTimeoutId = window.setTimeout(async () => {
      captureScheduled = false;
      captureTimeoutId = 0;
      extensionState.captureTimeoutId = 0;
      if (recordingState !== "recording") return;
      lastCaptureStartedAt = Date.now();
      extensionState.lastCaptureStartedAt = lastCaptureStartedAt;
      await captureLoadedMessages();
      if (recordingState === "recording" && !observedMessageContainer) scheduleCapture();
    }, delay);
    extensionState.captureTimeoutId = captureTimeoutId;
  }

  function isInsideOverlay(node) {
    return Boolean(node?.closest?.(`#${overlayId}`));
  }

  function dmStatus() {
    if (location.origin !== "https://discord.com") return { ok: false, reason: "not-discord" };
    const match = location.pathname.match(/^\/channels\/@me\/([^/]+)\/?$/);
    if (!match) return { ok: false, reason: "unsupported-path" };

    const chatRoot = document.querySelector('[role="log"], [data-list-id="chat-messages"], main');
    const groupIndicators = [
      '[aria-label*="Group DM" i]',
      '[aria-roledescription*="Group DM" i]'
    ];
    if (groupIndicators.some((selector) => document.querySelector(selector))) return { ok: false, reason: "group-dm" };

    const recipientLists = [...document.querySelectorAll('[class*="recipients"], [aria-label*="Recipients" i]')];
    const hasMultipleVisibleRecipients = recipientLists.some((list) => {
      const recipientItems = list.querySelectorAll('[role="listitem"], [class*="recipient"], [class*="avatar"]');
      return recipientItems.length > 1;
    });
    if (hasMultipleVisibleRecipients) return { ok: false, reason: "group-dm" };
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
    if (!overlayVisible && recordingState === "idle") {
      overlay?.remove();
      lastOverlaySignature = "";
      extensionState.lastOverlaySignature = "";
      return;
    }
    if (!overlay) {
      overlay = document.createElement("aside");
      overlay.id = overlayId;
      overlay.innerHTML = `<style>
        #${overlayId}{position:fixed;right:18px;bottom:18px;z-index:2147483647;width:340px;background:#1f2330;color:#fff;border:1px solid #5865f2;border-radius:12px;box-shadow:0 10px 30px #0008;font:14px/1.4 Arial,sans-serif;padding:14px}
        #${overlayId} h2{font-size:16px;margin:0 0 8px} #${overlayId} p{margin:7px 0;white-space:pre-line} #${overlayId} button{border:0;border-radius:7px;padding:8px 10px;margin:6px 6px 0 0;background:#5865f2;color:#fff;font-weight:700;cursor:pointer} #${overlayId} button.secondary{background:#4b5563} #${overlayId} button.danger{background:#b91c1c} #${overlayId} .warn{background:#3b2a16;border:1px solid #fdba74;border-radius:8px;padding:8px}
      </style><div data-body></div>`;
      document.body.appendChild(overlay);
      lastOverlaySignature = "";
      extensionState.lastOverlaySignature = "";
    }
    attachOverlayClickHandler(overlay);

    const body = overlay.querySelector("[data-body]");
    if (!dmStatus().ok) {
      updateOverlayBody(body, `<h2>Discord DM Log Exporter</h2><p>${unsupportedText}</p>`);
      return;
    }

    const mode = settings.everythingMode ? "EVERYTHING" : "Date Range";
    const range = settings.everythingMode ? "" : `<p>Date range: ${settings.startDate || "not set"} to ${settings.endDate || "not set"}</p>`;
    const mapping = `<p>Labels: self = ${escapeHtml(settings.selfLabel)}, other = ${escapeHtml(settings.otherLabel)}</p><p>Display-name hints: self = ${escapeHtml(settings.selfDisplayName || "not set")}, other = ${escapeHtml(settings.otherDisplayName || "not set")}</p>`;
    const displayNameWarning = (!settings.selfDisplayName || !settings.otherDisplayName) ? `<p class="warn">For best results, enter both Discord display names. If these are blank, speaker detection may be less accurate.</p>` : "";
    const dateWarning = !hasRequiredDates() ? `<p class="warn">${missingDatesText}</p>` : "";

    if (recordingState === "recording") {
      const unknownWarning = unknownSkipped ? `<p class="warn">${unknownWarningText}</p><button data-action="accept-unknown">Continue with UNKNOWN messages</button>` : "";
      updateOverlayBody(body, `<h2>Recording…</h2><p>Total messages seen: ${totalSeen}</p><p>Messages saved/exportable: ${messages.length}</p>${unknownWarning}<button data-action="stop">Stop Recording</button>`);
    } else if (recordingState === "stopped") {
      updateOverlayBody(body, `<h2>Recording stopped.</h2><p>${messages.length} messages ready to export.</p><button data-action="export">Export TXT</button><button class="danger" data-action="clear">Clear</button>`);
    } else {
      const disabled = hasRequiredDates() ? "" : "disabled";
      updateOverlayBody(body, `<h2>Confirm starting position</h2><p>Are you in the position where recording should begin?

Make sure you have manually scrolled to the first message you want this recording session to consider.</p><p>${modeConfirmationText()}</p>${range}${mapping}${displayNameWarning}${dateWarning}<button data-action="start" ${disabled}>Start Recording</button><button class="secondary" data-action="cancel">Cancel</button>`);
    }
  }

  function updateOverlayBody(body, html) {
    if (lastOverlaySignature === html) return;
    lastOverlaySignature = html;
    extensionState.lastOverlaySignature = html;
    body.innerHTML = html;
  }

  function attachOverlayClickHandler(overlay) {
    if (extensionState.overlayClickListener) {
      overlay.removeEventListener("click", extensionState.overlayClickListener);
    }
    extensionState.overlayClickListener = handleOverlayClick;
    overlay.addEventListener("click", handleOverlayClick);
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
      startMessageObserver();
      scheduleCapture();
      renderOverlay();
    }
    if (action === "stop") {
      stopMessageObserver();
      await chrome.storage.local.set({ recordingState: "stopped" });
    }
    if (action === "clear" || action === "cancel") {
      messages = [];
      seenKeys.clear();
      overlayVisible = false;
      stopMessageObserver();
      await chrome.storage.local.set({ messages: [], captureCounter: 0, recordingState: "idle" });
    }
    if (action === "export") exportTranscript();
    if (action === "accept-unknown") { unknownWarningAccepted = true; scheduleCapture(); renderOverlay(); }
  }

  function modeConfirmationText() {
    return settings.everythingMode
      ? "EVERYTHING mode is selected.\n\nEverything loaded during this recording session may be exported."
      : `Date Range mode is selected.\n\nStart date: ${settings.startDate || "not set"}\nEnd date: ${settings.endDate || "not set"}\n\nMessages outside this range will not be exported.`;
  }

  async function captureLoadedMessages() {
    if (recordingState !== "recording" || !canRecordNow()) return;
    const root = observedMessageContainer || findMessageListContainer() || document;
    const nodes = [...root.querySelectorAll('[id^="chat-messages-"], [role="article"]')].filter((node) => !isInsideOverlay(node));
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
    if (recordingState === "recording" && observedMessageContainer && !document.contains(observedMessageContainer)) {
      startMessageObserver();
    }
  }

  function parseMessage(node, domIndex) {
    if (isReactionOrControl(node)) return null;
    const timestamp = node.querySelector('time[datetime]')?.getAttribute("datetime") || "";
    const exactDate = parseExactTimestamp(timestamp);
    const dividerDate = exactDate ? "" : findNearestDateDivider(node);
    const isoDate = exactDate || dividerDate;
    const hasExactTimestamp = Boolean(exactDate);
    const authorText = getAuthor(node);
    const speaker = authorText ? speakerFor(authorText) : lastSpeaker;
    const text = getMessageText(node);
    const markers = getMarkers(node, speaker);
    const body = [text, ...markers].filter(Boolean).join("\n").trim();
    if (!body) return null;
    if (speaker) lastSpeaker = speaker;
    if (isoDate) lastIsoDate = isoDate;
    const id = node.id || node.getAttribute("data-list-item-id") || "";
    return { id, speaker, text: body, isoDate: isoDate || lastIsoDate, hasExactTimestamp, domIndex };
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

  function parseExactTimestamp(value) {
    if (!value) return "";
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString();
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
    const order = (a.captureIndex ?? a.domIndex ?? 0) - (b.captureIndex ?? b.domIndex ?? 0);
    const aDay = calendarDay(a.isoDate);
    const bDay = calendarDay(b.isoDate);

    if (aDay && bDay && aDay !== bDay) return aDay.localeCompare(bDay);
    if (a.hasExactTimestamp && b.hasExactTimestamp && a.isoDate && b.isoDate && a.isoDate !== b.isoDate) {
      return a.isoDate.localeCompare(b.isoDate);
    }
    return order;
  }

  function calendarDay(isoDate) {
    return isoDate ? isoDate.slice(0, 10) : "";
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
