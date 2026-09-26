import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ChevronRight, Mic, Volume2 } from 'lucide-react';
import { LiveAudioVisualizer } from './LiveAudioVisualizer';
import Analytics from '@/lib/analytics';
import { usePlatform } from '@/hooks/usePlatform';
import { toDeviceOptionValue, deviceDisplayName } from '@/lib/audio-devices';

export interface AudioDevice {
  name: string;
  device_type: 'Input' | 'Output';
}

export interface SelectedDevices {
  micDevice: string | null;
  systemDevice: string | null;
}

export interface AudioLevelData {
  device_name: string;
  device_type: string;
  rms_level: number;
  peak_level: number;
  is_active: boolean;
}

export interface AudioLevelUpdate {
  timestamp: number;
  levels: AudioLevelData[];
}

interface DeviceSelectionProps {
  selectedDevices: SelectedDevices;
  onDeviceChange: (devices: SelectedDevices) => void;
  disabled?: boolean;
  micGain?: number;
  systemGain?: number;
  onMicGainLive?: (value: number) => void;
  onMicGainCommit?: (value: number) => void;
  onSystemGainLive?: (value: number) => void;
  onSystemGainCommit?: (value: number) => void;
}

export function DeviceSelection({
  selectedDevices,
  onDeviceChange,
  disabled = false,
  micGain,
  systemGain,
  onMicGainLive,
  onMicGainCommit,
  onSystemGainLive,
  onSystemGainCommit,
}: DeviceSelectionProps) {
  const isMacOS = usePlatform() === 'macos';
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audioLevels, setAudioLevels] = useState<Map<string, AudioLevelData>>(new Map());
  const [levelTick, setLevelTick] = useState(0);
  const [openPicker, setOpenPicker] = useState<'mic' | 'system' | null>(null);
  // One-way latch: a failed *refresh* leaves the last good list in place, so
  // trust must never be downgraded once established.
  const [hasLoadedDevices, setHasLoadedDevices] = useState(false);

  // Filter devices by type
  const inputDevices = devices.filter(device => device.device_type === 'Input');
  const outputDevices = devices.filter(device => device.device_type === 'Output');

  const micOptions = inputDevices.map(toDeviceOptionValue);
  const systemOptions = outputDevices.map(toDeviceOptionValue);

  // A saved device that isn't in the current list. Guarded on the per-list
  // length because get_audio_devices can succeed while list_pulse_sinks() failed
  // server-side, yielding Input entries and zero Output entries — in which case
  // we genuinely don't know whether the device is missing.
  const micFellBack =
    hasLoadedDevices && micOptions.length > 0 &&
    !!selectedDevices.micDevice && !micOptions.includes(selectedDevices.micDevice);
  const systemFellBack =
    !isMacOS && hasLoadedDevices && systemOptions.length > 0 &&
    !!selectedDevices.systemDevice && !systemOptions.includes(selectedDevices.systemDevice);

  useEffect(() => {
    if (isMacOS && selectedDevices.systemDevice !== null) {
      onDeviceChange({ ...selectedDevices, systemDevice: null });
    }
  }, [isMacOS, onDeviceChange, selectedDevices]);

  // Fetch available audio devices
  const fetchDevices = async () => {
    try {
      setError(null);
      const result = await invoke<AudioDevice[]>('get_audio_devices');
      setDevices(result);
      setHasLoadedDevices(true);
      console.log('Fetched audio devices:', result);
    } catch (err) {
      console.error('Failed to fetch audio devices:', err);
      setError('Failed to load audio devices. Please check your system audio settings.');
    } finally {
      setLoading(false);
    }
  };

  // Load devices on component mount
  useEffect(() => {
    fetchDevices();
  }, []);

  // Empty deviceNames is the existing backend path for the OS default mic and output.
  // Naming every device would open a stream per endpoint; the chosen pair is enough.
  useEffect(() => {
    if (!hasLoadedDevices) return;
    const names: string[] = [];
    for (const device of devices) {
      const value = toDeviceOptionValue(device);
      if (device.device_type === 'Input' && value === selectedDevices.micDevice) names.push(device.name);
      if (!isMacOS && device.device_type === 'Output' && value === selectedDevices.systemDevice) names.push(device.name);
    }
    void invoke('start_audio_level_monitoring', { deviceNames: names }).catch(() => undefined);
    return () => {
      void invoke('stop_audio_level_monitoring').catch(() => undefined);
    };
  }, [hasLoadedDevices, isMacOS, devices, selectedDevices.micDevice, selectedDevices.systemDevice]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<AudioLevelUpdate>('audio-levels', (event) => {
      const next = new Map<string, AudioLevelData>();
      event.payload.levels.forEach((level) => {
        next.set(level.device_name, level);
      });
      setAudioLevels(next);
      setLevelTick(event.payload.timestamp || Date.now());
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    }).catch((err) => {
      console.error('Failed to setup audio level listener:', err);
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Helper function to detect device category and Bluetooth status
  const getDeviceMetadata = (deviceName: string) => {
    const nameLower = deviceName.toLowerCase();

    // Detect if it's Bluetooth
    const isBluetooth = nameLower.includes('airpods')
      || nameLower.includes('bluetooth')
      || nameLower.includes('wireless')
      || nameLower.includes('wh-')  // Sony WH-* series
      || nameLower.includes('bt ');

    // Categorize device
    let category = 'wired';
    if (deviceName === 'default') {
      category = 'default';
    } else if (nameLower.includes('airpods')) {
      category = 'airpods';
    } else if (isBluetooth) {
      category = 'bluetooth';
    }

    return { isBluetooth, category };
  };

  // Handle microphone device selection
  const handleMicDeviceChange = (deviceName: string) => {
    const newDevices = {
      ...selectedDevices,
      micDevice: deviceName === 'default' ? null : deviceName
    };
    onDeviceChange(newDevices);

    // Track device selection analytics with enhanced metadata
    const metadata = getDeviceMetadata(deviceName);
    Analytics.track('microphone_selected', {
      device_category: metadata.category,
      is_bluetooth: metadata.isBluetooth.toString(),
      has_system_audio: (!!selectedDevices.systemDevice).toString()
    }).catch(err => console.error('Failed to track microphone selection:', err));
  };

  // Handle system audio device selection
  const handleSystemDeviceChange = (deviceName: string) => {
    const newDevices = {
      ...selectedDevices,
      systemDevice: deviceName === 'default' ? null : deviceName
    };
    onDeviceChange(newDevices);

    // Track device selection analytics with enhanced metadata
    const metadata = getDeviceMetadata(deviceName);
    Analytics.track('system_audio_selected', {
      device_category: metadata.category,
      is_bluetooth: metadata.isBluetooth.toString(),
      has_microphone: (!!selectedDevices.micDevice).toString()
    }).catch(err => console.error('Failed to track system audio selection:', err));
  };

  const micLevel = levelFor(selectedDevices.micDevice, inputDevices, audioLevels, 'input');
  const systemLevel = levelFor(selectedDevices.systemDevice, outputDevices, audioLevels, 'output');

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-44 w-full max-w-[320px] animate-pulse rounded-2xl bg-[var(--af-panel)]" />
        <div className="h-44 w-full max-w-[320px] animate-pulse rounded-2xl bg-[var(--af-panel)]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="text-xs text-red-300">{error}</p>
      )}
      <AudioDeviceCard
        kind="mic"
        label="Microphone"
        volumeLabel="Mic volume"
        levelLabel="Input level"
        deviceName={chosenName(selectedDevices.micDevice, inputDevices, 'Default microphone')}
        devices={inputDevices}
        selectedValue={selectedDevices.micDevice}
        open={openPicker === 'mic'}
        onOpenChange={(next) => {
          setOpenPicker(next ? 'mic' : null);
          if (next) void fetchDevices();
        }}
        onSelect={(value) => {
          handleMicDeviceChange(value);
          setOpenPicker(null);
        }}
        disabled={disabled}
        unavailable={micFellBack ? deviceDisplayName(selectedDevices.micDevice!) : null}
        gain={micGain}
        onGainLive={onMicGainLive}
        onGainCommit={onMicGainCommit}
        rmsLevel={micLevel?.rms_level ?? 0}
        peakLevel={micLevel?.peak_level ?? 0}
        levelTick={levelTick}
      />
      <AudioDeviceCard
        kind="system"
        label="System audio"
        volumeLabel="System volume"
        levelLabel="System level"
        deviceName={isMacOS ? 'System default' : chosenName(selectedDevices.systemDevice, outputDevices, 'Default output')}
        devices={isMacOS ? [] : outputDevices}
        selectedValue={isMacOS ? null : selectedDevices.systemDevice}
        open={openPicker === 'system'}
        onOpenChange={(next) => {
          if (isMacOS) return;
          setOpenPicker(next ? 'system' : null);
          if (next) void fetchDevices();
        }}
        onSelect={(value) => {
          handleSystemDeviceChange(value);
          setOpenPicker(null);
        }}
        disabled={disabled || isMacOS}
        note={isMacOS ? 'macOS records the current system output.' : null}
        unavailable={!isMacOS && systemFellBack ? deviceDisplayName(selectedDevices.systemDevice!) : null}
        gain={systemGain}
        onGainLive={onSystemGainLive}
        onGainCommit={onSystemGainCommit}
        rmsLevel={systemLevel?.rms_level ?? 0}
        peakLevel={systemLevel?.peak_level ?? 0}
        levelTick={levelTick}
      />
    </div>
  );
}

