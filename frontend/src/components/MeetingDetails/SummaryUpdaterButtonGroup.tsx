"use client";
import { Spinner } from '@/components/ui/spinner';

import { ToolbarButton as Button } from './ToolbarButton';
import { ButtonGroup } from '@/components/ui/button-group';
import { Copy, Save } from 'lucide-react';
import Analytics from '@/lib/analytics';

interface SummaryUpdaterButtonGroupProps {
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => Promise<void>;
  onCopy: () => Promise<void>;
  onExport?: () => void;
  onFind?: () => void;
  onOpenFolder: () => Promise<void>;
  hasSummary: boolean;
}

export function SummaryUpdaterButtonGroup({
  isSaving,
  isDirty,
  onSave,
  onCopy,
  onExport,
  onFind,
  onOpenFolder,
  hasSummary
}: SummaryUpdaterButtonGroupProps) {
  return (
    <ButtonGroup className="meeting-toolbar-group">
      {/* Save button */}
      <Button
        variant="outline"
        size="sm"
        className={isDirty ? 'border-[var(--af-accent)] text-[var(--af-accent)]' : ''}
        title={isSaving ? "Saving" : "Save Changes"}
        onClick={() => {
          Analytics.trackButtonClick('save_changes', 'meeting_details');
          onSave();
        }}
        disabled={isSaving}
      >
        {isSaving ? (
          <>
            <Spinner className="" />
            <span className="summary-action-label">Saving...</span>
          </>
        ) : (
          <>
            <Save />
            <span className="summary-action-label">Save</span>
          </>
        )}
      </Button>

      {/* Copy button */}
      <Button
        variant="outline"
        size="sm"
        title="Copy Summary"
        onClick={() => {
          Analytics.trackButtonClick('copy_summary', 'meeting_details');
          onCopy();
        }}
        disabled={!hasSummary}
        className="cursor-pointer"
      >
        <Copy />
        <span className="summary-action-label">Copy</span>
      </Button>
    </ButtonGroup>
  );
}
