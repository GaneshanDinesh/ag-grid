import type {
    AgColumn,
    PdfCellStyle,
    PdfExportParams,
    PdfExportStyles,
    PdfFontFamily,
    PdfMargin,
    PdfPageOrientation,
    PdfPageSize,
    PdfTextAlignment,
} from 'ag-grid-community';

import type { PdfRow, PdfRowType } from './pdfSerializingSession';

/**
 * Minimal PDF generator for grid exports.
 * Focused on table layout with basic styling and pagination.
 */
const PAGE_SIZES: Record<string, { width: number; height: number }> = {
    A4: { width: 595.28, height: 841.89 },
    Letter: { width: 612, height: 792 },
};

const FONT_BOLD_MAP: Record<PdfFontFamily, PdfFontFamily> = {
    Helvetica: 'Helvetica-Bold',
    'Helvetica-Bold': 'Helvetica-Bold',
    'Times-Roman': 'Times-Bold',
    'Times-Bold': 'Times-Bold',
    Courier: 'Courier-Bold',
    'Courier-Bold': 'Courier-Bold',
};

const DEFAULTS = {
    pageSize: 'A4' as const,
    pageOrientation: 'landscape' as const,
    margin: 36,
    fontSize: 10,
    headerFontSize: 11,
    cellPadding: 4,
    repeatHeader: true,
    drawCellBorders: true,
};

type PdfBaseExportStyles = Required<
    Pick<
        PdfExportStyles,
        | 'backgroundColor'
        | 'dataBackgroundColor'
        | 'oddRowBackgroundColor'
        | 'foregroundColor'
        | 'headerBackgroundColor'
        | 'headerTextColor'
        | 'borderColor'
    >
>;

const DEFAULT_PDF_STYLES: PdfBaseExportStyles = {
    backgroundColor: '#ffffff',
    dataBackgroundColor: '#ffffff',
    oddRowBackgroundColor: '#ffffff',
    foregroundColor: '#000000',
    headerBackgroundColor: '#ffffff',
    headerTextColor: '#000000',
    borderColor: '#000000',
};

type ResolvedMargin = { top: number; right: number; bottom: number; left: number };

type ResolvedPageSize = { width: number; height: number };

const DEFAULT_TITLE_MARGIN: ResolvedMargin = { top: 0, right: 0, bottom: 8, left: 0 };
const DEFAULT_TITLE_PADDING: ResolvedMargin = { top: 6, right: 6, bottom: 6, left: 6 };
const DEFAULT_TITLE_ALIGNMENT: PdfTextAlignment = 'center';
const DEFAULT_CELL_ALIGNMENT: PdfTextAlignment = 'left';
const DEFAULT_CELL_MARGIN: ResolvedMargin = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Stores PDF objects and assembles a cross-reference table.
 * Object IDs are 1-based and match the order they are added.
 */
class PdfObjectStore {
    private readonly objects: string[] = [];

    /**
     * Reserve an object slot so other objects can reference it early.
     * @returns The reserved object ID.
     */
    public reserve(): number {
        this.objects.push('');
        return this.objects.length;
    }

    /**
     * Add a new object and return its ID.
     * @param content - The object content to append.
     * @returns The new object ID.
     */
    public add(content: string): number {
        this.objects.push(content);
        return this.objects.length;
    }

    /**
     * Replace a previously reserved object by ID.
     * @param id - The object ID to update.
     * @param content - The replacement content.
     */
    public set(id: number, content: string): void {
        this.objects[id - 1] = content;
    }

    /**
     * Build the final PDF file with an xref table and trailer.
     * @param rootId - The catalog object ID.
     * @param infoId - Optional info dictionary object ID.
     * @returns The complete PDF document as a string.
     */
    public build(rootId: number, infoId?: number): string {
        let body = '%PDF-1.4\n';
        const offsets: number[] = [0];

        this.objects.forEach((object, index) => {
            offsets[index + 1] = body.length;
            body += `${index + 1} 0 obj\n${object}\nendobj\n`;
        });

        // cross-reference table lists byte offsets for each object.
        const xrefOffset = body.length;
        body += `xref\n0 ${this.objects.length + 1}\n`;
        body += '0000000000 65535 f \n';

        for (let i = 1; i <= this.objects.length; i++) {
            body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
        }

        const trailerParts = [`/Size ${this.objects.length + 1}`, `/Root ${rootId} 0 R`];
        if (infoId) {
            trailerParts.push(`/Info ${infoId} 0 R`);
        }
        // trailer points to the catalog and optional metadata.
        body += `trailer\n<< ${trailerParts.join(' ')} >>\n`;
        body += `startxref\n${xrefOffset}\n%%EOF`;

        return body;
    }
}

/**
 * Build a PDF string for the provided rows and columns.
 * The layout is a simple table with optional header repetition.
 * @param rows - The serialised row data to render.
 * @param columnsToExport - The columns used to derive widths.
 * @param params - Export options for layout and styling.
 * @returns The PDF file contents as a string.
 */
