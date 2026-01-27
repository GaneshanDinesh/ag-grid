import { Alert } from '@ag-website-shared/components/alert/Alert';
import Code from '@ag-website-shared/components/code/Code';
import { Tabs } from '@ag-website-shared/components/tabs/Tabs';
import { Checkmark, Copy, Upload } from '@carbon/icons-react';
import styled from '@emotion/styled';
import { urlWithBaseUrl } from '@utils/urlWithBaseUrl';
import { useStore } from 'jotai';
import { useMemo, useRef, useState } from 'react';

import { type RenderedThemeInfo, useRenderedThemeInfo } from '../../model/rendered-theme';
import { type ImportResult, executeThemeImport, loadFile, useFileDropZone } from './themeImport';

export type ThemeImportExportDialogProps = {
    close: () => void;
    initialTab?: string;
};

export const ThemeImportExportDialog = ({ close, initialTab = 'Export' }: ThemeImportExportDialogProps) => {
    const [activeTab, setActiveTab] = useState(initialTab);
    const [isDraggingFile, setIsDraggingFile] = useState(false);
    const [importCode, setImportCode] = useState('');
    const [importResult, setImportResult] = useState<ImportResult | null>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const store = useStore();

    const handleImportFile = async (file: File) => {
        const result = await loadFile(file);
        if (result.success) {
            setImportCode(result.content);
            setImportResult(executeThemeImport(result.content, store));
        } else {
            setImportResult({ success: false, error: result.error });
        }
        setActiveTab('Import');
    };

    const handleApply = () => {
        const result = executeThemeImport(importCode, store);
        setImportResult(result);
    };

    const handleBack = () => {
        setImportResult(null);
    };

    useFileDropZone(dialogRef, {
        onDraggingChange: setIsDraggingFile,
        onFileDrop: handleImportFile,
    });

    return (
        <DialogWrapper ref={dialogRef} data-foo="bar">
            {isDraggingFile && (
                <DropOverlay>
                    <DropOverlayText>Drop file to import</DropOverlayText>
                </DropOverlay>
            )}
            <StyledTabs selectedTab={activeTab} onTabChange={setActiveTab}>
                <ExportTabContent tab-label="Export" />
                <ImportTabContent tab-label="Import">
                    {!importResult && (
                        <ImportCodeEditor
                            code={importCode}
                            onCodeChange={(code) => {
                                setImportCode(code);
                                setImportResult(null);
                            }}
                            onFileSelect={handleImportFile}
                            onApply={handleApply}
                        />
                    )}
                    {importResult?.success === false && <ImportError error={importResult.error} onRetry={handleBack} />}
                    {importResult?.success === true && (
                        <ImportSuccess warnings={importResult.warnings} onBack={handleBack} onDone={close} />
                    )}
                </ImportTabContent>
            </StyledTabs>
        </DialogWrapper>
    );
};

const HelpText = () => (
    <Paragraph>
        View our{' '}
        <a href={urlWithBaseUrl('/react-data-grid/theming-theme-builder/')} target="_blank">
            <strong>Theme Builder Documentation</strong>
        </a>{' '}
        to learn about exporting and importing AG Grid themes directly from Theme Builder.
    </Paragraph>
);

const ExportTabContent = () => {
    const theme = useRenderedThemeInfo();
    const codeSample = useMemo(() => renderThemeCodeSample(theme), [theme]);
    const downloadLink = `data:text/css;charset=utf-8,${encodeURIComponent(codeSample)}`;

    const [copyButtonClicked, setCopyButtonClicked] = useState(false);

    return (
        <TabContentInner>
            <HelpText />
            <CodeWrapper>
                <Code code={codeSample} language="js" />
            </CodeWrapper>
            <ButtonRow>
                <DownloadLink className="button-tertiary" href={downloadLink} download="ag-grid-theme-builder.js">
                    <LinkContent>{downloadIcon} Download</LinkContent>
                </DownloadLink>
                <CopyLink
                    className="button-tertiary"
                    onClick={(e) => {
                        e.preventDefault();
                        if (!copyButtonClicked) {
                            setTimeout(() => {
                                setCopyButtonClicked(false);
                            }, 4000);
                        }
                        setCopyButtonClicked(true);
                        navigator.clipboard.writeText(codeSample);
                    }}
                >
                    <LinkContent
                        className={`copy-state-ready ${!copyButtonClicked ? 'copy-state-visible' : 'copy-state-hidden'}`}
                    >
                        {<Copy />} Copy
                    </LinkContent>
                    <LinkContent
                        className={`copy-state-clicked ${copyButtonClicked ? 'copy-state-visible' : 'copy-state-hidden'}`}
                    >
                        {<Checkmark />} Copied
                    </LinkContent>
                </CopyLink>
            </ButtonRow>
        </TabContentInner>
    );
};

const ImportTabContent = ({ children }: { children: React.ReactNode }) => <TabContentInner>{children}</TabContentInner>;

type ImportCodeEditorProps = {
    code: string;
    onCodeChange: (code: string) => void;
    onFileSelect: (file: File) => void;
    onApply: () => void;
};

