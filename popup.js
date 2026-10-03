// Uses Chrome's built-in Prompt API (Gemini Nano, on-device) to score each
// headline's sentiment and pick which ones match the user's description.

const BATCH_SIZE = 10;
const LANGUAGE_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

const criteriaInput = document.getElementById("criteria");
const highlightBtn = document.getElementById("highlight");
const revertBtn = document.getElementById("revert");
const statusDiv = document.getElementById("status");
const resultsList = document.getElementById("results");
const legend = document.getElementById("legend");

// Remember the last description between popup openings.
criteriaInput.value = localStorage.getItem("criteria") || "";
criteriaInput.addEventListener("input", () => {
  localStorage.setItem("criteria", criteriaInput.value);
});

highlightBtn.addEventListener("click", async () => {
  const criteria = criteriaInput.value.trim();
  highlightBtn.disabled = true;
  clearResults();

  try {
    // Create the model session first: downloading the model requires the
    // user activation from this click, which expires after a short time.
    const session = await createSession();

    setStatus("Looking for headlines...");
    const tabId = await injectContentScript();
    const { headlines } = await chrome.tabs.sendMessage(tabId, {
      type: "FIND_HEADLINES",
    });

    if (!headlines.length) {
      setStatus("No headlines found on this page.");
      session.destroy();
      return;
    }

    legend.hidden = false;
    let highlighted = 0;
    let scored = 0;
    let total = 0;

    for (let start = 0; start < headlines.length; start += BATCH_SIZE) {
      const batch = headlines.slice(start, start + BATCH_SIZE);
      setStatus(
        `Asking Gemini Nano about headlines ${start + 1}-${
          start + batch.length
        } of ${headlines.length}...`
      );

      const results = await analyzeBatch(session, batch, criteria);
      results.forEach((r) => {
        addResultRow(tabId, r);
        if (r.score !== null) {
          scored++;
          total += r.score;
        }
      });

      const ids = results.filter((r) => r.matches).map((r) => r.id);
      const { count } = await chrome.tabs.sendMessage(tabId, {
        type: "HIGHLIGHT",
        ids,
        scroll: highlighted === 0,
      });
      highlighted += count;
    }
    session.destroy();

    const average = scored ? ` Average sentiment: ${formatScore(total / scored)}.` : "";
    setStatus(
      (criteria
        ? `Highlighted ${highlighted} of ${headlines.length} headlines matching "${criteria}".`
        : `Highlighted all ${highlighted} headlines found.`) + average
    );
  } catch (error) {
    console.error("Error highlighting headlines:", error);
    setStatus(`Error: ${error.message || "Failed to highlight headlines."}`);
  } finally {
    highlightBtn.disabled = false;
  }
});

revertBtn.addEventListener("click", async () => {
  clearResults();
  try {
    const tabId = await injectContentScript();
    const { count } = await chrome.tabs.sendMessage(tabId, { type: "REVERT" });
    setStatus(count ? `Removed ${count} highlights.` : "Nothing to revert.");
  } catch (error) {
    console.error("Error reverting:", error);
    setStatus(`Error: ${error.message || "Failed to revert."}`);
  }
});

function setStatus(message) {
  statusDiv.innerText = message;
}

function clearResults() {
  resultsList.innerHTML = "";
  legend.hidden = true;
}

function formatScore(score) {
  if (score === null) return "X";
  const rounded = score.toFixed(2);
  return score > 0 ? `+${rounded}` : rounded;
}

// Red for -1, white for 0, green for +1, grey for unknown.
function scoreColor(score) {
  if (score === null) return "#e0e0e0";
  const strength = Math.round(Math.abs(score) * 100);
  const color = score < 0 ? "#ef5350" : "#66bb6a";
  return `color-mix(in srgb, ${color} ${strength}%, #f5f5f5)`;
}

function addResultRow(tabId, result) {
  const li = document.createElement("li");
  if (result.matches) li.classList.add("match");

  const score = document.createElement("span");
  score.className = "score";
  score.innerText = formatScore(result.score);
  score.style.backgroundColor = scoreColor(result.score);

  const text = document.createElement("span");
  text.className = "headline-text";
  text.innerText = result.text;

  li.append(score, text);
  li.addEventListener("click", () => {
    chrome.tabs.sendMessage(tabId, { type: "SCROLL_TO", id: result.id });
  });
  resultsList.appendChild(li);
}

