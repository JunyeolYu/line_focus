const CENTER_DISTANCE_RATIO = 0.75;
const MAX_REFERENCE_HEIGHT_RATIO = 1.25;
const BAND_DISTANCE_RATIO = 0.75;
const EDGE_BAND_LIMIT = 3;
const TRACK_TOLERANCE = 0.02;
const ROTATION_THRESHOLD = 45;
const SIDE_TRACK_LIMIT = 0.1;
const MAX_HISTORY_PAGES = 64;
const MIN_OBSERVED_LINES = 3;

export interface TextRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TextLayoutPage<T> {
  key: string;
  pageNumber?: number;
  rect: TextRect;
  lines: T[][];
}

interface StoredLine {
  text: string;
  template: string;
  x: number;
  y: number;
  edge: Edge | null;
  printedPageNumber: number | null;
}

interface StoredPage {
  pageNumber: number | null;
  lines: StoredLine[];
}

export interface MarginTextHistory {
  pages: Map<string, StoredPage>;
}

interface LineFeature<T> extends StoredLine {
  line: T[];
  centerY: number;
  relativeAngle: number;
  fontRatio: number;
  topRank: number;
  bottomRank: number;
}

interface AnalyzedPage<T> {
  key: string;
  pageNumber: number | null;
  complete: boolean;
  lines: LineFeature<T>[];
}

interface VisualBand<T> {
  center: number;
  lines: LineFeature<T>[];
}

type Edge = "top" | "bottom";

export function createMarginTextHistory(): MarginTextHistory {
  return { pages: new Map() };
}

export function groupTextSpansByLine<T>(
  spans: readonly T[],
  getRect: (span: T) => TextRect,
): T[][] {
  const validSpans = spans.filter((span) => isValidRect(getRect(span)));
  const pageMedianHeight = median(
    validSpans.map((span) => getRect(span).height),
  );
  const lines: T[][] = [];
  let currentLine: T[] = [];
  let centers: number[] = [];
  let heights: number[] = [];

  for (const span of validSpans) {
    const rect = getRect(span);
    const center = rect.top + rect.height / 2;
    const lineCenter = median(centers);
    const referenceHeight = Math.min(
      Math.max(median(heights), rect.height),
      pageMedianHeight * MAX_REFERENCE_HEIGHT_RATIO,
    );
    const tolerance = Math.max(1, referenceHeight * CENTER_DISTANCE_RATIO);

    if (currentLine.length && Math.abs(center - lineCenter) > tolerance) {
      lines.push(currentLine);
      currentLine = [];
      centers = [];
      heights = [];
    }

    currentLine.push(span);
    centers.push(center);
    heights.push(rect.height);
  }

  if (currentLine.length) lines.push(currentLine);
  return lines;
}

export function filterMarginTextLines<T>(
  pages: readonly TextLayoutPage<T>[],
  history: MarginTextHistory,
  getRect: (span: T) => TextRect,
  getText: (span: T) => string,
  getAngle: (span: T) => number = () => 0,
): T[][] {
  const analyzedPages = pages.map((page) =>
    analyzePage(page, getRect, getText, getAngle),
  );

  for (const page of analyzedPages) {
    if (!page.complete) continue;
    const previous = history.pages.get(page.key);
    if (previous && previous.lines.length > page.lines.length) continue;
    history.pages.delete(page.key);
    history.pages.set(page.key, {
      pageNumber: page.pageNumber,
      lines: page.lines.map(toStoredLine),
    });
  }
  trimHistory(history);

  return analyzedPages.flatMap((page) =>
    page.lines
      .filter((line) => !isMarginArtifact(line, page, history))
      .map((line) => line.line),
  );
}

function analyzePage<T>(
  page: TextLayoutPage<T>,
  getRect: (span: T) => TextRect,
  getText: (span: T) => string,
  getAngle: (span: T) => number,
): AnalyzedPage<T> {
  const valid = isValidPageRect(page.rect);
  const spans = page.lines.flat();
  const typicalHeight = median(
    spans
      .map(getRect)
      .filter(isValidRect)
      .map((rect) => rect.height),
  );
  const dominantAngle = getDominantAngle(spans, getText, getAngle);
  const lines = page.lines
    .filter((line) => line.length)
    .map((line) => {
      const bounds = getBounds(line, getRect);
      const text = normalizeText(line.map(getText).join(""));
      const angle = getDominantAngle(line, getText, getAngle);
      const lineHeight = median(
        line
          .map(getRect)
          .filter(isValidRect)
          .map((rect) => rect.height),
      );
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height / 2;
      return {
        line,
        text,
        template: getTextTemplate(text),
        x: valid ? (centerX - page.rect.left) / page.rect.width : 0,
        y: valid ? (centerY - page.rect.top) / page.rect.height : 0,
        centerY,
        relativeAngle: angleDistance(angle, dominantAngle),
        edge: null,
        topRank: Number.POSITIVE_INFINITY,
        bottomRank: Number.POSITIVE_INFINITY,
        fontRatio: typicalHeight ? lineHeight / typicalHeight : 1,
        printedPageNumber: parsePageNumber(text),
      } satisfies LineFeature<T>;
    });

  assignVisualBands(lines, typicalHeight);

  return {
    key: page.key,
    pageNumber:
      page.pageNumber !== undefined && Number.isFinite(page.pageNumber)
        ? page.pageNumber
        : null,
    complete: valid && lines.length >= MIN_OBSERVED_LINES,
    lines,
  };
}

