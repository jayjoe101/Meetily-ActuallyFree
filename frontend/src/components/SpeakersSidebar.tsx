"use client";

import React, { useState, useEffect, useRef } from 'react';
import {
  Users,
  Edit2,
  GitMerge,
  UserCheck,
  X,
  Check,
  Sparkles,
  ChevronRight,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  speakerDot,
  speakerColor,
  speakerBadgeClass,
  isUserSpeaker,
  displaySpeaker,
} from '@/utils/speakerUtils';
import { MergeSpeakerDialog } from './MergeSpeakerDialog';
import { DetectedSpeaker } from '@/types';
import { SPEAKERS_ROOMY_COLUMN } from '@/hooks/useCompactChrome';

interface SpeakersSidebarProps {
  speakers: DetectedSpeaker[];
  userName: string;
  isOpen: boolean;
  onClose: () => void;
  onRenameSpeaker: (fromSpeaker: string, toSpeaker: string) => Promise<void> | void;
  onMergeSpeaker: (sourceSpeaker: string, targetSpeaker: string) => Promise<void> | void;
  isRecording?: boolean;
}

export function SpeakersSidebar({
  speakers,
  userName,
  isOpen,
  onClose,
  onRenameSpeaker,
  onMergeSpeaker,
  isRecording,
}: SpeakersSidebarProps) {
  // Editing state for inline rename
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // Merge modal state
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(true);
  const panelWidth = compact ? 'w-44' : 'w-80';

  useEffect(() => {
    const parent = shellRef.current?.parentElement;
    if (!parent) return;
    const read = () => setCompact(parent.clientWidth < SPEAKERS_ROOMY_COLUMN);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  // Focus input when editing starts
  useEffect(() => {
    if (editingSpeaker && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingSpeaker]);

  const startRename = (speaker: string) => {
    setEditingSpeaker(speaker);
    setEditValue(isUserSpeaker(speaker) ? (userName || 'You') : speaker);
  };

  const commitRename = async () => {
    if (!editingSpeaker) return;
    const trimmed = editValue.trim();
    const old = editingSpeaker;
    setEditingSpeaker(null);

    if (trimmed && trimmed !== old) {
      await onRenameSpeaker(old, trimmed);
    }
  };

  const cancelRename = () => {
    setEditingSpeaker(null);
  };

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--af-speakers-width', isOpen ? (compact ? '11rem' : '20rem') : '0px');
    return () => {
      root.style.removeProperty('--af-speakers-width');
    };
  }, [isOpen, compact]);

  const totalTurns = speakers.reduce((sum, s) => sum + s.segmentCount, 0);

  return (
    <>
      <div
        ref={shellRef}
        className={`flex h-full shrink-0 justify-end overflow-hidden transition-[width] duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
          isOpen ? panelWidth : 'pointer-events-none w-0'
        }`}
        aria-hidden={!isOpen}
      >
      <aside
        className={`flex h-full shrink-0 flex-col border-l border-[var(--af-border,#e5e7eb)] bg-[var(--af-panel,#ffffff)] ${panelWidth}`}
        aria-label="Detected Speakers Sidebar"
      >
        {/* Header. The title is the only flexible piece so the count and close control never collide. */}
        <div className={`flex items-center border-b border-[var(--af-border,#e5e7eb)] ${compact ? 'gap-1.5 px-2.5 py-2' : 'gap-2 px-4 py-3.5'}`}>
          <Users size={compact ? 14 : 18} className="shrink-0 text-blue-500" />
          <span className={`min-w-0 flex-1 truncate font-semibold text-[var(--af-text,#111827)] ${compact ? 'text-[13px]' : 'text-sm'}`}>
            {compact ? 'Speakers' : 'Detected Speakers'}
          </span>
          <span className={`shrink-0 rounded-full bg-blue-500/10 font-semibold tabular-nums text-blue-600 dark:text-blue-400 ${compact ? 'px-1.5 py-px text-[10px]' : 'px-2 py-0.5 text-xs'}`}>
            {speakers.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            className={`shrink-0 rounded-md text-[var(--af-text-3,#9ca3af)] transition-colors hover:bg-[var(--af-panel-2,#f3f4f6)] hover:text-[var(--af-text,#111827)] ${compact ? 'grid h-6 w-6 place-items-center' : 'p-1'}`}
            title="Close sidebar"
            aria-label="Close speakers"
          >
            <X size={compact ? 14 : 18} />
          </button>
        </div>

        {/* Live Call Active Banner */}
        {isRecording && (
          <div className={`flex items-center gap-2 border-b border-blue-500/15 bg-blue-500/5 text-xs text-blue-600 dark:text-blue-400 ${compact ? 'px-2 py-1.5' : 'px-4 py-2'}`}>
            <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500 animate-pulse" />
            <span className="truncate">{compact ? 'Live' : 'Listening & recognizing voices live'}</span>
          </div>
        )}

        {/* Speaker List */}
        <div className={`flex-1 overflow-y-auto ${compact ? 'space-y-1.5 p-2' : 'space-y-3 p-4'}`}>
          {speakers.length === 0 ? (
            <div className={`text-center text-[var(--af-text-3,#6b7280)] ${compact ? 'px-1 py-8' : 'px-2 py-12'}`}>
              <Users size={compact ? 22 : 32} className="mx-auto mb-2 opacity-40" />
              <p className={`font-medium ${compact ? 'text-xs' : 'text-sm'}`}>
                {compact ? 'No speakers yet' : 'No speakers detected yet'}
              </p>
              <p className={`mt-1 leading-snug opacity-75 ${compact ? 'text-[11px]' : 'text-xs'}`}>
                {compact
                  ? 'Voices show up here as they are recognized.'
                  : 'Speakers identified by voice diarization will appear here automatically.'}
              </p>
            </div>
          ) : (
            speakers.map((s) => {
              const isEditing = editingSpeaker === s.name;
              const isYou = s.isUser || isUserSpeaker(s.name);
              const label = displaySpeaker(s.name, userName);
              const percentage = totalTurns > 0 ? Math.round((s.segmentCount / totalTurns) * 100) : 0;

              const cardTone = isYou
                ? 'border-blue-500/30 bg-blue-500/5 hover:border-blue-500/50'
                : 'border-[var(--af-border,#e5e7eb)] bg-[var(--af-panel-2,#f9fafb)] hover:border-[var(--af-border-strong,#d1d5db)]';

              const renameField = (
                <Input
                  ref={editInputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitRename();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                  onBlur={commitRename}
                  className="h-7 w-auto min-w-0 flex-1 px-2 py-0 text-xs border-blue-500 focus-visible:ring-1"
                  placeholder="Speaker name"
                  aria-label={`Rename ${label}`}
                />
              );

              if (compact) {
                return (
                  <div key={s.id || s.name} className={`overflow-hidden rounded-lg border ${cardTone}`}>
                    {isEditing ? (
                      <div className="p-2">
                        <div className="flex items-center gap-1.5">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${speakerDot(s.name)}`} />
                          {renameField}
                        </div>
                        <div className="mt-1.5 flex justify-end gap-1">
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              cancelRename();
                            }}
                            className="grid h-6 w-6 place-items-center rounded-md text-[var(--af-text-3)] hover:bg-[var(--af-hover)] hover:text-[var(--af-text)]"
                            aria-label="Cancel rename"
                          >
                            <X size={13} />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              commitRename();
                            }}
                            className="grid h-6 w-6 place-items-center rounded-md bg-blue-600 text-white hover:bg-blue-700"
                            aria-label="Save name"
                          >
                            <Check size={13} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => startRename(s.name)}
                          title="Rename"
                          className="flex w-full min-w-0 items-center gap-2 text-left text-[var(--af-text,#111827)] hover:text-blue-600 dark:hover:text-blue-400"
                        >
                          <span className={`h-2 w-2 shrink-0 rounded-full ${speakerDot(s.name)}`} />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5">
                            {label}
                          </span>
                        </button>
                        <div className="mt-1 flex items-center gap-1 pl-4">
                          <span
                            className="min-w-0 flex-1 truncate text-[10px] tabular-nums leading-none text-[var(--af-text-3,#6b7280)]"
                            title={`${s.segmentCount} ${s.segmentCount === 1 ? 'turn' : 'turns'}, ${percentage}% of this conversation`}
                          >
                            {s.segmentCount} · {percentage}%
                          </span>
                          <div className="flex shrink-0 items-center">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => setMergeSource(s.name)}
                                  className="grid h-6 w-6 place-items-center rounded-md text-[var(--af-text-3,#9ca3af)] transition-colors hover:bg-blue-500/10 hover:text-blue-600"
                                  aria-label={`Merge ${label} into another speaker`}
                                >
                                  <GitMerge size={13} />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="left">Merge into another speaker</TooltipContent>
                            </Tooltip>
                            {!isYou && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => onRenameSpeaker(s.name, 'You')}
                                    className="grid h-6 w-6 place-items-center rounded-md text-[var(--af-text-3,#9ca3af)] transition-colors hover:bg-blue-500/10 hover:text-blue-600"
                                    aria-label={`Mark ${label} as me`}
                                  >
                                    <UserCheck size={13} />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="left">Mark as me</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <div
                  key={s.id || s.name}
                  className={`group relative rounded-xl border p-3 transition-all duration-150 ${cardTone}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <span className={`h-3 w-3 shrink-0 rounded-full ${speakerDot(s.name)}`} />

                      {isEditing ? (
                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                          {renameField}
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              commitRename();
                            }}
                            className="shrink-0 rounded bg-blue-600 p-1 text-white hover:bg-blue-700"
                            title="Save"
                            aria-label="Save name"
                          >
                            <Check size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => startRename(s.name)}
                            title="Click to rename"
                            className="group/name flex w-full min-w-0 items-center gap-1.5 text-left text-sm font-medium text-[var(--af-text,#111827)] hover:text-blue-600 dark:hover:text-blue-400"
                          >
                            <span className="min-w-0 flex-1 truncate">{label}</span>
                            <Edit2
                              size={12}
                              className="shrink-0 text-[var(--af-text-3,#9ca3af)] opacity-0 transition-opacity group-hover/name:opacity-100"
                            />
                          </button>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--af-text-3,#6b7280)]">
                            <span>
                              {s.segmentCount} {s.segmentCount === 1 ? 'turn' : 'turns'}
                            </span>
                            <span>•</span>
                            <span>{percentage}%</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {!isEditing && (
                      <div className="flex shrink-0 items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => setMergeSource(s.name)}
                              className="rounded-md p-1.5 text-[var(--af-text-3,#9ca3af)] transition-colors hover:bg-blue-500/10 hover:text-blue-600"
                              aria-label={`Merge ${label} into another speaker`}
                            >
                              <GitMerge size={15} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top">Merge into another speaker</TooltipContent>
                        </Tooltip>
                        {!isYou && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => onRenameSpeaker(s.name, 'You')}
                                className="rounded-md p-1.5 text-[var(--af-text-3,#9ca3af)] transition-colors hover:bg-blue-500/10 hover:text-blue-600"
                                aria-label={`Mark ${label} as me`}
                              >
                                <UserCheck size={15} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top">Mark as me</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info tip */}
        {!compact && (
        <div className="p-3 border-t border-[var(--af-border,#e5e7eb)] bg-[var(--af-panel-2,#f9fafb)]">
          <div className="flex items-start gap-2 text-[11px] text-[var(--af-text-3,#6b7280)]">
            <Info size={14} className="shrink-0 mt-0.5 text-blue-500" />
            <p className="leading-tight">
              Click any speaker name to rename on the spot. Use the merge icon to combine two speakers who are the same person.
            </p>
          </div>
        </div>
        )}
      </aside>
      </div>

      {/* Merge Speaker Modal */}
      <MergeSpeakerDialog
        open={mergeSource !== null}
        onOpenChange={(open) => !open && setMergeSource(null)}
        sourceSpeaker={mergeSource}
        availableSpeakers={speakers.map((s) => ({
          id: s.id,
          name: s.name,
          isUser: s.isUser,
          segmentCount: s.segmentCount,
        }))}
        onMerge={async (source, target) => {
          await onMergeSpeaker(source, target);
          setMergeSource(null);
        }}
      />
    </>
  );
}
