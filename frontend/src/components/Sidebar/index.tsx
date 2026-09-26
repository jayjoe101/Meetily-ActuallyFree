'use client';

/**
 * Primary left navigation sidebar.
 *
 * Layout (top → bottom): brand mark (see Logo.tsx), a global-search trigger
 * (Ctrl/Cmd+K), a red "New Recording" action, a "RECENT MEETINGS"
 * list (dot + title + date-subtitle from `created_at`, with a "View all
 * library" toggle capped by RECENT_LIMIT), and a Settings-only footer.
 *
 * Supports shift/ctrl multi-select + bulk delete of meetings.
 *
 * State/wiring:
 *  - Reads the meetings list + current meeting + recording status from
 *    SidebarProvider (useSidebar) — the single source of truth kept in sync
 *    with the Rust core via Tauri commands/events.
 *  - Navigation uses next/navigation; selecting a meeting routes to
 *    /meeting-details?id=...  (see app/meeting-details/page-content.tsx).
 *  - Default state is expanded (isCollapsed=false in SidebarProvider).
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, FileText, AudioLines, ArrowRight, Settings, Calendar, Trash2, Mic, Square, Plus, Search, Pencil, NotebookPen, Upload } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { useSidebar } from './SidebarProvider';
import type { CurrentMeeting } from '@/components/Sidebar/SidebarProvider';
import { ConfirmationModal } from '../ConfirmationModel/confirmation-modal';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { TranscriptModelProps } from '@/components/TranscriptSettings';
import Analytics from '@/lib/analytics';
import { SIDEBAR_DEFAULT } from '@/hooks/useCompactChrome';
import { invoke } from '@tauri-apps/api/core';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useImportDialog } from '@/contexts/ImportDialogContext';
import { useConfig } from '@/contexts/ConfigContext';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import { VisuallyHidden } from "@/components/ui/visually-hidden"

import { MessageToast } from '../MessageToast';
import Logo from '../Logo';
import { ComplianceNotification } from '../ComplianceNotification';

interface SidebarItem {
  id: string;
  title: string;
  type: 'folder' | 'file';
  children?: SidebarItem[];
  createdAt?: string;
  durationSeconds?: number;
}

function formatDurationShort(secs?: number): string {
  if (secs == null || !Number.isFinite(secs) || secs <= 0) return '';
  const total = Math.round(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

// "RECENT MEETINGS" rows show a date/time subtitle. Meetings created before the
// timestamp was tracked fall back to parsing it out of the auto-generated title
// (e.g. "Meeting 2026-08-05_21-59-55").
function parseMeetingDate(item: { createdAt?: string; title?: string }): Date | null {
  if (item.createdAt) {
    const d = new Date(item.createdAt);
    if (!isNaN(d.getTime())) return d;
  }
  const m = item.title?.match(/(\d{4})-(\d{2})-(\d{2})[_ T](\d{2})[-:](\d{2})(?:[-:](\d{2}))?/);
  if (m) {
    const [, y, mo, da, h, mi, s] = m;
    const d = new Date(Number(y), Number(mo) - 1, Number(da), Number(h), Number(mi), Number(s || '0'));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function formatMeetingDate(d: Date): string {
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatMeetingTime(d: Date): string {
  return d.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Shared by the collapsed rail and the wide sidebar. The icon slot is always
// 40px, so a control grows to the right of its icon instead of being replaced.
const RAIL_EASE = 'ease-[cubic-bezier(0.22,1,0.36,1)]';

function RailIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-full w-10 shrink-0 items-center justify-center">
      {children}
    </span>
  );
}

function RailLabel({ expanded, children }: { expanded: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`grid min-w-0 flex-1 items-center transition-[grid-template-columns,opacity] motion-reduce:transition-none ${RAIL_EASE} ${
        expanded
          ? 'grid-cols-[1fr] opacity-100 delay-75 duration-200'
          : 'grid-cols-[0fr] opacity-0 duration-150'
      }`}
    >
      <span className="flex min-w-0 items-center overflow-hidden">{children}</span>
    </span>
  );
}

function RailTip({
  show,
  label,
  children,
}: {
  show: boolean;
  label: string;
  children: React.ReactElement;
}) {
  if (!show) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

const Sidebar: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const {
    currentMeeting,
    setCurrentMeeting,
    sidebarItems,
    isCollapsed,
    sidebarWidth,
    setSidebarWidth,
    previewSidebar,
    handleRecordingToggle,
    meetings,
    setMeetings,
    serverAddress
  } = useSidebar();

  // Get recording state from RecordingStateContext (single source of truth)
  const { isRecording } = useRecordingState();
  const { openImportDialog } = useImportDialog();
  const { betaFeatures } = useConfig();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['meetings']));
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    provider: 'ollama',
    model: '',
    whisperModel: '',
    apiKey: null,
    ollamaEndpoint: null
  });
  const [transcriptModelConfig, setTranscriptModelConfig] = useState<TranscriptModelProps>({
    provider: 'parakeet',
    model: 'parakeet-tdt-0.6b-v3-int8',
  });
  const [settingsSaveSuccess, setSettingsSaveSuccess] = useState<boolean | null>(null);

  // State for edit modal
  const [editModalState, setEditModalState] = useState<{ isOpen: boolean; meetingId: string | null; currentTitle: string }>({
    isOpen: false,
    meetingId: null,
    currentTitle: ''
  });
  const [editingTitle, setEditingTitle] = useState<string>('');

  // Ensure 'meetings' folder is always expanded
  useEffect(() => {
    if (!expandedFolders.has('meetings')) {
      const newExpanded = new Set(expandedFolders);
      newExpanded.add('meetings');
      setExpandedFolders(newExpanded);
    }
  }, [expandedFolders]);

  // useEffect(() => {
  //   if (settingsSaveSuccess !== null) {
  //     const timer = setTimeout(() => {
  //       setSettingsSaveSuccess(null);
  //     }, 3000);
  //   }
  // }, [settingsSaveSuccess]);


  const [deleteModalState, setDeleteModalState] = useState<{ isOpen: boolean; itemId: string | null }>({ isOpen: false, itemId: null });

  // Multi-select for the meeting list: shift-click selects a range, ctrl/cmd
  // click toggles one, and the selection can be deleted in bulk.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // "RECENT MEETINGS" shows the newest few with a "View all library" toggle.
  const RECENT_LIMIT = 8;
  const [showAllMeetings, setShowAllMeetings] = useState(false);

  useEffect(() => {
    // Note: Don't set hardcoded defaults - let DB be the source of truth
    const fetchModelConfig = async () => {
      // Only make API call if serverAddress is loaded
      if (!serverAddress) {
        console.log('Waiting for server address to load before fetching model config');
        return;
      }

      try {
        const data = await invoke('api_get_model_config') as any;
        if (data && data.provider !== null) {
          // Fetch API key if not included and provider requires it
          if (data.provider !== 'ollama' && !data.apiKey) {
            try {
              const apiKeyData = await invoke('api_get_api_key', {
                provider: data.provider
              }) as string;
              data.apiKey = apiKeyData;
            } catch (err) {
              console.error('Failed to fetch API key:', err);
            }
          }
          setModelConfig(data);
        }
      } catch (error) {
        console.error('Failed to fetch model config:', error);
      }
    };

    fetchModelConfig();
  }, [serverAddress]);


  useEffect(() => {
    // Note: Don't set hardcoded defaults - let DB be the source of truth
    const fetchTranscriptSettings = async () => {
      // Only make API call if serverAddress is loaded
      if (!serverAddress) {
        console.log('Waiting for server address to load before fetching transcript settings');
        return;
      }

      try {
        const data = await invoke('api_get_transcript_config') as any;
        if (data && data.provider !== null) {
          setTranscriptModelConfig(data);
        }
      } catch (error) {
        console.error('Failed to fetch transcript settings:', error);
      }
    };
    fetchTranscriptSettings();
  }, [serverAddress]);

  // Listen for model config updates from other components
  useEffect(() => {
    const setupListener = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<ModelConfig>('model-config-updated', (event) => {
        console.log('Sidebar received model-config-updated event:', event.payload);
        setModelConfig(event.payload);
      });

      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setupListener().then(fn => cleanup = fn);

    return () => {
      cleanup?.();
    };
  }, []);



  // Handle model config save
  const handleSaveModelConfig = async (config: ModelConfig) => {
    try {
      await invoke('api_save_model_config', {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey,
        ollamaEndpoint: config.ollamaEndpoint,
        summaryMaxTokens: config.summaryMaxTokens ?? null,
      });

      setModelConfig(config);
      console.log('Model config saved successfully');
      setSettingsSaveSuccess(true);

      // Emit event to sync other components
      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', config);

      // Track settings change
      await Analytics.trackSettingsChanged('model_config', `${config.provider}_${config.model}`);
    } catch (error) {
      console.error('Error saving model config:', error);
      setSettingsSaveSuccess(false);
    }
  };

  const handleSaveTranscriptConfig = async (updatedConfig?: TranscriptModelProps) => {
    try {
      const configToSave = updatedConfig || transcriptModelConfig;
      const payload = {
        provider: configToSave.provider,
        model: configToSave.model,
        apiKey: configToSave.apiKey ?? null
      };
      console.log('Saving transcript config with payload:', payload);

      await invoke('api_save_transcript_config', {
        provider: payload.provider,
        model: payload.model,
        apiKey: payload.apiKey,
      });


      setSettingsSaveSuccess(true);

      // Track settings change
      const transcriptConfigToSave = updatedConfig || transcriptModelConfig;
      await Analytics.trackSettingsChanged('transcript_config', `${transcriptConfigToSave.provider}_${transcriptConfigToSave.model}`);
    } catch (error) {
      console.error('Failed to save transcript config:', error);
      setSettingsSaveSuccess(false);
    }
  };

  const openGlobalSearch = () => window.dispatchEvent(new CustomEvent('open-global-search'));


  const handleDelete = async (itemId: string) => {
    console.log('Deleting item:', itemId);
    const payload = {
      meetingId: itemId
    };

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('api_delete_meeting', {
        meetingId: itemId,
      });
      console.log('Meeting deleted successfully');
      const updatedMeetings = meetings.filter((m: CurrentMeeting) => m.id !== itemId);
      setMeetings(updatedMeetings);

      // Track meeting deletion
      Analytics.trackMeetingDeleted(itemId);

      // Show success toast
      toast.success("Meeting deleted successfully", {
        description: "All associated data has been removed"
      });

      // If deleting the active meeting, navigate to home
      if (currentMeeting?.id === itemId) {
        setCurrentMeeting({ id: 'intro-call', title: '+ New Call' });
        router.push('/');
      }
    } catch (error) {
      console.error('Failed to delete meeting:', error);
      toast.error("Failed to delete meeting", {
        description: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const handleDeleteConfirm = () => {
    if (deleteModalState.itemId) {
      handleDelete(deleteModalState.itemId);
    }
    setDeleteModalState({ isOpen: false, itemId: null });
  };

  // Flat, ordered list of meeting ids as currently displayed — needed so a
  // shift-click can select the contiguous range between two clicks.
  const orderedMeetingIds = useMemo(() => {
    const ids: string[] = [];
    for (const folder of sidebarItems) {
      if (folder.type === 'folder' && folder.children) {
        for (const child of folder.children) {
          if (child.type === 'file' && child.id.includes('-') && !child.id.startsWith('intro-call')) {
            ids.push(child.id);
          }
        }
      }
    }
    return ids;
  }, [sidebarItems]);

  const clearSelection = () => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
  };

  const handleMeetingSelect = (id: string, e: React.MouseEvent) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (e.shiftKey && lastSelectedId) {
        const a = orderedMeetingIds.indexOf(lastSelectedId);
        const b = orderedMeetingIds.indexOf(id);
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(orderedMeetingIds[i]);
        } else {
          next.has(id) ? next.delete(id) : next.add(id);
        }
      } else {
        next.has(id) ? next.delete(id) : next.add(id);
      }
      return next;
    });
    setLastSelectedId(id);
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    let ok = 0;
    for (const id of ids) {
      try {
        await invoke('api_delete_meeting', { meetingId: id });
        Analytics.trackMeetingDeleted(id);
        ok++;
      } catch (error) {
        console.error('Failed to delete meeting', id, error);
      }
    }
    setMeetings(meetings.filter((m: CurrentMeeting) => !selectedIds.has(m.id)));
    if (currentMeeting && selectedIds.has(currentMeeting.id)) {
      setCurrentMeeting({ id: 'intro-call', title: '+ New Call' });
      router.push('/');
    }
    if (ok > 0) {
      toast.success(`Deleted ${ok} meeting${ok === 1 ? '' : 's'}`, {
        description: 'All associated data has been removed',
      });
    }
    if (ok < ids.length) {
      toast.error(`Failed to delete ${ids.length - ok} meeting${ids.length - ok === 1 ? '' : 's'}`);
    }
    clearSelection();
    setBulkDeleteOpen(false);
  };

  // Handle modal editing of meeting names
  const handleEditStart = (meetingId: string, currentTitle: string) => {
    setEditModalState({
      isOpen: true,
      meetingId: meetingId,
      currentTitle: currentTitle
    });
    setEditingTitle(currentTitle);
  };

  const handleEditConfirm = async () => {
    const newTitle = editingTitle.trim();
    const meetingId = editModalState.meetingId;

    if (!meetingId) return;

    // Prevent empty titles
    if (!newTitle) {
      toast.error("Meeting title cannot be empty");
      return;
    }

    try {
      await invoke('api_save_meeting_title', {
        meetingId: meetingId,
        title: newTitle,
      });

      // Update local state
      const updatedMeetings = meetings.map((m: CurrentMeeting) =>
        m.id === meetingId ? { ...m, title: newTitle } : m
      );
      setMeetings(updatedMeetings);

      // Update current meeting if it's the one being edited
      if (currentMeeting?.id === meetingId) {
        setCurrentMeeting({ id: meetingId, title: newTitle });
      }

      // Track the edit
      Analytics.trackButtonClick('edit_meeting_title', 'sidebar');

      toast.success("Meeting title updated successfully");

      // Close modal and reset state
      setEditModalState({ isOpen: false, meetingId: null, currentTitle: '' });
      setEditingTitle('');
    } catch (error) {
      console.error('Failed to update meeting title:', error);
      toast.error("Failed to update meeting title", {
        description: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const handleEditCancel = () => {
    setEditModalState({ isOpen: false, meetingId: null, currentTitle: '' });
    setEditingTitle('');
  };

  const toggleFolder = (folderId: string) => {
    // Normal toggle behavior for all folders
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);
    }
    setExpandedFolders(newExpanded);
  };

  // Expose setShowModelSettings to window for Rust tray to call
  useEffect(() => {
    (window as any).openSettings = () => {
      setShowModelSettings(true);
    };

    // Cleanup on unmount
    return () => {
      delete (window as any).openSettings;
    };
  }, []);

  const renderItem = (item: SidebarItem, depth = 0) => {
    const isExpanded = expandedFolders.has(item.id);
    // Keep meeting rows tight to the left so more of the title is visible.
    const paddingLeft = item.type === 'file' ? `${Math.max(6, depth * 4 + 2)}px` : `${depth * 12 + 12}px`;
    const isActive = item.type === 'file' && currentMeeting?.id === item.id;
    const isMeetingItem = item.id.includes('-') && !item.id.startsWith('intro-call');
    const isSelected = selectedIds.has(item.id);

    return (
      <div key={item.id}>
        <div
          className={`flex items-center transition-all duration-150 group select-none ${item.type === 'folder' && depth === 0
            ? 'p-3 text-lg font-semibold h-10 mx-3 mt-3 rounded-lg'
            : `px-2.5 py-2 my-0.5 rounded-lg text-sm ${isSelected ? 'bg-[var(--af-panel-2)] text-[var(--af-text)] ring-1 ring-[var(--af-accent)]/50' :
              isActive ? 'bg-[var(--af-panel-2)] text-[var(--af-text)] font-medium' :
                'hover:bg-[var(--af-hover)]'
            } cursor-pointer`
            }`}
          style={item.type === 'folder' && depth === 0 ? {} : { paddingLeft }}
          onClick={(e) => {
            if (item.type === 'folder') {
              toggleFolder(item.id);
              return;
            }
            // Shift / Ctrl / Cmd click manages a multi-selection instead of
            // navigating, so several meetings can be deleted at once.
            if (isMeetingItem && (e.shiftKey || e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleMeetingSelect(item.id, e);
              return;
            }
            if (selectedIds.size > 0) clearSelection();
            setCurrentMeeting({ id: item.id, title: item.title });
            const basePath = item.id.startsWith('intro-call') ? '/' :
              item.id.includes('-') ? `/meeting-details?id=${item.id}` : `/notes/${item.id}`;
            router.push(basePath);
          }}
        >
          {item.type === 'folder' ? (
            <>
              {item.id === 'meetings' ? (
                <Calendar className="w-4 h-4 mr-2" />
              ) : item.id === 'notes' ? (
                <Calendar className="w-4 h-4 mr-2" />
              ) : null}
              <span className={depth === 0 ? "" : "font-medium"}>{item.title}</span>
              <div className="ml-auto">
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                )}
              </div>
            </>
          ) : (
            (() => {
              const meetingDate = isMeetingItem ? parseMeetingDate(item) : null;
              const durationLabel = isMeetingItem ? formatDurationShort(item.durationSeconds) : '';
              return (
                <div className="relative flex w-full min-w-0 items-start gap-1.5">
                  {isMeetingItem ? (
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center ${isActive ? 'text-[var(--af-accent)]' : 'text-[var(--af-text-3)]'}`}>
                      {isActive ? <AudioLines className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                    </span>
                  ) : (
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-blue-100 text-blue-600">
                      <Plus className="h-3 w-3" />
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-[13px] leading-snug"
                      title={item.title}
                    >
                      {item.title}
                    </div>
                    {isMeetingItem && (
                      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] leading-tight text-[var(--af-text-3)]">
                        {meetingDate && <span className="truncate">{formatMeetingDate(meetingDate)}</span>}
                        {meetingDate && durationLabel && <span aria-hidden>·</span>}
                        {durationLabel && <span className="shrink-0 tabular-nums">{durationLabel}</span>}
                      </div>
                    )}
                  </div>

                  {isMeetingItem && (
                    <div className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-[var(--af-panel)] p-0.5 opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditStart(item.id, item.title);
                        }}
                        className="rounded-md p-1 text-[var(--af-text-3)] hover:bg-[var(--af-hover)] hover:text-[var(--af-accent)]"
                        aria-label="Edit meeting title"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteModalState({ isOpen: true, itemId: item.id });
                        }}
                        className="rounded-md p-1 text-[var(--af-text-3)] hover:bg-red-500/10 hover:text-red-500"
                        aria-label="Delete meeting"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })()
          )}
        </div>
        {item.type === 'folder' && isExpanded && item.children && (
          <div className="ml-1">
            {item.children.map(child => renderItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const expanded = !isCollapsed;
  const [dragging, setDragging] = useState(false);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const originX = event.clientX;
    const originWidth = sidebarWidth;
    setDragging(true);
    document.documentElement.setAttribute('data-sidebar-drag', '');
    const move = (moveEvent: PointerEvent) => {
      previewSidebar(originWidth + (moveEvent.clientX - originX));
    };
    const stop = (endEvent: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      const next = originWidth + (endEvent.clientX - originX);
      requestAnimationFrame(() => {
        document.documentElement.removeAttribute('data-sidebar-drag');
        setDragging(false);
        setSidebarWidth(next, originWidth);
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };
  const isMeetingPage = Boolean(pathname?.includes('/meeting-details'));
  const isSettingsPage = pathname === '/settings';
  const meetingsTitle = sidebarItems.find((item) => item.id === 'meetings')?.title ?? 'Recent Meetings';
  const meetingListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (meetingListRef.current) meetingListRef.current.inert = !expanded;
  }, [expanded]);

  const navButtonClass = (active: boolean) =>
    `flex h-10 w-full items-center overflow-hidden rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--af-accent)] ${
      active
        ? 'bg-[var(--af-hover)] text-[var(--af-text)]'
        : 'text-[var(--af-text-2)] hover:bg-[var(--af-hover)] hover:text-[var(--af-text)]'
    }`;

  return (
    <div
      className={`af-rail fixed top-0 left-0 z-20 h-screen overflow-hidden ${dragging ? '' : 'transition-[width] duration-300 ease-[cubic-bezier(0.22,1.25,0.36,1)] motion-reduce:transition-none'}`}
      style={{ width: sidebarWidth }}
    >
      <TooltipProvider>
        <div className="relative h-full w-full overflow-hidden">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            aria-valuemin={64}
            aria-valuemax={256}
            aria-valuenow={sidebarWidth}
            onPointerDown={startResize}
            className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize"
          />

          <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-[var(--af-panel)] shadow-none">
            <div className="flex shrink-0 flex-col gap-3 px-3 pt-4">
              <Logo expanded={expanded} />

              <RailTip show={!expanded} label="Search everything (Ctrl+K)">
                <button
                  type="button"
                  onClick={openGlobalSearch}
                  aria-label="Search everything"
                  className="flex h-10 w-full items-center overflow-hidden rounded-lg border border-[var(--af-border)] bg-[var(--af-panel)] text-[var(--af-text-3)] shadow-sm transition-colors hover:border-[var(--af-border-strong)] hover:bg-[var(--af-panel-2)] hover:text-[var(--af-text-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--af-accent)]"
                >
                  <RailIcon>
                    <Search className="h-5 w-5" />
                  </RailIcon>
                  <RailLabel expanded={expanded}>
                    <span className="min-w-0 flex-1 truncate pr-2 text-sm">Search everything</span>
                    <kbd className="mr-2.5 shrink-0 rounded border border-[var(--af-border-strong)] bg-[var(--af-panel-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--af-text-3)]">
                      Ctrl K
                    </kbd>
                  </RailLabel>
                </button>
              </RailTip>

              <RailTip show={!expanded} label={isRecording ? 'Recording in progress' : 'New Recording'}>
                <button
                  type="button"
                  onClick={handleRecordingToggle}
                  disabled={isRecording}
                  aria-label={isRecording ? 'Recording in progress' : 'New Recording'}
                  className={`flex h-10 w-full items-center overflow-hidden rounded-full bg-red-500 text-sm font-semibold text-white shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 ${
                    isRecording ? 'cursor-not-allowed opacity-80' : 'hover:bg-red-600'
                  }`}
                >
                  <RailIcon>
                    {isRecording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  </RailIcon>
                  <RailLabel expanded={expanded}>
                    <span className="truncate pr-3">{isRecording ? 'Recording…' : 'New Recording'}</span>
                  </RailLabel>
                </button>
              </RailTip>
            </div>

            <div className="mt-2 flex min-h-0 flex-1 flex-col px-3">
              <RailTip show={!expanded} label={meetingsTitle}>
                <button
                  type="button"
                  onClick={() => {
                    if (!expanded) setSidebarWidth(SIDEBAR_DEFAULT);
                  }}
                  aria-label={meetingsTitle}
                  className={navButtonClass(isMeetingPage)}
                >
                  <RailIcon>
                    <NotebookPen className="h-5 w-5" />
                  </RailIcon>
                  <RailLabel expanded={expanded}>
                    <span className="truncate pr-2 text-xs font-semibold uppercase tracking-wider">
                      {meetingsTitle}
                    </span>
                  </RailLabel>
                </button>
              </RailTip>

              <div
                ref={meetingListRef}
                aria-hidden={!expanded}
                className={`mt-1 flex min-h-0 flex-1 flex-col overflow-hidden transition-opacity motion-reduce:transition-none ${RAIL_EASE} ${
                  expanded ? 'opacity-100 delay-100 duration-200' : 'pointer-events-none opacity-0 duration-100'
                }`}
              >
                {selectedIds.size > 0 && (
                  <div className="mb-1 flex items-center justify-between rounded-md bg-blue-50 px-3 py-2 text-sm">
                    <span className="font-medium text-blue-700">{selectedIds.size} selected</span>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={clearSelection} className="text-gray-500 hover:text-gray-700">Clear</button>
                      <button
                        type="button"
                        onClick={() => setBulkDeleteOpen(true)}
                        className="inline-flex items-center gap-1 rounded-md bg-red-500 px-2 py-1 font-medium text-white hover:bg-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  </div>
                )}

                <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
                  {sidebarItems
                    .filter(item => item.type === 'folder' && expandedFolders.has(item.id) && item.children)
                    .map(item => {
                      const children = item.children!;
                      const showAll = showAllMeetings;
                      const shown = showAll ? children : children.slice(0, RECENT_LIMIT);
                      const hasMore = children.length > RECENT_LIMIT;
                      return (
                        <div key={`${item.id}-children`}>
                          {shown.map(child => renderItem(child, 1))}
                          {item.id === 'meetings' && hasMore && (
                            <button
                              type="button"
                              onClick={() => setShowAllMeetings(v => !v)}
                              className="mb-2 mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--af-border-strong)] px-3 py-2 text-sm font-medium text-[var(--af-text-2)] transition-colors hover:bg-[var(--af-hover)] hover:text-[var(--af-text)]"
                            >
                              {showAllMeetings ? 'Show recent only' : 'View all library'}
                              <ArrowRight className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>

            <div className={`mx-3 mt-auto shrink-0 border-t pt-2 pb-3 transition-colors ${expanded ? 'border-[var(--af-border)]' : 'border-transparent'}`}>
              {betaFeatures.importAndRetranscribe && (
                <RailTip show={!expanded} label="Import Audio">
                  <button
                    type="button"
                    onClick={() => openImportDialog()}
                    aria-label="Import Audio"
                    className={navButtonClass(false)}
                  >
                    <RailIcon>
                      <Upload className="h-5 w-5" />
                    </RailIcon>
                    <RailLabel expanded={expanded}>
                      <span className="truncate pr-2 text-sm font-medium">Import Audio</span>
                    </RailLabel>
                  </button>
                </RailTip>
              )}
              <RailTip show={!expanded} label="Settings">
                <button
                  type="button"
                  onClick={() => router.push('/settings')}
                  aria-label="Settings"
                  className={navButtonClass(isSettingsPage)}
                >
                  <RailIcon>
                    <Settings className="h-5 w-5" />
                  </RailIcon>
                  <RailLabel expanded={expanded}>
                    <span className="truncate pr-2 text-sm font-medium">Settings</span>
                  </RailLabel>
                </button>
              </RailTip>
            </div>
          </div>
        </div>
      </TooltipProvider>

      {/* Confirmation Modal for Delete */}
      <ConfirmationModal
        isOpen={deleteModalState.isOpen}
        text="Are you sure you want to delete this meeting? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteModalState({ isOpen: false, itemId: null })}
      />

      {/* Confirmation Modal for Bulk Delete */}
      <ConfirmationModal
        isOpen={bulkDeleteOpen}
        text={`Delete ${selectedIds.size} selected meeting${selectedIds.size === 1 ? '' : 's'}? This action cannot be undone.`}
        onConfirm={handleBulkDelete}
        onCancel={() => setBulkDeleteOpen(false)}
      />

      {/* Edit Meeting Title Modal */}
      <Dialog open={editModalState.isOpen} onOpenChange={(open) => {
        if (!open) handleEditCancel();
      }}>
        <DialogContent className="sm:max-w-[425px]">
          <VisuallyHidden>
            <DialogTitle>Edit Meeting Title</DialogTitle>
          </VisuallyHidden>
          <div className="py-4">
            <h3 className="text-lg font-semibold mb-4">Edit Meeting Title</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="meeting-title" className="block text-sm font-medium text-gray-700 mb-2">
                  Meeting Title
                </label>
                <input
                  id="meeting-title"
                  type="text"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleEditConfirm();
                    } else if (e.key === 'Escape') {
                      handleEditCancel();
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter meeting title"
                  autoFocus
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={handleEditCancel}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleEditConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            >
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Sidebar;
