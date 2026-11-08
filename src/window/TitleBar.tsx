import { useCallback, useState, useEffect, useLayoutEffect, useRef } from 'react';
import { platform } from '@tauri-apps/plugin-os';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';
import { LibraryFilterControls } from '../components/panel/LibraryFilterControls';
import { LibraryPanelToggles } from '../components/panel/LibraryPanelToggles';
import { useEditorStore } from '../store/useEditorStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';

// The title bar's own inset from the window edge (`px-2`) and the padding the main pane keeps
// between its edge and its content (the BottomBar's `px-3`).
const TITLE_BAR_INSET = 8;
const MAIN_PANE_CONTENT_PADDING = 12;
// Inset of the 18 px icon inside the controls' 32 px toggle, so the first icon lines up with the
// BottomBar's first control (the rating stars) rather than the button's invisible edge.
const TOGGLE_ICON_INSET = 7;
// Space always kept after the title, and before the window controls so the window can still be dragged.
const MIN_TITLE_GAP = 16;
const MIN_DRAG_WIDTH = 48;

/** Whether the custom title bar is rendered (not with native decorations, in fullscreen, or on Android). */
export function useIsTitleBarShown() {
  const decorations = useSettingsStore((state) => Boolean(state.appSettings?.decorations));
  const osPlatform = useSettingsStore((state) => state.osPlatform);
  const isWindowFullScreen = useUIStore((state) => state.isWindowFullScreen);
  return !decorations && !isWindowFullScreen && osPlatform !== 'android';
}