export function createPdfDocument(rows: PdfRow[], columnsToExport: AgColumn[], params: PdfExportParams): string {
    const pageSize = resolvePageSize(params.pageSize, params.pageOrientation);
    const margin = resolveMargin(params.margin);
    const styleColors = resolvePdfStyleColors(params.pdfStyles);

    const columnCount = Math.max(columnsToExport.length, getMaxColumnCount(rows), 1);
    const availableWidth = Math.max(pageSize.width - margin.left - margin.right, 0);
    const columnWidths = getColumnWidths(columnsToExport, columnCount, availableWidth);

    const fontSize = params.fontSize ?? DEFAULTS.fontSize;
    const headerFontSize = params.headerFontSize ?? DEFAULTS.headerFontSize;
    const cellPadding = params.cellPadding ?? DEFAULTS.cellPadding;
    const repeatHeader = params.repeatHeader ?? DEFAULTS.repeatHeader;
    const drawCellBorders = params.drawCellBorders ?? DEFAULTS.drawCellBorders;

    const bodyFont = params.fontFamily ?? 'Helvetica';
    const headerFont = params.headerFontFamily ?? FONT_BOLD_MAP[bodyFont];
    const titleData = params.documentTitle
        ? resolveDocumentTitle(params.documentTitle, params, styleColors, headerFont)
        : undefined;
    const documentTitle = titleData?.text ? normaliseText(titleData.text) : '';
    const titleStyle = titleData?.style;
    const shouldRenderTitle = !!documentTitle;
    const fontKeyByFamily = createFontKeyMap(bodyFont, headerFont, titleStyle?.fontFamily, rows);
    const titleFontKey = titleStyle ? fontKeyByFamily.get(titleStyle.fontFamily) : undefined;

    const headerRows = repeatHeader ? getRepeatableHeaderRows(rows) : [];

    const layout: LayoutOptions = {
        columnCount,
        columnWidths,
        margin,
        drawCellBorders,
        fontSize,
        headerFontSize,
        cellPadding,
        rowHeight: params.rowHeight,
        headerRowHeight: params.headerRowHeight,
    };

    const pages: string[] = [];
    let pageParts: string[] = [];
    let cursorY = pageSize.height - margin.top;
    let isFirstPage = true;

    const startPage = (includeHeaders: boolean) => {
        if (pageParts.length) {
            pages.push(pageParts.join('\n'));
        }
        // PDF drawing commands for the current page are stored in pageParts.
        pageParts = ['0.5 w'];
        if (styleColors.pageBackground) {
            pageParts.push(`${formatColor(styleColors.pageBackground)} rg`);
            // fill the entire page background.
            pageParts.push(`0 0 ${fmt(pageSize.width)} ${fmt(pageSize.height)} re f`);
        }
        cursorY = pageSize.height - margin.top;
        if (isFirstPage) {
            if (titleStyle && titleFontKey && documentTitle && shouldRenderTitle) {
                cursorY = renderDocumentTitle(
                    documentTitle,
                    cursorY,
                    pageSize,
                    layout,
                    pageParts,
                    titleStyle,
                    titleFontKey
                );
            }
            isFirstPage = false;
        }

        if (includeHeaders && headerRows.length) {
            cursorY = renderRows(
                headerRows,
                cursorY,
                layout,
                pageParts,
                bodyFont,
                headerFont,
                styleColors,
                fontKeyByFamily
            );
        }
    };

    startPage(false);

    let bodyRowIndex = 0;
    for (const row of rows) {
        const rowHeight = getRowHeight(row.type, layout);

        if (cursorY - rowHeight < margin.bottom) {
            startPage(repeatHeader);
        }

        cursorY = renderRow(
            row,
            cursorY,
            layout,
            pageParts,
            bodyFont,
            headerFont,
            styleColors,
            bodyRowIndex,
            fontKeyByFamily
        );
        if (row.type === 'BODY') {
            bodyRowIndex += 1;
        }
    }

    if (pageParts.length) {
        pages.push(pageParts.join('\n'));
    }

    if (!pages.length) {
        pages.push('');
    }

    return buildPdf(pages, pageSize, fontKeyByFamily, documentTitle);
}

/**
 * Resolve a page size from a named preset or explicit width/height.
 * @param pageSize - Named page size or explicit dimensions.
 * @param orientation - Page orientation override.
 * @returns The resolved page size.
 */
function resolvePageSize(
    pageSize: PdfPageSize | undefined,
    orientation: PdfPageOrientation | undefined
): ResolvedPageSize {
    let resolvedSize: ResolvedPageSize;

    if (typeof pageSize === 'string' || pageSize == null) {
        resolvedSize = PAGE_SIZES[pageSize ?? DEFAULTS.pageSize] ?? PAGE_SIZES[DEFAULTS.pageSize];
    } else {
        resolvedSize = pageSize;
    }
    let width = resolvedSize.width;
    let height = resolvedSize.height;

    const resolvedOrientation = orientation ?? DEFAULTS.pageOrientation;

    if (resolvedOrientation === 'landscape') {
        [width, height] = [height, width];
    }

    return { width, height };
}

/**
 * Resolve margin values into a full top/right/bottom/left object.
 * @param margin - Margin input from export params.
 * @returns The resolved margin object.
 */
function resolveMargin(margin: PdfExportParams['margin']): ResolvedMargin {
    if (typeof margin === 'number') {
        return { top: margin, right: margin, bottom: margin, left: margin };
    }

    const resolvedMargin = margin ?? {};
    const fallback = DEFAULTS.margin;

    return {
        top: resolvedMargin.top ?? fallback,
        right: resolvedMargin.right ?? fallback,
        bottom: resolvedMargin.bottom ?? fallback,
        left: resolvedMargin.left ?? fallback,
    };
}

/**
 * Resolve box spacing into a full top/right/bottom/left object.
 * @param value - Spacing value or per-side overrides.
 * @param fallback - Fallback values for each side.
 * @returns The resolved spacing values.
 */
function resolveBoxSpacing(value: number | PdfMargin | undefined, fallback: ResolvedMargin): ResolvedMargin {
    if (typeof value === 'number') {
        return { top: value, right: value, bottom: value, left: value };
    }

    const resolvedValue = value ?? {};

    return {
        top: resolvedValue.top ?? fallback.top,
        right: resolvedValue.right ?? fallback.right,
        bottom: resolvedValue.bottom ?? fallback.bottom,
        left: resolvedValue.left ?? fallback.left,
    };
}

/**
 * Determine the maximum column count across all rows, including spans.
 * @param rows - Row data to inspect.
 * @returns The maximum column count found.
 */
function getMaxColumnCount(rows: PdfRow[]): number {
    let max = 0;

    rows.forEach((row) => {
        let count = 0;
        row.cells.forEach((cell) => {
            count += 1 + (cell.mergeAcross ?? 0);
        });
        max = Math.max(max, count);
    });

    return max;
}

/**
 * Calculate column widths and scale them to fit the page width.
 * Extra columns fall back to the average column width.
 * @param columnsToExport - Columns used to calculate base widths.
 * @param columnCount - Total column count, including generated columns.
 * @param availableWidth - Available width inside the page margins.
 * @returns The scaled column widths.
 */
function getColumnWidths(columnsToExport: AgColumn[], columnCount: number, availableWidth: number): number[] {
    if (!columnCount) {
        return [];
    }

    const baseWidths: number[] = [];
    const defaultWidth = columnsToExport.length
        ? columnsToExport.reduce((sum, col) => sum + col.getActualWidth(), 0) / columnsToExport.length
        : 100;

    for (let i = 0; i < columnCount; i++) {
        if (i < columnsToExport.length) {
            baseWidths.push(columnsToExport[i].getActualWidth());
        } else {
            baseWidths.push(defaultWidth);
        }
    }

    const totalWidth = baseWidths.reduce((sum, width) => sum + width, 0);

    if (!totalWidth || !availableWidth) {
        return baseWidths.map(() => availableWidth / columnCount);
    }

    const scale = availableWidth / totalWidth;
    return baseWidths.map((width) => width * scale);
}

