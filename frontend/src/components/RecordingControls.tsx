'use client';

/**
 * In-app recording widget shown on the main screen (app/page.tsx).
 *
 * Two visual states, both styled to mirror the floating compact bar (minibar):
 *  - One card for idle and recording. The red button, the status text, and
 *    the mic/output controls stay put: the button becomes stop, the label
 *    becomes the timer, the chevrons become level meters, and pause/shrink
 *    ease in beside the timer.
 *
 * Wiring:
 *  - Start/stop go through Tauri commands (invoke) and RecordingStateContext.
 *  - Live audio meters are fed by the Rust `recording-audio-levels` event
 *    (pre-mix, per-source) — the webview cannot capture system audio, so the
 *    meters must be Rust-driven.
 *  - The "shrink" control hands off to the minibar window; the minibar's Stop
 *    is driven from Rust (minibar::stop_recording_from_minibar), because
 *    cross-window emit/listen to the minibar webview is unreliable.
 */

import { invoke } from '@tauri-apps/api/core';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Square, Mic, MicOff, Volume2, VolumeX, AlertCircle, X, Minimize2 } from 'lucide-react';
import { LiveAudioVisualizer } from './LiveAudioVisualizer';
import { ProcessRequest, SummaryResponse } from '@/types/summary';
import { listen } from '@tauri-apps/api/event';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import Analytics from '@/lib/analytics';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useConfig } from '@/contexts/ConfigContext';
import { usePlatform } from '@/hooks/usePlatform';
import { toast } from 'sonner';
import { deviceDisplayName, UNAVAILABLE_DEVICE_VALUE, type AudioDeviceOption } from '@/lib/audio-devices';
import type { RecordingPreferences } from '@/components/RecordingSettings';
import type { SelectedDevices } from '@/components/DeviceSelection';
import { RecordingVoiceLane } from '@/components/RecordingVoiceLane';
import { Spinner } from '@/components/ui/spinner';

interface RecordingControlsProps {
  isRecording: boolean;
  barHeights: string[];
  onRecordingStop: (callApi?: boolean) => void;
  onRecordingStart: () => void;
  onTranscriptReceived: (summary: SummaryResponse) => void;
  onTranscriptionError?: (message: string) => void;
  onStopInitiated?: () => void; // Called immediately when stop button is clicked
  isRecordingDisabled: boolean;
  isParentProcessing: boolean;
  selectedDevices?: {
    micDevice: string | null;
    systemDevice: string | null;
  };
  meetingName?: string;
}

