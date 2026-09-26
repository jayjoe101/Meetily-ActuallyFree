'use client'

import './globals.css'
import dynamic from 'next/dynamic'
import { Inter } from 'next/font/google'
import { SidebarProvider } from '@/components/Sidebar/SidebarProvider'
import AnalyticsProvider from '@/components/AnalyticsProvider'
import { Toaster, toast } from 'sonner'
import { X } from 'lucide-react'
import "sonner/dist/styles.css"
import { useState, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { applyAppTheme, getSavedAppTheme } from '@/lib/app-theme'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RecordingStateProvider } from '@/contexts/RecordingStateContext'
import { OllamaDownloadProvider } from '@/contexts/OllamaDownloadContext'
import { TranscriptProvider } from '@/contexts/TranscriptContext'
import { ConfigProvider, useConfig } from '@/contexts/ConfigContext'
import { OnboardingProvider } from '@/contexts/OnboardingContext'
import { loadBetaFeatures } from '@/types/betaFeatures'
import { DownloadProgressToastProvider } from '@/components/shared/DownloadProgressToast'
import { UpdateCheckProvider } from '@/components/UpdateCheckProvider'
import { RecordingPostProcessingProvider } from '@/contexts/RecordingPostProcessingProvider'
import { ImportDialogProvider } from '@/contexts/ImportDialogContext'
import { isAudioExtension, getAudioFormatsDisplayList } from '@/constants/audioFormats'
import { getPendingCrashReport, type PendingCrashReport } from '@/services/crashReportService'

// Dynamically import heavy dialogs and onboarding wizard so app/layout.js stays lightweight
// and cold-compiles quickly without timing out on slow startup or high CPU load.
const OnboardingFlow = dynamic(
  () => import('@/components/onboarding').then((mod) => mod.OnboardingFlow),
  { ssr: false }
)
const ImportAudioDialog = dynamic(
  () => import('@/components/ImportAudio').then((mod) => mod.ImportAudioDialog),
  { ssr: false }
)
const ImportDropOverlay = dynamic(
  () => import('@/components/ImportAudio').then((mod) => mod.ImportDropOverlay),
  { ssr: false }
)
const GlobalSearchDialog = dynamic(
  () => import('@/components/GlobalSearchDialog'),
  { ssr: false }
)
const CrashReportDialog = dynamic(
  () => import('@/components/CrashReportDialog'),
  { ssr: false }
)

const Sidebar = dynamic(
  () => import('@/components/Sidebar'),
  { ssr: false }
)
const MainContent = dynamic(
  () => import('@/components/MainContent'),
  { ssr: false }
)

// Early inline handler executed in <head> before chunk scripts evaluate.
// Catches ChunkLoadError (such as on-demand compilation delay on cold launch)
// and reloads the window after a brief pause so pre-compiled chunks load instantly.
const inlineChunkErrorHandler = `
(function() {
  var RELOAD_KEY = 'meetily_chunk_reload';
  function handleChunkError(e) {
    try {
      var msg = (e && e.message) || (e && e.reason && e.reason.message) || '';
      var name = (e && e.name) || (e && e.reason && e.reason.name) || '';
      var isChunkError = name === 'ChunkLoadError' ||
        /loading chunk .* failed/i.test(msg) ||
        /timeout: .*_next\\/static/i.test(msg) ||
        /failed to fetch .*_next\\/static/i.test(msg);

      if (isChunkError) {
        var last = sessionStorage.getItem(RELOAD_KEY);
        var now = Date.now();
        if (!last || (now - parseInt(last, 10)) > 3000) {
          sessionStorage.setItem(RELOAD_KEY, String(now));
          console.warn('[Meetily] ChunkLoadError detected in WebView2. Reloading in 300ms...');
          setTimeout(function() {
            window.location.reload();
          }, 300);
        }
      }
    } catch (_) {}
  }
  window.addEventListener('error', handleChunkError, true);
  window.addEventListener('unhandledrejection', handleChunkError, true);
})();
`;

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
})

