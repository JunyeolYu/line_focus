import { config } from "../../package.json";

const PREF_KEY = `extensions.${config.addonRef}.rulerColor`;
const DEFAULT_COLOR = 'rgba(255, 255, 0, 0.4)';

export { initLineFocus, shutdownLineFocus };

let lineFocusActive = false; // global flag indicating whether line focus is currently ON in the active reader

// State for fixed line highlight
let activeViewerContainer: HTMLDivElement | null = null;
let rulerElementGlobal: HTMLDivElement | null = null;
let currentLineIndex: number = -1; // index into cachedLines
let cachedLines: HTMLElement[][] = []; // each line is array of span elements
let clickHandler: ((e: MouseEvent) => void) | null = null;

function getScrollContainer(): HTMLElement | null {
  if (!activeViewerContainer) return null;
  // In pdf.js, #viewerContainer is the scrollable parent of #viewer
  let p: HTMLElement | null = activeViewerContainer.parentElement as HTMLElement | null;
  while (p) {
    const canScroll = p.scrollHeight > p.clientHeight + 10; // some tolerance
    if (canScroll) return p;
    p = p.parentElement as HTMLElement | null;
  }
  return null;
}

function rebuildCachePreserveCurrent() {
  if (!activeViewerContainer) return;
  const ref = (currentLineIndex >= 0 && currentLineIndex < cachedLines.length) ? cachedLines[currentLineIndex][0] : null;
  const prevLen = cachedLines.length;
  buildLinesCache(activeViewerContainer);
  if (ref) {
    const idx = cachedLines.findIndex(line => line.includes(ref));
    if (idx >= 0) currentLineIndex = idx; // restore index if found
    else currentLineIndex = Math.min(currentLineIndex, cachedLines.length - 1);
  }
  return prevLen !== cachedLines.length;
}

function resetState() {
  activeViewerContainer = null;
  rulerElementGlobal = null;
  currentLineIndex = -1;
  cachedLines = [];
  clickHandler = null;
}

type LineFocusDirection = "up" | "down";

function getLineFocusDirection(
  event: KeyboardEvent,
): LineFocusDirection | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return null;
  }

  if (event.code === "BracketRight") {
    return "down";
  }
  if (event.code === "BracketLeft") {
    return "up";
  }
  return null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return Boolean(
    (target as Element | null)?.closest?.(
      "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
    ),
  );
}

function moveLineFocus(direction: LineFocusDirection): void {
  if (!activeViewerContainer) return;
  if (!cachedLines.length) buildLinesCache(activeViewerContainer);
  if (!cachedLines.length) return;

  if (currentLineIndex === -1) {
    currentLineIndex = 0;
  } else if (direction === "down") {
    let targetIndex = currentLineIndex + 1;
    if (targetIndex >= cachedLines.length) {
      const changed = rebuildCachePreserveCurrent();
      if (changed) {
        targetIndex = currentLineIndex + 1;
      }
      if (targetIndex >= cachedLines.length) {
        const sc = getScrollContainer();
        if (sc) {
          sc.scrollBy({
            top: sc.clientHeight * 0.8,
            behavior: "instant" as ScrollBehavior,
          });
          setTimeout(() => {
            rebuildCachePreserveCurrent();
            const newIdx = currentLineIndex + 1;
            if (newIdx < cachedLines.length) {
              currentLineIndex = newIdx;
              highlightLineByIndex(currentLineIndex);
            }
          }, 50);
        }
        highlightLineByIndex(currentLineIndex);
        return;
      }
    }
    currentLineIndex = targetIndex;
  } else {
    const targetIndex = currentLineIndex - 1;
    if (targetIndex < 0) {
      const sc = getScrollContainer();
      if (sc) {
        sc.scrollBy({
          top: -sc.clientHeight * 0.8,
          behavior: "instant" as ScrollBehavior,
        });
        setTimeout(() => {
          rebuildCachePreserveCurrent();
          const newIdx = currentLineIndex - 1;
          if (newIdx >= 0) {
            currentLineIndex = newIdx;
            highlightLineByIndex(currentLineIndex);
          }
        }, 50);
      }
      highlightLineByIndex(currentLineIndex);
      return;
    }
    currentLineIndex = targetIndex;
  }

  highlightLineByIndex(currentLineIndex);
}

function handleLineFocusKeyEvent(event: KeyboardEvent): void {
  if (
    event.type !== "keydown" ||
    !lineFocusActive ||
    isEditableTarget(event.target)
  ) {
    return;
  }

  const direction = getLineFocusDirection(event);
  if (!direction) return;

  event.preventDefault();
  event.stopPropagation();
  moveLineFocus(direction);
}

function shutdownLineFocus(): void {
  lineFocusActive = false;
  if (activeViewerContainer && clickHandler) {
    activeViewerContainer.removeEventListener("click", clickHandler, true);
  }
  rulerElementGlobal?.remove();
  resetState();
}

function buildLinesCache(container: HTMLElement): void {
  cachedLines = [];
  currentLineIndex = -1;
  const spans = Array.from(container.querySelectorAll('.textLayer span')) as HTMLElement[];
  if (!spans.length) return;
  // Group by top within tolerance
  const tolerance = 1; // px tolerance for same line
  let currentLine: HTMLElement[] = [];
  let currentTop: number | null = null;
  for (const span of spans) {
    const rect = span.getBoundingClientRect();
    if (currentTop === null) {
      currentTop = rect.top;
      currentLine.push(span);
      continue;
    }
    if (Math.abs(rect.top - currentTop) <= tolerance) {
      currentLine.push(span);
    } else {
      cachedLines.push(currentLine);
      currentLine = [span];
      currentTop = rect.top;
    }
  }
  if (currentLine.length) cachedLines.push(currentLine);
}

