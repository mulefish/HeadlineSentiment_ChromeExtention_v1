# Headline Highlighter

A Chrome extension that finds the headlines on a page, scores their sentiment
from **-1** (very negative) to **+1** (very positive), or **X** when unsure,
and highlights the ones matching what you type. It runs on your computer with
Chrome's built-in **Gemini Nano**, and can translate Chinese headlines first.

![Example](example.png)

Needs desktop Chrome 138+ and plenty of RAM

## TODO
Train a micro-model on industry norms and use that. Stretch goal: Train on economy DOW / interest / Brent

## Install

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Pin the extension from the puzzle-piece menu in the toolbar.

Never added an extension before? See the step-by-step guide in
[EXTENTION_AND_ABOUT.md](EXTENTION_AND_ABOUT.md#installing-the-extension).

## Use

Open a news page, click the extension icon, optionally type which headlines
you want, and click **Highlight Headlines**. **Revert** removes the highlights. Or highlight something for the same effect.

## Nothing is happening?

The Gemini Nano model probably hasn't downloaded yet. See
[how to force the download](EXTENTION_AND_ABOUT.md#nothing-is-happening).

## More

Translation, your own highlights, how it works, RAM use and example sites are
in [EXTENTION_AND_ABOUT.md](EXTENTION_AND_ABOUT.md).
