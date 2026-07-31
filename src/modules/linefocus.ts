import { config } from "../../package.json";
import {
  createMarginTextHistory,
  filterMarginTextLines,
  groupTextSpansByLine,
} from "./textLineGrouping";

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
let marginTextHistory = createMarginTextHistory();

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
  const previousIndex = currentLineIndex;
  const ref = (currentLineIndex >= 0 && currentLineIndex < cachedLines.length) ? cachedLines[currentLineIndex][0] : null;
  const prevLen = cachedLines.length;
  buildLinesCache(activeViewerContainer);
  if (ref) {
    const idx = cachedLines.findIndex(line => line.includes(ref));
    if (idx >= 0) currentLineIndex = idx; // restore index if found
    else currentLineIndex = Math.min(previousIndex, cachedLines.length - 1);
  }
  return prevLen !== cachedLines.length;
}

function resetState() {
  activeViewerContainer = null;
  rulerElementGlobal = null;
  currentLineIndex = -1;
  cachedLines = [];
  clickHandler = null;
  marginTextHistory = createMarginTextHistory();
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
  const textLayers = Array.from(
    container.querySelectorAll(".textLayer"),
  ) as HTMLElement[];
  const spanRects = new Map<HTMLElement, DOMRect>();
  const spanTexts = new Map<HTMLElement, string>();
  const spanAngles = new Map<HTMLElement, number>();
  const getRect = (span: HTMLElement) =>
    spanRects.get(span) ?? span.getBoundingClientRect();
  const pages = textLayers.map((textLayer, index) => {
    const pageElement = textLayer.closest(".page") as HTMLElement | null;
    const pageNumberText = pageElement?.dataset.pageNumber;
    const pageNumber = Number(pageNumberText);
    const spans = (
      Array.from(textLayer.querySelectorAll("span")) as HTMLElement[]
    ).filter((span) => span.textContent?.trim());
    for (const span of spans) {
      spanRects.set(span, span.getBoundingClientRect());
      spanTexts.set(span, span.textContent ?? "");
      spanAngles.set(span, getSpanRotation(span));
    }
    return {
      key: pageNumberText || pageElement?.id || String(index),
      pageNumber: Number.isFinite(pageNumber) ? pageNumber : undefined,
      rect: textLayer.getBoundingClientRect(),
      lines: groupTextSpansByLine(spans, getRect),
    };
  });

  cachedLines = filterMarginTextLines(
    pages,
    marginTextHistory,
    getRect,
    (span) => spanTexts.get(span) ?? "",
    (span) => spanAngles.get(span) ?? 0,
  );
}

function getSpanRotation(span: HTMLElement): number {
  const view = span.ownerDocument?.defaultView;
  if (!view) return 0;
  const style = view.getComputedStyle(span);
  if (!style) return 0;
  const transform = style.getPropertyValue("transform");
  if (!transform || transform === "none") return 0;
  const match = transform.match(/^matrix(?:3d)?\((.+)\)$/);
  if (!match) return 0;
  const values = match[1].split(",").map(Number);
  if (values.length < 2 || values.some((value) => !Number.isFinite(value))) {
    return 0;
  }
  return (Math.atan2(values[1], values[0]) * 180) / Math.PI;
}

function highlightLineByIndex(index: number) {
  if (!activeViewerContainer || !rulerElementGlobal) return;
  if (index < 0 || index >= cachedLines.length) return;
  const lineSpans = cachedLines[index];
  if (!lineSpans.length) return;
  const firstRect = lineSpans[0].getBoundingClientRect();
  let left = firstRect.left;
  let top = firstRect.top;
  let right = firstRect.right;
  let bottom = firstRect.bottom;
  for (const span of lineSpans.slice(1)) {
    const rect = span.getBoundingClientRect();
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  const viewerRect = activeViewerContainer.getBoundingClientRect();
  rulerElementGlobal.style.left = `${left - viewerRect.left}px`;
  rulerElementGlobal.style.top = `${top - viewerRect.top}px`;
  rulerElementGlobal.style.width = `${right - left}px`;
  rulerElementGlobal.style.height = `${bottom - top}px`;
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
              marginTextHistory = createMarginTextHistory();
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
