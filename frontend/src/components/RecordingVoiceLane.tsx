'use client';

import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Check, ChevronDown, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LiveAudioVisualizer } from '@/components/LiveAudioVisualizer';
import {
  deviceDisplayName,
  toDeviceOptionValue,
  type AudioDeviceOption,
} from '@/lib/audio-devices';

const BAR_COUNT = 22;

interface LevelEvent {
  levels?: Array<{
    device_name?: string;
    device_type?: string;
    rms_level?: number;
    peak_level?: number;
  }>;
}

export function RecordingVoiceLane({
  kind,
  open,
  onOpenChange,
  savedValue,
  options,
  onSelect,
  disabled,
  gain,
  onGainLive,
  onGainCommit,
  macDefaultOutput = false,
  live = false,
  muted = false,
  meterActive = false,
  onMute,
}: {
  kind: 'mic' | 'output';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stored preference, or null for the system default. */
  savedValue: string | null;
  options: AudioDeviceOption[];
  onSelect: (value: string) => void;
  disabled?: boolean;
  gain: number;
  onGainLive: (value: number) => void;
  onGainCommit: (value: number) => void;
  macDefaultOutput?: boolean;
  /** Recording is underway. The same button mutes, and the chevron becomes a meter. */
  live?: boolean;
  muted?: boolean;
  meterActive?: boolean;
  onMute?: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [heard, setHeard] = useState(false);
  const [bars, setBars] = useState<number[]>(() => Array(BAR_COUNT).fill(0));
  const testingRef = useRef(false);
  const barsRef = useRef<number[]>(Array(BAR_COUNT).fill(0));
  const Icon = kind === 'mic' ? Mic : Volume2;
  const title = kind === 'mic' ? 'Input' : 'Output';
  const chosen = options.find((device) => toDeviceOptionValue(device) === savedValue);
  const summary = macDefaultOutput
    ? 'System default'
    : chosen?.name || (savedValue ? deviceDisplayName(savedValue) : kind === 'mic' ? 'Default mic' : 'Default output');

  const stopTest = async () => {
    if (!testingRef.current) return;
    testingRef.current = false;
    setTesting(false);
    setHeard(false);
    const idle = Array(BAR_COUNT).fill(0);
    barsRef.current = idle;
    setBars(idle);
  };

  useEffect(() => {
    if (!open) void stopTest();
  }, [open]);

  useEffect(() => () => {
    void stopTest();
  }, []);

  useEffect(() => {
    if (!testing) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const wanted = chosen?.name ?? (savedValue ? deviceDisplayName(savedValue) : null);
    const wantedType = kind === 'mic' ? 'input' : 'output';

    void invoke('start_audio_level_monitoring', { deviceNames: wanted ? [wanted] : [] }).catch((error) => {
      console.error('Failed to test audio device:', error);
      if (cancelled) return;
      testingRef.current = false;
      setTesting(false);
    });

    void listen<LevelEvent>('audio-levels', (event) => {
      if (cancelled) return;
      const levels = event.payload?.levels ?? [];
      const match = levels.find((level) => {
        const type = (level.device_type || '').toLowerCase();
        const name = level.device_name || '';
        if (wanted && name === wanted) return true;
        return type === wantedType || type.includes(wantedType);
      });
      const rms = match?.rms_level ?? 0;
      const peak = match?.peak_level ?? 0;
      const level = Math.min(1, Math.max(peak * 1.15, rms * 3.2, 0));
      const next = barsRef.current.slice(1);
      next.push(level);
      barsRef.current = next;
      setBars(next);
      if (level > 0.12) setHeard(true);
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    }).catch((error) => console.error('Failed to listen for device test levels:', error));

    return () => {
      cancelled = true;
      unlisten?.();
      void invoke('stop_audio_level_monitoring').catch(() => undefined);
    };
  }, [testing, chosen?.name, savedValue, kind]);

  const startTest = () => {
    setHeard(false);
    const idle = Array(BAR_COUNT).fill(0);
    barsRef.current = idle;
    setBars(idle);
    testingRef.current = true;
    setTesting(true);
  };

  const settingsLabel = kind === 'mic' ? 'Input settings' : 'Output settings';
  const muteLabel = kind === 'mic'
    ? (muted ? 'Unmute microphone' : 'Mute microphone')
    : (muted ? 'Unmute output' : 'Mute output');
  const OffIcon = kind === 'mic' ? MicOff : VolumeX;

  return (
    <div className={live ? 'min-w-0 flex-1' : 'shrink-0'}>
    <Popover open={open && !live} onOpenChange={(next) => { if (!disabled && !live) onOpenChange(next); }}>
      <Tooltip open={open && !live ? false : undefined}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-expanded={live ? undefined : open}
              aria-pressed={live ? muted : undefined}
              aria-label={live ? muteLabel : settingsLabel}
              onClick={(event) => {
                if (disabled) {
                  event.preventDefault();
                  return;
                }
                if (live) {
                  event.preventDefault();
                  onMute?.();
                }
              }}
              className={`flex h-9 items-center rounded-full pl-2.5 transition-[background-color,padding,color,width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] disabled:opacity-50 ${
                live ? 'w-full min-w-[9rem] pr-2.5' : 'pr-1.5'
              } ${
                live && muted
                  ? 'bg-orange-500/15 text-orange-100 ring-1 ring-orange-400/40'
                  : open
                    ? 'bg-white/15 text-white ring-1 ring-white/25'
                    : 'bg-white/[0.06] text-white/75 hover:bg-white/[0.12] hover:text-white'
              }`}
            >
              <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                <Icon
                  size={15}
                  strokeWidth={1.75}
                  className={`absolute transition-opacity duration-300 ${muted && live ? 'opacity-0' : 'opacity-100'}`}
                />
                <OffIcon
                  size={15}
                  strokeWidth={1.75}
                  className={`absolute transition-opacity duration-300 ${muted && live ? 'opacity-100' : 'opacity-0'}`}
                />
              </span>
              <span
                className={`relative ml-1.5 flex h-4 items-center overflow-hidden transition-[width,flex] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
                  live ? 'min-w-0 flex-1' : 'w-3'
                }`}
              >
                <ChevronDown
                  size={12}
                  strokeWidth={2}
                  className={`shrink-0 text-white/55 transition-opacity duration-300 ${
                    live ? 'pointer-events-none absolute opacity-0' : 'opacity-100'
                  } ${open ? 'rotate-180 text-white' : ''}`}
                />
                <span className={`min-w-0 flex-1 transition-opacity duration-300 ${live ? 'opacity-100 delay-150' : 'pointer-events-none absolute opacity-0'}`}>
                  <LiveAudioVisualizer active={meterActive} source={kind === 'mic' ? 'mic' : 'system'} bars={18} fill className="w-full" />
                </span>
              </span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8} className="max-w-[220px]">
          <p className="font-medium">{live ? muteLabel : settingsLabel}</p>
          <p className="mt-0.5 opacity-80">{summary}</p>
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={10}
        className="w-72 border-white/10 bg-[#141820] p-3 text-white shadow-2xl"
      >
        <div className="space-y-3">
          <div>
            <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
              {kind === 'mic' ? 'Input device' : 'Output device'}
            </p>
            <div className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto pr-0.5">
              <DeviceChoice
                label={kind === 'mic' ? 'Default microphone' : 'Default output'}
                selected={!savedValue}
                disabled={disabled || macDefaultOutput}
                onClick={() => onSelect('default')}
              />
              {macDefaultOutput ? (
                <p className="px-2 py-1.5 text-xs leading-relaxed text-white/45">
                  macOS records the current system output. Change it in System Settings.
                </p>
              ) : (
                options.map((device) => {
                  const value = toDeviceOptionValue(device);
                  return (
                    <DeviceChoice
                      key={value}
                      label={device.name}
                      selected={savedValue === value}
                      disabled={disabled}
                      onClick={() => onSelect(value)}
                    />
                  );
                })
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
              <span>Sensitivity</span>
              <span className="tabular-nums text-white/70">{gain.toFixed(1)}×</span>
            </div>
            <div className="relative mt-1.5 h-7">
              <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full transition-[width] duration-75 ${heard ? 'bg-emerald-400' : 'bg-white/25'}`}
                  style={{ width: testing ? `${Math.round((bars[bars.length - 1] ?? 0) * 100)}%` : '0%' }}
                />
              </div>
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.1}
                value={gain}
                disabled={disabled}
                aria-label={`${title} sensitivity`}
                onChange={(event) => onGainLive(Number(event.target.value))}
                onPointerUp={(event) => onGainCommit(Number((event.target as HTMLInputElement).value))}
                onBlur={(event) => onGainCommit(Number(event.target.value))}
                className="af-bare absolute inset-0 w-full cursor-pointer appearance-none bg-transparent accent-emerald-400 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow"
              />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className={`text-[11px] ${heard ? 'text-emerald-300' : 'text-white/45'}`}>
                {testing ? (heard ? 'Hearing audio' : kind === 'mic' ? 'Speak to test…' : 'Play audio to test…') : 'Device test'}
              </span>
              <button
                type="button"
                onClick={() => void (testing ? stopTest() : startTest())}
                disabled={disabled}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  testing
                    ? 'bg-emerald-400/15 text-emerald-200 hover:bg-emerald-400/25'
                    : 'bg-white/10 text-white/80 hover:bg-white/15'
                }`}
              >
                {testing ? 'Stop' : 'Test'}
              </button>
            </div>
            <div className="flex h-8 items-end gap-[3px]" aria-hidden>
              {bars.map((level, index) => (
                <span
                  key={index}
                  className={`min-w-0 flex-1 rounded-full transition-[height,background-color] duration-75 ${
                    testing && level > 0.12 ? 'bg-emerald-400' : 'bg-white/20'
                  }`}
                  style={{ height: `${Math.max(testing ? 12 : 8, Math.round(level * 100))}%` }}
                />
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
    </div>
  );
}

function DeviceChoice({
  label,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors disabled:opacity-50 ${
        selected ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/[0.06] hover:text-white'
      }`}
    >
      <Check size={13} className={selected ? 'shrink-0 text-emerald-300' : 'shrink-0 opacity-0'} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