function chosenName(saved: string | null, devices: AudioDevice[], fallback: string) {
  if (!saved) return fallback;
  return devices.find((device) => toDeviceOptionValue(device) === saved)?.name ?? deviceDisplayName(saved);
}

function levelFor(
  saved: string | null,
  devices: AudioDevice[],
  levels: Map<string, AudioLevelData>,
  kind: 'input' | 'output',
) {
  if (saved) {
    const match = devices.find((device) => toDeviceOptionValue(device) === saved);
    return levels.get(match?.name ?? deviceDisplayName(saved));
  }
  for (const level of levels.values()) {
    if (level.device_type === kind) return level;
  }
  return undefined;
}

export function AudioDeviceCard({
  kind,
  label,
  volumeLabel,
  levelLabel,
  deviceName,
  devices,
  selectedValue,
  open,
  onOpenChange,
  onSelect,
  disabled,
  note,
  unavailable,
  gain,
  onGainLive,
  onGainCommit,
  rmsLevel,
  peakLevel,
  levelTick,
  meterActive = true,
}: {
  kind: 'mic' | 'system';
  label: string;
  volumeLabel: string;
  levelLabel: string;
  deviceName: string;
  devices: AudioDevice[];
  selectedValue: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (value: string) => void;
  disabled?: boolean;
  note?: string | null;
  unavailable?: string | null;
  gain?: number;
  onGainLive?: (value: number) => void;
  onGainCommit?: (value: number) => void;
  rmsLevel: number;
  peakLevel: number;
  /** Preview sample clock. Omit it to use the live recording meter. */
  levelTick?: number;
  meterActive?: boolean;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const closeTimer = useRef<number | null>(null);
  const openTimer = useRef<number | null>(null);
  const [place, setPlace] = useState<'right' | 'below' | 'above'>('right');
  const Icon = kind === 'mic' ? Mic : Volume2;
  const showVolume = typeof gain === 'number' && onGainLive && onGainCommit;

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const cancelOpen = () => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelOpen();
    cancelClose();
    closeTimer.current = window.setTimeout(() => onOpenChangeRef.current(false), 160);
  };
  const revealMenu = (immediate = false) => {
    if (disabled) return;
    cancelClose();
    if (immediate) {
      cancelOpen();
      onOpenChangeRef.current(true);
      return;
    }
    if (openTimer.current !== null) return;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      onOpenChangeRef.current(true);
    }, 90);
  };

  useEffect(() => () => {
    cancelClose();
    cancelOpen();
  }, []);

  useLayoutEffect(() => {
    if (!open || !popoverRef.current) return;
    const rect = popoverRef.current.getBoundingClientRect();
    const spaceRight = window.innerWidth - rect.right;
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceRight >= 296) setPlace('right');
    else if (spaceBelow >= 200) setPlace('below');
    else setPlace('above');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) onOpenChangeRef.current(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChangeRef.current(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="w-full max-w-[320px] rounded-2xl border border-[var(--af-border)] bg-[var(--af-panel)]">
      <div
        ref={popoverRef}
        className="relative"
        onMouseEnter={() => revealMenu(false)}
        onMouseLeave={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && popoverRef.current?.contains(next)) return;
          scheduleClose();
        }}
      >
      <div className="overflow-hidden rounded-t-[15px]">
      <button
        type="button"
        disabled={disabled}
        onClick={() => revealMenu(true)}
        onFocus={() => revealMenu(true)}
        className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left transition-colors duration-150 hover:bg-[var(--af-hover)] disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-medium text-[var(--af-text-3)]">{label}</span>
          <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-[var(--af-text)]">{deviceName}</span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-[var(--af-text-3)]" />
      </button>
      </div>

      {open && !disabled && (
        <div
          role="dialog"
          aria-label={`${label} devices`}
          onMouseEnter={cancelClose}
          className={`absolute z-50 ${
            place === 'below'
              ? 'left-0 top-full pt-2'
              : place === 'above'
                ? 'bottom-full left-0 pb-2'
                : 'left-full top-0 pl-2'
          }`}
        >
          <div className="w-[280px] overflow-hidden rounded-xl border border-[var(--af-border-strong)] bg-[var(--af-panel)] py-1 shadow-[var(--af-shadow-lg)]">
          <div className="max-h-72 overflow-y-auto" role="radiogroup" aria-label={label}>
            {devices.length === 0 && (
              <p className="px-3 py-3 text-[13px] text-[var(--af-text-3)]">No devices found</p>
            )}
            {devices.map((device) => {
              const value = toDeviceOptionValue(device);
              const selected = selectedValue === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onSelect(value)}
                  className={`mx-1 flex h-11 w-[calc(100%-8px)] cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left ${
                    selected ? 'bg-[var(--af-hover)]' : 'hover:bg-[var(--af-hover)]'
                  }`}
                >
                  <Icon size={14} className="shrink-0 text-[var(--af-text-3)]" />
                  <ScrollName text={device.name} />
                  <span
                    className={`h-4 w-4 shrink-0 rounded-full border-2 ${
                      selected ? 'border-[var(--af-accent)] bg-[var(--af-accent)]' : 'border-[var(--af-text-3)] bg-transparent'
                    }`}
                  />
                </button>
              );
            })}
          </div>
          </div>
        </div>
      )}
      </div>

      {showVolume && (
        <div className="border-t border-[var(--af-border)] px-3.5 py-3">
          <div className="mb-2 text-[12px] font-medium text-[var(--af-text-3)]">{volumeLabel}</div>
          <SmoothGainSlider
            value={gain}
            label={volumeLabel}
            disabled={disabled}
            onLive={onGainLive}
            onCommit={onGainCommit}
          />
        </div>
      )}

      <div className="border-t border-[var(--af-border)] px-3.5 py-3">
        <div className="mb-2 text-[12px] font-medium text-[var(--af-text-3)]">{levelLabel}</div>
        {levelTick === undefined ? (
          <LiveAudioVisualizer
            active={meterActive}
            source={kind === 'mic' ? 'mic' : 'system'}
            bars={18}
            fill
            className="w-full"
          />
        ) : (
          <LiveAudioVisualizer
            active
            source={kind === 'mic' ? 'mic' : 'system'}
            bars={18}
            fill
            feedRms={rmsLevel}
            feedPeak={peakLevel}
            feedTick={levelTick}
            displayGain={gain ?? 1}
            className="w-full"
          />
        )}
        {unavailable && (
          <p className="mt-2 text-[11px] text-[var(--af-text-3)]">{unavailable} is not connected.</p>
        )}
        {note && <p className="mt-2 text-[11px] text-[var(--af-text-3)]">{note}</p>}
      </div>
    </div>
  );
}