// Module-level component — stable reference across RootLayout re-renders.
// Defined here (not inside RootLayout) so React never sees a new function type
// on re-render, which would cause unmount/remount and break initialization logic.
function ConditionalImportDialog({
  showImportDialog,
  handleImportDialogClose,
  importFilePath,
}: {
  showImportDialog: boolean;
  handleImportDialogClose: (open: boolean) => void;
  importFilePath: string | null;
}) {
  const { betaFeatures } = useConfig();

  // Only mount ImportAudioDialog (and its hooks/listeners) when feature is enabled
  if (!betaFeatures.importAndRetranscribe) {
    return null;
  }

  return (
    <ImportAudioDialog
      open={showImportDialog}
      onOpenChange={handleImportDialogClose}
      preselectedFile={importFilePath}
    />
  );
}

// export { metadata } from './metadata'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isMinibar = (pathname ?? '').startsWith('/minibar')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingCompleted, setOnboardingCompleted] = useState(true)
  // These no longer gate the first paint. A slow onboarding command must not
  // leave the window on a blank startup screen.
  const startupResolved = true
  const startupError = null
  const [pendingCrashReport, setPendingCrashReport] = useState<PendingCrashReport | null>(null)

  // Import audio state
  const [showDropOverlay, setShowDropOverlay] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importFilePath, setImportFilePath] = useState<string | null>(null)

  // Apply saved theme (default: dark). Toggle lives in Settings.
  useEffect(() => {
    applyAppTheme(getSavedAppTheme())
  }, [])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      cancelled = true
    }, 8000)

    const initializeStartup = async () => {
      try {
        const status = await invoke<{ completed: boolean } | null>('get_onboarding_status')
        if (cancelled) return
        const isComplete = status?.completed ?? false
        setOnboardingCompleted(isComplete)
        setShowOnboarding(!isComplete)

        if (isComplete) {
          try {
            const report = await getPendingCrashReport()
            if (!cancelled) setPendingCrashReport(report)
          } catch (error) {
            console.warn('[Layout] Crash report check failed:', error)
          }
        }
      } catch (error) {
        console.warn('[Layout] Could not resolve Tauri startup state, defaulting to main app:', error)
        if (cancelled) return
        setOnboardingCompleted(true)
        setShowOnboarding(false)
      }
    }

    void initializeStartup()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  // Disable context menu in production
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      const handleContextMenu = (e: MouseEvent) => e.preventDefault();
      document.addEventListener('contextmenu', handleContextMenu);
      return () => document.removeEventListener('contextmenu', handleContextMenu);
    }
  }, []);
  useEffect(() => {
    if (!startupResolved || startupError || pendingCrashReport) return
    // Listen for tray recording toggle request
    const unlisten = listen('request-recording-toggle', () => {
      console.log('[Layout] Received request-recording-toggle from tray');

      if (showOnboarding) {
        toast.error("Please complete setup first", {
          description: "You need to finish onboarding before you can start recording."
        });
      } else {
        // If in main app, forward to useRecordingStart via window event
        console.log('[Layout] Forwarding to start-recording-from-sidebar');
        window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'));
      }
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [showOnboarding, startupResolved, startupError, pendingCrashReport]);

  useEffect(() => {
    if (!startupResolved || startupError || pendingCrashReport) return
    const unlisten = listen<{ title: string; message: string }>(
      'recording-audio-route-warning',
      (event) => {
        toast.warning(event.payload.title, {
          description: event.payload.message,
          duration: 30000,
        });
        invoke('show_simple_notification', {
          title: event.payload.title,
          body: event.payload.message,
        }).catch(() => {});
      }
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [startupResolved, startupError, pendingCrashReport]);

  // Meeting Detection: prompt to start recording when a meeting app is detected.
  useEffect(() => {
    if (!startupResolved || startupError || pendingCrashReport) return
    const unlisten = listen<{ app: string; process: string; notify: boolean }>(
      'meeting-detected',
      (event) => {
        const { app, notify } = event.payload;
        console.log('[Layout] meeting-detected:', event.payload);

        const startRecording = () => {
          if (showOnboarding) {
            toast.error('Please complete setup first', {
              description: 'Finish onboarding before you can start recording.',
            });
            return;
          }
          window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'));
        };

        // OS toast with a Start recording button (Windows native path).
        if (notify) {
          invoke('show_simple_notification', {
            title: `${app} meeting detected`,
            body: 'Start recording this meeting now?',
          }).catch(() => {});
        }

        // In-app prompt with a one-click start action.
        toast(`${app} meeting detected`, {
          description: 'Capture mic + system audio in Meetily.',
          duration: 20000,
          action: {
            label: 'Start recording',
            onClick: startRecording,
          },
        });
      }
    );

    // OS notification button → same start path as sidebar / in-app toast.
    const unlistenStart = listen('start-recording-from-notification', () => {
      if (showOnboarding) {
        toast.error('Please complete setup first', {
          description: 'Finish onboarding before you can start recording.',
        });
        return;
      }
      window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'));
    });

    return () => {
      unlisten.then((fn) => fn());
      unlistenStart.then((fn) => fn());
    };
  }, [showOnboarding, startupResolved, startupError, pendingCrashReport]);

  // Handle file drop for audio import
  const handleFileDrop = useCallback((paths: string[]) => {
    // Check if beta features are enabled (read from localStorage directly since we're outside ConfigProvider)
    const betaFeatures = loadBetaFeatures();

    if (!betaFeatures.importAndRetranscribe) {
      toast.error('Beta feature disabled', {
        description: 'Enable "Import Audio & Retranscribe" in Settings > Beta to use this feature.'
      });
      return;
    }

    // Find the first audio file
    const audioFile = paths.find(p => {
      const ext = p.split('.').pop()?.toLowerCase();
      return !!ext && isAudioExtension(ext);
    });

    if (audioFile) {
      console.log('[Layout] Audio file dropped:', audioFile);
      setImportFilePath(audioFile);
      setShowImportDialog(true);
    } else if (paths.length > 0) {
      toast.error('Please drop an audio file', {
        description: `Supported formats: ${getAudioFormatsDisplayList()}`
      });
    }
  }, []);

  // Listen for drag-drop events
  useEffect(() => {
    if (!startupResolved || startupError || pendingCrashReport || showOnboarding) return

    const unlisteners: UnlistenFn[] = [];
    const cleanedUpRef = { current: false };

    const setupListeners = async () => {
      // Drag enter/over - show overlay only if beta feature is enabled
      const unlistenDragEnter = await listen('tauri://drag-enter', () => {
        if (loadBetaFeatures().importAndRetranscribe) {
          setShowDropOverlay(true);
        }
      });
      if (cleanedUpRef.current) {
        unlistenDragEnter();
        return;
      }
      unlisteners.push(unlistenDragEnter);

      // Drag leave - hide overlay
      const unlistenDragLeave = await listen('tauri://drag-leave', () => {
        setShowDropOverlay(false);
      });
      if (cleanedUpRef.current) {
        unlistenDragLeave();
        unlisteners.forEach(u => u());
        return;
      }
      unlisteners.push(unlistenDragLeave);

      // Drop - process files
      const unlistenDrop = await listen<{ paths: string[] }>('tauri://drag-drop', (event) => {
        setShowDropOverlay(false);
        handleFileDrop(event.payload.paths);
      });
      if (cleanedUpRef.current) {
        unlistenDrop();
        unlisteners.forEach(u => u());
        return;
      }
      unlisteners.push(unlistenDrop);
    };

    setupListeners();

    return () => {
      cleanedUpRef.current = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [showOnboarding, startupResolved, startupError, pendingCrashReport, handleFileDrop]);

  // Handle import dialog close
  const handleImportDialogClose = useCallback((open: boolean) => {
    setShowImportDialog(open);
    if (!open) {
      setImportFilePath(null);
    }
  }, []);

  // Handler for ImportDialogProvider - opens import dialog from any child component
  const handleOpenImportDialog = useCallback((filePath?: string | null) => {
    setImportFilePath(filePath ?? null);
    setShowImportDialog(true);
  }, []);

  const handleOnboardingComplete = () => {
    console.log('[Layout] Onboarding completed, reloading app')
    setShowOnboarding(false)
    setOnboardingCompleted(true)
    // Optionally reload the window to ensure all state is fresh
    window.location.reload()
  }

  // The compact bar is its own window. Render it bare on the server and the
  // client so the full app chrome never mounts there and then unmounts.
  if (isMinibar) {
    return (
      <html lang="en" className={`dark minibar-window ${inter.variable} ${inter.className}`}>
        <head>
          <script dangerouslySetInnerHTML={{ __html: inlineChunkErrorHandler }} />
        </head>
        <body className="font-sans antialiased bg-transparent">
          {children}
        </body>
      </html>
    )
  }

  return (
    <html lang="en" className={`dark ${inter.variable} ${inter.className}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: inlineChunkErrorHandler }} />
      </head>
      <body className="font-sans antialiased">
        {pendingCrashReport ? (
          <>
            <div className="h-screen bg-[var(--af-bg)]" />
            <CrashReportDialog
              report={pendingCrashReport}
              onResolved={() => setPendingCrashReport(null)}
            />
          </>
        ) : (
          <AnalyticsProvider>
            <RecordingStateProvider>
              <TranscriptProvider>
                <ConfigProvider>
                  <OllamaDownloadProvider>
                    <OnboardingProvider>
                      <SidebarProvider>
                        <TooltipProvider>
                          <RecordingPostProcessingProvider>
                            <UpdateCheckProvider onboardingCompleted={onboardingCompleted}>
                              {onboardingCompleted && !showOnboarding && <GlobalSearchDialog />}
                              <ImportDialogProvider onOpen={handleOpenImportDialog}>
                                {/* Download progress toast provider - listens for background downloads */}
                                <DownloadProgressToastProvider />

                                {/* Show onboarding or main app */}
                                {showOnboarding ? (
                                  <OnboardingFlow onComplete={handleOnboardingComplete} />
                                ) : (
                                  <div className="flex min-h-0 min-w-0 h-screen overflow-hidden">
                                    <Sidebar />
                                    <MainContent>{children}</MainContent>
                                  </div>
                                )}
                                {/* Import audio overlay and dialog */}
                                <ImportDropOverlay visible={showDropOverlay} />
                                <ConditionalImportDialog
                                  showImportDialog={showImportDialog}
                                  handleImportDialogClose={handleImportDialogClose}
                                  importFilePath={importFilePath}
                                />
                                {/* Non-blocking crash report overlay */}
                                {pendingCrashReport && (
                                  <CrashReportDialog
                                    report={pendingCrashReport}
                                    onResolved={() => setPendingCrashReport(null)}
                                  />
                                )}
                              </ImportDialogProvider>
                            </UpdateCheckProvider>
                          </RecordingPostProcessingProvider>
                        </TooltipProvider>
                      </SidebarProvider>
                    </OnboardingProvider>
                  </OllamaDownloadProvider>
                </ConfigProvider>
              </TranscriptProvider>
            </RecordingStateProvider>
          </AnalyticsProvider>
        )}

        <Toaster
          position="top-center"
          theme="dark"
          closeButton
          offset={20}
          icons={{ close: <X className="h-4 w-4" /> }}
          toastOptions={{
            classNames: {
              toast: 'af-toast',
              title: 'text-sm font-medium text-[var(--af-text)]',
              description: 'text-xs text-[var(--af-text-2)]',
            },
          }}
        />
      </body>
    </html>
  )
}
