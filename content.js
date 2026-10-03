// Injected into the page by popup.js. Finds headlines, highlights and reverts them.
// Guarded so injecting it more than once doesn't register duplicate listeners.
if (!window.__headlineHighlighter) {
  window.__headlineHighlighter = true;

  const ID_ATTR = "data-hh-id";
  const TEXT_ID_ATTR = "data-hh-text-id";
  const HIGHLIGHT_CLASS = "hh-highlight";
  const TEXT_HIGHLIGHT_CLASS = "hh-text-highlight";
  const STYLE_ID = "hh-style";

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

  function wordCount(text) {
    return text.split(/\s+/).filter(Boolean).length;
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
      if (text.length < 15 || text.length > 300) continue;
      if (text.split(" ").length < 3) continue;
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

  function revert() {
    const highlighted = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
    highlighted.forEach((el) => el.classList.remove(HIGHLIGHT_CLASS));
    document
      .querySelectorAll(`.${TEXT_HIGHLIGHT_CLASS}`)
      .forEach((el) => el.classList.remove(TEXT_HIGHLIGHT_CLASS));
    document.querySelectorAll(`[${ID_ATTR}], [${TEXT_ID_ATTR}]`).forEach((el) => {
      el.removeAttribute(ID_ATTR);
      el.removeAttribute(TEXT_ID_ATTR);
    });
    document.getElementById(STYLE_ID)?.remove();
    return highlighted.length;
  }

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.type === "FIND_HEADLINES") {
      revert(); // start fresh so ids match this run
      sendResponse({ headlines: findHeadlines() });
    } else if (req.type === "HIGHLIGHT") {
      sendResponse({ count: highlight(req.ids, req.scroll) });
    } else if (req.type === "SCROLL_TO") {
      scrollToHeadline(req.id);
      sendResponse({});
    } else if (req.type === "REVERT") {
      sendResponse({ count: revert() });
    }
  });
}
