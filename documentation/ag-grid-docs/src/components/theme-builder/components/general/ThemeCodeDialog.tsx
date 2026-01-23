import Code from '@ag-website-shared/components/code/Code';
import { Checkmark, Copy, Upload } from '@carbon/icons-react';
import styled from '@emotion/styled';
import { urlWithBaseUrl } from '@utils/urlWithBaseUrl';
import { useStore } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { parseThemeCode, validateAndConvertToPreset } from '../../model/parseThemeCode';
import { type RenderedThemeInfo, useRenderedThemeInfo } from '../../model/rendered-theme';
import { applyPreset } from '../presets/presets';
import { Button } from './UIPopupButton';

export type ThemeCodeDialogTab = 'export' | 'import';

export type ThemeCodeDialogProps = {
    close: () => void;
    initialTab?: ThemeCodeDialogTab;
};

export const ThemeCodeDialog = ({ close, initialTab = 'export' }: ThemeCodeDialogProps) => {
    const [activeTab, setActiveTab] = useState<ThemeCodeDialogTab>(initialTab);
    const [isDragging, setIsDragging] = useState(false);
    const dialogRef = useRef<HTMLDivElement>(null);

    return (
        <DialogWrapper ref={dialogRef}>
            {isDragging && (
                <DropOverlay>
                    <DropOverlayText>Drop file to import</DropOverlayText>
                </DropOverlay>
            )}
            <TabHeader>
                <TabButton $active={activeTab === 'export'} onClick={() => setActiveTab('export')}>
                    Export
                </TabButton>
                <TabButton $active={activeTab === 'import'} onClick={() => setActiveTab('import')}>
                    Import
                </TabButton>
            </TabHeader>
            <TabContent>
                {activeTab === 'export' && <ExportTabContent />}
                <div style={{ display: activeTab === 'import' ? undefined : 'none' }}>
                    <ImportTabContent
                        close={close}
                        dropTargetRef={dialogRef}
                        onDragStateChange={(dragging) => {
                            setIsDragging(dragging);
                            if (dragging) setActiveTab('import');
                        }}
                    />
                </div>
            </TabContent>
        </DialogWrapper>
    );
};

const HelpText = () => (
    <Paragraph>
        View our{' '}
        <a href={urlWithBaseUrl('/react-data-grid/applying-theme-builder-styling-grid/')} target="_blank">
            <strong>Theme Builder Documentation</strong>
        </a>{' '}
        to learn about exporting and importing AG Grid themes directly from theme builder.
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

type ImportTabContentProps = {
    close: () => void;
    dropTargetRef: React.RefObject<HTMLDivElement | null>;
    onDragStateChange: (isDragging: boolean) => void;
};

const MAX_FILE_SIZE = 1024 * 1024; // 1MB

const ImportTabContent = ({ close, dropTargetRef, onDragStateChange }: ImportTabContentProps) => {
    const [code, setCode] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{ warnings: string[] } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const store = useStore();

    const loadFile = useCallback((file: File) => {
        if (file.size > MAX_FILE_SIZE) {
            setError(`File too large (${(file.size / 1024).toFixed(0)}KB). Maximum size is 1MB.`);
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target?.result;
            if (typeof content === 'string') {
                setCode(content);
                setError(null);
                setResult(null);
            }
        };
        reader.readAsText(file);
    }, []);

    useEffect(() => {
        const element = dropTargetRef.current;
        if (!element) return;

        const handleDragOver = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
        };

        const handleDragEnter = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            onDragStateChange(true);
        };

        const handleDragLeave = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            // Only set false if leaving the element entirely
            if (!element.contains(e.relatedTarget as Node)) {
                onDragStateChange(false);
            }
        };

        const handleDrop = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            onDragStateChange(false);

            const file = e.dataTransfer?.files[0];
            if (file) {
                loadFile(file);
            }
        };

        element.addEventListener('dragover', handleDragOver);
        element.addEventListener('dragenter', handleDragEnter);
        element.addEventListener('dragleave', handleDragLeave);
        element.addEventListener('drop', handleDrop);

        return () => {
            element.removeEventListener('dragover', handleDragOver);
            element.removeEventListener('dragenter', handleDragEnter);
            element.removeEventListener('dragleave', handleDragLeave);
            element.removeEventListener('drop', handleDrop);
        };
    }, [dropTargetRef, onDragStateChange, loadFile]);

    const handleApply = () => {
        setError(null);

        const parseResult = parseThemeCode(code);
        if (!parseResult.success) {
            setError(parseResult.error);
            return;
        }

        const { preset, warnings } = validateAndConvertToPreset(parseResult);

        applyPreset(store, preset);
        setResult({ warnings });

        if (warnings.length === 0) {
            setTimeout(() => close(), 500);
        }
    };

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            loadFile(file);
        }
        event.target.value = '';
    };

    if (result) {
        return (
            <TabContentInner>
                <SuccessMessage>Theme applied successfully</SuccessMessage>
                {result.warnings.length > 0 && (
                    <WarningsSection>
                        <WarningsHeader>Warnings:</WarningsHeader>
                        <WarningsList>
                            {result.warnings.map((warning, i) => (
                                <li key={i}>{warning}</li>
                            ))}
                        </WarningsList>
                    </WarningsSection>
                )}
                <HelpTextSmall>Click outside to close</HelpTextSmall>
            </TabContentInner>
        );
    }

    return (
        <TabContentInner>
            <HelpText />
            <Textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="const myTheme = themeQuartz.withParams({...});"
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
                <UploadButton className="button-tertiary" onClick={() => fileInputRef.current?.click()}>
                    <Upload /> Upload
                </UploadButton>
                <ApplyButton onClick={handleApply} disabled={!code.trim()}>
                    Apply
                </ApplyButton>
            </ButtonRow>
            {error && <ErrorMessage>{error}</ErrorMessage>}
        </TabContentInner>
    );
};

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
    width: 1060px;
    height: 600px;
    max-width: calc(100vw - 100px);
    max-height: calc(100vh - 100px);
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