/**
 * Map all font families used in the document to PDF font keys.
 * @param bodyFont - Font for body rows.
 * @param headerFont - Font for header rows.
 * @param titleFont - Font for the document title.
 * @param rows - Rows to inspect for custom content fonts.
 * @returns A map of font families to PDF font keys.
 */
function createFontKeyMap(
    bodyFont: PdfFontFamily,
    headerFont: PdfFontFamily,
    titleFont: PdfFontFamily | undefined,
    rows: PdfRow[]
): Map<PdfFontFamily, string> {
    const fontKeyByFamily = new Map<PdfFontFamily, string>();
    let nextIndex = 1;

    const registerFont = (font?: PdfFontFamily) => {
        if (!font || fontKeyByFamily.has(font)) {
            return;
        }
        fontKeyByFamily.set(font, `F${nextIndex}`);
        nextIndex += 1;
    };

    registerFont(bodyFont);
    registerFont(headerFont);
    registerFont(titleFont);

    rows.forEach((row) => {
        if (row.type !== 'CUSTOM') {
            return;
        }
        row.cells.forEach((cell) => {
            registerFont(cell.style?.fontFamily);
        });
    });

    return fontKeyByFamily;
}

/**
 * Collect header rows to repeat when pagination occurs.
 * @param rows - All export rows.
 * @returns Header rows to repeat on each page.
 */
function getRepeatableHeaderRows(rows: PdfRow[]): PdfRow[] {
    const headerRows: PdfRow[] = [];

    for (const row of rows) {
        if (row.type === 'BODY') {
            break;
        }
        if (row.type === 'HEADER' || row.type === 'HEADER_GROUPING') {
            headerRows.push(row);
        }
    }

    return headerRows;
}

/**
 * Row height uses explicit overrides or is derived from font size and padding.
 * @param rowType - The row type to measure.
 * @param layout - Layout options with sizing info.
 * @returns The resolved row height in points.
 */
function getRowHeight(rowType: PdfRowType, layout: LayoutOptions): number {
    if (rowType === 'HEADER' || rowType === 'HEADER_GROUPING') {
        return layout.headerRowHeight ?? layout.headerFontSize + layout.cellPadding * 2;
    }

    return layout.rowHeight ?? layout.fontSize + layout.cellPadding * 2;
}

/**
 * Calculate custom row height based on per-cell styles.
 * @param cellStyles - Resolved styles for custom row cells.
 * @param layout - Layout options with sizing info.
 * @returns The resolved row height in points.
 */
function getCustomRowHeight(cellStyles: ResolvedCellStyle[], layout: LayoutOptions): number {
    const defaultHeight = layout.rowHeight ?? layout.fontSize + layout.cellPadding * 2;
    let maxHeight = defaultHeight;

    cellStyles.forEach((cellStyle) => {
        const height = cellStyle.fontSize + cellStyle.padding.top + cellStyle.padding.bottom;
        maxHeight = Math.max(maxHeight, height);
    });

    return maxHeight;
}

/**
 * Resolve document title value and style from export params.
 * @param documentTitle - Title value or cell payload.
 * @param params - Export params for default sizing.
 * @param styleColors - Resolved colour palette.
 * @param headerFont - Font for header rows.
 * @returns The resolved title data, or undefined when no title is provided.
 */
function resolveDocumentTitle(
    documentTitle: PdfExportParams['documentTitle'],
    params: PdfExportParams,
    styleColors: PdfStyleColors,
    headerFont: PdfFontFamily
): ResolvedDocumentTitle | undefined {
    if (!documentTitle) {
        return undefined;
    }

    if (typeof documentTitle === 'string') {
        if (!documentTitle) {
            return undefined;
        }

        return {
            text: documentTitle,
            style: resolveTitleStyle(undefined, params, styleColors, headerFont),
        };
    }

    const value = documentTitle.data?.value ?? '';
    if (!value) {
        return undefined;
    }

    return {
        text: String(value),
        style: resolveTitleStyle(documentTitle.style, params, styleColors, headerFont),
    };
}

/**
 * Resolve title style into concrete layout values.
 * @param style - Title style overrides.
 * @param params - Export params for default sizing.
 * @param styleColors - Resolved colour palette.
 * @param headerFont - Font for header rows.
 * @returns The resolved title style.
 */
function resolveTitleStyle(
    style: PdfCellStyle | undefined,
    params: PdfExportParams,
    styleColors: PdfStyleColors,
    headerFont: PdfFontFamily
): ResolvedCellStyle {
    const headerFontSize = params.headerFontSize ?? DEFAULTS.headerFontSize;
    const fontSize = style?.fontSize ?? Math.max(headerFontSize + 4, 14);
    const fontFamily = style?.fontFamily ?? headerFont;
    const alignment = style?.alignment ?? DEFAULT_TITLE_ALIGNMENT;
    const padding = resolveBoxSpacing(style?.padding, DEFAULT_TITLE_PADDING);
    const margin = resolveBoxSpacing(style?.margin, DEFAULT_TITLE_MARGIN);

    const blendWith = styleColors.pageBackground ?? styleColors.dataBackground;
    const fallbackTextColor = styleColors.headerText ?? styleColors.foreground ?? { r: 0, g: 0, b: 0 };
    const textColor = resolveOptionalColor(style?.color, fallbackTextColor, blendWith) ?? fallbackTextColor;
    const backgroundColor = resolveOptionalColor(style?.backgroundColor, undefined, blendWith);
    const borderColor = resolveOptionalColor(style?.borderColor, undefined, blendWith);
    const borderWidth = style?.borderWidth ?? (borderColor ? 1 : 0);

    return {
        fontSize,
        fontFamily,
        alignment,
        padding,
        margin,
        textColor,
        backgroundColor,
        borderColor,
        borderWidth,
    };
}

/**
 * Resolve a custom cell style for table rendering.
 * @param style - Cell style overrides.
 * @param layout - Layout options for sizing.
 * @param fontFamily - Default font family.
 * @param rowStyles - Row-level fallback colours.
 * @param styleColors - Resolved colour palette.
 * @returns The resolved cell style.
 */