async function injectContentScript() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
  } catch (error) {
    // Chrome blocks extensions on its own pages (chrome://, the Web Store, etc.).
    console.warn("Could not inject content script:", error);
    throw new Error(
      "This page can't be used. Chrome doesn't let extensions run on chrome:// " +
        "pages, the Chrome Web Store or other browser pages. Open a normal web page and try again."
    );
  }
  return tab.id;
}

async function createSession() {
  if (!("LanguageModel" in self)) {
    throw new Error(
      "Chrome's built-in Prompt API is not available. Use Chrome 138 or newer on a supported device."
    );
  }

  setStatus("Checking Gemini Nano availability...");
  const availability = await LanguageModel.availability(LANGUAGE_OPTIONS);
  console.log("LanguageModel availability:", availability);
  if (availability === "unavailable") {
    throw new Error(
      "Gemini Nano is not supported on this device (check disk space and hardware requirements)."
    );
  }

  setStatus(
    availability === "available"
      ? "Loading Gemini Nano..."
      : `Gemini Nano model is ${availability}. Starting download (several GB, one time only).\n` +
          "Keep this popup open; progress is shown at chrome://on-device-internals."
  );

  return LanguageModel.create({
    ...LANGUAGE_OPTIONS,
    initialPrompts: [
      {
        role: "system",
        content:
          "You analyse news headlines. You are given a numbered list of headlines, " +
          "each with a short snippet of its story, and optionally a description.\n" +
          "For every headline return:\n" +
          "- n: the headline's number.\n" +
          "- sentiment: a number from -1 to 1. -1 is very negative (disaster, death, " +
          "crisis), 0 is neutral or factual, 1 is very positive (success, good news, " +
          "celebration). Use values in between for milder tone.\n" +
          "- unknown: true only if you genuinely cannot tell the sentiment, " +
          "otherwise false.\n" +
          "- matches: true if the headline matches the description, otherwise false. " +
          "If there is no description, always true.",
      },
    ],
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => {
        setStatus(
          `Downloading Gemini Nano model: ${Math.round(e.loaded * 100)}%\n` +
            "This only happens once."
        );
      });
    },
  });
}

// Returns [{ id, text, score (number or null for unknown), matches }] for the batch.
async function analyzeBatch(session, batch, criteria) {
  const list = batch
    .map(
      (h, i) =>
        `${i + 1}. Headline: ${h.text}\n   Snippet: ${h.context || "(none)"}`
    )
    .join("\n");
  const schema = {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            n: { type: "integer", minimum: 1, maximum: batch.length },
            sentiment: { type: "number", minimum: -1, maximum: 1 },
            unknown: { type: "boolean" },
            matches: { type: "boolean" },
          },
          required: ["n", "sentiment", "unknown", "matches"],
        },
      },
    },
    required: ["results"],
  };

  // Each batch gets a fresh copy of the session so earlier batches
  // don't fill up Gemini Nano's small context window.
  const batchSession = await session.clone();
  let parsed = [];
  try {
    const response = await batchSession.prompt(
      `Description: ${criteria || "(none)"}\n\nHeadlines:\n${list}`,
      { responseConstraint: schema }
    );
    parsed = JSON.parse(response).results;
    console.log("Batch results:", parsed);
  } catch (error) {
    // One bad batch shouldn't stop the rest; its headlines show as X.
    console.error("Batch failed:", error);
  } finally {
    batchSession.destroy();
  }

  const byNumber = new Map(parsed.map((r) => [r.n, r]));
  return batch.map((h, i) => {
    const r = byNumber.get(i + 1);
    const known = r && !r.unknown && Number.isFinite(r.sentiment);
    return {
      id: h.id,
      text: h.text,
      score: known ? Math.max(-1, Math.min(1, r.sentiment)) : null,
      matches: criteria ? !!r?.matches : true,
    };
  });
}