const TabHeader = styled('div')`
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--color-border-primary);
    margin-bottom: 16px;
`;

const TabButton = styled('button')<{ $active: boolean }>`
    padding: 8px 24px;
    border: none;
    background: none;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    color: ${(props) => (props.$active ? 'var(--color-fg-primary)' : 'var(--color-fg-secondary)')};
    border-bottom: 2px solid ${(props) => (props.$active ? 'var(--color-brand)' : 'transparent')};
    margin-bottom: -1px;
    transition:
        color 0.2s,
        border-color 0.2s;

    &:hover {
        color: var(--color-fg-primary);
    }
`;

const TabContent = styled('div')`
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
`;

const TabContentInner = styled('div')`
    display: flex;
    flex-direction: column;
    gap: 16px;
    flex: 1;
    min-height: 0;
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
    min-height: 200px;
    padding: 12px;
    border: 1px solid var(--color-border-primary);
    border-radius: 4px;
    font-family: monospace;
    font-size: 12px;
    resize: none;
    background: var(--color-bg-primary);
    color: var(--color-fg-primary);

    &:focus {
        outline: none;
        border-color: var(--color-brand);
    }
`;

const UploadButton = styled('button')`
    display: flex;
    align-items: center;
    gap: 8px;
`;

const ApplyButton = styled(Button)`
    width: auto;
    padding: 0 24px;

    &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
`;

const ErrorMessage = styled('span')`
    color: var(--color-error, #dc3545);
    font-size: 14px;
`;

const SuccessMessage = styled('div')`
    color: var(--color-success, #28a745);
    font-weight: 500;
    font-size: 16px;
`;

const WarningsSection = styled('div')`
    background: var(--color-warning-bg, #fff3cd);
    border: 1px solid var(--color-warning-border, #ffc107);
    border-radius: 4px;
    padding: 12px;
`;

const WarningsHeader = styled('div')`
    font-weight: 500;
    margin-bottom: 8px;
    color: var(--color-warning-fg, #856404);
`;

const WarningsList = styled('ul')`
    margin: 0;
    padding-left: 20px;
    font-size: 13px;
    color: var(--color-warning-fg, #856404);

    li {
        margin-bottom: 4px;
    }
`;

const HelpTextSmall = styled('div')`
    font-size: 12px;
    color: var(--color-fg-secondary);
    font-style: italic;
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
