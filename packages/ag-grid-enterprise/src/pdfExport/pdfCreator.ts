import type { IPdfCreator, NamedBean, PdfCustomContent, PdfExportParams } from 'ag-grid-community';
import { BaseCreator, _addGridCommonParams, _downloadFile, _warn } from 'ag-grid-community';

import { PdfSerializingSession } from './pdfSerializingSession';

export class PdfCreator
    extends BaseCreator<PdfCustomContent, PdfSerializingSession, PdfExportParams>
    implements NamedBean, IPdfCreator
{
    beanName = 'pdfCreator' as const;

    protected getMergedParams(params?: PdfExportParams): PdfExportParams {
        const baseParams = this.gos.get('defaultPdfExportParams');
        return Object.assign({}, baseParams, params);
    }

    protected export(userParams?: PdfExportParams): void {
        if (this.isExportSuppressed()) {
            _warn(160);
            return;
        }

        const exportFunc = () => {
            const mergedParams = this.getMergedParams(userParams);
            const data = this.getData(mergedParams);
            const mimeType = mergedParams.mimeType || 'application/pdf';

            const packagedFile = new Blob([data], { type: mimeType });
            const fileNameParams = mergedParams.fileName;
            const fileName =
                typeof fileNameParams === 'function'
                    ? fileNameParams(_addGridCommonParams(this.gos, {}))
                    : fileNameParams;

            _downloadFile(this.getFileName(fileName), packagedFile);
        };

        const { overlays } = this.beans;
        if (overlays) {
            overlays.showExportOverlay(exportFunc);
        } else {
            exportFunc();
        }
    }

    public exportDataAsPdf(params?: PdfExportParams): void {
        this.export(params);
    }

    public getDataAsPdf(params?: PdfExportParams): Blob | undefined {
        const mergedParams = this.getMergedParams(params);
        const data = this.getData(mergedParams);
        const mimeType = mergedParams.mimeType || 'application/pdf';

        return new Blob([data], { type: mimeType });
    }

    public getDefaultFileExtension(): string {
        return 'pdf';
    }

    public createSerializingSession(params?: PdfExportParams): PdfSerializingSession {
        const { colModel, colNames, rowGroupColsSvc, valueSvc, gos } = this.beans;
        const { processCellCallback, processHeaderCallback, processGroupHeaderCallback, processRowGroupCallback } =
            params!;

        return new PdfSerializingSession({
            ...params,
            colModel,
            colNames,
            rowGroupColsSvc,
            valueSvc,
            gos,
            processCellCallback: processCellCallback || undefined,
            processHeaderCallback: processHeaderCallback || undefined,
            processGroupHeaderCallback: processGroupHeaderCallback || undefined,
            processRowGroupCallback: processRowGroupCallback || undefined,
        });
    }

    public isExportSuppressed(): boolean {
        return this.gos.get('suppressPdfExport');
    }
}
