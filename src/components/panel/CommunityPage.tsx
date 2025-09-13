import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Image as ImageIcon,
  Loader2,
  Search,
  Users,
  Github,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { Invokes } from '../ui/AppProperties';
import { INITIAL_ADJUSTMENTS } from '../../utils/adjustments';

const DEFAULT_PREVIEW_IMAGE_URL = 'https://raw.githubusercontent.com/CyberTimon/RapidRAW-Presets/main/sample-image.jpg';

interface CommunityPreset {
  name: string;
  creator: string;
  adjustments: Record<string, any>;
}

const containerVariants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
    },
  },
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
  },
};

const CommunityPage = ({ onBackToLibrary }: { onBackToLibrary: () => void }) => {
  const [presets, setPresets] = useState<CommunityPreset[]>([]);
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [previewImagePath, setPreviewImagePath] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [downloadStatus, setDownloadStatus] = useState<Record<string, 'idle' | 'downloading' | 'success'>>({});
  const [allPreviewsLoaded, setAllPreviewsLoaded] = useState(false);

  const previewsRef = useRef(previews);
  previewsRef.current = previews;

  const fetchDefaultPreviewImage = useCallback(async () => {
    try {
      const response = await fetch(DEFAULT_PREVIEW_IMAGE_URL);
      const blob = await response.blob();
      const tempPath: string = await invoke(Invokes.SaveTempFile, { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) });
      setPreviewImagePath(tempPath);
    } catch (error) {
      console.error("Failed to fetch default preview image:", error);
    }
  }, []);

  useEffect(() => {
    const fetchPresets = async () => {
      setIsLoading(true);
      try {
        const communityPresets: CommunityPreset[] = await invoke(Invokes.FetchCommunityPresets);
        setPresets(communityPresets);
      } catch (error) {
        console.error("Failed to fetch community presets:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPresets();
    fetchDefaultPreviewImage();

    return () => {
      Object.values(previewsRef.current).forEach(url => {
        if (url && url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [fetchDefaultPreviewImage]);

  useEffect(() => {
    if (presets.length === 0 || !previewImagePath) {
      return;
    }

    const generateAllPreviews = async () => {
      setAllPreviewsLoaded(false);
      const newPreviews: Record<string, string | null> = {};

      const previewPromises = presets.map(async (preset) => {
        try {
          const fullPresetAdjustments = { ...INITIAL_ADJUSTMENTS, ...preset.adjustments };

          const imageData: Uint8Array = await invoke(Invokes.GenerateCommunityPresetPreview, {
            imagePath: previewImagePath,
            jsAdjustments: fullPresetAdjustments,
          });

          const blob = new Blob([imageData], { type: 'image/jpeg' });
          return { name: preset.name, url: URL.createObjectURL(blob) };
        } catch (error) {
          console.error(`Failed to generate preview for ${preset.name}:`, error);
          return { name: preset.name, url: null };
        }
      });

      const results = await Promise.all(previewPromises);
      
      results.forEach(result => {
        newPreviews[result.name] = result.url;
      });

      setPreviews(prev => {
        Object.values(prev).forEach(url => url?.startsWith('blob:') && URL.revokeObjectURL(url));
        return newPreviews;
      });
      setAllPreviewsLoaded(true);
    };

    generateAllPreviews();

  }, [presets, previewImagePath]);


  const handleSelectPreviewImage = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Image', extensions: ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'webp', 'arw', 'cr2', 'nef', 'dng'] }],
        defaultPath: await homeDir(),
      });
      if (typeof selected === 'string') {
        setPreviews({});
        setPreviewImagePath(selected);
      }
    } catch (error) {
      console.error("Failed to open file dialog:", error);
    }
  };

  const handleDownloadPreset = async (preset: CommunityPreset) => {
    setDownloadStatus(prev => ({ ...prev, [preset.name]: 'downloading' }));
    try {
      if (!preset.adjustments) {
          throw new Error("Preset adjustments are missing.");
      }

      await invoke(Invokes.SaveCommunityPreset, {
        name: preset.name,
        adjustments: preset.adjustments,
      });
      setDownloadStatus(prev => ({ ...prev, [preset.name]: 'success' }));
    } catch (error) {
      console.error(`Failed to download preset ${preset.name}:`, error);
      setDownloadStatus(prev => ({ ...prev, [preset.name]: 'idle' }));
    }
  };

  const filteredAndSortedPresets = useMemo(() => {
    return presets
      .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => {
        if (sortBy === 'name') {
          return a.name.localeCompare(b.name);
        }
        return 0;
      });
  }, [presets, searchTerm, sortBy]);

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-bg-secondary rounded-lg overflow-hidden p-4">
      <header className="flex-shrink-0 flex items-center justify-between mb-4 flex-wrap gap-4">
        <div className="flex items-center">
          <Button
            className="mr-4 hover:bg-surface text-text-primary rounded-full"
            onClick={onBackToLibrary}
            size="icon"
            variant="ghost"
          >
            <ArrowLeft />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
              <Users /> Community Presets
            </h1>
            <p className="text-sm text-text-secondary">Discover presets created by the community.</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Button onClick={handleSelectPreviewImage} variant="secondary">
            <ImageIcon size={16} className="mr-2" />
            Change Preview Image
          </Button>
        </div>
      </header>

      <div className="flex justify-between items-center mb-4 flex-wrap gap-4">
        <div className="relative">
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search presets..."
            className="pl-10 w-64"
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary" />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-text-secondary">Sort by:</span>
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-surface border border-border-color rounded-md py-1.5 pl-3 pr-8 text-sm appearance-none focus:ring-accent focus:border-accent"
            >
              <option value="name">Name (A-Z)</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 -mr-2">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-text-secondary">
            <Loader2 className="h-8 w-8 animate-spin mr-2" />
            Fetching presets from GitHub...
          </div>
        ) : (
          <motion.div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            <AnimatePresence>
              {filteredAndSortedPresets.map(preset => {
                const previewUrl = previews[preset.name];
                const status = downloadStatus[preset.name] || 'idle';
                if (!previewUrl) {
                  return null;
                }
                return (
                  <motion.div
                    key={preset.name}
                    layout
                    variants={itemVariants}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="bg-surface rounded-lg overflow-hidden group border border-border-color flex flex-col"
                  >
                    <div className="relative w-full h-45 bg-bg-primary flex items-center justify-center">
                      <img 
                        src={previewUrl} 
                        alt={preset.name} 
                        className="w-full h-full object-cover transition-all duration-300 group-hover:blur-sm group-hover:brightness-75" 
                      />
                      
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleDownloadPreset(preset)}
                          disabled={status !== 'idle'}
                          className="shadow-lg"
                        >
                          {status === 'idle' && <>Save</>}
                          {status === 'downloading' && <><Loader2 size={14} className="mr-2 animate-spin" /> Saving...</>}
                          {status === 'success' && <><CheckCircle2 size={14} className="mr-2" /> Saved</>}
                        </Button>
                      </div>
                    </div>
                    <div className="p-3 text-center">
                      <h4 className="font-semibold truncate text-text-primary">{preset.name}</h4>
                      <p className="text-xs text-text-secondary font-['cursive'] italic mt-1">by {preset.creator}</p>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        )}
        {allPreviewsLoaded && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="text-center mt-8 py-4 text-sm text-text-secondary"
          >
            <p>Want to get your preset featured?</p>
            <a
              href="https://github.com/CyberTimon/RapidRAW-Presets/issues/new?assignees=&labels=preset-submission&template=preset_submission.md&title=Preset+Submission%3A+%5BYour+Preset+Name%5D"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline inline-flex items-center gap-2"
            >
              <Github size={14} />
              Create an issue on GitHub
            </a>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default CommunityPage;