const ImportCodeEditor = ({ code, onCodeChange, onFileSelect, onApply }: ImportCodeEditorProps) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            onFileSelect(file);
        }
        event.target.value = '';
    };

    return (
        <>
            <HelpText />
            <Textarea
                id="theme-import-code"
                className="code"
                value={code}
                onChange={(e) => onCodeChange(e.target.value)}
                placeholder={'Paste your theme code here:\n\nconst myTheme = themeQuartz.withParams({...});'}
                spellCheck={false}
            />
            <ButtonRow>
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept=".js,.ts,.txt"
                    style={{ display: 'none' }}
                />
                <button className="button-tertiary" onClick={() => fileInputRef.current?.click()}>
                    <LinkContent>
                        <Upload /> Upload
                    </LinkContent>
                </button>
                <button onClick={onApply} disabled={!code.trim()}>
                    <LinkContent>Apply</LinkContent>
                </button>
            </ButtonRow>
        </>
    );
};

type ImportErrorProps = {
    error: string;
    onRetry: () => void;
};

const ImportError = ({ error, onRetry }: ImportErrorProps) => (
    <>
        <Alert type="warning">{error}</Alert>
        <ButtonRow>
            <button onClick={onRetry}>
                <LinkContent>Try Again</LinkContent>
            </button>
        </ButtonRow>
    </>
);

type ImportSuccessProps = {
    warnings: string[];
    onBack: () => void;
    onDone: () => void;
};

const ImportSuccess = ({ warnings, onBack, onDone }: ImportSuccessProps) => (
    <>
        {warnings.length === 0 ? (
            <Alert type="success">Theme applied successfully</Alert>
        ) : (
            <Alert type="warning">
                <b>The theme was applied but there were some issues:</b>
                <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
                    {warnings.map((warning, i) => (
                        <li key={i}>{warning}</li>
                    ))}
                </ul>
            </Alert>
        )}
        <ButtonRow>
            <button className="button-tertiary" onClick={onBack}>
                <LinkContent>Back</LinkContent>
            </button>
            <button onClick={onDone}>
                <LinkContent>Done</LinkContent>
            </button>
        </ButtonRow>
    </>
);

const renderThemeCodeSample = ({ overriddenParams, usedParts }: RenderedThemeInfo): string => {
    const imports = ['themeQuartz'];
    let code = '';
    code += `// to use myTheme in an application, pass it to the theme grid option\n`;
    const paramsJS = JSON.stringify(overriddenParams, null, 4)
        .replaceAll(/^(\s+)"([^"]+)":/gm, '$1$2:')
        .replaceAll(/(:\s*)"(\d+)px"/gm, '$1$2');
    code += `export const myTheme = themeQuartz\n`;
    for (const part of usedParts) {
        const partImport = camelCase(part.id);
        code += `    .withPart(${partImport})\n`;
        imports.push(partImport);
    }
    code += `    .withParams(${paramsJS.replaceAll('\n', '\n    ')});\n`;
    code = `import { ${imports.join(', ')} } from 'ag-grid-community';\n\n${code}`;

    return code;
};

const camelCase = (str: string) => str.replace(/[\W_]+([a-z])/g, (_, letter) => letter.toUpperCase());

const DialogWrapper = styled('div')`
    position: relative;
    display: flex;
    flex-direction: column;
    width: min(750px, var(--popup-available-width, 750px) - 40px);
    height: 600px;
    max-height: calc(100vh - 100px);
`;

const StyledTabs = styled(Tabs)`
    margin: 0;
    flex: 1;
    min-height: 0;
    border: none;
`;

const DropOverlay = styled('div')`
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--color-bg-primary) 80%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    pointer-events: none;
`;

const DropOverlayText = styled('div')`
    font-size: 18px;
    font-weight: 500;
    color: var(--color-fg-primary);
`;

const TabContentInner = styled('div')`
    display: flex;
    flex-direction: column;
    gap: 16px;
    height: 100%;
`;

const Paragraph = styled('div')``;

const CodeWrapper = styled('div')`
    user-select: text;
    cursor: text;
    flex: 1;
    min-height: 0;
    overflow: auto;

    .code {
        max-height: 100%;
        overflow: auto;
        margin-top: 0;
    }
`;

const ButtonRow = styled('div')`
    display: flex;
    gap: 16px;
    justify-content: flex-end;
`;

const DownloadLink = styled('a')`
    & span {
        padding-right: 4px;
    }
`;

const CopyLink = styled('button')`
    position: relative;

    .copy-state-ready {
        position: absolute;
        inset: 0;
    }
    .copy-state-clicked {
        margin-right: 4px;
    }
    .copy-state-visible {
        opacity: 1;
    }
    .copy-state-hidden {
        opacity: 0;
    }
`;

const LinkContent = styled('span')`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: center;
    transition: opacity 0.2s;
`;

const Textarea = styled('textarea')`
    flex: 1;
    min-height: 100px;

    font-size: var(--text-fs-sm);
    padding: 10px 16px 8px;
    font-family: var(--text-monospace-font-family);
    border-radius: var(--radius-sm, 0.375rem);
    background-color: var(--color-code-background);
    color: var(--color-fg-primary);
    border: 1px solid rgba(black, 0.1);
    font-size: 15px;
    font-variant-ligatures: none;
    font-optical-sizing: auto;
    font-weight: 500;
    line-height: 1.5;

    &:focus {
        outline: none;
        border-color: var(--color-brand);
    }
`;

const downloadIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="16" fill="none">
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            d="M2.5 10c0 1.885 0 2.829.586 3.414C3.671 14 4.615 14 6.5 14h4c1.885 0 2.829 0 3.414-.586.586-.585.586-1.529.586-3.414m-6-8v8.667m0 0 2.667-2.917M8.5 10.667 5.833 7.75"
        />
    </svg>
);
