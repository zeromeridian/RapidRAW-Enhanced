import { useState, useEffect } from 'react';
import { save, open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Save, CheckCircle, XCircle, Loader } from 'lucide-react';
import Switch from '../../ui/Switch';

const FILE_FORMATS = [
  { id: 'jpeg', name: 'JPEG', extensions: ['jpg', 'jpeg'] },
  { id: 'png', name: 'PNG', extensions: ['png'] },
  { id: 'tiff', name: 'TIFF', extensions: ['tiff'] },
];

function Section({ title, children }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-text-primary mb-3 border-b border-surface pb-2">
        {title}
      </h3>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export default function ExportPanel({ selectedImage, adjustments, multiSelectedPaths }) {
  const [fileFormat, setFileFormat] = useState('jpeg');
  const [jpegQuality, setJpegQuality] = useState(90);
  const [enableResize, setEnableResize] = useState(false);
  const [resizeMode, setResizeMode] = useState('longEdge');
  const [resizeValue, setResizeValue] = useState(2048);
  const [dontEnlarge, setDontEnlarge] = useState(true);
  const [demosaicQuality, setDemosaicQuality] = useState('Menon');

  const [exportStatus, setExportStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [batchExportProgress, setBatchExportProgress] = useState(null);

  const isEditorContext = !!selectedImage;
  const pathsToExport = isEditorContext
    ? (multiSelectedPaths.length > 0 ? multiSelectedPaths : (selectedImage ? [selectedImage.path] : []))
    : multiSelectedPaths;
  const numImages = pathsToExport.length;
  const isBatchMode = numImages > 1;

  const hasRawFileInSelection = pathsToExport.some(p =>
    /\.(arw|cr2|cr3|nef|dng|raf|orf|pef|rw2)$/i.test(p)
  );

  useEffect(() => {
    const unlistenPromise = listen('batch-export-progress', (event) => {
      setBatchExportProgress(event.payload);
    });
    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, []);

  useEffect(() => {
    setExportStatus('idle');
    setErrorMessage('');
    setBatchExportProgress(null);
  }, [selectedImage, multiSelectedPaths]);

  const handleExportImage = async () => {
    if (numImages === 0) return;

    setExportStatus('exporting');
    setErrorMessage('');
    if (isBatchMode) {
      setBatchExportProgress({ current: 0, total: numImages });
    }

    try {
      const exportSettings = {
        jpegQuality: parseInt(jpegQuality, 10),
        resize: enableResize ? {
          mode: resizeMode,
          value: parseInt(resizeValue, 10),
          dontEnlarge: dontEnlarge,
        } : null,
      };

      if (isBatchMode || !isEditorContext) {
        const outputFolder = await open({
          title: `Select Folder to Export ${numImages} Image(s)`,
          directory: true,
        });

        if (outputFolder) {
          await invoke('batch_export_images', {
            outputFolder,
            paths: pathsToExport,
            demosaicQuality: hasRawFileInSelection ? demosaicQuality : null,
            exportSettings,
            outputFormat: FILE_FORMATS.find(f => f.id === fileFormat).extensions[0],
          });
          setExportStatus('success');
        } else {
          setExportStatus('idle');
        }
      } else { // Single image export from the editor context
        const selectedFormat = FILE_FORMATS.find(f => f.id === fileFormat);
        const originalFilename = selectedImage.path.split(/[\\/]/).pop();
        const [name] = originalFilename.split('.');

        const filePath = await save({
          title: "Save Edited Image",
          defaultPath: `${name}_edited.${selectedFormat.extensions[0]}`,
          filters: FILE_FORMATS.map(f => ({ name: f.name, extensions: f.extensions })),
        });

        if (filePath) {
          await invoke('export_image', {
            path: filePath,
            jsAdjustments: adjustments,
            demosaicQuality: selectedImage.isRaw ? demosaicQuality : null,
            exportSettings: exportSettings,
          });
          setExportStatus('success');
        } else {
          setExportStatus('idle');
        }
      }
    } catch (error) {
      console.error('Error exporting image:', error);
      setErrorMessage(typeof error === 'string' ? error : 'An unknown error occurred.');
      setExportStatus('error');
    } finally {
      if (isBatchMode) {
        setTimeout(() => setBatchExportProgress(null), 4000);
      }
    }

    setTimeout(() => {
      if (exportStatus !== 'exporting') {
        setExportStatus('idle');
      }
    }, 4000);
  };

  const isExporting = exportStatus === 'exporting';
  const canExport = numImages > 0;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 flex justify-between items-center flex-shrink-0 border-b border-surface">
        <h2 className="text-xl font-bold text-primary text-shadow-shiny">
          Export {numImages > 1 ? `(${numImages})` : ''}
        </h2>
      </div>
      <div className="flex-grow overflow-y-auto p-4 text-text-secondary space-y-6">
        {canExport ? (
          <>
            <Section title="File Settings">
              <div className="grid grid-cols-3 gap-2">
                {FILE_FORMATS.map(format => (
                  <button
                    key={format.id}
                    onClick={() => setFileFormat(format.id)}
                    disabled={isExporting}
                    className={`px-2 py-1.5 text-sm rounded-md transition-colors ${
                      fileFormat === format.id
                        ? 'bg-surface text-white'
                        : 'bg-surface hover:bg-card-active'
                    } disabled:opacity-50`}
                  >
                    {format.name}
                  </button>
                ))}
              </div>
              {fileFormat === 'jpeg' && (
                <div className="flex items-center gap-2">
                  <label className="text-sm w-20">Quality</label>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={jpegQuality}
                    onChange={(e) => setJpegQuality(e.target.value)}
                    disabled={isExporting}
                    className="w-full h-1 bg-surface rounded-lg appearance-none cursor-pointer accent-accent"
                  />
                  <span className="text-sm font-mono w-12 text-right">{jpegQuality}</span>
                </div>
              )}
            </Section>

            <Section title="Image Sizing">
              <Switch
                label="Resize to Fit"
                checked={enableResize}
                onChange={setEnableResize}
                disabled={isExporting}
              />
              {enableResize && (
                <div className="space-y-4 pl-2 border-l-2 border-surface">
                  <div className="flex items-center gap-2">
                    <select
                      value={resizeMode}
                      onChange={(e) => setResizeMode(e.target.value)}
                      disabled={isExporting}
                      className="w-full bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent"
                    >
                      <option value="longEdge">Long Edge</option>
                      <option value="width">Width</option>
                      <option value="height">Height</option>
                    </select>
                    <input
                      type="number"
                      value={resizeValue}
                      onChange={(e) => setResizeValue(e.target.value)}
                      disabled={isExporting}
                      className="w-24 bg-bg-primary text-center rounded-md p-2 border border-surface focus:border-accent focus:ring-accent"
                      min="1"
                    />
                    <span className="text-sm">pixels</span>
                  </div>
                  <Switch
                    label="Don't Enlarge"
                    checked={dontEnlarge}
                    onChange={setDontEnlarge}
                    disabled={isExporting}
                  />
                </div>
              )}
            </Section>
            {/* COMMENTED OUT UNTIL I FIND BETTER DEMOSAICING ALGO'S
            {hasRawFileInSelection && (
              <Section title="RAW Settings">
                <div className="flex items-center gap-2">
                  <label className="text-sm flex-grow">Demosaic Quality</label>
                  <select
                    value={demosaicQuality}
                    onChange={(e) => setDemosaicQuality(e.target.value)}
                    disabled={isExporting}
                    className="w-1/2 bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent"
                  >
                    <option value="Menon">Menon (High Quality)</option>
                    <option value="Linear">Linear (Fast)</option>
                  </select>
                </div>
              </Section>
            )} */}
          </>
        ) : (
          <p className="text-center text-text-tertiary mt-4">No image selected for export.</p>
        )}
      </div>

      <div className="p-4 border-t border-surface flex-shrink-0">
        <button
          onClick={handleExportImage}
          disabled={!canExport || isExporting}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-surface text-white font-bold rounded-lg hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {isExporting ? (
            <>
              <Loader size={18} className="animate-spin" />
              {batchExportProgress
                ? `Exporting... (${batchExportProgress.current}/${batchExportProgress.total})`
                : 'Exporting...'
              }
            </>
          ) : (
            <>
              <Save size={18} />
              Export {numImages > 1 ? `${numImages} Images` : 'Image'}
            </>
          )}
        </button>
        {exportStatus === 'success' && (
          <div className="flex items-center gap-2 text-green-400 mt-3 text-sm justify-center">
            <CheckCircle size={16} />
            <span>Export successful!</span>
          </div>
        )}
        {exportStatus === 'error' && (
          <div className="flex items-center gap-2 text-red-400 mt-3 text-sm justify-center text-center">
            <XCircle size={16} />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
}