function resolveTableCellStyle(
    style: PdfCellStyle | undefined,
    layout: LayoutOptions,
    fontFamily: PdfFontFamily,
    rowStyles: PdfRowStyles,
    styleColors: PdfStyleColors
): ResolvedCellStyle {
    const padding = resolveBoxSpacing(style?.padding, {
        top: layout.cellPadding,
        right: layout.cellPadding,
        bottom: layout.cellPadding,
        left: layout.cellPadding,
    });
    const resolvedFontSize = style?.fontSize ?? layout.fontSize;
    const resolvedFontFamily = style?.fontFamily ?? fontFamily;
    const alignment = style?.alignment ?? DEFAULT_CELL_ALIGNMENT;

    const blendWith = rowStyles.background ?? styleColors.dataBackground ?? styleColors.pageBackground;
    const fallbackTextColor = rowStyles.text ?? styleColors.foreground ?? { r: 0, g: 0, b: 0 };
    const textColor = resolveOptionalColor(style?.color, fallbackTextColor, blendWith) ?? fallbackTextColor;
    const backgroundColor =
        resolveOptionalColor(style?.backgroundColor, rowStyles.background, blendWith) ?? rowStyles.background;
    const borderColor = resolveOptionalColor(style?.borderColor, rowStyles.border, blendWith) ?? rowStyles.border;
    const borderWidth = style?.borderWidth ?? (borderColor ? 1 : 0);

    return {
        fontSize: resolvedFontSize,
        fontFamily: resolvedFontFamily,
        alignment,
        padding,
        margin: DEFAULT_CELL_MARGIN,
        textColor,
        backgroundColor,
        borderColor,
        borderWidth,
    };
}

/**
 * Render a document title above the table and update the cursor position.
 * @param title - Title text to render.
 * @param cursorY - Current cursor Y position.
 * @param pageSize - Resolved page size.
 * @param layout - Layout options for the page.
 * @param pageParts - Output commands for the current page.
 * @param style - Resolved title style.
 * @param fontKey - PDF font key for the title.
 * @returns The updated cursor Y position.
 */
function renderDocumentTitle(
    title: string,
    cursorY: number,
    pageSize: ResolvedPageSize,
    layout: LayoutOptions,
    pageParts: string[],
    style: ResolvedCellStyle,
    fontKey: string
): number {
    const availableWidth = Math.max(pageSize.width - layout.margin.left - layout.margin.right, 0);
    if (!availableWidth) {
        return cursorY;
    }

    const boxWidth = Math.max(availableWidth - style.margin.left - style.margin.right, 0);
    if (!boxWidth) {
        return cursorY;
    }

    const innerWidth = Math.max(boxWidth - style.padding.left - style.padding.right, 0);
    const text = truncateText(title, innerWidth, style.fontSize, style.fontFamily);
    if (!text) {
        return cursorY;
    }

    const textWidth = estimateTextWidth(text, style.fontSize, style.fontFamily);
    const boxTop = cursorY - style.margin.top;
    const boxHeight = style.fontSize + style.padding.top + style.padding.bottom;
    const boxBottom = boxTop - boxHeight;
    const boxX = layout.margin.left + style.margin.left;

    if (style.backgroundColor) {
        pageParts.push(`${formatColor(style.backgroundColor)} rg`);
        pageParts.push(`${fmt(boxX)} ${fmt(boxBottom)} ${fmt(boxWidth)} ${fmt(boxHeight)} re f`);
    }

    if (style.borderColor && style.borderWidth > 0) {
        pageParts.push(`${fmt(style.borderWidth)} w`);
        pageParts.push(`${formatColor(style.borderColor)} RG`);
        pageParts.push(`${fmt(boxX)} ${fmt(boxBottom)} ${fmt(boxWidth)} ${fmt(boxHeight)} re S`);
        pageParts.push('0.5 w');
    }

    const textAreaLeft = boxX + style.padding.left;
    const textAreaWidth = Math.max(boxWidth - style.padding.left - style.padding.right, 0);
    let textX = textAreaLeft;

    if (style.alignment === 'center') {
        textX = textAreaLeft + (textAreaWidth - textWidth) / 2;
    } else if (style.alignment === 'right') {
        textX = boxX + boxWidth - style.padding.right - textWidth;
    }

    const minX = boxX + style.padding.left;
    const maxX = boxX + boxWidth - style.padding.right - textWidth;
    textX = Math.max(minX, Math.min(textX, maxX));

    const textY = boxTop - style.padding.top - style.fontSize;

    pageParts.push(`${formatColor(style.textColor)} rg`);
    pageParts.push('BT');
    pageParts.push(`/${fontKey} ${fmt(style.fontSize)} Tf`);
    pageParts.push(`1 0 0 1 ${fmt(textX)} ${fmt(textY)} Tm (${escapePdfString(text)}) Tj`);
    pageParts.push('ET');

    return boxBottom - style.margin.bottom;
}

/**
 * Render multiple rows, tracking body row index for striping.
 * @param rows - Rows to render.
 * @param startY - Starting cursor Y position.
 * @param layout - Layout options for rendering.
 * @param pageParts - Output commands for the current page.
 * @param bodyFont - Font for body rows.
 * @param headerFont - Font for header rows.
 * @param styleColors - Resolved colour palette.
 * @param fontKeyByFamily - Font resource keys for each font family.
 * @returns The updated cursor Y position after rendering.
 */
function renderRows(
    rows: PdfRow[],
    startY: number,
    layout: LayoutOptions,
    pageParts: string[],
    bodyFont: PdfFontFamily,
    headerFont: PdfFontFamily,
    styleColors: PdfStyleColors,
    fontKeyByFamily: Map<PdfFontFamily, string>
): number {
    let cursorY = startY;
    let bodyRowIndex = 0;

    rows.forEach((row) => {
        cursorY = renderRow(
            row,
            cursorY,
            layout,
            pageParts,
            bodyFont,
            headerFont,
            styleColors,
            bodyRowIndex,
            fontKeyByFamily
        );
        if (row.type === 'BODY') {
            bodyRowIndex += 1;
        }
    });

    return cursorY;
}

type LayoutOptions = {
    columnCount: number;
    columnWidths: number[];
    margin: ResolvedMargin;
    drawCellBorders: boolean;
    fontSize: number;
    headerFontSize: number;
    cellPadding: number;
    rowHeight?: number;
    headerRowHeight?: number;
};

type ResolvedCellStyle = {
    fontSize: number;
    fontFamily: PdfFontFamily;
    alignment: PdfTextAlignment;
    padding: ResolvedMargin;
    margin: ResolvedMargin;
    textColor: PdfRgb;
    backgroundColor?: PdfRgb;
    borderColor?: PdfRgb;
    borderWidth: number;
};

type ResolvedDocumentTitle = {
    text: string;
    style: ResolvedCellStyle;
};

