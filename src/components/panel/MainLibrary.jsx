import { useState, useEffect, useRef } from 'react';
import { 
  Folder, 
  Image as ImageIcon, 
  RefreshCw, 
  Settings, 
  Home, 
  Star, 
  ArrowUpDown,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Button from '../ui/Button';
import SettingsPanel from './SettingsPanel';
import { THEMES, DEFAULT_THEME_ID } from '../../themes';

const sortOptions = [
  { key: 'name', order: 'asc', label: 'File Name (A-Z)' },
  { key: 'name', order: 'desc', label: 'File Name (Z-A)' },
  { key: 'date', order: 'desc', label: 'Date (Newest)' },
  { key: 'date', order: 'asc', label: 'Date (Oldest)' },
  { key: 'rating', order: 'desc', label: 'Rating (Highest)' },
  { key: 'rating', order: 'asc', label: 'Rating (Lowest)' },
];

function SortDropdown({ sortCriteria, setSortCriteria }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSelect = (option) => {
    setSortCriteria({ key: option.key, order: option.order });
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        onClick={() => setIsOpen(!isOpen)}
        className="h-12 w-12 bg-surface text-text-primary shadow-none p-0 flex items-center justify-center"
        aria-haspopup="true"
        aria-expanded={isOpen}
        title="Sort images"
      >
        <ArrowUpDown className="w-8 h-8" />
      </Button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="absolute right-0 mt-2 w-56 origin-top-right z-20"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1, ease: 'easeOut' }}
          >
            <div
              className="bg-surface/90 backdrop-blur-md rounded-lg shadow-xl p-2"
              role="menu"
              aria-orientation="vertical"
            >
              {sortOptions.map((option) => {
                const isSelected = sortCriteria.key === option.key && sortCriteria.order === option.order;
                return (
                  <button
                    key={`${option.key}-${option.order}`}
                    onClick={() => handleSelect(option)}
                    className={`
                      w-full text-left px-3 py-2 text-sm rounded-md flex items-center justify-between
                      transition-colors duration-150
                      ${isSelected ? 'bg-card-active text-text-primary font-semibold' : 'text-text-primary hover:bg-bg-primary'}
                    `}
                    role="menuitem"
                  >
                    <span>{option.label}</span>
                    {isSelected && <Check size={16} />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Thumbnail({ path, data, onImageClick, onImageDoubleClick, isSelected, isActive, rating, onContextMenu }) {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (data) {
      setIsLoaded(true);
    }
  }, [data]);

  const ringClass = isActive
    ? 'ring-2 ring-accent'
    : isSelected
    ? 'ring-2 ring-gray-400'
    : 'hover:ring-2 hover:ring-hover-color';

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onImageClick(path, e);
      }}
      onDoubleClick={() => onImageDoubleClick(path)}
      onContextMenu={onContextMenu}
      className={`aspect-square bg-surface rounded-md overflow-hidden cursor-pointer group relative transition-all duration-150 ${ringClass}`}
      title={path.split(/[\\/]/).pop()}
    >
      {data ? (
        <img
          src={data}
          alt={path}
          className={`
            w-full h-full object-cover
            group-hover:scale-[1.02]
            transition ease-in-out duration-300
            ${isLoaded ? 'opacity-100' : 'opacity-0'}
          `}
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-surface">
          <ImageIcon className="text-text-secondary animate-pulse" />
        </div>
      )}
      {rating > 0 && (
        <div className="absolute top-1.5 right-1.5 bg-bg-primary/50 rounded-full px-1.5 py-0.5 text-xs text-text-primary flex items-center gap-1 backdrop-blur-sm">
          <span>{rating}</span>
          <Star size={12} className="text-accent fill-accent" />
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
        <p className="text-white text-xs truncate">{path.split(/[\\/]/).pop()}</p>
      </div>
    </div>
  );
}

export default function MainLibrary({
  imageList,
  onImageClick,
  onImageDoubleClick,
  onContextMenu,
  onEmptyAreaContextMenu,
  multiSelectedPaths,
  activePath,
  rootPath,
  currentFolderPath,
  onOpenFolder,
  thumbnails,
  imageRatings,
  appSettings,
  onContinueSession,
  onGoHome,
  onClearSelection,
  sortCriteria,
  setSortCriteria,
  onSettingsChange,
  onLibraryRefresh,
  theme,
}) {
  const [showSettings, setShowSettings] = useState(false);
  const prevFolderPathRef = useRef();
  const isNewFolder = currentFolderPath !== prevFolderPathRef.current;

  useEffect(() => {
    prevFolderPathRef.current = currentFolderPath;
  }, [currentFolderPath]);

  if (!rootPath) {
    if (!appSettings) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center h-full rounded-lg bg-bg-primary p-8 text-center">
          <ImageIcon size={80} className="text-accent opacity-20 mb-6 animate-pulse" />
          <h1 className="text-3xl font-bold text-primary mb-2">RapidRAW</h1>
          <p className="text-text-secondary mb-8">Loading settings...</p>
        </div>
      );
    }

    const hasLastPath = !!appSettings.lastRootPath;
    const currentThemeId = theme || DEFAULT_THEME_ID;
    const selectedTheme = THEMES.find(t => t.id === currentThemeId) || THEMES.find(t => t.id === DEFAULT_THEME_ID);
    const splashImage = selectedTheme.splashImage;

    return (
      <div className="flex-1 flex h-full bg-bg-secondary overflow-hidden shadow-lg">
        <div className="w-1/2 hidden md:block relative">
          <AnimatePresence>
            <motion.img
              key={splashImage}
              src={splashImage}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: 'easeInOut' }}
              className="absolute inset-0 w-full h-full object-cover"
              alt="Splash screen background"
            />
          </AnimatePresence>
        </div>

        <div className="w-full md:w-1/2 flex flex-col p-8 lg:p-16 relative">
          {showSettings ? (
            <SettingsPanel
              onBack={() => setShowSettings(false)}
              appSettings={appSettings}
              onSettingsChange={onSettingsChange}
              rootPath={rootPath}
              onLibraryRefresh={onLibraryRefresh}
            />
          ) : (
            <>
              <div className="my-auto text-left">
                <h1 className="text-5xl font-bold text-text-primary text-shadow-shiny mb-4">
                  RapidRAW
                </h1>
                <p className="text-text-secondary mb-10 max-w-md">
                  {hasLastPath ? (
                    <>
                      Welcome back!<br />
                      Continue where you left off or start a new session.
                    </>
                  ) : (
                    "A blazingly fast, GPU-accelerated RAW image editor. Open a folder to begin."
                  )}
                </p>
                <div className="flex flex-col w-full max-w-xs gap-4">
                  {hasLastPath && (
                    <Button onClick={onContinueSession} size="lg" className="rounded-md h-11 w-full flex justify-start items-center">
                      <RefreshCw size={20} className="mr-2" /> Continue Session
                    </Button>
                  )}
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={onOpenFolder}
                      size="lg"
                      className={`rounded-md flex-grow flex justify-start items-center h-11 ${hasLastPath ? 'bg-surface text-text-primary shadow-none' : ''}`}
                    >
                      <Folder size={20} className="mr-2" />
                      {hasLastPath ? "Change Folder" : "Open Folder"}
                    </Button>
                    <Button 
                      onClick={() => setShowSettings(true)} 
                      size="lg" 
                      variant="ghost" 
                      className="px-3 bg-surface text-text-primary shadow-none h-11"
                      title="Settings"
                    >
                      <Settings size={20} />
                    </Button>
                  </div>
                </div>
              </div>
              <p className="absolute bottom-8 left-8 lg:left-16 text-xs text-text-secondary">Version 1.0.8 - Images by Timon Käch (@timonkaech.photography)</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-bg-secondary rounded-lg overflow-hidden">
      <header className="p-4 flex-shrink-0 flex justify-between items-center border-b border-border-color">
        <div>
          <h2 className="text-2xl font-bold text-primary">Library</h2>
          <p className="text-sm text-text-secondary truncate">{currentFolderPath}</p>
        </div>
        <div className="flex items-center gap-3">
          <SortDropdown
            sortCriteria={sortCriteria}
            setSortCriteria={setSortCriteria}
          />
          <Button
            onClick={onOpenFolder}
            className="h-12 w-12 bg-surface text-text-primary shadow-none p-0 flex items-center justify-center"
            title="Open another folder"
          >
            <Folder className="w-8 h-8" />
          </Button>
          <Button
            onClick={onGoHome}
            className="h-12 w-12 bg-surface text-text-primary shadow-none p-0 flex items-center justify-center"
            title="Go to Home Screen"
          >
            <Home className="w-8 h-8" />
          </Button>
        </div>
      </header>


      {imageList.length === 0 ? (
        <div 
          className="flex-1 flex items-center justify-center text-text-secondary"
          onContextMenu={onEmptyAreaContextMenu}
        >
          <p>No images found in this folder.</p>
        </div>
      ) : (
        <div 
          className="flex-1 overflow-y-auto p-4"
          onClick={onClearSelection}
          onContextMenu={onEmptyAreaContextMenu}
        >
          <motion.div 
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4"
          >
            <AnimatePresence>
              {imageList.map((imageFile) => (
                <motion.div
                  key={imageFile.path}
                  layout
                  initial={isNewFolder ? false : { opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                >
                  <Thumbnail
                    path={imageFile.path}
                    data={thumbnails[imageFile.path]}
                    rating={imageRatings?.[imageFile.path] || 0}
                    onImageClick={onImageClick}
                    onImageDoubleClick={onImageDoubleClick}
                    isSelected={multiSelectedPaths.includes(imageFile.path)}
                    isActive={activePath === imageFile.path}
                    onContextMenu={(e) => onContextMenu(e, imageFile.path)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        </div>
      )}
    </div>
  );
}