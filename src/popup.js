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

const missingDatesText = "Date Range mode requires both a start date and an end date.\n\nChoose both dates, or check EVERYTHING.";
const displayNameWarningText = "For best results, enter both Discord display names. If these are blank, speaker detection may be less accurate.";
const everythingText = "Open Discord Web manually, open the correct one-on-one DM, scroll to where you want recording to begin, then click START.";
const dateRangeText = "Open Discord Web manually, open the correct one-on-one DM, scroll to where you want recording to begin, then click START.";
const openDiscordManuallyText = "Open Discord Web manually, open the correct one-on-one DM, scroll to where you want recording to begin, then click START.";
const startFailedText = "Could not start the extension on this Discord tab. Make sure the page is fully loaded, then try START again.";

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
  ignoreReactions: document.querySelector("#ignore-reactions")
};
const statusEl = document.querySelector("#status");
const instructionsEl = document.querySelector("#mode-instructions");
const warningEl = document.querySelector("#tab-warning");
const dateWarningEl = document.querySelector("#date-warning");
const displayNameWarningEl = document.querySelector("#display-name-warning");
const startButton = document.querySelector("#start");

init();

async function init() {
  const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get("settings");
  populate({ ...DEFAULT_SETTINGS, ...settings, ignoreReactions: true });
  updateValidation();
  await showTabWarningIfNeeded();
}

function populate(settings) {
  for (const [key, input] of Object.entries(fields)) {
    if (input.type === "checkbox") input.checked = Boolean(settings[key]);
    else input.value = settings[key] || "";
  }
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
    allowUnknownDateRange: false
  };
}

fields.everythingMode.addEventListener("change", updateValidation);
fields.startDate.addEventListener("input", updateValidation);
fields.endDate.addEventListener("input", updateValidation);
fields.selfDisplayName.addEventListener("input", updateValidation);
fields.otherDisplayName.addEventListener("input", updateValidation);
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = readSettings();
  if (!settings.everythingMode && (!settings.startDate || !settings.endDate)) {
    statusEl.textContent = missingDatesText.replace(/\n+/g, " ");
    updateValidation();
    return;
  }
  await chrome.storage.local.set({ settings });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isDiscordWeb = tab?.url?.startsWith("https://discord.com/");
  if (!isDiscordWeb || !tab.id) {
    statusEl.textContent = openDiscordManuallyText;
    await showTabWarningIfNeeded();
    return;
  }

  try {
    const response = await showOverlayOnTab(tab.id);
    if (response?.ok) {
      statusEl.textContent = "Confirm recording from the Discord page overlay.";
      window.close();
    } else {
      statusEl.textContent = startFailedText;
    }
  } catch (error) {
    statusEl.textContent = startFailedText;
  }
});

async function showOverlayOnTab(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "SHOW_RECORDING_OVERLAY" });
  } catch (error) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/content.js"]
    });
    return chrome.tabs.sendMessage(tabId, { type: "SHOW_RECORDING_OVERLAY" });
  }
}

function updateValidation() {
  const everything = fields.everythingMode.checked;
  const datesMissing = !everything && (!fields.startDate.value || !fields.endDate.value);
  const displayNamesMissing = !fields.selfDisplayName.value.trim() || !fields.otherDisplayName.value.trim();

  fields.startDate.disabled = everything;
  fields.endDate.disabled = everything;
  fields.startDate.required = !everything;
  fields.endDate.required = !everything;
  fields.ignoreReactions.checked = true;
  instructionsEl.textContent = everything ? everythingText : dateRangeText;
  dateWarningEl.classList.toggle("hidden", !datesMissing);
  displayNameWarningEl.classList.toggle("hidden", !displayNamesMissing);
  displayNameWarningEl.textContent = displayNameWarningText;
  startButton.disabled = datesMissing;
}

async function showTabWarningIfNeeded() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isDiscordWeb = tab?.url?.startsWith("https://discord.com/");
  warningEl.classList.toggle("hidden", Boolean(isDiscordWeb));
}