function renderRow(
    row: PdfRow,
    cursorY: number,
    layout: LayoutOptions,
    pageParts: string[],
    bodyFont: PdfFontFamily,
    headerFont: PdfFontFamily,
    styleColors: PdfStyleColors,
    bodyRowIndex: number,
    fontKeyByFamily: Map<PdfFontFamily, string>
): number {
    const { columnCount, columnWidths, margin, drawCellBorders, fontSize, headerFontSize, cellPadding } = layout;
    const isHeader = row.type === 'HEADER' || row.type === 'HEADER_GROUPING';
    const isCustom = row.type === 'CUSTOM';
    const appliedFontSize = isHeader ? headerFontSize : fontSize;
    const fontFamily = isHeader ? headerFont : bodyFont;
    const fontKey = fontKeyByFamily.get(fontFamily) ?? 'F1';
    const rowStyles = getRowStyles(row.type, styleColors, bodyRowIndex);
    const cellStyles = isCustom
        ? row.cells.map((cell) => resolveTableCellStyle(cell.style, layout, fontFamily, rowStyles, styleColors))
        : [];
    const rowHeight = isCustom ? getCustomRowHeight(cellStyles, layout) : getRowHeight(row.type, layout);

    const rowTop = cursorY;
    const rowBottom = cursorY - rowHeight;
    const textY = rowTop - cellPadding - appliedFontSize;

    let colIndex = 0;
    let x = margin.left;
    const textParts: string[] = [];

    if (!isCustom) {
        if (rowStyles.background) {
            // "rg" sets the fill colour for subsequent drawing.
            pageParts.push(`${formatColor(rowStyles.background)} rg`);
        }
        if (drawCellBorders && rowStyles.border) {
            // "RG" sets the stroke colour for subsequent paths.
            pageParts.push(`${formatColor(rowStyles.border)} RG`);
        }

        row.cells.forEach((cell) => {
            const span = cell.mergeAcross ?? 0;
            const cellWidth = getSpanWidth(columnWidths, colIndex, span + 1);
            const text = truncateText(
                normaliseText(cell.value),
                cellWidth - cellPadding * 2,
                appliedFontSize,
                fontFamily
            );

            if (rowStyles.background) {
                // "re f" draws and fills a rectangle.
                pageParts.push(`${fmt(x)} ${fmt(rowBottom)} ${fmt(cellWidth)} ${fmt(rowHeight)} re f`);
            }
            if (drawCellBorders) {
                // "re S" draws and strokes a rectangle.
                pageParts.push(`${fmt(x)} ${fmt(rowBottom)} ${fmt(cellWidth)} ${fmt(rowHeight)} re S`);
            }

            if (text) {
                // "Tm" positions text, "Tj" draws a text string.
                textParts.push(`1 0 0 1 ${fmt(x + cellPadding)} ${fmt(textY)} Tm (${escapePdfString(text)}) Tj`);
            }

            x += cellWidth;
            colIndex += span + 1;
        });

        if (colIndex < columnCount) {
            for (let i = colIndex; i < columnCount; i++) {
                const cellWidth = columnWidths[i];
                if (rowStyles.background) {
                    pageParts.push(`${fmt(x)} ${fmt(rowBottom)} ${fmt(cellWidth)} ${fmt(rowHeight)} re f`);
                }
                if (drawCellBorders) {
                    pageParts.push(`${fmt(x)} ${fmt(rowBottom)} ${fmt(cellWidth)} ${fmt(rowHeight)} re S`);
                }
                x += cellWidth;
            }
        }

        if (textParts.length) {
            if (rowStyles.text) {
                // set text fill colour.
                pageParts.push(`${formatColor(rowStyles.text)} rg`);
            }
            // text blocks must be wrapped in BT/ET.
            pageParts.push('BT');
            pageParts.push(`/${fontKey} ${fmt(appliedFontSize)} Tf`);
            pageParts.push(...textParts);
            pageParts.push('ET');
        }

        return rowBottom;
    }

    let currentLineWidth = 0.5;
    row.cells.forEach((cell, cellIndex) => {
        const span = cell.mergeAcross ?? 0;
        const cellWidth = getSpanWidth(columnWidths, colIndex, span + 1);
        const cellStyle = cellStyles[cellIndex];
        const padding = cellStyle.padding;
        const textWidthAvailable = cellWidth - padding.left - padding.right;
        const text = truncateText(
            normaliseText(cell.value),
            textWidthAvailable,
            cellStyle.fontSize,
            cellStyle.fontFamily
        );

        if (cellStyle.backgroundColor) {
            pageParts.push(`${formatColor(cellStyle.backgroundColor)} rg`);
            pageParts.push(`${fmt(x)} ${fmt(rowBottom)} ${fmt(cellWidth)} ${fmt(rowHeight)} re f`);
        }

        if (drawCellBorders && cellStyle.borderColor && cellStyle.borderWidth > 0) {
            if (cellStyle.borderWidth !== currentLineWidth) {
                pageParts.push(`${fmt(cellStyle.borderWidth)} w`);
                currentLineWidth = cellStyle.borderWidth;
            }
            pageParts.push(`${formatColor(cellStyle.borderColor)} RG`);
            pageParts.push(`${fmt(x)} ${fmt(rowBottom)} ${fmt(cellWidth)} ${fmt(rowHeight)} re S`);
        }

        if (text) {
            const textWidth = estimateTextWidth(text, cellStyle.fontSize, cellStyle.fontFamily);
            const textAreaLeft = x + padding.left;
            const textAreaWidth = Math.max(cellWidth - padding.left - padding.right, 0);
            let textX = textAreaLeft;

            if (cellStyle.alignment === 'center') {
                textX = textAreaLeft + (textAreaWidth - textWidth) / 2;
            } else if (cellStyle.alignment === 'right') {
                textX = x + cellWidth - padding.right - textWidth;
            }

            const minX = x + padding.left;
            const maxX = x + cellWidth - padding.right - textWidth;
            textX = Math.max(minX, Math.min(textX, maxX));

            const textY = rowTop - padding.top - cellStyle.fontSize;
            const cellFontKey = fontKeyByFamily.get(cellStyle.fontFamily) ?? fontKey;

            textParts.push('BT');
            textParts.push(`${formatColor(cellStyle.textColor)} rg`);
            textParts.push(`/${cellFontKey} ${fmt(cellStyle.fontSize)} Tf`);
            textParts.push(`1 0 0 1 ${fmt(textX)} ${fmt(textY)} Tm (${escapePdfString(text)}) Tj`);
            textParts.push('ET');
        }

        x += cellWidth;
        colIndex += span + 1;
    });

    if (currentLineWidth !== 0.5) {
        pageParts.push('0.5 w');
    }

    if (colIndex < columnCount) {
        for (let i = colIndex; i < columnCount; i++) {
            const cellWidth = columnWidths[i];
            if (rowStyles.background) {
                pageParts.push(`${formatColor(rowStyles.background)} rg`);
                pageParts.push(`${fmt(x)} ${fmt(rowBottom)} ${fmt(cellWidth)} ${fmt(rowHeight)} re f`);
            }
            if (drawCellBorders && rowStyles.border) {
                pageParts.push(`${formatColor(rowStyles.border)} RG`);
                pageParts.push(`${fmt(x)} ${fmt(rowBottom)} ${fmt(cellWidth)} ${fmt(rowHeight)} re S`);
            }
            x += cellWidth;
        }
    }

    if (textParts.length) {
        pageParts.push(...textParts);
    }

    return rowBottom;
}

