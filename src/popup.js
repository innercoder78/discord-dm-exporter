const SHOW_DEVELOPER_MODE_UI = false;

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

const missingDatesText = "Date Range mode requires both a start date and an end date.\n\nChoose both dates, or check EVERYTHING.";
const reversedDatesText = "Start date must be on or before end date.";
const displayNameWarningText = "For best results, enter both Discord display names without server tags. If these are blank, speaker detection may be less accurate.";
const everythingText = "Open the DM you want to log, scroll to where you want recording to begin, then click START.";
const dateRangeText = "Open the DM you want to log, scroll to where you want recording to begin, then click START.";
const openDiscordManuallyText = "Open the DM you want to log, scroll to where you want recording to begin, then click START again.";

const form = document.querySelector("#settings-form");
const fields = {
  selfLabel: document.querySelector("#self-label"),
  otherLabel: document.querySelector("#other-label"),
  selfDisplayName: document.querySelector("#self-display-name"),
  otherDisplayName: document.querySelector("#other-display-name"),
  startDate: document.querySelector("#start-date"),
  endDate: document.querySelector("#end-date"),
  everythingMode: document.querySelector("#everything-mode"),
  includeTimestamps: document.querySelector("#include-timestamps"),
  developerMode: document.querySelector("#developer-mode")
};
const statusEl = document.querySelector("#status");
const instructionsEl = document.querySelector("#mode-instructions");
const warningEl = document.querySelector("#tab-warning");
const dateWarningEl = document.querySelector("#date-warning");
const displayNameWarningEl = document.querySelector("#display-name-warning");
const startButton = document.querySelector("#start");

init().catch((error) => showPopupError("Could not initialize popup", error));

async function init() {
  const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get("settings");
  const normalizedSettings = normalizeSettings(settings);
  if (!SHOW_DEVELOPER_MODE_UI && settings?.developerMode) {
    await chrome.storage.local.set({ settings: normalizedSettings });
  }
  populate(normalizedSettings);
  updateValidation();
  await showTabWarningIfNeeded();
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
    developerMode: SHOW_DEVELOPER_MODE_UI ? Boolean(value?.developerMode) : false
  };
}

function populate(settings) {
  configureDeveloperModeUi();
  for (const [key, input] of Object.entries(fields)) {
    if (!input) continue;
    if (input.type === "checkbox") input.checked = Boolean(settings[key]);
    else input.value = settings[key] || "";
  }
}

function configureDeveloperModeUi() {
  const developerModeControl = fields.developerMode?.closest("label");
  const developerModeNote = document.querySelector("#developer-mode-note");
  if (developerModeControl) developerModeControl.hidden = !SHOW_DEVELOPER_MODE_UI;
  if (developerModeNote) developerModeNote.hidden = !SHOW_DEVELOPER_MODE_UI;
  if (!SHOW_DEVELOPER_MODE_UI && fields.developerMode) fields.developerMode.checked = false;
}

function readSettings() {
  return {
    selfLabel: fields.selfLabel.value.trim() || DEFAULT_SETTINGS.selfLabel,
    otherLabel: fields.otherLabel.value.trim() || DEFAULT_SETTINGS.otherLabel,
    selfDisplayName: fields.selfDisplayName.value.trim(),
    otherDisplayName: fields.otherDisplayName.value.trim(),
    startDate: fields.startDate.value,
    endDate: fields.endDate.value,
    everythingMode: fields.everythingMode.checked,
    includeTimestamps: fields.includeTimestamps.checked,
    ignoreReactions: true,
    allowUnknownDateRange: false,
    developerMode: SHOW_DEVELOPER_MODE_UI && Boolean(fields.developerMode?.checked)
  };
}

