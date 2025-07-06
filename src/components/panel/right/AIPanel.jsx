import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wand2, RotateCcw, Loader2, Eye, EyeOff, Trash2, Send, UserCheck, ArrowLeft } from 'lucide-react';
import clsx from 'clsx';
import Input from '../../ui/Input';
import Button from '../../ui/Button';

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

const itemVariants = {
  hidden: { opacity: 0, x: -15 },
  visible: i => ({
    opacity: 1,
    x: 0,
    transition: { duration: 0.25, delay: i * 0.05 },
  }),
  exit: { opacity: 0, x: -15, transition: { duration: 0.2 } },
};

const viewVariants = {
  enter: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeInOut' } },
  exit: { opacity: 0, y: 10, transition: { duration: 0.2, ease: 'easeInOut' } },
};

const ToolButton = ({ icon: Icon, label, onClick, disabled, isActive }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={clsx(
      'bg-surface text-text-primary rounded-lg p-3 flex flex-col items-center justify-center gap-1.5 aspect-square transition-all duration-200',
      disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-card-active',
      isActive && 'ring-2 ring-accent bg-accent/10'
    )}
  >
    <Icon size={24} className={clsx(isActive ? 'text-accent' : 'text-text-secondary')} />
    <span className="text-xs font-semibold">{label}</span>
  </button>
);

const ActiveToolInfo = ({ tool, onCancel }) => {
  const instructions = {
    'generative-replace': 'Paint over the area you want to replace on the image.',
    'select-subject': 'The AI is selecting the subject. Please wait...',
  };
  return (
    <div className="p-4 bg-surface rounded-lg text-center space-y-3">
      <p className="text-sm text-text-primary">{instructions[tool]}</p>
      <Button onClick={onCancel} variant="secondary" size="sm" className="w-full">
        <ArrowLeft size={14} className="mr-2" />
        Cancel
      </Button>
    </div>
  );
};