/**
 * Sum a set of column widths for a span.
 * @param widths - Column widths.
 * @param startIndex - Start column index.
 * @param span - Number of columns in the span.
 * @returns The total span width.
 */
function getSpanWidth(widths: number[], startIndex: number, span: number): number {
    let width = 0;

    for (let i = 0; i < span; i++) {
        width += widths[startIndex + i] ?? 0;
    }

    return width;
}

const WIN_ANSI_CODEPOINT_MAP = new Map<number, number>([
    [0x20ac, 0x80],
    [0x201a, 0x82],
    [0x0192, 0x83],
    [0x201e, 0x84],
    [0x2026, 0x85],
    [0x2020, 0x86],
    [0x2021, 0x87],
    [0x02c6, 0x88],
    [0x2030, 0x89],
    [0x0160, 0x8a],
    [0x2039, 0x8b],
    [0x0152, 0x8c],
    [0x017d, 0x8e],
    [0x2018, 0x91],
    [0x2019, 0x92],
    [0x201c, 0x93],
    [0x201d, 0x94],
    [0x2022, 0x95],
    [0x2013, 0x96],
    [0x2014, 0x97],
    [0x02dc, 0x98],
    [0x2122, 0x99],
    [0x0161, 0x9a],
    [0x203a, 0x9b],
    [0x0153, 0x9c],
    [0x017e, 0x9e],
    [0x0178, 0x9f],
]);

/**
 * Normalise line breaks and constrain text to WinAnsi-compatible characters.
 * @param value - Text value to clean.
 * @returns The normalised text.
 */
function normaliseText(value: string): string {
    const trimmed = value.replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ');
    let output = '';

    for (const char of trimmed) {
        const codePoint = char.codePointAt(0) ?? 0;
        if (
            (codePoint >= 0x20 && codePoint <= 0x7e) ||
            (codePoint >= 0xa0 && codePoint <= 0xff) ||
            WIN_ANSI_CODEPOINT_MAP.has(codePoint)
        ) {
            output += char;
        } else {
            output += '?';
        }
    }

    return output;
}

/**
 * Estimate the width of a single character for built-in fonts.
 * @param fontSize - Font size in points.
 * @param fontFamily - Font family name.
 * @returns The approximate character width.
 */
function getApproxCharWidth(fontSize: number, fontFamily: PdfFontFamily): number {
    return fontFamily.includes('Courier') ? fontSize * 0.6 : fontSize * 0.5;
}

/**
 * Estimate the width of a string using the built-in font approximation.
 * @param text - Text to measure.
 * @param fontSize - Font size in points.
 * @param fontFamily - Font family name.
 * @returns The estimated width in points.
 */
function estimateTextWidth(text: string, fontSize: number, fontFamily: PdfFontFamily): number {
    return text.length * getApproxCharWidth(fontSize, fontFamily);
}

/**
 * Trim text to fit an approximate width.
 * The approximation avoids font metrics for a dependency-free export.
 * @param text - Text to truncate.
 * @param maxWidth - Maximum allowed width in points.
 * @param fontSize - Font size in points.
 * @param fontFamily - Font family name.
 * @returns The truncated text.
 */
function truncateText(text: string, maxWidth: number, fontSize: number, fontFamily: PdfFontFamily): string {
    if (!text) {
        return '';
    }

    const charWidth = getApproxCharWidth(fontSize, fontFamily);
    const maxChars = Math.floor(maxWidth / charWidth);

    if (maxChars <= 0) {
        return '';
    }

    if (text.length <= maxChars) {
        return text;
    }

    if (maxChars <= 3) {
        return text.slice(0, maxChars);
    }

    return `${text.slice(0, maxChars - 3)}...`;
}

/**
 * Encode to WinAnsi bytes and escape characters for PDF string literals.
 * @param value - String value to encode.
 * @returns The encoded string.
 */
function escapePdfString(value: string): string {
    let output = '';

    for (const char of value) {
        const codePoint = char.codePointAt(0) ?? 0;
        let byte: number;

        if (codePoint >= 0x20 && codePoint <= 0x7e) {
            byte = codePoint;
        } else if (codePoint >= 0xa0 && codePoint <= 0xff) {
            byte = codePoint;
        } else {
            byte = WIN_ANSI_CODEPOINT_MAP.get(codePoint) ?? 0x3f;
        }

        if (byte === 0x28) {
            output += '\\(';
        } else if (byte === 0x29) {
            output += '\\)';
        } else if (byte === 0x5c) {
            output += '\\\\';
        } else if (byte >= 0x20 && byte <= 0x7e) {
            output += String.fromCharCode(byte);
        } else {
            output += `\\${byte.toString(8).padStart(3, '0')}`;
        }
    }

    return output;
}

/**
 * Format numbers with a small fixed precision for compact PDF output.
 * @param value - Numeric value to format.
 * @returns The formatted number string.
 */
function fmt(value: number): string {
    if (Number.isInteger(value)) {
        return value.toString();
    }

    return value.toFixed(2);
}

/**
 * Build the PDF object tree for pages, fonts, and metadata.
 * Returns a complete PDF file as a string.
 * @param pages - Page content streams.
 * @param pageSize - Resolved page size in points.
 * @param fontKeyByFamily - Font resource keys for each font family.
 * @param documentTitle - Optional document title metadata.
 * @returns The complete PDF document as a string.
 */