function assignVisualBands<T>(
  lines: LineFeature<T>[],
  typicalHeight: number,
): void {
  const horizontalLines = lines
    .filter((line) => line.relativeAngle < ROTATION_THRESHOLD)
    .sort((a, b) => a.centerY - b.centerY);
  const bands: VisualBand<T>[] = [];
  const tolerance = Math.max(1, typicalHeight * BAND_DISTANCE_RATIO);

  for (const line of horizontalLines) {
    const band = bands[bands.length - 1];
    if (!band || Math.abs(line.centerY - band.center) > tolerance) {
      bands.push({
        center: line.centerY,
        lines: [line],
      });
      continue;
    }

    band.lines.push(line);
    band.center = median(band.lines.map((item) => item.centerY));
  }

  bands.forEach((band, index) => {
    for (const line of band.lines) {
      line.topRank = index;
      line.bottomRank = bands.length - index - 1;
    }
  });

  if (bands.length < 2) return;
  const gaps = bands.slice(0, -1).map((band, index) => {
    const nextBand = bands[index + 1];
    return Math.max(0, nextBand.center - band.center);
  });
  const gapMedian = median(gaps);
  const regularGaps = gaps.filter((gap) => gap <= gapMedian);
  const baseline = median(regularGaps);
  const deviation = median(regularGaps.map((gap) => Math.abs(gap - baseline)));
  const largeGap = baseline + Math.max(typicalHeight * 1.5, deviation * 4);

  const topLimit = Math.min(EDGE_BAND_LIMIT, gaps.length);
  for (let index = 0; index < topLimit; index += 1) {
    if (gaps[index] < largeGap) continue;
    for (const band of bands.slice(0, index + 1)) {
      for (const line of band.lines) line.edge = "top";
    }
    break;
  }

  const bottomStart = Math.max(0, gaps.length - EDGE_BAND_LIMIT);
  for (let index = gaps.length - 1; index >= bottomStart; index -= 1) {
    if (gaps[index] < largeGap) continue;
    for (const band of bands.slice(index + 1)) {
      for (const line of band.lines) line.edge = "bottom";
    }
    break;
  }
}

function isMarginArtifact<T>(
  line: LineFeature<T>,
  page: AnalyzedPage<T>,
  history: MarginTextHistory,
): boolean {
  if (!page.complete || !line.text) return false;

  const semanticMetadata = isPublicationMetadata(line.text);
  const sideCandidate =
    line.x < SIDE_TRACK_LIMIT || line.x > 1 - SIDE_TRACK_LIMIT;
  const rotatedSide = line.relativeAngle >= ROTATION_THRESHOLD && sideCandidate;
  const detachedEdge = line.edge !== null;

  if (
    semanticMetadata &&
    ((detachedEdge && line.fontRatio <= 1.35) || rotatedSide)
  ) {
    return true;
  }

  if (isSequentialPageNumber(line, page, history)) return true;

  return detachedEdge && hasRepeatedTrack(line, page.key, history);
}

function hasRepeatedTrack(
  line: StoredLine,
  pageKey: string,
  history: MarginTextHistory,
): boolean {
  if (!line.text || !line.edge) return false;

  let matchingPages = 0;
  for (const [otherKey, page] of history.pages) {
    if (otherKey === pageKey) continue;
    const matches = page.lines.some((other) => {
      return (
        sameSignature(line, other) &&
        other.edge === line.edge &&
        Math.abs(other.x - line.x) <= TRACK_TOLERANCE &&
        Math.abs(other.y - line.y) <= TRACK_TOLERANCE
      );
    });
    if (matches) matchingPages += 1;
    if (matchingPages >= 2) {
      return true;
    }
  }
  return false;
}

