import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import Button from '../ui/Button';
import Text from '../ui/Text';
import { TextColor, TextColors, TextVariants } from '../../types/typography';
import { ImportIssueKind, ImportReport } from '../ui/ExportImportProperties';

interface ImportSummaryModalProps {
  /** The finished import; null closes the dialog. */
  report: ImportReport | null;
  onClose(): void;
  /** Opens `folder` in the Library. */
  onShowFolder(folder: string): void;
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** What an import did (Plan item 64): counts, the problems with their reasons, its folders. */
export default function ImportSummaryModal({ report, onClose, onShowFolder }: ImportSummaryModalProps) {
  const { t } = useTranslation();
  const [shownReport, setShownReport] = useState<ImportReport | null>(null);
  const [show, setShow] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  useEffect(() => {
    if (report) {
      setShownReport(report);
      setIsDetailsOpen(false);
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    }
    setShow(false);
    const timer = setTimeout(() => setShownReport(null), 300);
    return () => clearTimeout(timer);
  }, [report]);

  if (!shownReport) return null;

  const { imported, issues, folders } = shownReport;
  const issuesOf = (kind: ImportIssueKind) => issues.filter((issue) => issue.kind === kind);
  const skipped = issuesOf(ImportIssueKind.NameTaken);
  const failed = issuesOf(ImportIssueKind.Failed);
  const sourceKept = issuesOf(ImportIssueKind.SourceKept);
  const suffixed = imported.filter((file) => file.suffixed).length;
  const seconds = Math.max(1, Math.round(shownReport.elapsedMs / 1000));
  const folderToShow = folders.length === 1 ? folders[0] : shownReport.destination;

  const lines: Array<{ text: string; color?: TextColor }> = [
    {
      text: t(shownReport.moved ? 'modals.importSummary.moved' : 'modals.importSummary.copied', {
        count: imported.length,
      }),
      color: TextColors.primary,
    },
    ...(suffixed > 0 ? [{ text: t('modals.importSummary.suffixed', { count: suffixed }) }] : []),
    ...(skipped.length > 0 ? [{ text: t('modals.importSummary.skipped', { count: skipped.length }) }] : []),
    ...(sourceKept.length > 0
      ? [{ text: t('modals.importSummary.sourceKept', { count: sourceKept.length }), color: TextColors.error }]
      : []),
    ...(failed.length > 0
      ? [{ text: t('modals.importSummary.failed', { count: failed.length }), color: TextColors.error }]
      : []),
    ...(shownReport.notStarted > 0
      ? [{ text: t('modals.importSummary.notStarted', { count: shownReport.notStarted }) }]
      : []),
  ];

  const issueReason = (kind: ImportIssueKind, message: string | null) =>
    kind === ImportIssueKind.NameTaken
      ? t('modals.importSummary.reasonNameTaken')
      : kind === ImportIssueKind.SourceKept
        ? t('modals.importSummary.reasonSourceKept', { message: message ?? '' })
        : (message ?? '');

  return (
    <div
      aria-labelledby="import-summary-title"
      aria-modal="true"
      className={`fixed inset-0 flex items-center justify-center z-50 bg-black/30 backdrop-blur-xs transition-opacity duration-300 ease-in-out ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onClose}
      role="dialog"
    >
      <div
        className={`bg-surface rounded-lg shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto transform transition-all duration-300 ease-out ${
          show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'
        }`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <Text variant={TextVariants.title} id="import-summary-title" className="mb-4">
          {t(shownReport.cancelled ? 'modals.importSummary.titleCancelled' : 'modals.importSummary.title')}
        </Text>

        <div className="space-y-1 text-sm">
          {lines.map((line) => (
            <Text key={line.text} color={line.color}>
              {line.text}
            </Text>
          ))}
          <Text variant={TextVariants.small}>{t('modals.importSummary.elapsed', { count: seconds })}</Text>
        </div>

        {folders.length > 0 && (
          <div className="mt-4">
            <Text variant={TextVariants.heading} className="block mb-1">
              {t('modals.importSummary.folders')}
            </Text>
            <div className="max-h-32 overflow-y-auto space-y-0.5">
              {folders.map((folder) => (
                <Text key={folder} variant={TextVariants.small} className="font-mono break-all">
                  {folder}
                </Text>
              ))}
            </div>
          </div>
        )}

        {issues.length > 0 && (
          <div className="mt-4">
            <button
              className="flex items-center gap-1 text-text-secondary hover:text-text-primary transition-colors"
              onClick={() => setIsDetailsOpen((isOpen) => !isOpen)}
              type="button"
            >
              {isDetailsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <Text as="span" variant={TextVariants.label}>
                {t('modals.importSummary.details', { count: issues.length })}
              </Text>
            </button>
            {isDetailsOpen && (
              <div className="mt-2 max-h-48 overflow-y-auto space-y-1 bg-bg-primary rounded-md p-2">
                {issues.map((issue) => (
                  <Text key={`${issue.kind}:${issue.source}`} variant={TextVariants.small} className="break-all">
                    <span className="font-mono text-text-primary">{fileName(issue.source)}</span>
                    {` — ${issueReason(issue.kind, issue.message)}`}
                  </Text>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <Button
            className="bg-bg-primary shadow-transparent hover:bg-bg-primary text-white shadow-none focus:outline-hidden focus:ring-0"
            onClick={onClose}
            variant="ghost"
          >
            {t('modals.importSummary.close')}
          </Button>
          {imported.length > 0 && (
            <Button
              autoFocus
              className="focus:outline-hidden focus:ring-0 focus:ring-offset-0"
              onClick={() => {
                onShowFolder(folderToShow);
                onClose();
              }}
            >
              {t('modals.importSummary.showInLibrary')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