function ScrollName({ text }: { text: string }) {
  const outerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  const [hover, setHover] = useState(false);
  const looping = hover && shift > 0;
  const duration = Math.max(2.2, shift / 40);

  const measure = () => {
    const outer = outerRef.current;
    const node = textRef.current;
    if (!outer || !node) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    const textWidth = range.getBoundingClientRect().width;
    setShift(textWidth - outer.clientWidth > 2 ? Math.ceil(textWidth) + 32 : 0);
  };

  useLayoutEffect(() => {
    if (!looping) return;
    const node = textRef.current;
    if (!node) return;
    const exact = Math.ceil(node.offsetWidth) + 32;
    setShift((current) => (Math.abs(current - exact) > 1 ? exact : current));
  }, [looping, text]);

  return (
    <span
      ref={outerRef}
      className="block min-w-0 flex-1 overflow-hidden"
      onMouseEnter={() => {
        measure();
        setHover(true);
      }}
      onMouseLeave={() => setHover(false)}
    >
      {looping ? (
        <span
          className="af-name-scroll inline-flex w-max items-center"
          style={{
            ['--af-shift' as string]: `${shift}px`,
            animationDuration: `${duration}s`,
          }}
        >
          <span ref={textRef} className="inline-block whitespace-nowrap text-[13px] text-[var(--af-text)]">{text}</span>
          <span aria-hidden className="inline-block whitespace-nowrap pl-[32px] text-[13px] text-[var(--af-text)]">{text}</span>
        </span>
      ) : (
        <span ref={textRef} className="block truncate text-[13px] text-[var(--af-text)]">{text}</span>
      )}
    </span>
  );
}