export const RecordingControls: React.FC<RecordingControlsProps> = ({
  isRecording,
  barHeights,
  onRecordingStop,
  onRecordingStart,
  onTranscriptReceived,
  onTranscriptionError,
  onStopInitiated,
  isRecordingDisabled,
  isParentProcessing,
  selectedDevices,
  meetingName,
}) => {
  // Use global recording state context for pause state (syncs with tray operations)
  const recordingState = useRecordingState();
  const isPaused = recordingState.isPaused;
  const isMicrophoneMuted = recordingState.isMicrophoneMuted;
  const isSystemAudioMuted = recordingState.isSystemAudioMuted;
  // Phase text published by useRecordingStart ("Preparing transcription
  // model…", "Starting audio capture…") so the wait is explained rather than
  // just being a dead button.
  const startupMessage = recordingState.statusMessage;

  const { selectedDevices: savedDevices, setSelectedDevices } = useConfig();
  const activeDevices = savedDevices ?? selectedDevices;
  const isMacOS = usePlatform() === 'macos';
  const [audioDevices, setAudioDevices] = useState<AudioDeviceOption[]>([]);
  const [openLane, setOpenLane] = useState<'mic' | 'output' | null>(null);
  const [micGain, setMicGain] = useState(1);
  const [systemGain, setSystemGain] = useState(1);
  const saveChain = useRef(Promise.resolve());
  const gainTimer = useRef<number | null>(null);
  const pendingGain = useRef<{ which: 'mic' | 'system'; value: number } | null>(null);
  const [idleMicMuted, setIdleMicMuted] = useState(false);
  const [idleSystemMuted, setIdleSystemMuted] = useState(false);

  const inputDevices = audioDevices.filter((device) => device.device_type === 'Input');
  const outputDevices = audioDevices.filter((device) => device.device_type === 'Output');

  const loadAudioDevices = useCallback(async () => {
    try {
      const result = await invoke<AudioDeviceOption[]>('get_audio_devices');
      setAudioDevices(result);
    } catch (error) {
      console.error('Failed to load audio devices for the recording card:', error);
    }
  }, []);

  useEffect(() => {
    void loadAudioDevices();
    void invoke<RecordingPreferences>('get_recording_preferences')
      .then((prefs) => {
        setMicGain(prefs.mic_gain ?? 1);
        setSystemGain(prefs.system_gain ?? 1);
      })
      .catch(() => undefined);
  }, [loadAudioDevices]);



  const saveDevices = useCallback((next: SelectedDevices) => {
    setSelectedDevices(next);
    saveChain.current = saveChain.current.then(async () => {
      const prefs = await invoke<RecordingPreferences>('get_recording_preferences');
      await invoke('set_recording_preferences', {
        preferences: {
          ...prefs,
          preferred_mic_device: next.micDevice,
          preferred_system_device: next.systemDevice,
        },
      });
    }).catch((error) => {
      console.error('Failed to save recording devices:', error);
      toast.error('Could not save the audio device', {
        description: error instanceof Error ? error.message : String(error),
      });
    });
  }, [setSelectedDevices]);

  const flushGain = useCallback(() => {
    const pending = pendingGain.current;
    if (!pending) return;
    pendingGain.current = null;
    const { which, value } = pending;
    saveChain.current = saveChain.current.then(async () => {
      const prefs = await invoke<RecordingPreferences>('get_recording_preferences');
      await invoke('set_recording_preferences', {
        preferences: {
          ...prefs,
          mic_gain: which === 'mic' ? value : prefs.mic_gain,
          system_gain: which === 'system' ? value : prefs.system_gain,
        },
      });
    }).catch((error) => {
      console.error('Failed to save audio sensitivity:', error);
      toast.error('Could not save sensitivity');
    });
  }, []);

  const scheduleGain = useCallback((which: 'mic' | 'system', raw: number, immediate: boolean) => {
    const value = Math.min(3, Math.max(0.5, raw));
    if (which === 'mic') setMicGain(value);
    else setSystemGain(value);
    pendingGain.current = { which, value };
    if (gainTimer.current !== null) window.clearTimeout(gainTimer.current);
    if (immediate) flushGain();
    else gainTimer.current = window.setTimeout(flushGain, 90);
  }, [flushGain]);

  const applyLiveDevice = (kind: 'Microphone' | 'SystemAudio', value: string, previous: SelectedDevices, next: SelectedDevices) => {
    saveDevices(next);
    if (!isRecording || value === 'default') return;
    void invoke<boolean>('attempt_device_reconnect', {
      deviceName: deviceDisplayName(value),
      deviceType: kind,
    }).then((ok) => {
      if (ok) return;
      toast.error(kind === 'Microphone' ? 'Could not switch microphone' : 'Could not switch system audio', {
        description: 'The recording is still using the previous device.',
      });
      saveDevices(previous);
    }).catch((error) => {
      console.error('Failed to switch audio device while recording:', error);
      toast.error(kind === 'Microphone' ? 'Could not switch microphone' : 'Could not switch system audio', {
        description: error instanceof Error ? error.message : String(error),
      });
      saveDevices(previous);
    });
  };

  const chooseMic = (value: string) => {
    if (value === UNAVAILABLE_DEVICE_VALUE) return;
    const previous: SelectedDevices = {
      micDevice: activeDevices?.micDevice ?? null,
      systemDevice: activeDevices?.systemDevice ?? null,
    };
    applyLiveDevice('Microphone', value, previous, {
      micDevice: value === 'default' ? null : value,
      systemDevice: previous.systemDevice,
    });
  };

  const chooseSystem = (value: string) => {
    if (value === UNAVAILABLE_DEVICE_VALUE || isMacOS) return;
    const previous: SelectedDevices = {
      micDevice: activeDevices?.micDevice ?? null,
      systemDevice: activeDevices?.systemDevice ?? null,
    };
    applyLiveDevice('SystemAudio', value, previous, {
      micDevice: previous.micDevice,
      systemDevice: value === 'default' ? null : value,
    });
  };

  const [showPlayback, setShowPlayback] = useState(false);
  const [recordingPath, setRecordingPath] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    if (isStarting) setOpenLane(null);
  }, [isStarting]);

  const wasRecording = useRef(false);
  useEffect(() => {
    if (isRecording && !wasRecording.current) {
      if (idleMicMuted) void invoke('set_microphone_muted', { muted: true }).catch(() => undefined);
      if (idleSystemMuted) void invoke('set_system_audio_muted', { muted: true }).catch(() => undefined);
    }
    if (!isRecording && wasRecording.current) {
      setIdleMicMuted(false);
      setIdleSystemMuted(false);
    }
    wasRecording.current = isRecording;
  }, [idleMicMuted, idleSystemMuted, isRecording]);
  const [isStopping, setIsStopping] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [isChangingMicrophoneMute, setIsChangingMicrophoneMute] = useState(false);
  const [isChangingSystemAudioMute, setIsChangingSystemAudioMute] = useState(false);
  const MIN_RECORDING_DURATION = 2000; // 2 seconds minimum recording time
  const [transcriptionErrors, setTranscriptionErrors] = useState(0);
  const [isValidatingModel, setIsValidatingModel] = useState(false);
  const [speechDetected, setSpeechDetected] = useState(false);
  const [deviceError, setDeviceError] = useState<{ title: string, message: string } | null>(null);
  // Coach-mark above the minimize button after recording starts.


  const currentTime = 0;
  const duration = 0;
  const isPlaying = false;
  const progress = 0;

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Elapsed timer for the in-app bar, mirroring the floating compact bar.
  const elapsedSeconds = Math.max(0, Math.floor(recordingState.recordingDuration ?? 0));
  const formatElapsed = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  useEffect(() => {
    const checkTauri = async () => {
      try {
        const result = await invoke('is_recording');
        console.log('Tauri is initialized and ready, is_recording result:', result);
      } catch (error) {
        console.error('Tauri initialization error:', error);
        alert('Failed to initialize recording. Please check the console for details.');
      }
    };
    checkTauri();
  }, []);

  const handleStartRecording = useCallback(async () => {
    if (isStarting || isValidatingModel) return;
    console.log('Starting recording...');
    console.log('Selected devices:', selectedDevices);
    console.log('Meeting name:', meetingName);
    console.log('Current isRecording state:', isRecording);

    setShowPlayback(false);
    setTranscript(''); // Clear any previous transcript
    setSpeechDetected(false); // Reset speech detection on new recording

    // Mark the button busy for the whole start sequence. This was previously
    // only ever read, never set, so the spinner never appeared and the button
    // looked unresponsive during model load.
    setIsStarting(true);
    await invoke('stop_audio_level_monitoring').catch(() => undefined);

    try {
      // Call the validation callback which will:
      // 1. Check if model is ready
      // 2. Show appropriate toast/modal
      // 3. Call backend if valid
      // 4. Update UI state
      await onRecordingStart();
    } catch (error) {
      console.error('Failed to start recording:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined
      });

      // Parse error message to provide user-friendly feedback
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Check for device-related errors
      if (errorMsg.includes('microphone') || errorMsg.includes('mic') || errorMsg.includes('input')) {
        setDeviceError({
          title: 'Microphone Not Available',
          message: 'Unable to access your microphone. Please check that:\n• Your microphone is connected\n• The app has microphone permissions\n• No other app is using the microphone'
        });
      } else if (errorMsg.includes('system audio') || errorMsg.includes('speaker') || errorMsg.includes('output')) {
        setDeviceError({
          title: 'System Audio Not Available',
          message: 'Unable to capture system audio. On macOS, grant Meetily Audio Capture permission in Privacy & Security, play audio, and try again. On other platforms, verify the selected playback device.'
        });
      } else if (errorMsg.includes('permission')) {
        setDeviceError({
          title: 'Permission Required',
          message: 'Recording permissions are required. Grant microphone access and, on macOS, Audio Capture access in Privacy & Security. Restart the app after changing permissions.'
        });
      } else {
        setDeviceError({
          title: 'Recording Failed',
          message: 'Unable to start recording. Please check your audio device settings and try again.'
        });
      }
    } finally {
      setIsStarting(false);
    }
  }, [onRecordingStart, isStarting, isValidatingModel, selectedDevices, meetingName, isRecording]);

  const stopRecordingAction = useCallback(async () => {
    console.log('Executing stop recording...');
    try {
      setIsProcessing(true);
      // Portable build: recordings save into the program's install-local data
      // root (same directory returned for the database), not %APPDATA%.
      const dataDir = await invoke<string>('get_database_directory');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const savePath = `${dataDir}/recording-${timestamp}.wav`;
      console.log('Saving recording to:', savePath);
      console.log('About to call stop_recording command');
      const didStop = await invoke<boolean>('stop_recording', {
        args: {
          save_path: savePath
        }
      });
      console.log('stop_recording command completed successfully:', didStop);
      if (!didStop) {
        setIsProcessing(false);
        return;
      }
      setRecordingPath(savePath);
      // setShowPlayback(true);
      setIsProcessing(false);
      // Track successful transcription
      Analytics.trackTranscriptionSuccess();
      // Native stop emits one main-window-only completion event. The global
      // post-processing provider handles transcript drain/save/navigation for
      // every stop origin, so do not start a second frontend owner here.
    } catch (error) {
      console.error('Failed to stop recording:', error);
      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          name: error.name,
          stack: error.stack,
        });
        if (error.message.includes('No recording in progress')) {
          return;
        }
      } else if (typeof error === 'string' && error.includes('No recording in progress')) {
        return;
      } else if (error && typeof error === 'object' && 'toString' in error) {
        if (error.toString().includes('No recording in progress')) {
          return;
        }
      }
      setIsProcessing(false);
      onRecordingStop(false);
    } finally {
      setIsStopping(false);
    }
  }, [onRecordingStop]);

  const handleStopRecording = useCallback(async () => {
    console.log('handleStopRecording called - isRecording:', isRecording, 'isStarting:', isStarting, 'isStopping:', isStopping);
    if (!isRecording || isStarting || isStopping) {
      console.log('Early return from handleStopRecording due to state check');
      return;
    }

    console.log('Stopping recording...');

    // Notify parent immediately (for UI state updates)
    onStopInitiated?.();

    setIsStopping(true);

    // Immediately trigger the stop action
    await stopRecordingAction();
  }, [isRecording, isStarting, isStopping, stopRecordingAction, onStopInitiated]);

  const handlePauseRecording = useCallback(async () => {
    if (!isRecording || isPaused || isPausing) return;

    console.log('Pausing recording...');
    setIsPausing(true);

    try {
      await invoke('pause_recording');
      // isPaused state now managed by RecordingStateContext via events
      console.log('Recording paused successfully');
    } catch (error) {
      console.error('Failed to pause recording:', error);
      alert('Failed to pause recording. Please check the console for details.');
    } finally {
      setIsPausing(false);
    }
  }, [isRecording, isPaused, isPausing]);

  const handleResumeRecording = useCallback(async () => {
    if (!isRecording || !isPaused || isResuming) return;

    console.log('Resuming recording...');
    setIsResuming(true);

    try {
      await invoke('resume_recording');
      // isPaused state now managed by RecordingStateContext via events
      console.log('Recording resumed successfully');
    } catch (error) {
      console.error('Failed to resume recording:', error);
      alert('Failed to resume recording. Please check the console for details.');
    } finally {
      setIsResuming(false);
    }
  }, [isRecording, isPaused, isResuming]);

  const handleMicrophoneMute = useCallback(async () => {
    if (!isRecording || isStopping || isChangingMicrophoneMute || isChangingSystemAudioMute) return;

    setIsChangingMicrophoneMute(true);
    try {
      await invoke<boolean>('set_microphone_muted', { muted: !isMicrophoneMuted });
      Analytics.trackButtonClick(
        isMicrophoneMuted ? 'unmute_microphone' : 'mute_microphone',
        'recording_controls'
      );
    } catch (error) {
      console.error('Failed to change microphone mute state:', error);
    } finally {
      setIsChangingMicrophoneMute(false);
    }
  }, [isChangingMicrophoneMute, isChangingSystemAudioMute, isMicrophoneMuted, isRecording, isStopping]);

  const handleSystemAudioMute = useCallback(async () => {
    if (!isRecording || isStopping || isChangingMicrophoneMute || isChangingSystemAudioMute) return;

    setIsChangingSystemAudioMute(true);
    try {
      await invoke<boolean>('set_system_audio_muted', { muted: !isSystemAudioMuted });
      Analytics.trackButtonClick(
        isSystemAudioMuted ? 'unmute_system_audio' : 'mute_system_audio',
        'recording_controls'
      );
    } catch (error) {
      console.error('Failed to change system audio mute state:', error);
    } finally {
      setIsChangingSystemAudioMute(false);
    }
  }, [isChangingMicrophoneMute, isChangingSystemAudioMute, isRecording, isStopping, isSystemAudioMuted]);

  // Collapse the full window down to the floating compact bar. Mirrors the
  // bar's expand button so the two are one control surface in two sizes; the
  // current duration seeds the bar so its timer continues rather than resets.
  const collapseToBar = useCallback(() => {
    const elapsed = Math.max(0, Math.floor(recordingState.recordingDuration ?? 0));
    Analytics.trackButtonClick('enter_compact_mode', 'recording_controls');
    invoke('enter_compact_mode', { elapsedSeconds: elapsed }).catch((e) =>
      console.error('Failed to enter compact mode:', e)
    );
  }, [recordingState.recordingDuration]);

  useEffect(() => {
    return () => {
      // Cleanup on unmount if needed
    };
  }, []);

  useEffect(() => {
    console.log('Setting up recording event listeners');
    let unsubscribes: (() => void)[] = [];

    const setupListeners = async () => {
      try {
        // Transcript error listener - handles both regular and actionable errors
        const transcriptErrorUnsubscribe = await listen('transcript-error', (event) => {
          console.log('transcript-error event received:', event);
          console.error('Transcription error received:', event.payload);
          const errorMessage = event.payload as string;

          Analytics.trackTranscriptionError(errorMessage);
          console.log('Tracked transcription error:', errorMessage);

          setTranscriptionErrors(prev => {
            const newCount = prev + 1;
            console.log('Transcription error count incremented:', newCount);
            return newCount;
          });
          setIsProcessing(false);
          console.log('Calling onRecordingStop(false) due to transcript error');
          onRecordingStop(false);
          if (onTranscriptionError) {
            onTranscriptionError(errorMessage);
          }
        });

        // Transcription error listener - handles structured error objects with actionable flag
        const transcriptionErrorUnsubscribe = await listen('transcription-error', (event) => {
          console.log('transcription-error event received:', event);
          console.error('Transcription error received:', event.payload);

          let errorMessage: string;
          let isActionable = false;

          if (typeof event.payload === 'object' && event.payload !== null) {
            const payload = event.payload as { error: string, userMessage: string, actionable: boolean };
            errorMessage = payload.userMessage || payload.error;
            isActionable = payload.actionable || false;
          } else {
            errorMessage = String(event.payload);
          }

          Analytics.trackTranscriptionError(errorMessage);
          console.log('Tracked transcription error:', errorMessage);

          setTranscriptionErrors(prev => {
            const newCount = prev + 1;
            console.log('Transcription error count incremented:', newCount);
            return newCount;
          });
          setIsProcessing(false);
          console.log('Calling onRecordingStop(false) due to transcription error');
          onRecordingStop(false);

          // For actionable errors (like model loading failures), the main page will handle showing the model selector
          // For regular errors, they are handled by useModalState global listener which shows a toast
          // We don't want to show a modal (via onTranscriptionError) AND a toast, so we skip the callback here
          /* if (onTranscriptionError && !isActionable) {
            onTranscriptionError(errorMessage);
          } */
        });

        // Pause/Resume events are now handled by RecordingStateContext
        // No need for duplicate listeners here

        // Speech detected listener - for UX feedback when VAD detects speech
        const speechDetectedUnsubscribe = await listen('speech-detected', (event) => {
          console.log('speech-detected event received:', event);
          setSpeechDetected(true);
        });

        unsubscribes = [
          transcriptErrorUnsubscribe,
          transcriptionErrorUnsubscribe,
          speechDetectedUnsubscribe
        ];
        console.log('Recording event listeners set up successfully');
      } catch (error) {
        console.error('Failed to set up recording event listeners:', error);
      }
    };

    setupListeners();

    return () => {
      console.log('Cleaning up recording event listeners');
      unsubscribes.forEach(unsubscribe => {
        if (unsubscribe && typeof unsubscribe === 'function') {
          unsubscribe();
        }
      });
    };
  }, [onRecordingStop, onTranscriptionError]);

  return (
    <TooltipProvider>
      <div className="flex flex-col space-y-2">
        <div className={`pointer-events-auto flex items-center rounded-3xl border border-white/10 bg-[#0f1218]/90 text-white shadow-2xl backdrop-blur-xl ${isRecording || isProcessing ? 'w-full min-w-0 gap-3 px-4 py-3' : 'w-max gap-4 px-4 py-3'}`}>
          {showPlayback ? (
                <>
                  <button
                    onClick={handleStartRecording}
                    className="w-10 h-10 flex items-center justify-center bg-red-500 rounded-full text-white hover:bg-red-600 transition-colors"
                  >
                    <Mic size={16} />
                  </button>

                  <div className="w-px h-6 bg-gray-200 mx-1" />

                  <div className="flex items-center space-x-1 mx-2">
                    <div className="text-sm text-gray-600 min-w-[40px]">
                      {formatTime(currentTime)}
                    </div>
                    <div
                      className="relative w-24 h-1 bg-gray-200 rounded-full"
                    >
                      <div
                        className="absolute h-full bg-blue-500 rounded-full"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="text-sm text-gray-600 min-w-[40px]">
                      {formatTime(duration)}
                    </div>
                  </div>

                  <button
                    className="w-10 h-10 flex items-center justify-center bg-gray-300 rounded-full text-white cursor-not-allowed"
                    disabled
                  >
                    <Play size={16} />
                  </button>
                </>
              ) : (
                <>
                    <div className={`flex min-w-0 items-center gap-4 ${isRecording || isProcessing ? 'w-full' : 'w-max'}`}>
                      <div className="flex shrink-0 items-center gap-3 pl-0.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => {
                                if (isRecording) {
                                  Analytics.trackButtonClick('stop_recording', 'recording_controls');
                                  handleStopRecording();
                                  return;
                                }
                                Analytics.trackButtonClick('start_recording', 'recording_controls');
                                handleStartRecording();
                              }}
                              disabled={
                                isStarting || isProcessing || isValidatingModel ||
                                (!isRecording && isRecordingDisabled) ||
                                (isRecording && (isStopping || isPausing || isResuming))
                              }
                              data-loading={isStarting || isValidatingModel || isProcessing ? 'true' : undefined}
                              className="af-record-button relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white transition-[background] duration-200"
                            >
                              {isRecording && !isPaused && !isStopping && !isProcessing && (
                                <span className="pointer-events-none absolute -inset-1 animate-pulse rounded-full border border-[color-mix(in_srgb,var(--af-record)_55%,white)]" />
                              )}
                              {isStarting || isValidatingModel || isProcessing ? (
                                <Spinner size={20} className="text-white" />
                              ) : (
                                <span className="relative flex h-5 w-5 items-center justify-center">
                                  <Mic
                                    size={20}
                                    className={`absolute transition-all duration-300 ${isRecording ? 'scale-75 opacity-0' : 'scale-100 opacity-100'}`}
                                  />
                                  <Square
                                    size={13}
                                    fill="currentColor"
                                    className={`absolute transition-all duration-300 ${isRecording ? 'scale-100 opacity-100' : 'scale-75 opacity-0'}`}
                                  />
                                </span>
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{isRecording ? 'Stop recording' : 'Start recording'}</p>
                          </TooltipContent>
                        </Tooltip>

                        <div className="min-w-[7.75rem] shrink-0 whitespace-nowrap text-left leading-tight">
                          <div className="text-sm font-semibold tabular-nums tracking-tight text-white">
                            {isRecording
                              ? formatElapsed(elapsedSeconds)
                              : isProcessing
                                ? 'Processing recording'
                                : isStarting || isValidatingModel
                                  ? 'Starting…'
                                  : 'Start Recording'}
                          </div>
                          <div className={`text-[11px] transition-colors duration-300 ${isPaused ? 'text-orange-400' : 'text-red-400'}`}>
                            {isRecording
                              ? (isStopping ? 'Stopping…' : isPaused ? 'Paused' : 'Recording')
                              : isProcessing || isStarting || isValidatingModel
                                ? (startupMessage || 'Please wait')
                                : 'Ready'}
                          </div>
                        </div>

                        <div
                          className={`grid overflow-hidden transition-[grid-template-columns,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
                            isRecording ? 'grid-cols-[1fr] opacity-100' : 'pointer-events-none grid-cols-[0fr] opacity-0'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isPaused) {
                                      Analytics.trackButtonClick('resume_recording', 'recording_controls');
                                      handleResumeRecording();
                                    } else {
                                      Analytics.trackButtonClick('pause_recording', 'recording_controls');
                                      handlePauseRecording();
                                    }
                                  }}
                                  disabled={isPausing || isResuming || isStopping}
                                  aria-label={isPaused ? 'Resume recording' : 'Pause recording'}
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-40"
                                >
                                  {isPaused ? <Play size={14} /> : <Pause size={14} />}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" sideOffset={8}>
                                <p>{isPaused ? 'Resume recording' : 'Pause recording'}</p>
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={collapseToBar}
                                  disabled={isStopping}
                                  aria-label="Shrink to floating bar"
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-40"
                                >
                                  <Minimize2 size={14} />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" sideOffset={8}>
                                <p>Shrink to floating bar</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      </div>

                      <div className="h-8 w-px shrink-0 self-center bg-white/10" />

                      <div className={`flex items-center gap-2 ${isRecording ? 'min-w-0 flex-1' : 'shrink-0'}`}>
                        <RecordingVoiceLane
                          kind="mic"
                          open={openLane === 'mic'}
                          onOpenChange={(next) => {
                            if (next) void loadAudioDevices();
                            setOpenLane(next ? 'mic' : null);
                          }}
                          savedValue={activeDevices?.micDevice ?? null}
                          options={inputDevices}
                          onSelect={chooseMic}
                          disabled={isStarting || isValidatingModel}
                          gain={micGain}
                          onGainLive={(value) => scheduleGain('mic', value, false)}
                          onGainCommit={(value) => scheduleGain('mic', value, true)}
                          live={isRecording}
                          muted={isRecording ? isMicrophoneMuted : idleMicMuted}
                          meterActive={isRecording && !isPaused && !isMicrophoneMuted}
                          onMute={() => {
                            if (isRecording) void handleMicrophoneMute();
                            else setIdleMicMuted((current) => !current);
                          }}
                        />
                        <RecordingVoiceLane
                          kind="output"
                          open={openLane === 'output'}
                          onOpenChange={(next) => {
                            if (next) void loadAudioDevices();
                            setOpenLane(next ? 'output' : null);
                          }}
                          savedValue={isMacOS ? null : activeDevices?.systemDevice ?? null}
                          options={isMacOS ? [] : outputDevices}
                          onSelect={chooseSystem}
                          disabled={isStarting || isValidatingModel}
                          gain={systemGain}
                          onGainLive={(value) => scheduleGain('system', value, false)}
                          onGainCommit={(value) => scheduleGain('system', value, true)}
                          macDefaultOutput={isMacOS}
                          live={isRecording}
                          muted={isRecording ? isSystemAudioMuted : idleSystemMuted}
                          meterActive={isRecording && !isPaused && !isSystemAudioMuted}
                          onMute={() => {
                            if (isRecording) void handleSystemAudioMute();
                            else setIdleSystemMuted((current) => !current);
                          }}
                        />
                      </div>
                    </div>

                </>
              )}
        </div>

        {/* Device error alert */}
        {deviceError && (
          <Alert variant="destructive" className="mt-4 border-red-300 bg-red-50">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <button
              onClick={() => setDeviceError(null)}
              className="absolute right-3 top-3 text-red-600 hover:text-red-800 transition-colors"
              aria-label="Close alert"
            >
              <X className="h-4 w-4" />
            </button>
            <AlertTitle className="text-red-800 font-semibold mb-2">
              {deviceError.title}
            </AlertTitle>
            <AlertDescription className="text-red-700">
              {deviceError.message.split('\n').map((line, i) => (
                <div key={i} className={i > 0 ? 'ml-2' : ''}>
                  {line}
                </div>
              ))}
            </AlertDescription>
          </Alert>
        )}

        {/* {showPlayback && recordingPath && (
        <div className="text-sm text-gray-600 px-4">
          Recording saved to: {recordingPath}
        </div>
      )} */}
      </div>
    </TooltipProvider>
  );
};