function isSequentialPageNumber<T>(
  line: LineFeature<T>,
  page: AnalyzedPage<T>,
  history: MarginTextHistory,
): boolean {
  if (
    line.printedPageNumber === null ||
    page.pageNumber === null ||
    !line.edge ||
    (line.topRank >= EDGE_BAND_LIMIT && line.bottomRank >= EDGE_BAND_LIMIT)
  ) {
    return false;
  }

  const offset = line.printedPageNumber - page.pageNumber;
  for (const [otherKey, otherPage] of history.pages) {
    if (
      otherKey === page.key ||
      otherPage.pageNumber === null ||
      otherPage.pageNumber === page.pageNumber
    ) {
      continue;
    }
    for (const other of otherPage.lines) {
      if (
        other.printedPageNumber !== null &&
        other.edge === line.edge &&
        Math.abs(other.x - line.x) <= TRACK_TOLERANCE &&
        Math.abs(other.y - line.y) <= TRACK_TOLERANCE &&
        other.printedPageNumber - otherPage.pageNumber === offset
      ) {
        return true;
      }
    }
  }
  return false;
}

function sameSignature(a: StoredLine, b: StoredLine): boolean {
  if (a.text === b.text) return true;
  return (
    a.template.length >= 8 &&
    /[a-z]{4}/i.test(a.template) &&
    a.template === b.template
  );
}

function toStoredLine<T>(line: LineFeature<T>): StoredLine {
  return {
    text: line.text,
    template: line.template,
    x: line.x,
    y: line.y,
    edge: line.edge,
    printedPageNumber: line.printedPageNumber,
  };
}

function trimHistory(history: MarginTextHistory): void {
  while (history.pages.size > MAX_HISTORY_PAGES) {
    const oldestKey = history.pages.keys().next().value as string | undefined;
    if (oldestKey === undefined) return;
    history.pages.delete(oldestKey);
  }
}

function getBounds<T>(
  line: readonly T[],
  getRect: (span: T) => TextRect,
): TextRect {
  const rects = line.map(getRect).filter(isValidRect);
  const first = rects[0];
  if (!first) return { left: 0, top: 0, width: 0, height: 0 };
  let left = first.left;
  let top = first.top;
  let right = first.left + first.width;
  let bottom = first.top + first.height;

  for (const rect of rects.slice(1)) {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.left + rect.width);
    bottom = Math.max(bottom, rect.top + rect.height);
  }
  return { left, top, width: right - left, height: bottom - top };
}

function getDominantAngle<T>(
  spans: readonly T[],
  getText: (span: T) => string,
  getAngle: (span: T) => number,
): number {
  const bins = new Map<number, number>();
  for (const span of spans) {
    const angle = normalizeAngle(getAngle(span));
    const bin = Math.round(angle / 5) * 5;
    const weight = Math.max(1, getText(span).trim().length);
    bins.set(bin, (bins.get(bin) ?? 0) + weight);
  }

  let dominant = 0;
  let bestWeight = -1;
  for (const [angle, weight] of bins) {
    if (weight > bestWeight) {
      dominant = angle;
      bestWeight = weight;
    }
  }
  return dominant;
}

function normalizeAngle(value: number): number {
  if (!Number.isFinite(value)) return 0;
  let angle = value % 180;
  if (angle >= 90) angle -= 180;
  if (angle < -90) angle += 180;
  return angle;
}

function angleDistance(a: number, b: number): number {
  const distance = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(distance, 180 - distance);
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function getTextTemplate(value: string): string {
  return value.replace(/^(?:page\s*)?\d+\b/, "#").replace(/\b\d+$/, "#");
}

function parsePageNumber(value: string): number | null {
  const match = value.match(
    /^(?:page\s*)?([0-9]{1,5}|[ivxlcdm]{1,12})(?:\s*(?:of|\/)\s*(?:[0-9]{1,5}|[ivxlcdm]{1,12}))?$/i,
  );
  if (!match) return null;
  if (/^\d+$/.test(match[1])) return Number(match[1]);

  const values: Record<string, number> = {
    i: 1,
    v: 5,
    x: 10,
    l: 50,
    c: 100,
    d: 500,
    m: 1000,
  };
  let result = 0;
  let previous = 0;
  for (const character of match[1].toLowerCase().split("").reverse()) {
    const current = values[character];
    result += current < previous ? -current : current;
    previous = current;
  }
  return result || null;
}

function isPublicationMetadata(value: string): boolean {
  const boilerplate =
    /(?:\bdoi\b|10\.\d{4,9}\/|\bissn\b|\bisbn\b|copyright|©|licensed|all rights reserved|\barxiv\s*:\s*\d)/i;
  const masthead =
    /(?:19|20)\d{2}/.test(value) &&
    /\b(?:ieee|acm|springer|elsevier)\b/i.test(value) &&
    /\b(?:conference|proceedings|journal|transactions)\b/i.test(value);
  return boilerplate.test(value) || masthead;
}

function isValidRect(rect: TextRect): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width >= 0 &&
    rect.height > 0
  );
}

function isValidPageRect(rect: TextRect): boolean {
  return isValidRect(rect) && rect.width > 0;
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