function highlightLineByIndex(index: number) {
  if (!activeViewerContainer || !rulerElementGlobal) return;
  if (index < 0 || index >= cachedLines.length) return;
  const lineSpans = cachedLines[index];
  if (!lineSpans.length) return;
  const firstRect = lineSpans[0].getBoundingClientRect();
  const lastRect = lineSpans[lineSpans.length - 1].getBoundingClientRect();
  const viewerRect = activeViewerContainer.getBoundingClientRect();
  const left = firstRect.left - viewerRect.left;
  const top = firstRect.top - viewerRect.top;
  const width = lastRect.right - firstRect.left;
  const height = firstRect.height;
  rulerElementGlobal.style.left = `${left}px`;
  rulerElementGlobal.style.top = `${top}px`;
  rulerElementGlobal.style.width = `${width}px`;
  rulerElementGlobal.style.height = `${height}px`;
  rulerElementGlobal.style.display = 'block';
  // Attempt scroll into view if out of viewport
  lineSpans[0].scrollIntoView({ block: 'nearest' });
}

function highlightLineFromSpan(span: HTMLElement) {
  if (!activeViewerContainer) return;
  if (!cachedLines.length) buildLinesCache(activeViewerContainer);
  // Find which line array contains the span
  const idx = cachedLines.findIndex(line => line.includes(span));
  if (idx >= 0) {
    currentLineIndex = idx;
    highlightLineByIndex(idx);
  } else {
    // If not found maybe rebuild cache (layout changed)
    buildLinesCache(activeViewerContainer);
    const idx2 = cachedLines.findIndex(line => line.includes(span));
    if (idx2 >= 0) {
      currentLineIndex = idx2;
      highlightLineByIndex(idx2);
    }
  }
}

function initLineFocus() {
  ztoolkit.Keyboard.register(handleLineFocusKeyEvent);

  Zotero.Reader.registerEventListener("renderToolbar", (event) => {
    const { reader, doc, append } = event;

    let rulerElement: HTMLDivElement | null = null;
    let isOn = false;

    const button = ztoolkit.UI.createElement(doc, "button", {
      namespace: "html",
      id: "toggle-line-focus",
      classList: ["toolbar-button", `${addon.data.config.addonRef}-reader-button`],
      properties: { tabIndex: -1, title: "Toggle Line Focus ([ / ])" },
      listeners: [
        {
          type: "click",
          listener: (e: MouseEvent) => {
            isOn = !isOn;
            lineFocusActive = isOn; // sync global flag
            (e.target as HTMLButtonElement).textContent = isOn ? "On" : "Off";

            const hostDoc = reader._iframe?.contentDocument;
            if (!hostDoc) { return; }
            const viewerIframe = hostDoc.querySelector('#primary-view > iframe') as HTMLIFrameElement | null;
            if (!viewerIframe) { return; }
            const pdfDoc = viewerIframe.contentDocument as Document | null;
            if (!pdfDoc) { return; }

            const viewerContainer = pdfDoc.querySelector('#viewer') as HTMLDivElement | null;
            if (!viewerContainer) { return; }

            if (isOn) {
              const newRuler = pdfDoc.createElement("div");
              newRuler.id = "reading-ruler";

              const savedColor = String(Zotero.Prefs.get(PREF_KEY, true) || DEFAULT_COLOR);

              newRuler.style.position = 'absolute';
              newRuler.style.backgroundColor = savedColor;
              newRuler.style.pointerEvents = 'none';
              newRuler.style.zIndex = '9999';
              newRuler.style.display = 'none';
              newRuler.style.borderRadius = '2px';

              if (pdfDoc.defaultView) {
                const win = pdfDoc.defaultView as Window;
                const vc = viewerContainer;
                if (vc) {
                  const styleDecl = win.getComputedStyle(vc as Element);
                  if (styleDecl) {
                    const viewerPos = styleDecl.position;
                    if (viewerPos === 'static') {
                      (vc as HTMLDivElement).style.position = 'relative';
                    }
                  }
                }
              }
              viewerContainer.appendChild(newRuler);
              rulerElement = newRuler;
              activeViewerContainer = viewerContainer;
              rulerElementGlobal = newRuler;
              buildLinesCache(viewerContainer);

              // Click to fix highlight on that line
              clickHandler = (ce: MouseEvent) => {
                const target = ce.target as HTMLElement;
                if (target && target.nodeName === 'SPAN' && target.closest('.textLayer')) {
                  highlightLineFromSpan(target);
                }
              };
              viewerContainer.addEventListener('click', clickHandler, true);
            } else {
              // Cleanup
              if (viewerContainer && clickHandler) viewerContainer.removeEventListener('click', clickHandler, true);
              const ruler = viewerContainer.querySelector('#reading-ruler') as HTMLDivElement | null;
              if (ruler) ruler.remove();
              resetState();
            }
          },
        },
      ],
      enableElementRecord: false,
    });
    (button as HTMLButtonElement).textContent = isOn ? "On" : "Off";
    append(button);
  }, addon.data.config.addonID);
}
