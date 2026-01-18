import type {
    AgColumn,
    AgColumnGroup,
    GridSerializingParams,
    PdfCustomContent,
    PdfExportParams,
    RowAccumulator,
    RowNode,
    RowSpanningAccumulator,
} from 'ag-grid-community';
import { BaseGridSerializingSession } from 'ag-grid-community';

import { createPdfDocument } from './pdfDocument';

export type PdfRowType = 'HEADER_GROUPING' | 'HEADER' | 'BODY' | 'CUSTOM';

export interface PdfCell {
    value: string;
    mergeAcross?: number;
}

export interface PdfRow {
    type: PdfRowType;
    cells: PdfCell[];
}

type PdfGridSerializingParams = GridSerializingParams & PdfExportParams;

export class PdfSerializingSession extends BaseGridSerializingSession<PdfCustomContent> {
    private readonly rows: PdfRow[] = [];
    private columnsToExport: AgColumn[] = [];
    private rowIndex = 0;

    constructor(private readonly config: PdfGridSerializingParams) {
        super(config);
    }

    public override prepare(columnsToExport: AgColumn[]): void {
        super.prepare(columnsToExport);
        this.columnsToExport = [...columnsToExport];
    }

    public addCustomContent(content: PdfCustomContent): void {
        if (!content) {
            return;
        }

        if (typeof content === 'string') {
            const span = Math.max(this.columnsToExport.length - 1, 0);
            content.split(/\r?\n/).forEach((line) => {
                const row = this.createRow('CUSTOM');
                row.cells.push({
                    value: line,
                    mergeAcross: span || undefined,
                });
            });
            return;
        }

        content.forEach((rowCells) => {
            const row = this.createRow('CUSTOM');
            rowCells.forEach((cell) => {
                row.cells.push({
                    value: String(cell?.data?.value ?? ''),
                    mergeAcross: cell?.mergeAcross,
                });
            });
        });
    }

    public onNewHeaderGroupingRow(): RowSpanningAccumulator {
        const row = this.createRow('HEADER_GROUPING');

        return {
            onColumn: (_columnGroup: AgColumnGroup, header: string, _index: number, span: number) => {
                row.cells.push({
                    value: header ?? '',
                    mergeAcross: span || undefined,
                });
            },
        };
    }

    public onNewHeaderRow(): RowAccumulator {
        const row = this.createRow('HEADER');

        return {
            onColumn: (column: AgColumn) => {
                row.cells.push({
                    value: this.extractHeaderValue(column),
                });
            },
        };
    }

    public onNewBodyRow(node?: RowNode): RowAccumulator {
        const row = this.createRow('BODY');
        const rowIndex = this.rowIndex;
        let skipCols = 0;

        return {
            onColumn: (column: AgColumn, index: number, currentNode?: RowNode) => {
                if (skipCols > 0) {
                    skipCols -= 1;
                    return;
                }

                const activeNode = currentNode ?? node;
                if (!activeNode) {
                    row.cells.push({ value: '' });
                    return;
                }

                const rowCellValue = this.extractRowCellValue({
                    column,
                    node: activeNode,
                    currentColumnIndex: index,
                    accumulatedRowIndex: rowIndex,
                    type: 'pdf',
                    useRawFormula: false,
                });

                const value = String(rowCellValue.valueFormatted ?? rowCellValue.value ?? '');
                const colSpan = column.getColSpan(activeNode);

                if (colSpan > 1) {
                    skipCols = colSpan - 1;
                    row.cells.push({
                        value,
                        mergeAcross: colSpan - 1,
                    });
                } else {
                    row.cells.push({ value });
                }
            },
        };
    }

    public parse(): string {
        return createPdfDocument(this.rows, this.columnsToExport, this.config);
    }

    private createRow(type: PdfRowType): PdfRow {
        this.rowIndex += 1;
        const row: PdfRow = {
            type,
            cells: [],
        };
        this.rows.push(row);
        return row;
    }
}
