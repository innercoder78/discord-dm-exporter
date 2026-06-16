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
const everythingText = "Scroll up to the very first day you two started chatting.\n\nOnce the earliest messages are loaded, click ‘Start Recording.’";
const dateRangeText = "Scroll up to the day you set as the start date.\n\nIdeally, scroll a few messages prior to that date, since sometimes Discord may not expose the exact first message clearly if you start on the exact day.\n\nOnce you are in position, click ‘Start Recording.’";

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
const saveButton = document.querySelector("#save-settings");

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
document.querySelector("#go-discord").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_DISCORD_WEB" }));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = readSettings();
  if (!settings.everythingMode && (!settings.startDate || !settings.endDate)) {
    statusEl.textContent = missingDatesText.replace(/\n+/g, " ");
    updateValidation();
    return;
  }
  await chrome.storage.local.set({ settings });
  statusEl.textContent = "Settings saved locally.";
});

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
  saveButton.disabled = datesMissing;
}

async function showTabWarningIfNeeded() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isDiscordWeb = tab?.url?.startsWith("https://discord.com/");
  warningEl.classList.toggle("hidden", Boolean(isDiscordWeb));
}