export default function AIPanel({
  selectedImage,
  adjustments,
  isComfyUiConnected,
  isGeneratingAi,
  onGenerativeReplace,
  onResetAiEdits,
  aiTool,
  setAiTool,
  pendingAiAction,
  setPendingAiAction,
  onDeletePatch,
  onTogglePatchVisibility,
  onStyleShift,
  onUpscale,
  onSelectSubjectForReplace,
}) {
  const [prompt, setPrompt] = useState('');
  const [styleShiftPrompt, setStyleShiftPrompt] = useState('');
  const [expandedPatchId, setExpandedPatchId] = useState(null);
  const isInitialRender = useRef(true);

  useEffect(() => {
    isInitialRender.current = false;
  }, []);

  useEffect(() => {
    if (pendingAiAction) {
      setPrompt('');
    }
  }, [pendingAiAction]);

  const handleGenerateClick = () => {
    if (!pendingAiAction || !onGenerativeReplace) return;
    onGenerativeReplace({
      maskDataBase64: pendingAiAction.maskDataBase64,
      prompt,
    });
    setAiTool(null);
  };

  const handleApplyStyleShift = () => {
    if (!styleShiftPrompt || !onStyleShift) return;
    onStyleShift(styleShiftPrompt);
  };

  const handleSelectSubjectClick = () => {
    if (!onSelectSubjectForReplace) return;
    setAiTool('select-subject');
    onSelectSubjectForReplace();
  };

  const handleCancelPending = () => {
    setPendingAiAction(null);
    setPrompt('');
    setAiTool(null);
  };

  const aiPatches = adjustments?.aiPatches || [];
  const hasAiEdits = aiPatches.length > 0;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 flex justify-between items-center flex-shrink-0 border-b border-surface">
        <h2 className="text-xl font-bold text-primary text-shadow-shiny">AI Tools</h2>
        <button
          onClick={onResetAiEdits}
          className="p-2 rounded-full hover:bg-surface transition-colors"
          title="Reset All AI Edits"
          disabled={!hasAiEdits || isGeneratingAi}
        >
          <RotateCcw size={18} />
        </button>
      </div>

      <div className="flex-grow overflow-y-auto p-4 text-text-secondary space-y-6 relative">
        {!selectedImage ? (
          <p className="text-center text-text-tertiary mt-4">No image selected.</p>
        ) : (
          <>
            <ConnectionStatus isConnected={isComfyUiConnected} />

            <div className={clsx("space-y-8", !isComfyUiConnected && 'opacity-40 pointer-events-none')}>
              
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-text-primary">Generative Edit</h3>
                
                <div className="relative">
                  <AnimatePresence mode="wait">
                    {pendingAiAction ? (
                      <motion.div
                        key="prompt"
                        variants={viewVariants}
                        initial="exit"
                        animate="enter"
                        exit="exit"
                        className="p-4 bg-surface rounded-lg space-y-3"
                      >
                        <p className="text-sm font-semibold text-text-primary">Describe what you want to generate:</p>
                        <div className="flex items-center gap-2">
                          <Input
                            type="text"
                            placeholder="e.g., a field of flowers (optional)"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            className="flex-grow"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === 'Enter') handleGenerateClick(); }}
                          />
                          <Button onClick={handleGenerateClick} disabled={isGeneratingAi} size="icon">
                            {isGeneratingAi ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                          </Button>
                        </div>
                        <Button onClick={handleCancelPending} variant="link" size="sm" className="w-full text-text-secondary">
                          Cancel
                        </Button>
                      </motion.div>
                    ) : aiTool ? (
                      <motion.div
                        key="info"
                        variants={viewVariants}
                        initial="exit"
                        animate="enter"
                        exit="exit"
                      >
                        <ActiveToolInfo tool={aiTool} onCancel={() => setAiTool(null)} />
                      </motion.div>
                    ) : (
                      <motion.div
                        key="buttons"
                        variants={viewVariants}
                        initial="exit"
                        animate="enter"
                        exit="exit"
                        className="grid grid-cols-2 gap-2"
                      >
                        <ToolButton
                          icon={Wand2}
                          label="Replace Area"
                          onClick={() => setAiTool('generative-replace')}
                          disabled={isGeneratingAi}
                        />
                        <ToolButton
                          icon={UserCheck}
                          label="Select Subject"
                          onClick={handleSelectSubjectClick}
                          disabled={isGeneratingAi}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                
                {hasAiEdits && (
                  <div className="flex flex-col gap-2">
                    <AnimatePresence>
                      {aiPatches.map((patch, index) => (
                        <motion.div
                          key={patch.id}
                          layout
                          variants={itemVariants}
                          initial={isInitialRender.current ? "hidden" : false}
                          animate="visible"
                          exit="exit"
                          custom={index}
                          className={clsx('group p-2 rounded-lg flex flex-col cursor-pointer transition-colors bg-surface hover:bg-card-active')}
                          onClick={() => setExpandedPatchId(prev => prev === patch.id ? null : patch.id)}
                        >
                          <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-3">
                              {patch.isLoading ? (
                                <Loader2 size={16} className="text-accent animate-spin" />
                              ) : (
                                <Wand2 size={16} className="text-text-secondary" />
                              )}
                              <span className="font-medium text-sm text-text-primary truncate max-w-[150px]">
                                {patch.prompt || 'AI Edit'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button onClick={(e) => { e.stopPropagation(); onTogglePatchVisibility(patch.id); }} className="p-1.5 rounded-full text-text-secondary hover:bg-bg-primary opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all" title={patch.visible ? "Hide Patch" : "Show Patch"} disabled={patch.isLoading}>
                                {patch.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); onDeletePatch(patch.id); }} className="p-1.5 rounded-full text-text-secondary hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all" title="Delete Patch" disabled={patch.isLoading}>
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                          <AnimatePresence>
                            {expandedPatchId === patch.id && (
                              <motion.div initial={{ height: 0, opacity: 0, marginTop: 0 }} animate={{ height: 'auto', opacity: 1, marginTop: '8px' }} exit={{ height: 0, opacity: 0, marginTop: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                                <p className="text-xs text-text-secondary bg-bg-primary p-2 rounded-md break-words">
                                  <strong>Prompt:</strong> {patch.prompt || <em>No prompt provided</em>}
                                </p>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-text-primary">Style Shift</h3>
                <p className="text-xs text-text-secondary -mt-2">Transform the entire image with a new artistic style.</p>
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    placeholder="e.g., cinematic, Van Gogh painting"
                    value={styleShiftPrompt}
                    onChange={(e) => setStyleShiftPrompt(e.target.value)}
                    disabled={isGeneratingAi}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleApplyStyleShift(); }}
                  />
                  <Button onClick={handleApplyStyleShift} disabled={!styleShiftPrompt || isGeneratingAi}>
                    Apply
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-text-primary">Upscale</h3>
                <p className="text-xs text-text-secondary -mt-2">Increase the image resolution using AI.</p>
                <div className="grid grid-cols-3 gap-2">
                    <Button variant="secondary" onClick={() => onUpscale && onUpscale(2)} disabled={isGeneratingAi}>2x</Button>
                    <Button variant="secondary" onClick={() => onUpscale && onUpscale(3)} disabled={isGeneratingAi}>3x</Button>
                    <Button variant="secondary" onClick={() => onUpscale && onUpscale(4)} disabled={isGeneratingAi}>4x</Button>
                </div>
              </div>

            </div>
          </>
        )}
      </div>
    </div>
  );
}