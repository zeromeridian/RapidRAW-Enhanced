import { BrainCircuit, Sparkles, Wand2, RotateCcw, Loader2 } from 'lucide-react';
import clsx from 'clsx';

const ToolButton = ({ icon: Icon, label, onClick, isActive = false, disabled = false }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={clsx(
      'flex flex-col items-center justify-center p-3 rounded-lg transition-colors text-text-secondary w-full',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      isActive
        ? 'bg-accent text-white shadow-md'
        : 'bg-surface hover:bg-card-active hover:text-text-primary'
    )}
  >
    <Icon size={20} />
    <span className="text-xs mt-1.5 font-semibold">{label}</span>
  </button>
);

const ConnectionStatus = ({ isConnected }) => (
  <div className="flex items-center gap-2 px-4 py-2 bg-surface rounded-lg mb-4">
    <div className={clsx('w-2.5 h-2.5 rounded-full', isConnected ? 'bg-green-500' : 'bg-red-500')} />
    <span className="text-sm font-medium text-text-secondary">
      ComfyUI Backend:
    </span>
    <span className={clsx('text-sm font-bold', isConnected ? 'text-green-400' : 'text-red-400')}>
      {isConnected ? 'Connected' : 'Not Detected'}
    </span>
  </div>
);

export default function AIPanel({
  selectedImage,
  adjustments,
  isComfyUiConnected,
  isGeneratingAi,
  onGenerativeErase,
  onRevertAiEdits,
  aiTool,
  setAiTool,
}) {
  const hasAiEdits = adjustments?.aiPatches?.length > 0;

  const handleToolClick = (toolName) => {
    setAiTool(prev => (prev === toolName ? null : toolName));
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 flex justify-between items-center flex-shrink-0 border-b border-surface">
        <h2 className="text-xl font-bold text-primary text-shadow-shiny flex items-center gap-2">
          <BrainCircuit size={24} />
          AI Tools
        </h2>
      </div>

      <div className="flex-grow overflow-y-auto p-4 text-text-secondary relative">
        {!selectedImage ? (
          <p className="text-center text-text-tertiary mt-4">No image selected.</p>
        ) : (
          <>
            <ConnectionStatus isConnected={isComfyUiConnected} />

            <div className={clsx(!isComfyUiConnected && 'opacity-40 pointer-events-none')}>
              {isGeneratingAi && (
                <div className="absolute inset-0 bg-bg-secondary/80 flex flex-col items-center justify-center z-10 rounded-lg">
                  <Loader2 size={32} className="animate-spin text-accent" />
                  <p className="mt-4 text-text-primary font-semibold">Processing with AI...</p>
                  <p className="text-sm text-text-secondary">This may take a moment.</p>
                </div>
              )}

              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                    <Sparkles size={16} className="text-accent" />
                    Generative Tools
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <ToolButton
                      icon={Wand2}
                      label="Generative Erase"
                      onClick={() => handleToolClick('generative-erase')}
                      isActive={aiTool === 'generative-erase'}
                      disabled={isGeneratingAi}
                    />
                  </div>
                  {aiTool === 'generative-erase' && (
                     <div className="mt-3 p-3 bg-surface rounded-lg text-center text-sm text-text-primary">
                        Paint over the area you want to remove on the image. The AI process will start automatically.
                     </div>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-text-primary mb-3">
                    Management
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <ToolButton
                      icon={RotateCcw}
                      label="Revert Last AI Edit"
                      onClick={onRevertAiEdits}
                      disabled={!hasAiEdits || isGeneratingAi}
                    />
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}