// Injected into the page by popup.js. Finds headlines, highlights and reverts them.
// Guarded so injecting it more than once doesn't register duplicate listeners.
if (!window.__headlineHighlighter) {
  window.__headlineHighlighter = true;

  const ID_ATTR = "data-hh-id";
  const TEXT_ID_ATTR = "data-hh-text-id";
  const HIGHLIGHT_CLASS = "hh-highlight";
  const TEXT_HIGHLIGHT_CLASS = "hh-text-highlight";
  const STYLE_ID = "hh-style";
  const MANUAL_CLASS = "hh-manual-highlight";

  // Number of selections the user has highlighted, for the Revert message.
  let manualCount = 0;

  const HEADLINE_SELECTORS = [
    "h1",
    "h2",
    "h3",
    "h4",
    "[itemprop='headline']",
    "[class*='headline' i]",
    "[data-testid*='headline' i]",
  ].join(",");

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function cleanText(el) {
    return el.innerText.replace(/\s+/g, " ").trim();
  }

  // Chinese and Japanese don't put spaces between words, so each of their
  // characters is counted as a word, and as 3 letters when measuring length.
  const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;

  function wordCount(text) {
    const cjk = (text.match(CJK) || []).length;
    return text.replace(CJK, " ").split(/\s+/).filter(Boolean).length + cjk;
  }

  function textLength(text) {
    return text.length + 2 * (text.match(CJK) || []).length;
  }

  function isHeadlineLike(el) {
    return el.matches(HEADLINE_SELECTORS) || !!el.querySelector(HEADLINE_SELECTORS);
  }

  // Text inside a link doesn't count as associated text (menus are mostly links),
  // unless the headline is inside the same link (e.g. a whole card that is one link).
  function nonLinkText(el, headline) {
    const parts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const link = node.parentElement.closest("a");
      if (link && !link.contains(headline)) continue;
      parts.push(node.textContent);
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  const IGNORED_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "IMG", "PICTURE",
    "FIGURE", "VIDEO", "BUTTON", "FORM", "INPUT", "SELECT", "TIME",
  ]);

  // Finds the body text that belongs to a headline: the elements after it (up to
  // the next headline), walking up a few levels while we're still inside the
  // headline's own card or section. Returns [] if there's no real text.
  function findAssociatedText(headline) {
    let node = headline;

    for (let depth = 0; depth < 4; depth++) {
      const found = [];
      for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
        if (isHeadlineLike(sib)) break;
        if (IGNORED_TAGS.has(sib.tagName.toUpperCase())) continue;
        if (!isVisible(sib) || !cleanText(sib)) continue;
        found.push(sib);
      }

      const text = found.map((el) => nonLinkText(el, headline)).join(" ");
      if (wordCount(text) >= 5) return found;

      const parent = node.parentElement;
      if (!parent || parent === document.body) break;
      // If the parent holds other headlines, it's a list of stories, so
      // whatever follows it doesn't belong to this headline.
      const others = [...parent.querySelectorAll(HEADLINE_SELECTORS)].filter(
        (el) => !headline.contains(el) && !el.contains(headline)
      );
      if (others.length) break;
      node = parent;
    }

    return [];
  }

  function findHeadlines() {
    const seenText = new Set();
    const headlines = [];

    for (const el of document.querySelectorAll(HEADLINE_SELECTORS)) {
      // Skip elements inside a headline we already picked (e.g. <span> in an <h2>).
      if (el.parentElement?.closest(`[${ID_ATTR}]`)) continue;
      // Skip wrappers that contain other headline elements.
      if (el.querySelector("h1, h2, h3, h4")) continue;
      if (el.closest("nav, footer, aside, [role='navigation']")) continue;
      if (!isVisible(el)) continue;

      const text = cleanText(el);
      // Real headlines are usually a few words long; skip labels like "Sport".
      const length = textLength(text);
      if (length < 15 || length > 300) continue;
      if (wordCount(text) < 3) continue;
      if (seenText.has(text)) continue;
      // Skip anything already claimed as another headline's text.
      if (el.closest(`[${TEXT_ID_ATTR}]`)) continue;

      // A real headline has some text with it; navigation widgets and
      // page headers don't.
      const associated = findAssociatedText(el);
      if (!associated.length) continue;
      seenText.add(text);

      const id = String(headlines.length);
      el.setAttribute(ID_ATTR, id);
      associated.forEach((a) => a.setAttribute(TEXT_ID_ATTR, id));
      // A short snippet of the story helps the model judge sentiment.
      const context = associated
        .map(cleanText)
        .join(" ")
        .substring(0, 250);
      headlines.push({ id, text, context });

      if (headlines.length >= 150) break;
    }

    return headlines;
  }

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        background-color: #fff176 !important;
        color: #000 !important;
        outline: 3px solid #fbc02d !important;
        border-radius: 3px;
      }
      .${TEXT_HIGHLIGHT_CLASS} {
        background-color: #b3e5fc !important;
        color: #000 !important;
        outline: 2px solid #4fc3f7 !important;
        border-radius: 3px;
      }
      .${MANUAL_CLASS} {
        background-color: #ffcc80 !important;
        color: #000 !important;
        border-radius: 2px;
      }
    `;
    document.head.appendChild(style);
  }

  function scrollToHeadline(id) {
    document.querySelector(`[${ID_ATTR}="${id}"]`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  function highlight(ids, scroll) {
    addStyle();
    let count = 0;
    for (const id of ids) {
      const el = document.querySelector(`[${ID_ATTR}="${id}"]`);
      if (el) {
        el.classList.add(HIGHLIGHT_CLASS);
        count++;
      }
      document
        .querySelectorAll(`[${TEXT_ID_ATTR}="${id}"]`)
        .forEach((t) => t.classList.add(TEXT_HIGHLIGHT_CLASS));
    }
    if (scroll && ids.length) scrollToHeadline(ids[0]);
    return count;
  }

  // Highlights the text the user has selected on the page. A selection can
  // cross element boundaries, so each selected text node is wrapped in its
  // own span. Returns the selected text, or null if nothing is selected.
  function highlightSelection() {
    const selection = getSelection();
    const text = selection.toString().replace(/\s+/g, " ").trim();
    if (!selection.rangeCount || !text) return null;
    addStyle();

    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      const { startContainer, startOffset, endContainer, endOffset } = range;
      const root = range.commonAncestorContainer;

      const nodes = [];
      if (root.nodeType === Node.TEXT_NODE) {
        nodes.push(root);
      } else {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (range.intersectsNode(walker.currentNode)) nodes.push(walker.currentNode);
        }
      }

      for (let node of nodes) {
        if (node.parentElement.closest(`script, style, noscript, .${MANUAL_CLASS}`)) {
          continue;
        }
        // Split off the unselected parts at either end. The end is split
        // first so the start offset is still correct.
        if (node === endContainer) node.splitText(endOffset);
        if (node === startContainer) node = node.splitText(startOffset);
        if (!node.textContent.trim()) continue;

        const span = document.createElement("span");
        span.className = MANUAL_CLASS;
        node.replaceWith(span);
        span.appendChild(node);
      }
    }

    selection.removeAllRanges();
    manualCount++;
    return { text };
  }

  function revertManual() {
    document.querySelectorAll(`.${MANUAL_CLASS}`).forEach((span) => {
      const parent = span.parentNode;
      span.replaceWith(...span.childNodes);
      parent.normalize(); // rejoin the text nodes split up when highlighting
    });
    const count = manualCount;
    manualCount = 0;
    return count;
  }

  function revertHeadlines() {
    const highlighted = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
    highlighted.forEach((el) => el.classList.remove(HIGHLIGHT_CLASS));
    document
      .querySelectorAll(`.${TEXT_HIGHLIGHT_CLASS}`)
      .forEach((el) => el.classList.remove(TEXT_HIGHLIGHT_CLASS));
    document.querySelectorAll(`[${ID_ATTR}], [${TEXT_ID_ATTR}]`).forEach((el) => {
      el.removeAttribute(ID_ATTR);
      el.removeAttribute(TEXT_ID_ATTR);
    });
    return highlighted.length;
  }

  function revert() {
    const count = revertHeadlines() + revertManual();
    document.getElementById(STYLE_ID)?.remove();
    return count;
  }

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.type === "FIND_HEADLINES") {
      // Start fresh so ids match this run, but keep the user's own highlights.
      revertHeadlines();
      sendResponse({ headlines: findHeadlines() });
    } else if (req.type === "HIGHLIGHT") {
      sendResponse({ count: highlight(req.ids, req.scroll) });
    } else if (req.type === "HIGHLIGHT_SELECTION") {
      sendResponse({ selection: highlightSelection() });
    } else if (req.type === "SCROLL_TO") {
      scrollToHeadline(req.id);
      sendResponse({});
    } else if (req.type === "REVERT") {
      sendResponse({ count: revert() });
    }
  });
}
