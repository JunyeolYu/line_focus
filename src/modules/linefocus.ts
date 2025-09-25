import { config } from "../../package.json";

const PREF_KEY = `extensions.${config.addonRef}.rulerColor`;
const DEFAULT_COLOR = 'rgba(255, 255, 0, 0.4)';

export { initLineFocus };

let keyboardHookInstalled = false;
let missingKeyFieldWarned = false;
let lineFocusActive = false; // global flag indicating whether line focus is currently ON in the active reader

// State for fixed line highlight
let activeViewerContainer: HTMLDivElement | null = null;
let rulerElementGlobal: HTMLDivElement | null = null;
let currentLineIndex: number = -1; // index into cachedLines
let cachedLines: HTMLElement[][] = []; // each line is array of span elements
let clickHandler: ((e: MouseEvent) => void) | null = null;
// Track keys to avoid duplicate processing (some environments may fire multiple handlers)
const pressedKeys = new Set<string>();
let lastMoveAt = 0; // timestamp of last line move
const MOVE_INTERVAL_MIN = 10; // minimal ms gap to avoid accidental double fire (keeps repeat fast)

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
interface NormalizedKeyEvent {
  key: string | null;
  code: string | null;
  keyCode: number | null;
  raw: any;
}
function normalizeKeyEvent(e: any): NormalizedKeyEvent {
  let key: string | null = null;
  let code: string | null = null;
  let keyCode: number | null = null;

  if (typeof e.key === 'string' && e.key.length > 0) key = e.key;
  if (typeof e.code === 'string' && e.code.length > 0) code = e.code;
  if (typeof e.keyCode === 'number' && e.keyCode > 0) keyCode = e.keyCode;
  else if (typeof e.which === 'number' && e.which > 0) keyCode = e.which;
  else if (typeof e.charCode === 'number' && e.charCode > 0) keyCode = e.charCode;

  if (!key && keyCode) {
    // Attempt derive key from keyCode (A-Z 65-90)
    if (keyCode >= 65 && keyCode <= 90) key = String.fromCharCode(keyCode).toLowerCase();
  }
  if (!code && key) {
    // Derive code for letters
    if (/^[a-z]$/i.test(key)) code = 'Key' + key.toUpperCase();
  }
  if (!code && keyCode && keyCode >= 65 && keyCode <= 90) {
    code = 'Key' + String.fromCharCode(keyCode);
  }

  if (!missingKeyFieldWarned && (!('key' in e) || !('code' in e))) {
    missingKeyFieldWarned = true;
    try {
      Zotero.log('[LineFocus] Key event missing standard fields. keys=' + Object.keys(e).join(','));
    } catch { }
  }

  return { key, code, keyCode, raw: e };
}

function installKeyboardHookOnce() {
  if (keyboardHookInstalled) return;
  keyboardHookInstalled = true;

  ztoolkit.Keyboard.register((ev: any, keyOptions: any) => {
    if (!lineFocusActive) return; // Only process when active

    // We only want to act on keydown to avoid double fire (keydown + keyup) while
    // still allowing native repeat when key is held.
    const type = ev?.type;
    if (type === 'keyup') {
      const nkUp = normalizeKeyEvent(ev);
      if (nkUp.code) pressedKeys.delete(nkUp.code);
      return;
    }
    if (type && type !== 'keydown') return; // ignore keypress

    const nk = normalizeKeyEvent(ev);

    // Dump once when derived code is KeyS
    if (nk.code === 'KeyS') {

      // try {
      //   Zotero.log('[ztoolkit cb] normalized code=KeyS key=' + nk.key + ' keyCode=' + nk.keyCode);
      //   Zotero.log('[ztoolkit cb] keyOptions=' + JSON.stringify(keyOptions, (k, v) => (v && typeof v === 'object' && v.toString ? v.toString() : v)));
      // } catch { }
    }

    const kObj = keyOptions?.keyboard;
    const isS = (
      nk.code === 'KeyS' ||
      (typeof nk.key === 'string' && nk.key.toLowerCase() === 's') ||
      nk.keyCode === 83 ||
      kObj?.code === 'KeyS' ||
      kObj?.equals?.('s') ||
      kObj?.equals?.('S')
    );
    const isW = (
      nk.code === 'KeyW' ||
      (typeof nk.key === 'string' && nk.key.toLowerCase() === 'w') ||
      nk.keyCode === 87 ||
      kObj?.code === 'KeyW' ||
      kObj?.equals?.('w') ||
      kObj?.equals?.('W')
    );

    if (isS || isW) {
      // Deduplicate: process only if not already pressed OR enough time passed (repeat)
      const keyId = isS ? 'KeyS' : 'KeyW';
      const now = Date.now();
      if (pressedKeys.has(keyId)) {
        // allow if native repeat interval passes threshold
        if (now - lastMoveAt < MOVE_INTERVAL_MIN) return;
      } else {
        pressedKeys.add(keyId);
      }
      lastMoveAt = now;
      if (!activeViewerContainer) return;
      if (!cachedLines.length) buildLinesCache(activeViewerContainer);
      if (!cachedLines.length) return;
      if (currentLineIndex === -1) currentLineIndex = 0;
      else {
        if (isS) {
          let targetIndex = currentLineIndex + 1;
          if (targetIndex >= cachedLines.length) {
            // Try rebuild (maybe new page rendered)
            const changed = rebuildCachePreserveCurrent();
            if (changed) {
              targetIndex = currentLineIndex + 1;
            }
            if (targetIndex >= cachedLines.length) {
              // Force scroll to load next page, then attempt another rebuild async
              const sc = getScrollContainer();
              if (sc) {
                try { sc.scrollBy({ top: sc.clientHeight * 0.8, behavior: 'instant' as ScrollBehavior }); } catch { }
                // schedule async rebuild & move
                setTimeout(() => {
                  rebuildCachePreserveCurrent();
                  const newIdx = currentLineIndex + 1;
                  if (newIdx < cachedLines.length) {
                    currentLineIndex = newIdx;
                    highlightLineByIndex(currentLineIndex);
                  }
                }, 50);
              }
              // Keep highlighting current line until next batch ready
              highlightLineByIndex(currentLineIndex);
              return;
            }
          }
          if (targetIndex < cachedLines.length) currentLineIndex = targetIndex;
        } else { // isW
          let targetIndex = currentLineIndex - 1;
          if (targetIndex < 0) {
            // Try scroll up to load previous page
            const sc = getScrollContainer();
            if (sc) {
              try { sc.scrollBy({ top: -sc.clientHeight * 0.8, behavior: 'instant' as ScrollBehavior }); } catch { }
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
      }
      if (currentLineIndex >= 0) highlightLineByIndex(currentLineIndex);
    }
  });
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
  try { lineSpans[0].scrollIntoView({ block: 'nearest' }); } catch { }
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
  installKeyboardHookOnce();

  Zotero.Reader.registerEventListener("renderToolbar", (event) => {
    const { reader, doc, append } = event;

    let rulerElement: HTMLDivElement | null = null;
    let isOn = false;

    const button = ztoolkit.UI.createElement(doc, "button", {
      namespace: "html",
      id: "toggle-line-focus",
      classList: ["toolbar-button", `${addon.data.config.addonRef}-reader-button`],
      properties: { tabIndex: -1, title: "Toggle Line Focus" },
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