function buildPdf(
    pages: string[],
    pageSize: ResolvedPageSize,
    fontKeyByFamily: Map<PdfFontFamily, string>,
    documentTitle?: string
): string {
    const store = new PdfObjectStore();
    const fontResourcesParts: string[] = [];
    fontKeyByFamily.forEach((fontKey, fontFamily) => {
        const fontId = store.add(
            `<< /Type /Font /Subtype /Type1 /BaseFont /${fontFamily} /Encoding /WinAnsiEncoding >>`
        );
        fontResourcesParts.push(`/${fontKey} ${fontId} 0 R`);
    });
    const pagesId = store.reserve();

    const pageIds: number[] = [];
    const fontResources = `<< ${fontResourcesParts.join(' ')} >>`;

    pages.forEach((content) => {
        // Each page has a single content stream with the drawing commands.
        const contentStream = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
        const contentId = store.add(contentStream);
        // MediaBox uses PDF points with the origin at the bottom-left.
        const pageObject = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${fmt(pageSize.width)} ${fmt(pageSize.height)}] /Resources << /Font ${fontResources} >> /Contents ${contentId} 0 R >>`;
        const pageId = store.add(pageObject);
        pageIds.push(pageId);
    });

    store.set(
        pagesId,
        `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
    );
    const catalogId = store.add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

    const resolvedTitle = documentTitle ? normaliseText(documentTitle) : '';
    const infoId = resolvedTitle?.trim().length
        ? store.add(`<< /Title (${escapePdfString(resolvedTitle)}) >>`)
        : undefined;

    return store.build(catalogId, infoId);
}

/**
 * RGB colour channels stored as 0..255 integers.
 */
type PdfRgb = { r: number; g: number; b: number };

/**
 * RGBA colour channels with alpha in 0..1 range.
 */
type PdfRgba = PdfRgb & { a: number };

type PdfStyleColors = {
    pageBackground?: PdfRgb;
    dataBackground?: PdfRgb;
    oddRowBackground?: PdfRgb;
    headerBackground?: PdfRgb;
    border?: PdfRgb;
    foreground?: PdfRgb;
    headerText?: PdfRgb;
};

/**
 * Resolved styles applied to a single row.
 */
type PdfRowStyles = {
    background?: PdfRgb;
    border?: PdfRgb;
    text?: PdfRgb;
};

/**
 * Resolve the user styles into RGB values with sensible fallbacks.
 * @param styles - User-supplied style overrides.
 * @returns The resolved colour palette.
 */
function resolvePdfStyleColors(styles?: PdfExportStyles): PdfStyleColors {
    const resolvedStyles = { ...DEFAULT_PDF_STYLES, ...(styles ?? {}) };

    const pageBackground = resolveColor(resolvedStyles.backgroundColor, DEFAULT_PDF_STYLES.backgroundColor);
    const dataBackground = resolveColor(
        resolvedStyles.dataBackgroundColor,
        resolvedStyles.backgroundColor || DEFAULT_PDF_STYLES.dataBackgroundColor
    );
    const oddRowBackground = resolveColor(
        resolvedStyles.oddRowBackgroundColor,
        resolvedStyles.dataBackgroundColor || DEFAULT_PDF_STYLES.oddRowBackgroundColor
    );
    const headerBackground = resolveColor(
        resolvedStyles.headerBackgroundColor,
        resolvedStyles.backgroundColor || DEFAULT_PDF_STYLES.headerBackgroundColor
    );
    const border = resolveColor(
        resolvedStyles.borderColor,
        DEFAULT_PDF_STYLES.borderColor,
        pageBackground ?? dataBackground
    );
    const foreground = resolveColor(
        resolvedStyles.foregroundColor,
        DEFAULT_PDF_STYLES.foregroundColor,
        dataBackground ?? pageBackground
    );
    const headerText = resolveColor(
        resolvedStyles.headerTextColor,
        DEFAULT_PDF_STYLES.headerTextColor,
        headerBackground ?? pageBackground
    );
    return {
        pageBackground,
        dataBackground,
        oddRowBackground,
        headerBackground,
        border,
        foreground,
        headerText,
    };
}

/**
 * Choose colours for a specific row type and striping index.
 * @param rowType - Row type.
 * @param styles - Resolved style colours.
 * @param bodyRowIndex - Index of the body row for striping.
 * @returns The resolved row styles.
 */
function getRowStyles(rowType: PdfRowType, styles: PdfStyleColors, bodyRowIndex: number): PdfRowStyles {
    if (rowType === 'HEADER' || rowType === 'HEADER_GROUPING') {
        return {
            background: styles.headerBackground,
            border: styles.border,
            text: styles.headerText ?? styles.foreground,
        };
    }

    if (rowType === 'CUSTOM') {
        return {
            background: styles.dataBackground,
            border: styles.border,
            text: styles.foreground,
        };
    }

    if (rowType === 'BODY') {
        return {
            background:
                bodyRowIndex % 2 === 1 ? styles.oddRowBackground ?? styles.dataBackground : styles.dataBackground,
            border: styles.border,
            text: styles.foreground,
        };
    }

    return {
        background: styles.dataBackground,
        border: styles.border,
        text: styles.foreground,
    };
}

/**
 * Resolve an optional colour string with a fallback value.
 * @param value - CSS colour string to resolve.
 * @param fallback - Fallback colour to use when parsing fails.
 * @param blendWith - Background colour used for alpha blending.
 * @returns The resolved colour, or the fallback.
 */
function resolveOptionalColor(
    value: string | undefined,
    fallback: PdfRgb | undefined,
    blendWith?: PdfRgb
): PdfRgb | undefined {
    if (!value) {
        return fallback;
    }

    const parsed = parseColor(value);
    if (parsed === null) {
        return undefined;
    }
    if (!parsed) {
        return fallback;
    }

    return blendWith && parsed.a < 1 ? blendColors(parsed, blendWith) : stripAlpha(parsed);
}

/**
 * Resolve a colour string and optionally blend with a background.
 * @param value - CSS colour string to resolve.
 * @param fallback - Fallback CSS colour.
 * @param blendWith - Background colour used for alpha blending.
 * @returns The resolved colour or undefined when parsing fails.
 */
function resolveColor(value: string | undefined, fallback: string, blendWith?: PdfRgb): PdfRgb | undefined {
    if (value) {
        const parsed = parseColor(value);
        if (parsed === null) {
            return undefined;
        }
        if (parsed) {
            return blendWith && parsed.a < 1 ? blendColors(parsed, blendWith) : stripAlpha(parsed);
        }
    }

    const parsedFallback = parseColor(fallback);
    if (!parsedFallback || parsedFallback === null) {
        return undefined;
    }

    return blendWith && parsedFallback.a < 1 ? blendColors(parsedFallback, blendWith) : stripAlpha(parsedFallback);
}