const RestoreDownIcon = ({ size = 14, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect x="3" y="6" width="8" height="8" rx="1.5" />
    <path d="M6 6V4.5A1.5 1.5 0 0 1 7.5 3h5A1.5 1.5 0 0 1 14 4.5v5A1.5 1.5 0 0 1 12.5 11H11" />
  </svg>
);

export default function TitleBar() {
  const [osPlatform, setOsPlatform] = useState('');
  const [isMaximized, setIsMaximized] = useState(false);

  const appWindow = getCurrentWindow();
  const mainPaneBounds = useUIStore((state) => state.mainPaneBounds);
  const toolbarVisibility = useSettingsStore((state) => state.appSettings?.bottomToolbarVisibility);
  const hasSelectedImage = useEditorStore((state) => Boolean(state.selectedImage));
  const isLibraryGridShown = useUIStore((state) => state.activeView === 'library') && !hasSelectedImage;
  const titleRef = useRef<HTMLDivElement>(null);
  const windowControlsRef = useRef<HTMLDivElement>(null);
  const panelTogglesRef = useRef<HTMLDivElement>(null);
  const [panelTogglesWidth, setPanelTogglesWidth] = useState(0);
  const [titleWidth, setTitleWidth] = useState(0);
  const [windowControlsWidth, setWindowControlsWidth] = useState(0);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);

  useLayoutEffect(() => {
    setTitleWidth(titleRef.current?.offsetWidth ?? 0);
    setWindowControlsWidth(windowControlsRef.current?.offsetWidth ?? 0);
  }, [osPlatform]);

  // The panel toggles' labels follow the language and toolbar settings, so their width is measured.
  const showPanelToggles = Boolean(mainPaneBounds) && isLibraryGridShown;
  useLayoutEffect(() => {
    const element = panelTogglesRef.current;
    if (!element) {
      setPanelTogglesWidth(0);
      return;
    }
    const observer = new ResizeObserver(() => setPanelTogglesWidth(element.offsetWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [showPanelToggles, osPlatform]);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const getPlatform = async () => {
      try {
        const p = platform();
        setOsPlatform(p);
      } catch (error) {
        console.error('Failed to get platform:', error);
        setOsPlatform('windows');
      }
    };
    getPlatform();
  }, []);

  useEffect(() => {
    const updateMaximizedState = async () => {
      try {
        const max = await appWindow.isMaximized();
        setIsMaximized(max);
      } catch (error) {
        console.error('Failed to check maximized state:', error);
      }
    };

    updateMaximizedState();

    let unlisten: () => void;
    appWindow
      .onResized(() => {
        updateMaximizedState();
      })
      .then((u) => (unlisten = u));

    return () => {
      if (unlisten) unlisten();
    };
  }, [appWindow]);

  const handleMinimize = () => appWindow.minimize();
  const handleClose = () => appWindow.close();

  const handleMaximize = useCallback(async () => {
    try {
      if (osPlatform === 'macos') {
        const isFullscreen = await appWindow.isFullscreen();
        appWindow.setFullscreen(!isFullscreen);
      } else {
        appWindow.toggleMaximize();
      }
    } catch (error) {
      console.error('Failed to toggle maximize:', error);
    }
  }, [osPlatform, appWindow]);

  const isMac = osPlatform === 'macos';
  const isLinux = osPlatform === 'linux';
  const isWindows = osPlatform === 'windows';
  const isMobile = osPlatform === 'android';
  if (!osPlatform || isMobile) {
    return null;
  }
  const outerDragProps = isLinux ? {} : { 'data-tauri-drag-region': 'true' };
  // Filter controls start at the main pane's content edge, like the BottomBar's own controls below, and
  // must end within the pane, clear of the title and the window controls (title-bar coordinates).
  const filterControlsStart = mainPaneBounds
    ? Math.max(
        mainPaneBounds.left + MAIN_PANE_CONTENT_PADDING - TOGGLE_ICON_INSET - TITLE_BAR_INSET,
        titleWidth + MIN_TITLE_GAP,
      )
    : 0;
  const filterControlsEnd = mainPaneBounds
    ? Math.min(
        mainPaneBounds.right - MAIN_PANE_CONTENT_PADDING - TITLE_BAR_INSET,
        windowWidth - 2 * TITLE_BAR_INSET - windowControlsWidth - panelTogglesWidth - MIN_DRAG_WIDTH,
      )
    : 0;

  return (
    <div className="relative pt-2 px-2 w-full z-50 bg-transparent" {...outerDragProps}>
      <div
        className="h-10 bg-bg-secondary flex justify-between items-center select-none rounded-lg overflow-hidden"
        {...outerDragProps}
      >
        <div ref={titleRef} className="flex items-center h-full">
          {isMac && (
            <div className="flex items-center h-full px-4 space-x-2 z-10">
              <button
                aria-label="Close window"
                className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-600 transition-colors duration-150"
                onClick={handleClose}
              />
              <button
                aria-label="Minimize window"
                className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-600 transition-colors duration-150"
                onClick={handleMinimize}
              />
              <button
                aria-label="Maximize window"
                className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-600 transition-colors duration-150"
                onClick={handleMaximize}
              />
            </div>
          )}
          <div data-tauri-drag-region className={`flex items-center h-full ${isMac ? '' : 'px-4'}`}>
            <p className="text-sm font-semibold text-text-secondary pointer-events-none">ThisIsRAW</p>
          </div>
        </div>
        {mainPaneBounds && (
          <div
            className="flex items-center h-full min-w-0 z-10"
            style={{ marginLeft: filterControlsStart - titleWidth }}
          >
            <LibraryFilterControls
              availableWidth={filterControlsEnd - filterControlsStart}
              isItemVisible={(id) => toolbarVisibility?.[id] !== false}
            />
          </div>
        )}
        <div data-tauri-drag-region className="flex-1 h-full" />
        {showPanelToggles && (
          <div ref={panelTogglesRef} className="flex items-center h-full pr-1 z-10">
            <LibraryPanelToggles isItemVisible={(id) => toolbarVisibility?.[id] !== false} />
          </div>
        )}
        <div ref={windowControlsRef} className="flex items-center h-full z-10">
          {isLinux && (
            <div className="flex items-center gap-2 pr-2 h-full">
              <button
                aria-label="Minimize window"
                className="w-7 h-7 rounded-full inline-flex justify-center items-center hover:bg-white/10 transition-colors duration-150"
                onClick={handleMinimize}
              >
                <Minus size={16} className="text-text-secondary" />
              </button>
              <button
                aria-label="Maximize window"
                className="w-7 h-7 rounded-full inline-flex justify-center items-center hover:bg-white/10 transition-colors duration-150"
                onClick={handleMaximize}
              >
                {isMaximized ? (
                  <RestoreDownIcon size={13} className="text-text-secondary" />
                ) : (
                  <Square size={13} className="text-text-secondary" />
                )}
              </button>
              <button
                aria-label="Close window"
                className="w-7 h-7 rounded-full inline-flex justify-center items-center hover:bg-red-500 hover:text-white transition-colors duration-150"
                onClick={handleClose}
              >
                <X size={16} className="text-text-secondary hover:text-white" />
              </button>
            </div>
          )}

          {isWindows && <div data-tauri-drag-region className="w-36 shrink-0 h-full pointer-events-none" />}
        </div>
      </div>

      {isWindows && (
        <div className="absolute top-0 right-0 flex h-12 z-20">
          <button aria-label="Minimize window" className="relative w-12 group outline-none" onClick={handleMinimize}>
            <div className="absolute bottom-0 left-0 w-12 h-10 flex justify-center items-center group-hover:bg-white/10 group-active:bg-white/20 transition-colors duration-150">
              <Minus size={16} className="text-text-secondary" />
            </div>
          </button>

          <button aria-label="Maximize window" className="relative w-12 group outline-none" onClick={handleMaximize}>
            <div className="absolute bottom-0 left-0 w-12 h-10 flex justify-center items-center group-hover:bg-white/10 group-active:bg-white/20 transition-colors duration-150">
              {isMaximized ? (
                <RestoreDownIcon size={12} className="text-text-secondary" />
              ) : (
                <Square size={12} className="text-text-secondary" />
              )}
            </div>
          </button>

          <button aria-label="Close window" className="relative w-14 group outline-none" onClick={handleClose}>
            <div className="absolute bottom-0 left-0 w-12 h-10 flex justify-center items-center group-hover:bg-red-500 group-active:bg-red-600 transition-colors duration-150 rounded-r-lg">
              <X size={16} className="text-text-secondary group-hover:text-white transition-colors duration-150" />
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
