'use client';

/**
 * Compact recording bar â€” the entire UI of the frameless `minibar` window.
 *
 * Shown while recording so the user can keep an eye on the timer and input
 * levels, and pause/stop, without the full window taking over their screen.
 *
 * Deliberately does NOT duplicate the stop logic. Rust owns native finalization
 * and emits the completion event that makes the main window save and navigate.
 */

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Mic, MicOff, Volume2, VolumeX, Pause, Play, Square, Maximize2 } from 'lucide-react';
import { LiveAudioVisualizer } from '@/components/LiveAudioVisualizer';
import { recordingService } from '@/services/recordingService';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function MiniBarPage() {
  const [elapsed, setElapsed] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isChangingMicMute, setIsChangingMicMute] = useState(false);
  const [isSystemMuted, setIsSystemMuted] = useState(false);
  const [isChangingSystemMute, setIsChangingSystemMute] = useState(false);
  // Once stopping begins the timer must freeze immediately, even though the
  // bar stays up until the recording is actually finalised (see below).
  const [isStopping, setIsStopping] = useState(false);

  // The window is transparent; the page must not paint a background over it.
  useEffect(() => {
    document.documentElement.classList.add('minibar-window');
    return () => document.documentElement.classList.remove('minibar-window');
  }, []);

  // Rust's RecordingState uses a monotonic Instant. Reading that duration keeps
  // this separate webview aligned through creation delays, pauses, and duplicate
  // minimize events instead of accumulating drift in a local +1 counter.
  useEffect(() => {
    let mounted = true;
    const syncFromNative = async () => {
      try {
        const state = await recordingService.getRecordingState();
        if (!mounted) return;
        const duration = state.active_duration ?? state.recording_duration;
        if (duration !== null) {
          setElapsed(Math.max(0, Math.floor(duration)));
        }
        setIsPaused(state.is_paused);
        setIsMicMuted(state.is_microphone_muted);
        setIsSystemMuted(state.is_system_audio_muted);
      } catch (error) {
        console.error('Compact bar: failed to sync recording state', error);
      }
    };
    void syncFromNative();
    const id = window.setInterval(syncFromNative, 500);
    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void recordingService.onSystemAudioMuteChanged(({ muted }) => {
      if (!disposed) setIsSystemMuted(muted);
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    }).catch((error) => {
      console.error('Compact bar: failed to listen for system audio mute changes', error);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void recordingService.onMicrophoneMuteChanged(({ muted }) => {
      if (!disposed) setIsMicMuted(muted);
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    }).catch((error) => {
      console.error('Compact bar: failed to listen for microphone mute changes', error);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const togglePause = useCallback(async () => {
    try {
      await invoke(isPaused ? 'resume_recording' : 'pause_recording');
    } catch (e) {
      console.error('Compact bar: pause/resume failed', e);
    }
  }, [isPaused]);

  const toggleMicMute = useCallback(async () => {
    if (isChangingMicMute || isChangingSystemMute || isStopping) return;
    setIsChangingMicMute(true);
    try {
      await recordingService.setMicrophoneMuted(!isMicMuted);
    } catch (error) {
      console.error('Compact bar: microphone mute failed', error);
    } finally {
      setIsChangingMicMute(false);
    }
  }, [isChangingMicMute, isChangingSystemMute, isMicMuted, isStopping]);

  const toggleSystemMute = useCallback(async () => {
    if (isChangingMicMute || isChangingSystemMute || isStopping) return;
    setIsChangingSystemMute(true);
    try {
      await recordingService.setSystemAudioMuted(!isSystemMuted);
    } catch (error) {
      console.error('Compact bar: system audio mute failed', error);
    } finally {
      setIsChangingSystemMute(false);
    }
  }, [isChangingMicMute, isChangingSystemMute, isStopping, isSystemMuted]);

  const expand = useCallback(() => {
    invoke('exit_compact_mode').catch((e) => console.error(e));
  }, []);

  const stop = useCallback(async () => {
    // Rust closes this native window as soon as it claims shutdown. Do not wait
    // for a frontend event from another webview to remove the bar.
    setIsStopping(true);
    try {
      const didStop = await invoke<boolean>('stop_recording_from_minibar');
      if (!didStop) {
        console.log('Compact bar: native shutdown was already owned');
      }
    } catch (e) {
      console.error('Compact bar: stop failed', e);
      setIsStopping(false);
    }
  }, []);

  const busy = isStopping || isChangingMicMute || isChangingSystemMute;

  return (
    <TooltipProvider>
      <div
        onMouseDown={(event) => {
          if (event.button !== 0 || (event.target as Element).closest('button')) return;
          event.preventDefault();
          void getCurrentWindow().startDragging().catch((error) => {
            console.error('Compact bar: dragging failed', error);
          });
        }}
        className="flex h-screen w-screen items-center gap-3 rounded-full border border-white/10 bg-[#0f1218]/55 px-3 text-white shadow-2xl backdrop-blur-xl select-none"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => { void stop(); }}
              disabled={busy}
              aria-label="Stop recording"
              className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-500 text-white transition-colors hover:bg-red-600 disabled:opacity-40"
            >
              {!isPaused && !isStopping && (
                <span className="pointer-events-none absolute -inset-1 animate-pulse rounded-full border border-red-400/50" />
              )}
              <Square size={13} fill="currentColor" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            <p>Stop recording</p>
          </TooltipContent>
        </Tooltip>

        <div className="min-w-[5.5rem] shrink-0 leading-tight">
          <div className="text-sm font-semibold tabular-nums tracking-tight">{formatElapsed(elapsed)}</div>
          <div className={`text-[11px] ${isStopping ? 'text-gray-400' : isPaused ? 'text-orange-400' : 'text-red-400'}`}>
            {isStopping ? 'Finishing…' : isPaused ? 'Paused' : 'Recording'}
          </div>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => { void togglePause(); }}
              disabled={busy}
              aria-label={isPaused ? 'Resume recording' : 'Pause recording'}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-40"
            >
              {isPaused ? <Play size={14} /> : <Pause size={14} />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            <p>{isPaused ? 'Resume recording' : 'Pause recording'}</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={expand}
              disabled={busy}
              aria-label="Back to the full window"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-40"
            >
              <Maximize2 size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            <p>Back to the full window</p>
          </TooltipContent>
        </Tooltip>

        <div className="h-8 w-px shrink-0 bg-white/10" />

        <button
          type="button"
          onClick={() => { void toggleMicMute(); }}
          disabled={busy}
          aria-pressed={isMicMuted}
          aria-label={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
          className={`flex h-9 min-w-0 flex-1 items-center rounded-full pl-2.5 pr-2.5 transition-colors disabled:opacity-40 ${
            isMicMuted ? 'bg-orange-500/15 text-orange-100 ring-1 ring-orange-400/40' : 'bg-white/[0.06] text-white/80 hover:bg-white/[0.12]'
          }`}
        >
          {isMicMuted ? <MicOff size={15} /> : <Mic size={15} />}
          <LiveAudioVisualizer
            active={!isPaused && !isStopping && !isMicMuted}
            source="mic"
            bars={18}
            fill
            className="ml-1.5 min-w-0 flex-1"
          />
        </button>

        <button
          type="button"
          onClick={() => { void toggleSystemMute(); }}
          disabled={busy}
          aria-pressed={isSystemMuted}
          aria-label={isSystemMuted ? 'Unmute output' : 'Mute output'}
          className={`flex h-9 min-w-0 flex-1 items-center rounded-full pl-2.5 pr-2.5 transition-colors disabled:opacity-40 ${
            isSystemMuted ? 'bg-orange-500/15 text-orange-100 ring-1 ring-orange-400/40' : 'bg-white/[0.06] text-white/80 hover:bg-white/[0.12]'
          }`}
        >
          {isSystemMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          <LiveAudioVisualizer
            active={!isPaused && !isStopping && !isSystemMuted}
            source="system"
            bars={18}
            fill
            className="ml-1.5 min-w-0 flex-1"
          />
        </button>
      </div>
    </TooltipProvider>
  );
}