fields.everythingMode.addEventListener("change", updateValidation);
fields.startDate.addEventListener("input", updateValidation);
fields.endDate.addEventListener("input", updateValidation);
fields.selfDisplayName.addEventListener("input", updateValidation);
fields.otherDisplayName.addEventListener("input", updateValidation);
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  startButton.disabled = true;
  statusEl.textContent = "Opening recording overlay…";
  try {
    const settings = readSettings();
    if (!settings.everythingMode && (!settings.startDate || !settings.endDate)) {
      statusEl.textContent = missingDatesText.replace(/\n+/g, " ");
      updateValidation();
      return;
    }
    if (isReversedDateRange(settings)) {
      statusEl.textContent = reversedDatesText;
      updateValidation();
      return;
    }
    await chrome.storage.local.set({ settings });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !isSupportedDiscordDmUrl(tab.url)) {
      statusEl.textContent = unsupportedActiveTabText(tab?.url);
      await showTabWarningIfNeeded();
      return;
    }

    const response = await showOverlayOnTab(tab.id);
    if (response?.ok) {
      statusEl.textContent = "Recording overlay opened on Discord.";
      window.close();
      return;
    }
    statusEl.textContent = response?.error || "Could not open the recording overlay on Discord.";
  } catch (error) {
    showPopupError("Could not open the recording overlay", error);
  } finally {
    updateValidation();
  }
});

async function showOverlayOnTab(tabId) {
  const firstResponse = await sendStartMessage(tabId);
  if (firstResponse.ok) return firstResponse.response;
  if (!isConnectionMissingError(firstResponse.error)) {
    throw new Error(firstResponse.error || "The Discord page script did not respond.");
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/content.js"]
  });
  checkLastError("injecting the Discord page script");

  const secondResponse = await sendStartMessage(tabId);
  if (secondResponse.ok) return secondResponse.response;
  throw new Error(secondResponse.error || firstResponse.error || "The Discord page script did not respond after retrying.");
}

function sendStartMessage(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "SHOW_RECORDING_OVERLAY", developerMode: readSettings().developerMode }, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        resolve({ ok: false, error: lastError.message });
        return;
      }
      if (!response) {
        resolve({ ok: false, error: "The Discord page script returned no response." });
        return;
      }
      if (response.ok === false) {
        resolve({ ok: false, error: response.error || "The Discord page script reported an unknown error." });
        return;
      }
      resolve({ ok: true, response });
    });
  });
}

function checkLastError(action) {
  const lastError = chrome.runtime.lastError;
  if (lastError) throw new Error(`Error while ${action}: ${lastError.message}`);
}

function showPopupError(prefix, error) {
  statusEl.textContent = `${prefix}: ${error?.message || String(error)}`;
}

function updateValidation() {
  const everything = fields.everythingMode.checked;
  const datesMissing = !everything && (!fields.startDate.value || !fields.endDate.value);
  const datesReversed = !everything && isReversedDateRange({ startDate: fields.startDate.value, endDate: fields.endDate.value, everythingMode: everything });
  const displayNamesMissing = !fields.selfDisplayName.value.trim() || !fields.otherDisplayName.value.trim();

  fields.startDate.disabled = everything;
  fields.endDate.disabled = everything;
  fields.startDate.required = !everything;
  fields.endDate.required = !everything;
  instructionsEl.textContent = everything ? everythingText : dateRangeText;
  dateWarningEl.classList.toggle("hidden", !datesMissing && !datesReversed);
  dateWarningEl.textContent = datesReversed ? reversedDatesText : missingDatesText;
  displayNameWarningEl.classList.toggle("hidden", !displayNamesMissing);
  displayNameWarningEl.textContent = displayNameWarningText;
  startButton.disabled = datesMissing || datesReversed;
}

async function showTabWarningIfNeeded() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  warningEl.classList.toggle("hidden", isSupportedDiscordDmUrl(tab?.url));
}

function isSupportedDiscordDmUrl(url) {
  try {
    const parsed = new URL(url || "");
    return parsed.origin === "https://discord.com" && /^\/channels\/@me\/[^/]+\/?$/.test(parsed.pathname);
  } catch (error) {
    return false;
  }
}

function unsupportedActiveTabText(url) {
  if (!String(url || "").startsWith("https://discord.com/")) return openDiscordManuallyText;
  return "Open a one-on-one Discord DM before starting. Server channels, group chats, threads, forums, and voice channels are not supported.";
}

function isConnectionMissingError(message) {
  return /receiving end does not exist|could not establish connection/i.test(String(message || ""));
}


function isReversedDateRange(settings) {
  if (settings.everythingMode || !settings.startDate || !settings.endDate) return false;
  const start = localDateBoundaryMs(settings.startDate);
  const end = localDateBoundaryMs(settings.endDate);
  return !Number.isNaN(start) && !Number.isNaN(end) && start > end;
}

function localDateBoundaryMs(dateString) {
  const match = String(dateString || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return NaN;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
}