function SmoothGainSlider({
  value,
  label,
  disabled,
  onLive,
  onCommit,
}: {
  value: number;
  label: string;
  disabled?: boolean;
  onLive: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const shownRef = useRef(value);
  const dragging = useRef(false);
  const over = useRef(false);
  const [shown, setShown] = useState(value);
  const [tip, setTip] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    let frame = 0;
    const tick = () => {
      const delta = value - shownRef.current;
      if (Math.abs(delta) < 0.003) {
        shownRef.current = value;
        setShown(value);
        return;
      }
      shownRef.current += delta * 0.35;
      setShown(shownRef.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  const pct = ((shown - 0.5) / 2.5) * 100;

  const valueFromX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return value;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round((0.5 + ratio * 2.5) * 10) / 10;
  };

  const nudge = (direction: number) => {
    const next = Math.min(3, Math.max(0.5, Math.round((value + direction * 0.1) * 10) / 10));
    onLive(next);
    onCommit(next);
  };

  const showTip = (nextDragging: boolean) => setTip(over.current || nextDragging);

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0.5}
      aria-valuemax={3}
      aria-valuenow={value}
      aria-valuetext={`${value.toFixed(1)}×`}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          event.preventDefault();
          nudge(1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          event.preventDefault();
          nudge(-1);
        }
      }}
      onPointerEnter={() => {
        over.current = true;
        showTip(dragging.current);
      }}
      onPointerLeave={() => {
        over.current = false;
        showTip(dragging.current);
      }}
      onFocus={() => setTip(true)}
      onBlur={() => { if (!dragging.current) setTip(false); }}
      onPointerDown={(event) => {
        if (disabled) return;
        dragging.current = true;
        setTip(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        onLive(valueFromX(event.clientX));
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        onLive(valueFromX(event.clientX));
      }}
      onPointerUp={(event) => {
        if (!dragging.current) return;
        dragging.current = false;
        const next = valueFromX(event.clientX);
        onLive(next);
        onCommit(next);
        showTip(false);
      }}
      className={`relative flex h-5 items-center outline-none ${disabled ? 'cursor-default opacity-50' : 'cursor-pointer'}`}
    >
      <span className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--af-border)]" />
      <span className="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--af-accent)]" style={{ width: `${pct}%` }} />
      <span
        className="pointer-events-none absolute top-1/2 z-10 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ left: `${pct}%`, backgroundColor: '#ffffff', boxShadow: '0 0 0 1px rgba(0,0,0,0.28)' }}
      >
        {tip && (
          <span className="absolute bottom-full left-1/2 z-20 mb-2.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground">
            {label} {value.toFixed(1)}×
          </span>
        )}
      </span>
    </div>
  );
}
