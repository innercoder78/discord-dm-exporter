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
    allowUnknownDateRange: false,
    developerMode: false
  };
  const STORE_KEYS = ["settings", "messages", "recordingState", "captureCounter"];
  const overlayId = "discord-dm-log-exporter-overlay";
  const unsupportedText = "This extension is designed only for one-on-one Discord DMs.\n\nServer channels, group chats, threads, forums, and voice channels are not supported.";
  const missingDatesText = "Date Range mode requires both a start date and an end date.\n\nChoose both dates, or check EVERYTHING.";
  const unknownWarningText = "Some loaded messages cannot be confidently mapped to either configured Discord name. UNKNOWN messages are retained for review and may need resolution before export.";
  let settings = DEFAULT_SETTINGS;
  let messages = [];
  let recordingState = "idle";
  let seenKeys = new Set();
  let seenObservedKeys = new Set();
  let skippedUnknownKeys = new Set();
  let totalSeen = 0;
  let captureCounter = 0;
  let lastKnownSpeaker = "UNKNOWN";
  let lastKnownSpeakerNode = null;
  let lastIsoDate = "";
  let unknownWarningAccepted = false;
  let unknownRetainedCount = 0;
  let overlayVisible = false;
  let messageObserver = extensionState.messageObserver || null;
  let observedMessageContainer = extensionState.observedMessageContainer || null;
  let scrollCaptureTarget = extensionState.scrollCaptureTarget || null;
  let scrollCaptureTimeoutId = extensionState.scrollCaptureTimeoutId || 0;
  let scrollPollingIntervalId = extensionState.scrollPollingIntervalId || 0;
  let lastPolledScrollTop = extensionState.lastPolledScrollTop || 0;
  let captureScheduled = false;
  let captureTimeoutId = extensionState.captureTimeoutId || 0;
  let lastCaptureStartedAt = extensionState.lastCaptureStartedAt || 0;
  let lastOverlaySignature = extensionState.lastOverlaySignature || "";
  let exportFilename = defaultFilename();
  let debugLog = createDebugLog();
  const minCaptureIntervalMs = 750;

  init();

  async function init() {
    const stored = await chrome.storage.local.get(STORE_KEYS);
    settings = normalizeSettings(stored.settings);
    messages = stored.messages || [];
    recordingState = stored.recordingState || "idle";
    captureCounter = Number(stored.captureCounter || messages.length || 0);
    seenKeys = new Set(messages.map((message) => messageKey(message)));
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
      try {
        overlayVisible = true;
        if (typeof message.developerMode === "boolean") settings = { ...settings, developerMode: message.developerMode };
        const status = dmStatus();
        renderOverlay();
        if (!status.ok) {
          sendResponse({ ok: false, error: dmErrorText(status.reason) });
          return true;
        }
        if (!document.getElementById(overlayId)) {
          sendResponse({ ok: false, error: "The recording overlay could not be added to the Discord page." });
          return true;
        }
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
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
    if (changes.messages) {
      messages = changes.messages.newValue || [];
      if (recordingState === "recording") {
        messages.forEach((message) => seenKeys.add(messageKey(message)));
      } else {
        seenKeys = new Set(messages.map((message) => messageKey(message)));
      }
    }
    if (changes.recordingState) recordingState = changes.recordingState.newValue || "idle";
    if (changes.captureCounter) captureCounter = Number(changes.captureCounter.newValue || 0);
    if (changes.recordingState) {
      if (recordingState === "recording") startMessageObserver();
      else stopMessageObserver();
    }
    renderOverlay();
  }

  function normalizeSettings(value) {
    return {
      ...DEFAULT_SETTINGS,
      selfLabel: value?.selfLabel || DEFAULT_SETTINGS.selfLabel,
      otherLabel: value?.otherLabel || DEFAULT_SETTINGS.otherLabel,
      selfDisplayName: value?.selfDisplayName || "",
      otherDisplayName: value?.otherDisplayName || "",
      startDate: value?.startDate || "",
      endDate: value?.endDate || "",
      everythingMode: Boolean(value?.everythingMode),
      includeTimestamps: Boolean(value?.includeTimestamps),
      ignoreReactions: true,
      allowUnknownDateRange: Boolean(value?.allowUnknownDateRange),
      developerMode: Boolean(value?.developerMode)
    };
  }

  function startMessageObserver() {
    stopMessageObserver();
    if (recordingState !== "recording") return;
    const target = findMessageListContainer();
    if (!target) {
      scheduleCapture("mutation");
      return;
    }
    observedMessageContainer = target;
    extensionState.observedMessageContainer = target;
    startScrollCaptureListener(target);
    messageObserver = new MutationObserver((mutations) => {
      if (recordingState !== "recording") return;
      const hasRelevantMutation = mutations.some((mutation) => !isInsideOverlay(mutation.target));
      if (hasRelevantMutation) scheduleCapture("mutation");
    });
    messageObserver.observe(target, { childList: true, subtree: true });
    extensionState.messageObserver = messageObserver;
    scheduleCapture();
  }

  function stopMessageObserver() {
    if (messageObserver) messageObserver.disconnect();
    stopScrollCaptureListener();
    if (captureTimeoutId) window.clearTimeout(captureTimeoutId);
    messageObserver = null;
    observedMessageContainer = null;
    captureScheduled = false;
    captureTimeoutId = 0;
    extensionState.messageObserver = null;
    extensionState.observedMessageContainer = null;
    extensionState.captureTimeoutId = 0;
  }

  function startScrollCaptureListener(messageContainer) {
    stopScrollCaptureListener();
    const target = findScrollCaptureTarget(messageContainer);
    if (!target) return;
    scrollCaptureTarget = target;
    extensionState.scrollCaptureTarget = target;
    target.addEventListener("scroll", handleManualScroll, { passive: true });
    startScrollPolling(target);
  }

  function stopScrollCaptureListener() {
    if (scrollCaptureTarget) scrollCaptureTarget.removeEventListener("scroll", handleManualScroll);
    stopScrollPolling();
    if (scrollCaptureTimeoutId) window.clearTimeout(scrollCaptureTimeoutId);
    scrollCaptureTarget = null;
    scrollCaptureTimeoutId = 0;
    extensionState.scrollCaptureTarget = null;
    extensionState.scrollCaptureTimeoutId = 0;
  }

  function startScrollPolling(target) {
    stopScrollPolling();
    if (!target || recordingState !== "recording") return;
    lastPolledScrollTop = Number(target.scrollTop || 0);
    extensionState.lastPolledScrollTop = lastPolledScrollTop;
    scrollPollingIntervalId = window.setInterval(() => {
      if (recordingState !== "recording" || !scrollCaptureTarget || !document.contains(scrollCaptureTarget)) {
        stopScrollPolling();
        return;
      }
      const currentScrollTop = Number(scrollCaptureTarget.scrollTop || 0);
      if (currentScrollTop !== lastPolledScrollTop) {
        lastPolledScrollTop = currentScrollTop;
        extensionState.lastPolledScrollTop = currentScrollTop;
        debounceScrollCapture("scroll-poll");
      }
    }, 250);
    extensionState.scrollPollingIntervalId = scrollPollingIntervalId;
  }

  function stopScrollPolling() {
    if (scrollPollingIntervalId) window.clearInterval(scrollPollingIntervalId);
    scrollPollingIntervalId = 0;
    extensionState.scrollPollingIntervalId = 0;
  }

  function handleManualScroll(event) {
    if (recordingState !== "recording" || isInsideOverlay(event.target)) return;
    debounceScrollCapture("scroll");
  }

  function debounceScrollCapture(reason = "scroll") {
    if (recordingState !== "recording") return;
    if (scrollCaptureTimeoutId) window.clearTimeout(scrollCaptureTimeoutId);
    scrollCaptureTimeoutId = window.setTimeout(() => {
      scrollCaptureTimeoutId = 0;
      extensionState.scrollCaptureTimeoutId = 0;
      scheduleCapture(reason);
    }, 500);
    extensionState.scrollCaptureTimeoutId = scrollCaptureTimeoutId;
  }

  function findScrollCaptureTarget(messageContainer) {
    const candidates = [
      messageContainer,
      messageContainer?.parentElement,
      messageContainer?.closest?.('[class*="scroller"], [data-list-id="chat-messages"], [role="log"], main'),
      ...[...document.querySelectorAll('[class*="scroller"], [data-list-id="chat-messages"], [role="log"], main')]
    ].filter((element) => element && !isInsideOverlay(element));
    return candidates.find(isScrollableElement) || messageContainer || null;
  }

  function isScrollableElement(element) {
    if (!element || element === document || element === document.documentElement || element === document.body) return false;
    const style = window.getComputedStyle(element);
    const canScroll = /(auto|scroll|overlay)/i.test(`${style.overflowY} ${style.overflow}`);
    return canScroll && element.scrollHeight > element.clientHeight;
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

  function scheduleCapture(reason = "mutation") {
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
      await captureLoadedMessages({ reason });
      if (recordingState === "recording" && !observedMessageContainer) scheduleCapture("mutation");
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

  function dmErrorText(reason) {
    if (reason === "not-discord") return "Open the DM you want to log, scroll to where you want recording to begin, then click START.";
    if (reason === "unsupported-path") return "Open a one-on-one Discord DM before starting. Server channels, group chats, threads, forums, and voice channels are not supported.";
    if (reason === "group-dm") return "This appears to be a group DM. Open a one-on-one Discord DM before starting.";
    return "Could not confirm this page is a one-on-one Discord DM. Wait for Discord to finish loading, then click START again.";
  }

  function hasRequiredDates() {
    return settings.everythingMode || Boolean(settings.startDate && settings.endDate);
  }

  function canRecordNow() {
    return dmStatus().ok && hasRequiredDates() && !isReversedDateRange();
  }

  function isReversedDateRange() {
    if (settings.everythingMode || !settings.startDate || !settings.endDate) return false;
    const startBoundaryMs = localDateBoundaryMs(settings.startDate);
    const endBoundaryMs = localDateBoundaryMs(settings.endDate);
    return !Number.isNaN(startBoundaryMs) && !Number.isNaN(endBoundaryMs) && startBoundaryMs > endBoundaryMs;
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
        #${overlayId} h2{font-size:16px;margin:0 0 8px} #${overlayId} h3{font-size:14px;margin:12px 0 4px} #${overlayId} p{margin:7px 0;white-space:pre-line} #${overlayId} button{border:0;border-radius:7px;padding:8px 10px;margin:6px 6px 0 0;background:#5865f2;color:#fff;font-weight:700;cursor:pointer} #${overlayId} button.secondary{background:#4b5563} #${overlayId} button.danger{background:#b91c1c} #${overlayId} .warn{background:#3b2a16;border:1px solid #fdba74;border-radius:8px;padding:8px} #${overlayId} label{display:block;font-weight:700;margin-top:8px} #${overlayId} .debug{border-top:1px solid #4b5563;margin-top:10px;padding-top:8px} #${overlayId} select{box-sizing:border-box;width:100%;margin-top:4px;padding:7px;border-radius:6px;border:1px solid #6b7280;background:#111827;color:#fff}
      </style><div data-body></div>`;
      document.body.appendChild(overlay);
      lastOverlaySignature = "";
      extensionState.lastOverlaySignature = "";
    }
    attachOverlayClickHandler(overlay);

    const body = overlay.querySelector("[data-body]");
    const status = dmStatus();
    if (!status.ok) {
      updateOverlayBody(body, `<h2>Discord DM Log Exporter</h2><p>${unsupportedText}</p><p class="warn">${dmErrorText(status.reason)}</p>`);
      return;
    }

    const mode = settings.everythingMode ? "EVERYTHING" : "Date Range";
    const range = settings.everythingMode ? "" : `<p>Date range: ${settings.startDate || "not set"} to ${settings.endDate || "not set"}</p>`;
    const mapping = `<p>Log labels: self = ${escapeHtml(settings.selfLabel)}, other = ${escapeHtml(settings.otherLabel)}</p><p>Discord names: self = ${escapeHtml(settings.selfDisplayName || "not set")}, other = ${escapeHtml(settings.otherDisplayName || "not set")}</p>`;
    const displayNameWarning = (!settings.selfDisplayName || !settings.otherDisplayName) ? `<p class="warn">For best results, enter both Discord display names without server tags. If these are blank, speaker detection may be less accurate.</p>` : "";
    const dateWarning = !hasRequiredDates() ? `<p class="warn">${missingDatesText}</p>` : isReversedDateRange() ? `<p class="warn">Start date must be on or before end date.</p>` : "";
    const everythingNote = settings.everythingMode ? `<p class="warn">EVERYTHING mode records every loaded message it sees while recording. If you need exact start and end boundaries, use Date Range. Otherwise, you may need to manually trim a few extra lines from the TXT file afterward.</p>` : "";
    const developerTools = developerModeTools();
    updateDebugWarningState();

    if (recordingState === "recording") {
      const unknownWarning = unknownRetainedCount && !unknownWarningAccepted ? `<p class="warn">${unknownWarningText}</p><button data-action="accept-unknown">Continue with UNKNOWN messages</button>` : "";
      updateOverlayBody(body, `<h2>Recording…</h2><p>Scroll down manually through the conversation. Messages are captured as Discord loads them.</p><p>Total messages seen: ${totalSeen}</p><p>Messages saved/exportable: ${messages.length}</p><p>Current mode: ${mode}</p>${unknownWarning}<button class="danger" data-action="stop">END RECORDING</button>${developerTools}`);
    } else if (recordingState === "stopped") {
      updateOverlayBody(body, `<h2>Recording ended.</h2><p>Total messages saved/exportable: ${messages.length}</p><p>After clicking Export TXT, Chrome will open a Save As window where you can choose the file name and folder.</p><p>Default filename: ${escapeHtml(exportFilename)}</p>${timestampFormatControls()}<button data-action="export">Export TXT</button><button class="danger" data-action="clear">Clear</button>${developerTools}`);
    } else {
      const disabled = hasRequiredDates() && !isReversedDateRange() ? "" : "disabled";
      updateOverlayBody(body, `<h2>Confirm starting position</h2><p>After you click Start Recording, scroll manually through the DM. Messages are captured as Discord loads them.</p><p>For the cleanest log, start where you want the log to begin and scroll down until you reach the point where you want it to end.</p><p>${modeConfirmationText()}</p>${everythingNote}${range}${mapping}${displayNameWarning}${dateWarning}<button data-action="start" ${disabled}>Start Recording</button><button class="secondary" data-action="cancel">Cancel</button>${developerTools}`);
    }
  }


  function developerModeTools() {
    if (!settings.developerMode) return "";
    return `<section class="debug"><h3>Developer Mode</h3><p>Privacy-safe debug log enabled.</p><button class="secondary" data-action="copy-debug">Copy Debug Log</button><button class="secondary" data-action="download-debug">Download Debug Log</button></section>`;
  }

  function createDebugLog() {
    return {
      schema: "discord-dm-exporter-debug-v1",
      createdAt: new Date().toISOString(),
      settings: sanitizedSettingsSummary(),
      browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown",
      pathCategory: currentPathCategory(),
      candidates: [],
      unknownWarningState: {
        unknownRetainedCount: 0,
        unknownWarningAccepted: false,
        warningVisible: false,
        acceptUnknownClicked: 0
      },
      actions: {
        startClicked: 0,
        acceptUnknownClicked: 0,
        exportClicked: 0,
        stopClicked: 0,
        copyDebugClicked: 0,
        downloadDebugClicked: 0
      }
    };
  }

  function sanitizedSettingsSummary() {
    return {
      everythingMode: Boolean(settings.everythingMode),
      startDate: settings.startDate || "",
      endDate: settings.endDate || "",
      timestampOption: settings.includeTimestamps ? "shown" : "hidden",
      includeTimestamps: Boolean(settings.includeTimestamps),
      developerMode: Boolean(settings.developerMode)
    };
  }

  function currentPathCategory() {
    const path = window.location.pathname || "";
    if (/^\/channels\/@me\/\d{15,25}/.test(path)) return "dm";
    if (/^\/channels\/@me/.test(path)) return "dm-list-or-loading";
    if (/^\/channels\/\d{15,25}\//.test(path)) return "server-channel";
    if (/^\/channels\//.test(path)) return "channels-other";
    return "other";
  }

  function recordDebugAction(action) {
    if (!settings.developerMode) return;
    if (!debugLog || !debugLog.actions) debugLog = createDebugLog();
    const key = `${action}Clicked`;
    if (Object.prototype.hasOwnProperty.call(debugLog.actions, key)) debugLog.actions[key] += 1;
    if (action === "acceptUnknown") {
      debugLog.unknownWarningState.acceptUnknownClicked += 1;
    }
    updateDebugWarningState();
  }

  function updateDebugWarningState() {
    if (!settings.developerMode) return;
    if (!debugLog || !debugLog.unknownWarningState) debugLog = createDebugLog();
    debugLog.settings = sanitizedSettingsSummary();
    debugLog.browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
    debugLog.pathCategory = currentPathCategory();
    debugLog.unknownWarningState.unknownRetainedCount = unknownRetainedCount;
    debugLog.unknownWarningState.unknownWarningAccepted = Boolean(unknownWarningAccepted);
    debugLog.unknownWarningState.warningVisible = Boolean(unknownRetainedCount && !unknownWarningAccepted);
  }

  function recordCandidateDebug(parsed, { insideRange, acceptedIntoExport, skippedReason }) {
    if (!settings.developerMode || !parsed?.debug) return;
    updateDebugWarningState();
    debugLog.candidates.push({
      ...parsed.debug,
      insideSelectedDateRange: Boolean(insideRange),
      acceptedIntoExport: Boolean(acceptedIntoExport),
      skippedReason: skippedReason || "none",
      unknownReasonCode: parsed.speaker === "UNKNOWN" ? parsed.debug.inference.reasonCode : "none"
    });
    if (debugLog.candidates.length > 1000) debugLog.candidates.splice(0, debugLog.candidates.length - 1000);
  }

  function safeSpeakerLabel(speaker) {
    if (speaker === settings.selfLabel) return "SELF";
    if (speaker === settings.otherLabel) return "OTHER";
    return "UNKNOWN";
  }

  function buildContinuationDiagnostics(node) {
    const continuation = evaluateContinuation(node);
    return continuation.diagnostics;
  }

  function resetContinuationContext() {
    lastKnownSpeaker = "UNKNOWN";
    lastKnownSpeakerNode = null;
  }

  function rememberKnownSpeaker(speaker, node) {
    if (!speaker || speaker === "UNKNOWN") return;
    lastKnownSpeaker = speaker;
    lastKnownSpeakerNode = node || null;
  }

  function candidateHasOwnedExportableEvidence(node) {
    return Boolean(isValidMessageCandidate(node));
  }

  function evaluateContinuation(node) {
    const continuationNode = getContinuationNode(node);
    const previousContinuationNode = getContinuationNode(lastKnownSpeakerNode);
    const previousSpeakerExisted = Boolean(lastKnownSpeaker && lastKnownSpeaker !== "UNKNOWN");
    const previousSpeakerNodeExists = Boolean(previousContinuationNode && document.contains(previousContinuationNode));
    const hasVisibleAuthor = Boolean(getAuthor(node));
    const sameGroup = Boolean(previousContinuationNode && isSameMessageGroup(continuationNode, previousContinuationNode));
    const directNearAdjacency = Boolean(previousContinuationNode && isAdjacentMessageRun(previousContinuationNode, continuationNode));
    const sharedParent = Boolean(previousContinuationNode && continuationNode?.parentElement && continuationNode.parentElement === previousContinuationNode.parentElement);
    const boundaryDetected = Boolean(isLikelyBoundaryElement(continuationNode) || isLikelyBoundaryElement(previousContinuationNode) || (previousContinuationNode && hasBoundaryBetween(previousContinuationNode, continuationNode)));
    const visibleAuthorChange = Boolean(previousContinuationNode && hasVisibleAuthorBetween(previousContinuationNode, continuationNode));
    const hasCandidateEvidence = candidateHasOwnedExportableEvidence(node);
    let reasonCode = "no-continuation-evidence";
    let inferredSpeaker = "UNKNOWN";
    let usedScanOrderFallback = false;

    if (!node) reasonCode = "missing-node";
    else if (hasVisibleAuthor) reasonCode = "visible-author";
    else if (!previousSpeakerExisted) reasonCode = "no-continuation-evidence";
    else if (boundaryDetected) reasonCode = "blocked-boundary";
    else if (visibleAuthorChange) reasonCode = "blocked-visible-author-change";
    else if (previousSpeakerNodeExists && sameGroup) {
      inferredSpeaker = lastKnownSpeaker;
      reasonCode = "dom-same-group";
    } else if (previousSpeakerNodeExists && directNearAdjacency) {
      inferredSpeaker = lastKnownSpeaker;
      reasonCode = "dom-adjacent-run";
    } else if (previousSpeakerNodeExists && sharedParent) {
      inferredSpeaker = lastKnownSpeaker;
      reasonCode = "dom-shared-parent";
    } else if (hasCandidateEvidence) {
      inferredSpeaker = lastKnownSpeaker;
      reasonCode = "scan-order-fallback";
      usedScanOrderFallback = true;
    }

    return {
      speaker: inferredSpeaker,
      diagnostics: {
        previousSpeakerExisted,
        previousSpeakerLabel: safeSpeakerLabel(lastKnownSpeaker),
        previousSpeakerNodeExists,
        continuationNodeTagName: String(continuationNode?.tagName || "unknown").toLowerCase(),
        previousContinuationNodeTagName: String(previousContinuationNode?.tagName || "unknown").toLowerCase(),
        hasOuterMessageContainer: Boolean(continuationNode && continuationNode !== node),
        sameGroup,
        directNearAdjacency,
        sharedParent,
        boundaryDetected,
        visibleAuthorChange,
        hasCandidateEvidence,
        usedScanOrderFallback,
        reasonCode
      }
    };
  }

  function debugLogText() {
    updateDebugWarningState();
    return JSON.stringify(debugLog || createDebugLog(), null, 2);
  }

  async function copyDebugLog() {
    recordDebugAction("copyDebug");
    try {
      await navigator.clipboard.writeText(debugLogText());
      showOverlayMessage("Debug log copied.");
    } catch (error) {
      showOverlayMessage(`Copy failed: ${error?.message || "unknown error"}`);
    }
  }

  function downloadDebugLog() {
    recordDebugAction("downloadDebug");
    const blob = new Blob([debugLogText()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `discord-dm-exporter-debug-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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

  function timestampFormatControls() {
    if (!settings.includeTimestamps) return "";
    return `<label>Date Format<select data-timestamp-date-format><option value="MM/DD/YYYY" selected>MM/DD/YYYY</option><option value="DD/MM/YYYY">DD/MM/YYYY</option><option value="YYYY/MM/DD">YYYY/MM/DD</option></select></label><label>Time Format<select data-timestamp-time-format><option value="12" selected>12 HOURS (AM/PM)</option><option value="24">24 HOURS (00:00 to 23:59)</option></select></label>`;
  }

  async function handleOverlayClick(event) {
    const action = event.target?.dataset?.action;
    if (!action) return;
    if (action === "start") {
      if (!canRecordNow() || isReversedDateRange()) { renderOverlay(); return; }
      debugLog = createDebugLog();
      recordDebugAction("start");
      totalSeen = 0;
      captureCounter = 0;
      messages = [];
      seenKeys.clear();
      seenObservedKeys.clear();
      skippedUnknownKeys.clear();
      resetContinuationContext();
      lastIsoDate = "";
      unknownWarningAccepted = false;
      unknownRetainedCount = 0;
      recordingState = "recording";
      await chrome.storage.local.set({ messages, captureCounter, recordingState: "recording" });
      startMessageObserver();
      await captureLoadedMessages({ reason: "start-recording" });
      renderOverlay();
    }
    if (action === "stop") {
      recordDebugAction("stop");
      await captureLoadedMessages({ reason: "end-recording" });
      stopMessageObserver();
      recordingState = "stopped";
      exportFilename = defaultFilename();
      await chrome.storage.local.set({ recordingState: "stopped" });
      renderOverlay();
    }
    if (action === "clear") {
      await resetRecordingSession({ clearMessages: true });
    }
    if (action === "cancel") {
      await resetRecordingSession({ clearMessages: false });
    }
    if (action === "export") { recordDebugAction("export"); exportTranscript(); }
    if (action === "accept-unknown") {
      unknownWarningAccepted = true;
      recordDebugAction("acceptUnknown");
      updateDebugWarningState();
      scheduleCapture();
      renderOverlay();
    }
    if (action === "copy-debug") copyDebugLog();
    if (action === "download-debug") downloadDebugLog();
  }

  async function resetRecordingSession({ clearMessages }) {
    stopMessageObserver();
    if (clearMessages) messages = [];
    seenKeys.clear();
    seenObservedKeys.clear();
    skippedUnknownKeys.clear();
    overlayVisible = false;
    recordingState = "idle";
    totalSeen = 0;
    captureCounter = 0;
    resetContinuationContext();
    lastIsoDate = "";
    unknownWarningAccepted = false;
    unknownRetainedCount = 0;
    const updates = { captureCounter: 0, recordingState: "idle" };
    if (clearMessages) updates.messages = [];
    await chrome.storage.local.set(updates);
    renderOverlay();
  }

  function modeConfirmationText() {
    return settings.everythingMode
      ? "EVERYTHING mode is selected."
      : `Date Range mode is selected.\n\nStart date: ${settings.startDate || "not set"}\nEnd date: ${settings.endDate || "not set"}\n\nMessages outside this range will not be exported.`;
  }

  async function captureLoadedMessages({ allowStopped = false, reason = "mutation" } = {}) {
    const canCaptureStoppedPage = allowStopped && recordingState === "stopped";
    if (recordingState !== "recording" && !canCaptureStoppedPage) return;
    if (!canRecordNow()) return;
    const nodes = findLoadedMessageCandidates();
    const newMessages = [];
    const parsedMessages = nodes
      .map((node, domIndex) => parseMessage(node, domIndex))
      .filter(Boolean);
    const suspiciousStableIds = findSuspiciousStableIds(parsedMessages);

    let improvedExisting = false;
    parsedMessages.forEach((parsed) => {
      const key = messageKey(parsed, suspiciousStableIds);
      let skippedReason = "none";
      let acceptedIntoExport = false;
      if (!seenObservedKeys.has(key)) {
        seenObservedKeys.add(key);
        totalSeen += 1;
      }
      if (!settings.everythingMode && !parsed.isoDate) {
        skippedReason = "missing-date";
        recordCandidateDebug(parsed, { insideRange: false, acceptedIntoExport, skippedReason });
        return;
      }
      if (!settings.everythingMode && !isInsideRange(parsed.isoDate)) {
        skippedReason = "outside-range";
        recordCandidateDebug(parsed, { insideRange: false, acceptedIntoExport, skippedReason });
        return;
      }
      if (parsed.speaker === "UNKNOWN" && !unknownWarningAccepted) {
        if (!skippedUnknownKeys.has(key)) {
          skippedUnknownKeys.add(key);
          unknownRetainedCount += 1;
        }
      }
      const existingIndex = messages.findIndex((message) => messageKey(message, suspiciousStableIds) === key);
      if (existingIndex >= 0) {
        const merged = mergeMessageRecord(messages[existingIndex], parsed);
        if (merged !== messages[existingIndex]) {
          messages[existingIndex] = merged;
          improvedExisting = true;
        }
      } else if (!seenKeys.has(key)) {
        seenKeys.add(key);
        captureCounter += 1;
        const savedMessage = { ...parsed, deduplicationKey: key, captureIndex: captureCounter };
        newMessages.push(savedMessage);
        acceptedIntoExport = true;
      } else {
        acceptedIntoExport = true;
      }
      recordCandidateDebug(parsed, { insideRange: settings.everythingMode || isInsideRange(parsed.isoDate), acceptedIntoExport, skippedReason });
    });

    if (newMessages.length || improvedExisting) {
      messages = [...messages, ...newMessages].sort(compareMessages);
      await chrome.storage.local.set({ messages, captureCounter });
    }
    renderOverlay();
    if (recordingState === "recording" && observedMessageContainer && !document.contains(observedMessageContainer)) {
      startMessageObserver();
    }
  }

  function findLoadedMessageCandidates() {
    return findMessageCandidates(document);
  }

  function findMessageCandidates(root) {
    const searchRoot = root?.querySelectorAll ? root : document;
    const contentCandidates = uniqueElements([...searchRoot.querySelectorAll('[id^="message-content-"]')])
      .filter(isValidMessageContentNode)
      .map((contentNode) => {
        const messageId = extractMessageContentId(contentNode);
        return { contentNode, container: findClosestMessageContainer(contentNode, messageId), messageId };
      });
    const contentMessageIds = new Set(contentCandidates.map((candidate) => candidate.messageId).filter(Boolean));

    const primarySelectors = [
      'li[id^="chat-messages-"]',
      '[data-list-item-id^="chat-messages-"]',
      '[data-list-item-id*="chat-messages"]',
      '[class*="messageListItem"]',
      '[role="article"][id^="chat-messages-"]',
      '[role="article"][data-list-item-id]',
      '[role="article"]'
    ];
    let candidates = uniqueElements(primarySelectors.flatMap((selector) => [...searchRoot.querySelectorAll(selector)]))
      .map(normalizeMessageCandidate)
      .filter(Boolean);
    candidates = uniqueElements(candidates).filter(isValidMessageCandidate);

    const messageLikeDescendants = countMessageLikeDescendants(searchRoot);
    if (candidates.length <= 1 && messageLikeDescendants > candidates.length + 1) {
      const fallback = uniqueElements([
        ...searchRoot.querySelectorAll('li[id^="chat-messages-"], li[data-list-item-id*="chat-messages"]'),
        ...searchRoot.querySelectorAll('[class*="messageListItem"], [class*="messageListItem_"]'),
        ...searchRoot.querySelectorAll('[class*="messageContent"]')
          .map((node) => node.closest('li[id^="chat-messages-"], li[data-list-item-id], [role="article"], [class*="messageListItem"]'))
      ]).filter(Boolean);
      candidates = uniqueElements([...candidates, ...fallback.map(normalizeMessageCandidate)])
        .filter(isValidMessageCandidate);
    }

    const containerCandidates = candidates
      .map((container) => ({ contentNode: null, container, messageId: getContainerMessageId(container) }))
      .filter((candidate) => !candidate.messageId || !contentMessageIds.has(candidate.messageId));

    return [...contentCandidates, ...containerCandidates];
  }

  function getContainerMessageId(container) {
    if (!container) return "";
    return extractSnowflakeFromRecordId(getStableMessageId(container))
      || messageSpecificSnowflake(container?.querySelector?.('[id^="message-content-"]')?.id, "descendant-message-content-id");
  }

  function isValidMessageContentNode(node) {
    if (!node || isInsideOverlay(node) || isReplyPreviewElement(node)) return false;
    if (!extractMessageContentId(node)) return false;
    if (node.closest?.('[role="textbox"], [contenteditable="true"], form, [class*="channelTextArea"], [class*="slateTextArea"], [class*="replyBar"], [class*="attachedBars"]')) return false;
    return true;
  }

  function extractMessageContentId(node) {
    const match = String(node?.id || "").match(/^message-content-(\d{15,25})$/);
    return match?.[1] || "";
  }

  function findClosestMessageContainer(contentNode, messageId = "") {
    if (!contentNode || isInsideOverlay(contentNode)) return null;
    const safeFallbackSelector = 'li[id^="chat-messages-"], li[data-list-item-id*="chat-messages"], [role="article"][id^="chat-messages-"], [role="article"][data-list-item-id], [role="article"], [class*="messageListItem"]';
    let fallback = null;
    let current = contentNode.parentElement;
    while (current && current !== document.body && !isInsideOverlay(current)) {
      if (current.matches?.('[role="textbox"], [contenteditable="true"], form, [class*="channelTextArea"], [class*="slateTextArea"], [class*="replyBar"], [class*="attachedBars"]')) return null;
      if (isReplyPreviewElement(current)) return null;
      const id = current.id || "";
      const listId = current.getAttribute?.("data-list-item-id") || "";
      const hasMessageId = messageId && (id.includes(messageId) || listId.includes(messageId));
      const isChatItem = id.startsWith("chat-messages-") || listId.includes("chat-messages");
      if (hasMessageId || isChatItem) return current;
      if (!fallback && current.matches?.(safeFallbackSelector)) fallback = current;
      current = current.parentElement;
    }
    return fallback || normalizeMessageCandidate(contentNode);
  }

  function uniqueElements(elements) {
    return [...new Set(elements.filter(Boolean))];
  }

  function normalizeMessageCandidate(node) {
    if (!node || isInsideOverlay(node)) return null;
    return node.closest?.('li[id^="chat-messages-"], li[data-list-item-id*="chat-messages"], [role="article"][id^="chat-messages-"], [role="article"][data-list-item-id], [role="article"], [class*="messageListItem"]') || node;
  }

  function isValidMessageCandidate(node) {
    if (!node || isInsideOverlay(node) || isReactionOrControl(node)) return false;
    if (node.closest?.('[role="textbox"], [contenteditable="true"], form, [class*="channelTextArea"], [class*="slateTextArea"], [class*="replyBar"], [class*="attachedBars"]')) return false;
    if (node.matches('[data-list-id="chat-messages"], [role="log"], main, ol') && !node.matches('li, [role="article"]')) return false;
    if (!hasMessageSpecificEvidence(node)) return false;
    return Boolean(getOwnedTimestamp(node) || getOwnedContentNodes(node).length || getOwnedMediaNodes(node).length || getOwnedVoiceNodes(node).length);
  }

  function countMessageLikeDescendants(root) {
    return uniqueElements([...root.querySelectorAll('[class*="messageContent"], time[datetime], li[id^="chat-messages-"], [data-list-item-id*="chat-messages"]')])
      .filter((node) => !isInsideOverlay(node)).length;
  }


  function hasMessageSpecificEvidence(node) {
    if (!node) return false;
    const ownId = getStableMessageId(node);
    if (ownId) return true;
    if (node.matches?.('li, [role="article"], [class*="messageListItem"]')) {
      return Boolean(getOwnedTimestamp(node) || getOwnedContentNodes(node).length || getOwnedMediaNodes(node).length || getOwnedVoiceNodes(node).length);
    }
    return false;
  }

  function ownsDescendant(candidate, descendant) {
    if (!candidate || !descendant || !candidate.contains(descendant)) return false;
    const owner = normalizeMessageCandidate(descendant);
    if (owner === candidate) return true;
    return Boolean(getStableMessageId(candidate) && candidate.matches?.('li[id^="chat-messages-"], li[data-list-item-id*="chat-messages"]') && owner && candidate.contains(owner));
  }

  function getOwnedContentNodes(node) {
    return [...node.querySelectorAll('[id^="message-content-"]')]
      .filter(isValidMessageContentNode)
      .filter((contentNode) => ownsDescendant(node, contentNode));
  }

  function getOwnedTimestamp(node) {
    return [...node.querySelectorAll('time[datetime]')]
      .find((timeNode) => ownsDescendant(node, timeNode)) || null;
  }

  function getOwnedMediaNodes(node) {
    return [...node.querySelectorAll('a[href*="cdn.discordapp.com"], [class*="attachment"], [class*="imageWrapper"], [class*="embedWrapper"], [class*="sticker"]')]
      .filter((mediaNode) => ownsDescendant(node, mediaNode) && !isReplyPreviewElement(mediaNode));
  }

  function getOwnedVoiceNodes(node) {
    return [...node.querySelectorAll('[class*="voiceMessage"], [aria-label*="Voice message" i]')]
      .filter((voiceNode) => ownsDescendant(node, voiceNode) && !isReplyPreviewElement(voiceNode));
  }

  function isSameMessageGroup(a, b) {
    const groupA = closestMessageGroup(getContinuationNode(a));
    const groupB = closestMessageGroup(getContinuationNode(b));
    return Boolean(groupA && groupA === groupB);
  }

  function closestMessageGroup(node) {
    return getContinuationNode(node);
  }

  function getContinuationNode(node) {
    if (!node || isInsideOverlay(node)) return null;
    const normalized = normalizeMessageCandidate(node);
    const start = normalized || node;
    const stableSelector = '[id^="chat-messages-"], [data-list-item-id*="chat-messages"]';
    const fallbackSelector = 'li, [role="article"], [class*="messageListItem"]';
    let fallback = null;
    let current = start;
    while (current && current !== document.body && !isInsideOverlay(current)) {
      if (current.matches?.('[data-list-id="chat-messages"], [role="log"], main, ol, ul') && !current.matches?.('li, [role="article"], [class*="messageListItem"]')) break;
      if (current.matches?.(stableSelector)) return current;
      if (!fallback && current.matches?.(fallbackSelector)) fallback = current;
      current = current.parentElement;
    }
    return fallback || start;
  }

  function isAdjacentMessageRun(previousNode, node) {
    const previousContinuationNode = getContinuationNode(previousNode);
    const continuationNode = getContinuationNode(node);
    if (!previousContinuationNode || !continuationNode || previousContinuationNode === continuationNode) return false;
    if (previousContinuationNode.parentElement !== continuationNode.parentElement) return false;
    let current = previousContinuationNode.nextElementSibling;
    let inspected = 0;
    while (current && inspected < 4) {
      if (current === continuationNode) return !isLikelyBoundaryElement(previousContinuationNode) && !isLikelyBoundaryElement(continuationNode);
      if (isLikelyBoundaryElement(current)) return false;
      if (normalizeMessageCandidate(current) && getAuthor(normalizeMessageCandidate(current))) return false;
      current = current.nextElementSibling;
      inspected += 1;
    }
    return false;
  }

  function shareImmediateListParent(a, b) {
    if (!a || !b || a.parentElement !== b.parentElement) return false;
    const parent = a.parentElement;
    if (!parent?.matches?.('ol, ul, [role="list"], [role="log"], [data-list-id="chat-messages"], [class*="scroller"]')) return false;
    return !hasBoundaryBetween(a, b) && !hasVisibleAuthorBetween(a, b);
  }

  function hasBoundaryBetween(a, b) {
    return elementsBetween(a, b).some(isLikelyBoundaryElement);
  }

  function hasVisibleAuthorBetween(a, b) {
    return elementsBetween(a, b).some((element) => {
      if (element === a || element === b) return false;
      const candidate = normalizeMessageCandidate(element);
      return candidate && candidate !== a && candidate !== b && Boolean(getAuthor(candidate));
    });
  }

  function elementsBetween(a, b) {
    if (!a || !b) return [];
    const parent = a.parentElement;
    if (!parent || parent !== b.parentElement) return [];
    const elements = [];
    let current = a.nextElementSibling;
    while (current && current !== b) {
      elements.push(current);
      current = current.nextElementSibling;
    }
    return current === b ? elements : [];
  }

  function isLikelyBoundaryElement(node) {
    const text = (node?.textContent || "").trim();
    return Boolean(node?.matches?.('[role="separator"], [class*="divider"], [class*="systemMessage"]')) || Boolean(parseDividerDate(text));
  }

  function findSuspiciousStableIds(parsedMessages) {
    const fingerprintsById = new Map();
    parsedMessages.forEach((message) => {
      if (!message.id) return;
      const fingerprints = fingerprintsById.get(message.id) || new Set();
      fingerprints.add(message.fallbackDeduplicationKey);
      fingerprintsById.set(message.id, fingerprints);
    });
    return new Set([...fingerprintsById].filter(([, fingerprints]) => fingerprints.size > 1).map(([id]) => id));
  }

  function parseMessage(candidate, domIndex) {
    const contentNode = candidate?.contentNode || null;
    const node = candidate?.container || candidate;
    if (!node || isReactionOrControl(node)) {
      return null;
    }
    const contentMessageId = extractMessageContentId(contentNode);
    const id = contentMessageId ? `discord:${contentMessageId}` : getStableMessageId(node);
    const snowflake = contentMessageId || extractSnowflakeFromRecordId(id);
    const ownedTimestamp = getOwnedTimestamp(node);
    const timestamp = ownedTimestamp?.getAttribute("datetime") || "";
    const exactDate = parseExactTimestamp(timestamp);
    const dividerDate = exactDate ? "" : findNearestDateDivider(node);
    const snowflakeDate = exactDate || dividerDate ? "" : isoDateFromSnowflake(snowflake);
    const isoDate = exactDate || dividerDate || snowflakeDate;
    const timestampSource = exactDate ? "datetime" : dividerDate ? "divider" : snowflakeDate ? "snowflake" : "unknown";
    const hasExactTimestamp = Boolean(exactDate);
    const ownedContentNodes = getOwnedContentNodes(node);
    const ownedMediaNodes = getOwnedMediaNodes(node);
    const ownedVoiceNodes = getOwnedVoiceNodes(node);
    const continuationNode = getContinuationNode(node);
    const authorText = getAuthor(node);
    const authorSpeaker = authorText ? speakerFor(authorText) : "UNKNOWN";
    const continuation = evaluateContinuation(node);
    const continuationDiagnostics = continuation.diagnostics;
    const inferredSpeaker = authorText ? "UNKNOWN" : continuation.speaker;
    const speaker = authorText ? authorSpeaker : inferredSpeaker;
    const text = contentNode ? getMessageTextFromContentNode(contentNode) : getMessageText(node);
    const markers = getMarkers(node, speaker);
    const body = [text, ...markers].filter(Boolean).join("\n").trim();
    const debug = settings.developerMode ? {
      candidateIndex: domIndex,
      normalizedCandidateTagName: String(node.tagName || "unknown").toLowerCase(),
      continuationNodeTagName: String(continuationNode?.tagName || "unknown").toLowerCase(),
      hasOuterMessageContainer: Boolean(continuationNode && continuationNode !== node),
      stableIdPresent: Boolean(id),
      hasMessageSpecificEvidence: hasMessageSpecificEvidence(node),
      hasOwnedTimestamp: Boolean(ownedTimestamp),
      hasOwnedContent: Boolean(ownedContentNodes.length),
      ownedContentNodeCount: ownedContentNodes.length,
      textLength: text.length,
      hasOwnedMedia: Boolean(ownedMediaNodes.length),
      ownedMediaCount: ownedMediaNodes.length,
      hasOwnedVoice: Boolean(ownedVoiceNodes.length),
      ownedVoiceCount: ownedVoiceNodes.length,
      hasVisibleAuthor: Boolean(authorText),
      authorMatched: safeSpeakerLabel(authorSpeaker),
      inferredContinuedSpeaker: safeSpeakerLabel(inferredSpeaker),
      finalSpeaker: safeSpeakerLabel(speaker),
      timestampSource,
      inferenceMethod: authorText ? "visible-author" : continuationDiagnostics.reasonCode,
      usedScanOrderFallback: Boolean(continuationDiagnostics.usedScanOrderFallback),
      domRelationship: continuationDiagnostics.sharedParent ? "shared-parent" : "not-shared-parent",
      inference: continuationDiagnostics
    } : null;
    if (!body) {
      return null;
    }
    if (speaker && speaker !== "UNKNOWN") {
      rememberKnownSpeaker(speaker, continuationNode || node);
    } else if (authorText || continuationDiagnostics.boundaryDetected || continuationDiagnostics.visibleAuthorChange) {
      resetContinuationContext();
    }
    if (isoDate) lastIsoDate = isoDate;
    const effectiveIsoDate = isoDate || lastIsoDate;
    const fallbackDeduplicationKey = buildFallbackDeduplicationKey({ speaker, text: body, isoDate: effectiveIsoDate, hasExactTimestamp, markers });
    const key = id || fallbackDeduplicationKey;
    return { id, deduplicationKey: key, fallbackDeduplicationKey, speaker, unknownSpeaker: speaker === "UNKNOWN", text: body, isoDate: effectiveIsoDate, timestampSource, hasExactTimestamp, domIndex, debug };
  }

  function mergeMessageRecord(existing, parsed) {
    let changed = false;
    const merged = { ...existing };
    if ((merged.speaker === "UNKNOWN" || !merged.speaker) && parsed.speaker && parsed.speaker !== "UNKNOWN") {
      merged.speaker = parsed.speaker;
      merged.unknownSpeaker = false;
      changed = true;
    }
    if (!merged.isoDate && parsed.isoDate) {
      merged.isoDate = parsed.isoDate;
      changed = true;
    }
    if (!merged.hasExactTimestamp && parsed.hasExactTimestamp) {
      merged.isoDate = parsed.isoDate;
      merged.hasExactTimestamp = true;
      merged.timestampSource = parsed.timestampSource;
      changed = true;
    }
    if ((!merged.timestampSource || merged.timestampSource === "unknown" || merged.timestampSource === "snowflake") && parsed.timestampSource && parsed.timestampSource !== "unknown" && parsed.timestampSource !== "snowflake") {
      merged.timestampSource = parsed.timestampSource;
      changed = true;
    }
    if (normalizeMessageText(parsed.text).length > normalizeMessageText(merged.text).length) {
      merged.text = parsed.text;
      changed = true;
    }
    if (!merged.id && parsed.id) {
      merged.id = parsed.id;
      merged.deduplicationKey = parsed.id;
      changed = true;
    }
    return changed ? merged : existing;
  }

  function getStableMessageId(node) {
    const attributes = [
      { name: "id", value: node.id },
      { name: "data-list-item-id", value: node.getAttribute("data-list-item-id") },
      { name: "data-message-id", value: node.getAttribute("data-message-id") },
      { name: "data-item-id", value: node.getAttribute("data-item-id") }
    ].filter((attribute) => attribute.value);

    for (const attribute of attributes) {
      const id = messageSpecificSnowflake(attribute.value, attribute.name);
      if (id) return `discord:${id}`;
    }
    return "";
  }

  function messageSpecificSnowflake(value, attributeName) {
    const text = String(value || "");
    const contentMatch = text.match(/message-content-(\d{15,25})/);
    if (contentMatch) return contentMatch[1];
    const chatMessageMatch = text.match(/chat-messages-(\d{15,25})-(\d{15,25})/);
    if (chatMessageMatch) return chatMessageMatch[2];
    const explicitMessageMatch = text.match(/(?:^|[^a-z])message-(\d{15,25})(?:\b|$)/i);
    if (explicitMessageMatch) return explicitMessageMatch[1];
    if (/^\d{15,25}$/.test(text) && /data-message-id$/.test(attributeName)) return text;
    return "";
  }

  function buildDeduplicationKey({ id, speaker, text, isoDate, hasExactTimestamp, markers }) {
    return id || buildFallbackDeduplicationKey({ speaker, text, isoDate, hasExactTimestamp, markers });
  }

  function buildFallbackDeduplicationKey({ speaker, text, isoDate, hasExactTimestamp, markers }) {
    const normalizedText = normalizeMessageText(text);
    const markerText = markers.join("|");
    const datePart = hasExactTimestamp && isoDate ? `exact:${isoDate}` : `fallback:${calendarDay(isoDate) || isoDate || "unknown-date"}`;
    return ["fallback", speaker || "UNKNOWN", datePart, normalizedText || "[no text]", markerText].join("|");
  }

  function normalizeMessageText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function getAuthor(node) {
    const labelled = node.getAttribute("aria-label") || node.querySelector("[aria-label*=\"Message from\"]")?.getAttribute("aria-label") || "";
    const fromMatch = labelled.match(/Message from ([^,]+)/i);
    return (fromMatch?.[1] || node.querySelector('h3 [class*="username"], h3 span, [class*="header"] [class*="username"]')?.textContent || "").trim();
  }

  function speakerFor(authorText) {
    const author = authorText.toLowerCase();
    if (settings.selfDisplayName && author.includes(settings.selfDisplayName.toLowerCase())) return settings.selfLabel;
    if (settings.otherDisplayName && author.includes(settings.otherDisplayName.toLowerCase())) return settings.otherLabel;
    const currentUser = document.querySelector('[class*="nameTag"] [class*="username"], [aria-label="User area"] [class*="username"]')?.textContent?.trim().toLowerCase();
    if (currentUser && author.includes(currentUser)) return settings.selfLabel;
    return "UNKNOWN";
  }

  function getMessageTextFromContentNode(contentNode) {
    if (!contentNode || isReplyPreviewElement(contentNode)) return "";
    const clone = contentNode.cloneNode(true);
    removeMessageTextIgnoredMetadata(clone);
    return cleanMessageText(clone.innerText || clone.textContent || "");
  }

  function getMessageText(node) {
    return getOwnedContentNodes(node)
      .map(getMessageTextFromContentNode)
      .filter(Boolean)
      .join("\n") || getMessageTextFromLegacyContent(node);
  }

  function getMessageTextFromLegacyContent(node) {
    const ignoredSelectors = [
      '[class*="reaction"]',
      '[aria-label*="reaction" i]',
      '[aria-label*="React" i]',
      '[class*="button"]',
      '[role="button"]',
      '[class*="buttons"]',
      '[class*="operations"]',
      '[class*="edited"]',
      '[aria-label*="edited" i]',
      '[title*="edited" i]',
      '[class*="timestamp"]',
      'time'
    ].join(", ");
    return [...node.querySelectorAll('[class*="messageContent"]')]
      .filter((el) => !isReplyPreviewElement(el))
      .map((el) => {
        const clone = el.cloneNode(true);
        clone.querySelectorAll(ignoredSelectors).forEach((ignored) => ignored.remove());
        removeHiddenMetadata(clone);
        return cleanMessageText(clone.innerText || clone.textContent || "");
      })
      .filter(Boolean)
      .join("\n");
  }

  function removeMessageTextIgnoredMetadata(root) {
    const ignoredSelectors = [
      '[class*="reaction"]',
      '[aria-label*="reaction" i]',
      '[aria-label*="React" i]',
      '[class*="button"]',
      '[role="button"]',
      '[class*="buttons"]',
      '[class*="operations"]',
      '[class*="edited"]',
      '[aria-label*="edited" i]',
      '[title*="edited" i]',
      '[class*="timestamp"]',
      'time'
    ].join(", ");
    root.querySelectorAll(ignoredSelectors).forEach((ignored) => ignored.remove());
    removeHiddenMetadata(root);
  }

  function isReplyPreviewElement(el) {
    return Boolean(el.closest([
      '[class*="repliedMessage"]',
      '[class*="referencedMessage"]',
      '[class*="threadMessageAccessory"]',
      '[class*="messageReference"]'
    ].join(", ")));
  }

  function removeHiddenMetadata(root) {
    [...root.querySelectorAll("[aria-label], [title], [style], [hidden], [aria-hidden='true']")]
      .filter((el) => {
        const ariaLabel = el.getAttribute("aria-label") || "";
        const title = el.getAttribute("title") || "";
        const style = el.getAttribute("style") || "";
        return el.hidden
          || el.getAttribute("aria-hidden") === "true"
          || /edited/i.test(ariaLabel)
          || /edited/i.test(title)
          || /display:\s*none|visibility:\s*hidden|position:\s*absolute/i.test(style);
      })
      .forEach((el) => el.remove());
  }

  function cleanMessageText(value) {
    return String(value || "")
      .replace(/\s*\(edited\)(?:\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}(?:\s+at)?\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)?\s*$/i, "")
      .replace(/\s*\(edited\)\s*$/i, "")
      .trim();
  }

  function getMarkers(node, speaker) {
    const markers = [];
    const files = getOwnedMediaNodes(node);
    const voice = getOwnedVoiceNodes(node);
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
    if (!isoDate || !settings.startDate || !settings.endDate) return false;
    const messageTimeMs = Date.parse(isoDate);
    if (Number.isNaN(messageTimeMs)) return false;
    const startBoundaryMs = localDateBoundaryMs(settings.startDate);
    const endBoundaryMs = localDateBoundaryMs(settings.endDate, 1);
    if (Number.isNaN(startBoundaryMs) || Number.isNaN(endBoundaryMs)) return false;
    return messageTimeMs >= startBoundaryMs && messageTimeMs < endBoundaryMs;
  }

  function localDateBoundaryMs(dateString, dayOffset = 0) {
    const match = String(dateString || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return NaN;
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day) + dayOffset).getTime();
  }

  function compareMessages(a, b) {
    const snowflakeOrder = compareSnowflakeIds(a.id, b.id);
    if (snowflakeOrder) return snowflakeOrder;
    const order = (a.captureIndex ?? a.domIndex ?? 0) - (b.captureIndex ?? b.domIndex ?? 0);
    const aDay = calendarDay(a.isoDate);
    const bDay = calendarDay(b.isoDate);

    if (aDay && bDay && aDay !== bDay) return aDay.localeCompare(bDay);
    if (a.hasExactTimestamp && b.hasExactTimestamp && a.isoDate && b.isoDate && a.isoDate !== b.isoDate) {
      return a.isoDate.localeCompare(b.isoDate);
    }
    return order;
  }

  function compareSnowflakeIds(aId, bId) {
    const aSnowflake = extractSnowflakeFromRecordId(aId);
    const bSnowflake = extractSnowflakeFromRecordId(bId);
    if (!aSnowflake || !bSnowflake || aSnowflake === bSnowflake) return 0;
    return aSnowflake.length === bSnowflake.length ? aSnowflake.localeCompare(bSnowflake) : aSnowflake.length - bSnowflake.length;
  }

  function extractSnowflakeFromRecordId(id) {
    const match = String(id || "").match(/^discord:(\d{15,25})$/);
    return match?.[1] || "";
  }

  function isoDateFromSnowflake(snowflake) {
    if (!/^\d{15,25}$/.test(String(snowflake || ""))) return "";
    try {
      const timestampMs = Number((BigInt(snowflake) >> 22n) + 1420070400000n);
      const date = new Date(timestampMs);
      return Number.isNaN(date.getTime()) ? "" : date.toISOString();
    } catch {
      return "";
    }
  }

  function calendarDay(isoDate) {
    return isoDate ? isoDate.slice(0, 10) : "";
  }

  function messageKey(message, suspiciousStableIds = new Set()) {
    const suspiciousIds = suspiciousStableIds instanceof Set ? suspiciousStableIds : new Set();
    if (message.id && suspiciousIds.has(message.id)) {
      return message.fallbackDeduplicationKey || buildFallbackDeduplicationKey({
        speaker: message.speaker,
        text: message.text,
        isoDate: message.isoDate,
        hasExactTimestamp: message.hasExactTimestamp,
        markers: []
      });
    }
    return message.deduplicationKey || message.id || buildDeduplicationKey({
      id: "",
      speaker: message.speaker,
      text: message.text,
      isoDate: message.isoDate,
      hasExactTimestamp: message.hasExactTimestamp,
      markers: []
    });
  }

  async function exportTranscript() {
    await captureLoadedMessages({ allowStopped: true, reason: "pre-export" });
    const timestampFormats = readTimestampFormats();
    const transcript = formatTranscript(messages, settings.includeTimestamps, timestampFormats);
    exportFilename = defaultFilename();
    chrome.runtime.sendMessage({ type: "DOWNLOAD_TRANSCRIPT", text: transcript, filename: exportFilename }, async (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError || response?.ok === false) {
        showOverlayMessage(`Export failed: ${response?.error || lastError?.message || "Unknown download error."}`);
        return;
      }
      messages = [];
      seenKeys.clear();
      seenObservedKeys.clear();
      skippedUnknownKeys.clear();
      overlayVisible = false;
      recordingState = "idle";
      captureCounter = 0;
      stopMessageObserver();
      await chrome.storage.local.set({ messages: [], captureCounter: 0, recordingState: "idle" });
      renderOverlay();
    });
  }

  function defaultFilename() {
    return `discord-dm-log-${new Date().toISOString().slice(0, 10)}.txt`;
  }


  function showOverlayMessage(text) {
    const overlay = document.getElementById(overlayId);
    const body = overlay?.querySelector("[data-body]");
    if (!body) return;
    const note = document.createElement("p");
    note.className = "warn";
    note.textContent = text;
    body.appendChild(note);
  }

  function readTimestampFormats() {
    const overlay = document.getElementById(overlayId);
    return {
      dateFormat: overlay?.querySelector("[data-timestamp-date-format]")?.value || "MM/DD/YYYY",
      timeFormat: overlay?.querySelector("[data-timestamp-time-format]")?.value || "12"
    };
  }

  function formatTranscript(items, includeTimestamps, timestampFormats = {}) {
    const blocks = [];
    let current;
    for (const item of items) {
      const stamp = includeTimestamps && item.isoDate ? `[${formatExportTimestamp(item.isoDate, timestampFormats)}]\n` : "";
      if (!current || current.speaker !== item.speaker || stamp) {
        current = { speaker: item.speaker, lines: [], stamp };
        blocks.push(current);
      }
      current.lines.push(item.text);
    }
    return blocks.map((block) => `${block.stamp}${block.speaker}:\n${block.lines.join("\n\n")}`).join("\n\n");
  }

  function formatExportTimestamp(isoDate, { dateFormat = "MM/DD/YYYY", timeFormat = "12" } = {}) {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return isoDate.slice(0, 16).replace("T", " ");

    const year = String(date.getFullYear());
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());
    const formattedDate = {
      "DD/MM/YYYY": `${day}/${month}/${year}`,
      "YYYY/MM/DD": `${year}/${month}/${day}`
    }[dateFormat] || `${month}/${day}/${year}`;

    const hours = date.getHours();
    const minutes = pad2(date.getMinutes());
    if (timeFormat === "24") return `${formattedDate} ${pad2(hours)}:${minutes}`;

    const period = hours >= 12 ? "PM" : "AM";
    const hour12 = hours % 12 || 12;
    return `${formattedDate} ${hour12}:${minutes} ${period}`;
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
  }
})();
