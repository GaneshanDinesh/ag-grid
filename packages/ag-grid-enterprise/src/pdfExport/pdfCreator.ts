import type {
    IPdfCreator,
    NamedBean,
    PdfCustomContent,
    PdfExportParams,
    PdfExportStyles,
} from 'ag-grid-community';
import { BaseCreator, _addGridCommonParams, _downloadFile, _paramToVariableName, _warn } from 'ag-grid-community';

import { PdfSerializingSession } from './pdfSerializingSession';

/**
 * Orchestrates PDF export by serialising grid data and downloading a file.
 * Style defaults are resolved from the active grid theme.
 */
export class PdfCreator
    extends BaseCreator<PdfCustomContent, PdfSerializingSession, PdfExportParams>
    implements NamedBean, IPdfCreator
{
    beanName = 'pdfCreator' as const;

    /**
     * Merge default params with user params and resolve PDF styles.
     * @param params - Optional export params provided by the caller.
     * @returns The merged params with resolved theme styles applied.
     */
    protected getMergedParams(params?: PdfExportParams): PdfExportParams {
        const baseParams = this.gos.get('defaultPdfExportParams');
        const merged = Object.assign({}, baseParams, params);
        merged.pdfStyles = this.resolvePdfStyles(baseParams?.pdfStyles, params?.pdfStyles);
        const mergedDocumentTitle = this.mergeDocumentTitle(baseParams?.documentTitle, params?.documentTitle);
        merged.documentTitle = this.resolveDocumentTitle(mergedDocumentTitle);
        return merged;
    }

    /**
     * Run the export pipeline and trigger a download.
     * @param userParams - Optional export params to use for this export.
     */
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
            // Match other exporters by showing a transient export overlay.
            overlays.showExportOverlay(exportFunc);
        } else {
            exportFunc();
        }
    }

    /**
     * Export and download a PDF file.
     * @param params - Optional export params to use for this export.
     */
    public exportDataAsPdf(params?: PdfExportParams): void {
        this.export(params);
    }

    /**
     * Return the PDF file as a Blob without downloading it.
     * @param params - Optional export params to use for this export.
     * @returns The generated PDF as a Blob, or undefined if export is unavailable.
     */
    public getDataAsPdf(params?: PdfExportParams): Blob | undefined {
        const mergedParams = this.getMergedParams(params);
        const data = this.getData(mergedParams);
        const mimeType = mergedParams.mimeType || 'application/pdf';

        return new Blob([data], { type: mimeType });
    }

    /**
     * File extension used by PDF export.
     * @returns The file extension for PDF exports.
     */
    public getDefaultFileExtension(): string {
        return 'pdf';
    }

    /**
     * Create a serialising session for the grid exporter.
     * @param params - Export params to drive serialisation.
     * @returns A configured serialising session instance.
     */
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

    /**
     * Check if PDF export is suppressed by grid options.
     * @returns True when export is disabled, otherwise false.
     */
    public isExportSuppressed(): boolean {
        return this.gos.get('suppressPdfExport');
    }

    /**
     * Merge theme colours with default and override styles.
     * @param baseStyles - Default styles from grid options.
     * @param overrideStyles - One-off overrides supplied by the caller.
     * @returns The merged styles for PDF rendering.
     */
    private resolvePdfStyles(baseStyles?: PdfExportStyles, overrideStyles?: PdfExportStyles): PdfExportStyles {
        return {
            ...this.getThemePdfStyles(),
            ...baseStyles,
            ...overrideStyles,
        };
    }

    /**
     * Resolve document title style colours when provided as a PdfCell.
     * @param documentTitle - Title value or cell payload.
     * @returns The resolved document title.
     */
    private resolveDocumentTitle(
        documentTitle: PdfExportParams['documentTitle']
    ): PdfExportParams['documentTitle'] {
        if (!documentTitle || typeof documentTitle === 'string') {
            return documentTitle;
        }

        const style = documentTitle.style;
        if (!style) {
            return documentTitle;
        }

        return {
            ...documentTitle,
            style: {
                ...style,
                color: this.resolveCssColorValue(style.color),
                backgroundColor: this.resolveCssColorValue(style.backgroundColor),
                borderColor: this.resolveCssColorValue(style.borderColor),
            },
        };
    }

    /**
     * Merge document title values to allow default styles with overridden text.
     * @param baseTitle - Default document title value.
     * @param overrideTitle - Export-specific document title value.
     * @returns The merged document title value.
     */
    private mergeDocumentTitle(
        baseTitle: PdfExportParams['documentTitle'],
        overrideTitle: PdfExportParams['documentTitle']
    ): PdfExportParams['documentTitle'] {
        if (overrideTitle == null) {
            return baseTitle;
        }

        if (typeof overrideTitle === 'string') {
            if (baseTitle && typeof baseTitle !== 'string') {
                return {
                    ...baseTitle,
                    data: {
                        ...(baseTitle.data ?? {}),
                        value: overrideTitle,
                    },
                };
            }
            return overrideTitle;
        }

        if (baseTitle && typeof baseTitle !== 'string') {
            return {
                ...baseTitle,
                ...overrideTitle,
                data: {
                    ...(baseTitle.data ?? {}),
                    ...(overrideTitle.data ?? {}),
                },
                style: {
                    ...(baseTitle.style ?? {}),
                    ...(overrideTitle.style ?? {}),
                },
            };
        }

        return overrideTitle;
    }

    /**
     * Read theme colours from CSS variables on the grid root element.
     * @returns Theme-derived styles for PDF rendering.
     */
    private getThemePdfStyles(): PdfExportStyles {
        const { eRootDiv } = this.beans;
        if (!eRootDiv || typeof getComputedStyle !== 'function') {
            return {};
        }

        const styles = getComputedStyle(eRootDiv);
        const themeParams: (keyof PdfExportStyles)[] = [
            'backgroundColor',
            'dataBackgroundColor',
            'oddRowBackgroundColor',
            'foregroundColor',
            'headerBackgroundColor',
            'headerTextColor',
            'borderColor',
        ];

        const themeStyles: PdfExportStyles = {};
        themeParams.forEach((param) => {
            const cssVar = _paramToVariableName(param);
            const value = styles.getPropertyValue(cssVar).trim();
            if (value) {
                // resolve CSS keywords/vars to a concrete colour string.
                const resolved = this.resolveCssColor(value);
                if (resolved) {
                    themeStyles[param] = resolved;
                }
            }
        });

        const headerBackground = this.getElementStyleColor('.ag-header', 'backgroundColor');
        if (headerBackground) {
            themeStyles.headerBackgroundColor = headerBackground;
        }

        return themeStyles;
    }

    /**
     * Resolve CSS colour values (including named colours) to computed rgb(...).
     * This keeps parsing simple for the PDF writer.
     * @param value - The CSS colour string to resolve.
     * @returns A computed colour string, or an empty string if it cannot be resolved.
     */
    private resolveCssColor(value: string): string {
        if (typeof document === 'undefined') {
            return value;
        }

        const { eRootDiv } = this.beans;
        if (!eRootDiv || typeof getComputedStyle !== 'function') {
            return value;
        }

        const probe = document.createElement('span');
        probe.style.color = value;
        if (!probe.style.color) {
            return '';
        }

        // Use a hidden element so the browser resolves named colours and vars.
        probe.style.position = 'absolute';
        probe.style.left = '-99999px';
        probe.style.top = '-99999px';
        probe.style.visibility = 'hidden';

        eRootDiv.appendChild(probe);
        const computed = getComputedStyle(probe).color;
        probe.remove();

        return computed || '';
    }

    /**
     * Resolve a CSS colour string to a computed rgb value.
     * @param value - CSS colour string to resolve.
     * @returns The computed colour string, or undefined when unresolved.
     */
    private resolveCssColorValue(value?: string): string | undefined {
        if (!value) {
            return undefined;
        }

        const resolved = this.resolveCssColor(value);
        return resolved || undefined;
    }

    /**
     * Read a computed colour from a grid element.
     * @param selector - CSS selector for the element to inspect.
     * @param property - CSS property to read from the element.
     * @returns The computed colour string, or undefined if unavailable.
     */
    private getElementStyleColor(selector: string, property: 'backgroundColor' | 'color'): string | undefined {
        const { eRootDiv } = this.beans;
        if (!eRootDiv || typeof getComputedStyle !== 'function') {
            return undefined;
        }

        const element = eRootDiv.querySelector<HTMLElement>(selector);
        if (!element) {
            return undefined;
        }

        const value = getComputedStyle(element)[property].trim();
        if (!value || value === 'transparent' || /^rgba\(0,\s*0,\s*0,\s*0\)$/.test(value)) {
            return undefined;
        }

        return value;
    }
}
