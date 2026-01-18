import type { ExportFileNameGetter, ExportParams } from './exportParams';

export type PdfPageOrientation = 'portrait' | 'landscape';

export type PdfFontFamily = 'Helvetica' | 'Helvetica-Bold' | 'Times-Roman' | 'Times-Bold' | 'Courier' | 'Courier-Bold';

export type PdfPageSize =
    | 'A4'
    | 'Letter'
    | {
          /** Page width in points. */
          width: number;
          /** Page height in points. */
          height: number;
      };

export interface PdfMargin {
    /** Top margin in points. */
    top?: number;
    /** Right margin in points. */
    right?: number;
    /** Bottom margin in points. */
    bottom?: number;
    /** Left margin in points. */
    left?: number;
}

export type PdfTextAlignment = 'left' | 'center' | 'right';

export interface PdfCellStyle {
    /**
     * Font size in points.
     */
    fontSize?: number;
    /**
     * Font family.
     */
    fontFamily?: PdfFontFamily;
    /**
     * Text colour.
     */
    color?: string;
    /**
     * Background colour.
     */
    backgroundColor?: string;
    /**
     * Border colour.
     */
    borderColor?: string;
    /**
     * Border width in points.
     * Defaults to 1 when `borderColor` is set, otherwise 0.
     */
    borderWidth?: number;
    /**
     * Padding inside the cell in points. A number applies to all sides.
     */
    padding?: number | PdfMargin;
    /**
     * Margin around the cell in points. A number applies to all sides.
     * Only applies to the document title.
     */
    margin?: number | PdfMargin;
    /**
     * Horizontal alignment for the cell text.
     */
    alignment?: PdfTextAlignment;
}

export interface PdfCellData {
    /** The value of the cell. */
    value: string | null;
}

export interface PdfCell {
    /** The data that will be added to the cell. */
    data: PdfCellData;
    /**
     * The number of cells to span across (1 means span 2 columns).
     * @default 0
     */
    mergeAcross?: number;
    /**
     * Optional styling for the cell.
     */
    style?: PdfCellStyle;
}

export type PdfCustomContent = PdfCell[][] | string;

export interface PdfExportStyles {
    /** CSS colour strings that map to theme colour keys. */
    /**
     * Background colour for the PDF page.
     * Defaults to the theme `backgroundColor`.
     */
    backgroundColor?: string;
    /**
     * Background colour for body rows.
     * Defaults to the theme `dataBackgroundColor`.
     */
    dataBackgroundColor?: string;
    /**
     * Alternate background colour for odd body rows.
     * Defaults to the theme `oddRowBackgroundColor`.
     */
    oddRowBackgroundColor?: string;
    /**
     * Text colour for body rows.
     * Defaults to the theme `foregroundColor`.
     */
    foregroundColor?: string;
    /**
     * Background colour for header rows.
     * Defaults to the theme `headerBackgroundColor`.
     */
    headerBackgroundColor?: string;
    /**
     * Text colour for header rows.
     * Defaults to the theme `headerTextColor`.
     */
    headerTextColor?: string;
    /**
     * Border colour for cell outlines.
     * Defaults to the theme `borderColor`.
     */
    borderColor?: string;
}


interface PdfFileParams {
    /**
     * String to use as the file name or a function that returns a string.
     * @default 'export.pdf'
     */
    fileName?: string | ExportFileNameGetter;
    /**
     * The mimeType of the PDF file.
     * @default 'application/pdf'
     */
    mimeType?: string;
}

export interface PdfExportParams extends ExportParams<PdfCustomContent>, PdfFileParams {
    /**
     * The document title stored in the PDF metadata.
     * When set, a visible title is rendered above the exported table.
     * Provide a `PdfCell` to style the title using `PdfCell.style`.
     */
    documentTitle?: string | PdfCell;
    /**
     * Override PDF colours. Any missing values fall back to the current theme.
     */
    pdfStyles?: PdfExportStyles;
    /**
     * The size of the PDF page. Defaults to A4.
     * @default 'A4'
     */
    pageSize?: PdfPageSize;
    /**
     * Page orientation.
     * @default 'landscape'
     */
    pageOrientation?: PdfPageOrientation;
    /**
     * Page margins in points. A number applies to all sides.
     * @default 36
     */
    margin?: number | PdfMargin;
    /**
     * Base font size for body rows in points.
     * @default 10
     */
    fontSize?: number;
    /**
     * Base font size for header rows in points.
     * @default 11
     */
    headerFontSize?: number;
    /**
     * Base font family for body rows.
     * @default 'Helvetica'
     */
    fontFamily?: PdfFontFamily;
    /**
     * Font family for header rows.
     * @default derived bold variant of `fontFamily`
     */
    headerFontFamily?: PdfFontFamily;
    /**
     * Padding inside each cell in points.
     * @default 4
     */
    cellPadding?: number;
    /**
     * Height of body rows in points. If omitted, calculated from font size and padding.
     */
    rowHeight?: number;
    /**
     * Height of header rows in points. If omitted, calculated from header font size and padding.
     */
    headerRowHeight?: number;
    /**
     * Set to `false` to avoid repeating header rows on each page.
     * @default true
     */
    repeatHeader?: boolean;
    /**
     * Set to `false` to skip drawing cell borders.
     * @default true
     */
    drawCellBorders?: boolean;
}

export interface IPdfCreator {
    getDataAsPdf(params?: PdfExportParams): Blob | undefined;
    exportDataAsPdf(params?: PdfExportParams): void;
}