/**
 * Parse a CSS colour string into RGBA.
 * Supports hex, rgb(a), hsl(a), and 'transparent'.
 * @param value - CSS colour string to parse.
 * @returns Parsed colour, null for transparent, or undefined if invalid.
 */
function parseColor(value: string): PdfRgba | null | undefined {
    const normalised = value.trim().toLowerCase();
    if (!normalised || normalised === 'transparent' || normalised === 'none') {
        return null;
    }

    if (normalised.startsWith('#')) {
        const hex = normalised.slice(1);
        if (hex.length === 3 || hex.length === 4) {
            const r = Number.parseInt(hex[0] + hex[0], 16);
            const g = Number.parseInt(hex[1] + hex[1], 16);
            const b = Number.parseInt(hex[2] + hex[2], 16);
            const a = hex.length === 4 ? Number.parseInt(hex[3] + hex[3], 16) / 255 : 1;
            return { r, g, b, a };
        }
        if (hex.length === 6 || hex.length === 8) {
            const r = Number.parseInt(hex.slice(0, 2), 16);
            const g = Number.parseInt(hex.slice(2, 4), 16);
            const b = Number.parseInt(hex.slice(4, 6), 16);
            const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
            return { r, g, b, a };
        }
        return undefined;
    }

    const rgbMatch = normalised.match(/^rgba?\((.+)\)$/);
    if (rgbMatch) {
        const parts = rgbMatch[1].split(',').map((part) => part.trim());
        if (parts.length < 3) {
            return undefined;
        }
        const [r, g, b] = parts.slice(0, 3).map(parseRgbChannel);
        if (r == null || g == null || b == null) {
            return undefined;
        }
        const a = parts.length > 3 ? parseAlpha(parts[3]) : 1;
        return { r, g, b, a: a ?? 1 };
    }

    const hslMatch = normalised.match(/^hsla?\((.+)\)$/);
    if (hslMatch) {
        const parts = hslMatch[1].split(',').map((part) => part.trim());
        if (parts.length < 3) {
            return undefined;
        }
        const h = parseFloat(parts[0]);
        const s = parsePercent(parts[1]);
        const l = parsePercent(parts[2]);
        if (!isFinite(h) || s == null || l == null) {
            return undefined;
        }
        const rgb = hslToRgb(h, s, l);
        const a = parts.length > 3 ? parseAlpha(parts[3]) : 1;
        return { ...rgb, a: a ?? 1 };
    }

    return undefined;
}

/**
 * Parse a single RGB channel, supporting percentages.
 * @param value - Channel value from CSS.
 * @returns Parsed channel value, or null if invalid.
 */
function parseRgbChannel(value: string): number | null {
    if (value.endsWith('%')) {
        const percent = parseFloat(value);
        if (!isFinite(percent)) {
            return null;
        }
        return clampChannel(Math.round((percent / 100) * 255));
    }
    const numeric = parseFloat(value);
    if (!isFinite(numeric)) {
        return null;
    }
    return clampChannel(Math.round(numeric));
}

/**
 * Parse a CSS alpha channel value into 0..1.
 * @param value - Alpha value from CSS.
 * @returns Parsed alpha value, or null if invalid.
 */
function parseAlpha(value: string): number | null {
    const numeric = parseFloat(value);
    if (!isFinite(numeric)) {
        return null;
    }
    return Math.max(0, Math.min(1, numeric));
}

/**
 * Parse a percentage value into 0..1.
 * @param value - Percentage string.
 * @returns Parsed percentage, or null if invalid.
 */
function parsePercent(value: string): number | null {
    if (!value.endsWith('%')) {
        return null;
    }
    const numeric = parseFloat(value);
    if (!isFinite(numeric)) {
        return null;
    }
    return Math.max(0, Math.min(100, numeric)) / 100;
}

/**
 * Convert HSL to RGB using the standard CSS algorithm.
 * @param hue - Hue component in degrees.
 * @param saturation - Saturation component in 0..1 range.
 * @param lightness - Lightness component in 0..1 range.
 * @returns The corresponding RGB colour.
 */
function hslToRgb(hue: number, saturation: number, lightness: number): PdfRgb {
    const h = ((hue % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = lightness - c / 2;

    let r = 0;
    let g = 0;
    let b = 0;

    if (h < 60) {
        r = c;
        g = x;
    } else if (h < 120) {
        r = x;
        g = c;
    } else if (h < 180) {
        g = c;
        b = x;
    } else if (h < 240) {
        g = x;
        b = c;
    } else if (h < 300) {
        r = x;
        b = c;
    } else {
        r = c;
        b = x;
    }

    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255),
    };
}

/**
 * Clamp colour channels to the 0..255 range.
 * @param value - Channel value.
 * @returns Clamped channel value.
 */
function clampChannel(value: number): number {
    return Math.min(255, Math.max(0, value));
}

/**
 * Drop the alpha channel once blending has been applied.
 * @param color - RGBA colour with alpha.
 * @returns RGB colour without alpha.
 */
function stripAlpha(color: PdfRgba): PdfRgb {
    return { r: color.r, g: color.g, b: color.b };
}

/**
 * Blend a semi-transparent colour over an opaque background.
 * @param foreground - Foreground colour with alpha.
 * @param background - Background colour.
 * @returns The blended colour.
 */
function blendColors(foreground: PdfRgba, background: PdfRgb): PdfRgb {
    const alpha = Math.max(0, Math.min(1, foreground.a));
    return {
        r: Math.round(foreground.r * alpha + background.r * (1 - alpha)),
        g: Math.round(foreground.g * alpha + background.g * (1 - alpha)),
        b: Math.round(foreground.b * alpha + background.b * (1 - alpha)),
    };
}

/**
 * Format an RGB colour as PDF colour operands in 0..1 range.
 * @param color - RGB colour to format.
 * @returns The PDF colour operands string.
 */
function formatColor(color: PdfRgb): string {
    return `${formatChannel(color.r)} ${formatChannel(color.g)} ${formatChannel(color.b)}`;
}

/**
 * Format an RGB channel into PDF colour space (0..1).
 * @param value - Channel value in 0..255 range.
 * @returns The formatted channel string.
 */
function formatChannel(value: number): string {
    const channel = Math.max(0, Math.min(1, value / 255));
    return channel.toFixed(3);
}
