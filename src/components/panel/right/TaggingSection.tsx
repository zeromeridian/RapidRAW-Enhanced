import CollapsibleSection from '../../ui/CollapsibleSection';
import { useUIStore } from '../../../store/useUIStore';

interface TaggingSectionProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
  id: string;
  title: string;
}

/** A collapsible Tagging panel section whose open state lasts for the session. */
export default function TaggingSection({ children, defaultOpen = true, id, title }: TaggingSectionProps) {
  const isOpen = useUIStore((state) => state.taggingSectionsOpen[id] ?? defaultOpen);
  const toggleTaggingSection = useUIStore((state) => state.toggleTaggingSection);
  return (
    <CollapsibleSection
      canToggleVisibility={false}
      isContentVisible
      isOpen={isOpen}
      onToggle={() => toggleTaggingSection(id, defaultOpen)}
      title={title}
    >
      {children}
    </CollapsibleSection>
  );
}
