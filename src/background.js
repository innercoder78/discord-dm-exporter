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

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(["settings", "messages", "recordingState", "captureCounter"]);
  if (!stored.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
  if (!stored.messages) {
    await chrome.storage.local.set({ messages: [] });
  }
  if (!stored.recordingState) {
    await chrome.storage.local.set({ recordingState: "idle" });
  }
  if (!stored.captureCounter) {
    await chrome.storage.local.set({ captureCounter: 0 });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "DOWNLOAD_TRANSCRIPT") {
    downloadTranscript(message.text || "", message.filename || defaultFilename())
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function downloadTranscript(text, filename) {
  const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
  await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: true,
    conflictAction: "uniquify"
  });
}

function defaultFilename() {
  const day = new Date().toISOString().slice(0, 10);
  return `discord-dm-log-${day}.txt`;
}
