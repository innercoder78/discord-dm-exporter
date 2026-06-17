# Discord DM Log Exporter

Discord DM Log Exporter is a Chrome extension for saving one-on-one Discord Web DMs as a clean `.txt` log file.

It works locally in your browser while you manually scroll through a DM. It does not use Discord’s API, tokens, bots, or outside servers.

## What It Does

* Records one-on-one Discord Web DMs while you scroll
* Saves messages into a readable TXT log
* Lets you choose the names shown in the exported log
* Supports Date Range mode for cleaner start and end points
* Supports EVERYTHING mode for recording all loaded messages
* Avoids duplicate entries when scrolling back and forth
* Ignores emoji reactions
* Adds simple markers for files, images, and voice messages
* Uses Chrome’s Save As window when exporting

## Important Notes

This extension only works on Discord Web in Chrome.

It does not work with:

* Discord desktop app
* Discord mobile app
* Server channels
* Group chats
* Threads
* Forums
* Voice channels

The extension does not auto-scroll. You choose where to start, click Start Recording, and scroll manually through the DM.

Discord only loads part of a conversation at a time, so the extension can only capture messages that are loaded while recording.

## Recording Modes

### Date Range

Use Date Range mode when you want cleaner start and end boundaries.

Messages outside the selected date range are not exported.

### EVERYTHING

Use EVERYTHING mode when you want to record every loaded message the extension sees while recording.

This mode may include a few extra nearby messages, so you may need to trim the TXT file afterward.

## Basic Workflow

1. Open Discord Web in Chrome.
2. Open the DM you want to log.
3. Scroll to where you want recording to begin.
4. Open the extension.
5. Enter the names/display names.
6. Choose Date Range or EVERYTHING mode.
7. Click START.
8. Click Start Recording on the Discord page.
9. Scroll manually through the DM.
10. Click END RECORDING.
11. Click Export TXT.
12. Choose where to save the file.

## Privacy

Everything stays local in your browser.

The extension does not upload your messages or send them anywhere.

## DISCLAIMER

Discord frowns upon such tools. Therefore, if you get your account banned because of it, you assume all risk and liability by using this extension.
