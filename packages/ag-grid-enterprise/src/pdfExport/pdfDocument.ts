import type { AgColumn, PdfExportParams, PdfFontFamily, PdfPageOrientation, PdfPageSize } from 'ag-grid-community';

import type { PdfRow, PdfRowType } from './pdfSerializingSession';

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

type ResolvedMargin = { top: number; right: number; bottom: number; left: number };

type ResolvedPageSize = { width: number; height: number };

class PdfObjectStore {
    private readonly objects: string[] = [];

    public reserve(): number {
        this.objects.push('');
        return this.objects.length;
    }

    public add(content: string): number {
        this.objects.push(content);
        return this.objects.length;
    }

    public set(id: number, content: string): void {
        this.objects[id - 1] = content;
    }

    public build(rootId: number): string {
        let body = '%PDF-1.4\n';
        const offsets: number[] = [0];

        this.objects.forEach((object, index) => {
            offsets[index + 1] = body.length;
            body += `${index + 1} 0 obj\n${object}\nendobj\n`;
        });

        const xrefOffset = body.length;
        body += `xref\n0 ${this.objects.length + 1}\n`;
        body += '0000000000 65535 f \n';

        for (let i = 1; i <= this.objects.length; i++) {
            body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
        }

        body += `trailer\n<< /Size ${this.objects.length + 1} /Root ${rootId} 0 R >>\n`;
        body += `startxref\n${xrefOffset}\n%%EOF`;

        return body;
    }
}

export function createPdfDocument(rows: PdfRow[], columnsToExport: AgColumn[], params: PdfExportParams): string {
    const pageSize = resolvePageSize(params.pageSize, params.pageOrientation);
    const margin = resolveMargin(params.margin);

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

    const startPage = (includeHeaders: boolean) => {
        if (pageParts.length) {
            pages.push(pageParts.join('\n'));
        }
        pageParts = ['0 0 0 RG', '0 0 0 rg', '0.5 w'];
        cursorY = pageSize.height - margin.top;

        if (includeHeaders && headerRows.length) {
            cursorY = renderRows(headerRows, cursorY, layout, pageParts, bodyFont, headerFont);
        }
    };

    startPage(false);

    for (const row of rows) {
        const rowHeight = getRowHeight(row.type, layout);

        if (cursorY - rowHeight < margin.bottom) {
            startPage(repeatHeader);
        }

        cursorY = renderRow(row, cursorY, layout, pageParts, bodyFont, headerFont);
    }

    if (pageParts.length) {
        pages.push(pageParts.join('\n'));
    }

    if (!pages.length) {
        pages.push('');
    }

    return buildPdf(pages, pageSize, bodyFont, headerFont);
}

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

function getRowHeight(rowType: PdfRowType, layout: LayoutOptions): number {
    if (rowType === 'HEADER' || rowType === 'HEADER_GROUPING') {
        return layout.headerRowHeight ?? layout.headerFontSize + layout.cellPadding * 2;
    }

    return layout.rowHeight ?? layout.fontSize + layout.cellPadding * 2;
}

function renderRows(
    rows: PdfRow[],
    startY: number,
    layout: LayoutOptions,
    pageParts: string[],
    bodyFont: PdfFontFamily,
    headerFont: PdfFontFamily
): number {
    let cursorY = startY;

    rows.forEach((row) => {
        cursorY = renderRow(row, cursorY, layout, pageParts, bodyFont, headerFont);
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

function renderRow(
    row: PdfRow,
    cursorY: number,
    layout: LayoutOptions,
    pageParts: string[],
    bodyFont: PdfFontFamily,
    headerFont: PdfFontFamily
): number {
    const { columnCount, columnWidths, margin, drawCellBorders, fontSize, headerFontSize, cellPadding } = layout;
    const isHeader = row.type === 'HEADER' || row.type === 'HEADER_GROUPING';
    const appliedFontSize = isHeader ? headerFontSize : fontSize;
    const rowHeight = getRowHeight(row.type, layout);
    const fontKey = isHeader ? 'F2' : 'F1';
    const fontFamily = isHeader ? headerFont : bodyFont;

    const rowTop = cursorY;
    const rowBottom = cursorY - rowHeight;
    const textY = rowTop - cellPadding - appliedFontSize;

    let colIndex = 0;
    let x = margin.left;
    const textParts: string[] = [];

    row.cells.forEach((cell) => {
        const span = cell.mergeAcross ?? 0;
        const cellWidth = getSpanWidth(columnWidths, colIndex, span + 1);
        const text = truncateText(normaliseText(cell.value), cellWidth - cellPadding * 2, appliedFontSize, fontFamily);

        if (drawCellBorders) {
            pageParts.push(`${fmt(x)} ${fmt(rowBottom)} ${fmt(cellWidth)} ${fmt(rowHeight)} re S`);
        }

        if (text) {
            textParts.push(`1 0 0 1 ${fmt(x + cellPadding)} ${fmt(textY)} Tm (${escapePdfString(text)}) Tj`);
        }

        x += cellWidth;
        colIndex += span + 1;
    });

    if (colIndex < columnCount) {
        for (let i = colIndex; i < columnCount; i++) {
            const cellWidth = columnWidths[i];
            if (drawCellBorders) {
                pageParts.push(`${fmt(x)} ${fmt(rowBottom)} ${fmt(cellWidth)} ${fmt(rowHeight)} re S`);
            }
            x += cellWidth;
        }
    }

    if (textParts.length) {
        pageParts.push('BT');
        pageParts.push(`/${fontKey} ${fmt(appliedFontSize)} Tf`);
        pageParts.push(...textParts);
        pageParts.push('ET');
    }

    return rowBottom;
}

function getSpanWidth(widths: number[], startIndex: number, span: number): number {
    let width = 0;

    for (let i = 0; i < span; i++) {
        width += widths[startIndex + i] ?? 0;
    }

    return width;
}

function normaliseText(value: string): string {
    const trimmed = value.replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ');
    return trimmed.replace(/[^\x20-\x7E]/g, '?');
}

function truncateText(text: string, maxWidth: number, fontSize: number, fontFamily: PdfFontFamily): string {
    if (!text) {
        return '';
    }

    const charWidth = fontFamily.includes('Courier') ? fontSize * 0.6 : fontSize * 0.5;
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

function escapePdfString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function fmt(value: number): string {
    if (Number.isInteger(value)) {
        return value.toString();
    }

    return value.toFixed(2);
}

function buildPdf(
    pages: string[],
    pageSize: ResolvedPageSize,
    bodyFont: PdfFontFamily,
    headerFont: PdfFontFamily
): string {
    const store = new PdfObjectStore();
    const bodyFontId = store.add(`<< /Type /Font /Subtype /Type1 /BaseFont /${bodyFont} >>`);
    const headerFontId =
        headerFont === bodyFont ? bodyFontId : store.add(`<< /Type /Font /Subtype /Type1 /BaseFont /${headerFont} >>`);
    const pagesId = store.reserve();

    const pageIds: number[] = [];
    const fontResources = `<< /F1 ${bodyFontId} 0 R /F2 ${headerFontId} 0 R >>`;

    pages.forEach((content) => {
        const contentStream = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
        const contentId = store.add(contentStream);
        const pageObject = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${fmt(pageSize.width)} ${fmt(pageSize.height)}] /Resources << /Font ${fontResources} >> /Contents ${contentId} 0 R >>`;
        const pageId = store.add(pageObject);
        pageIds.push(pageId);
    });

    store.set(
        pagesId,
        `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
    );
    const catalogId = store.add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

    return store.build(catalogId);
}
