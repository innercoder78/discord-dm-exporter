const DEFAULT_SETTINGS = {
  selfLabel: "ME",
  otherLabel: "FRIEND",
  selfDisplayName: "",
  otherDisplayName: "",
  startDate: "",
  endDate: "",
  everythingMode: false,
  includeTimestamps: false,
  ignoreReactions: true
};

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

init();

async function init() {
  const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get("settings");
  populate({ ...DEFAULT_SETTINGS, ...settings });
  updateModeControls();
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
    ignoreReactions: true
  };
}

fields.everythingMode.addEventListener("change", updateModeControls);
document.querySelector("#go-discord").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_DISCORD_WEB" }));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = readSettings();
  await chrome.storage.local.set({ settings });
  statusEl.textContent = "Settings saved locally.";
});

function updateModeControls() {
  const everything = fields.everythingMode.checked;
  fields.startDate.disabled = everything;
  fields.endDate.disabled = everything;
  instructionsEl.textContent = everything ? everythingText : dateRangeText;
}

async function showTabWarningIfNeeded() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isDiscordWeb = tab?.url?.startsWith("https://discord.com/");
  warningEl.classList.toggle("hidden", Boolean(isDiscordWeb));
}
