import React from 'react';

const LEVEL_BARS = 18;

function filledBarCount(rmsLevel: number, peakLevel: number, bars: number) {
  const level = Math.max(0, Math.min(1, Math.max(rmsLevel, peakLevel)));
  const shaped = level > 0 ? Math.log10(level * 9 + 1) : 0;
  return Math.round(shaped * bars);
}

/** Quiet bars stay dim. Louder input lights bars from left to right. */
export function LevelBarStrip({
  rmsLevel,
  peakLevel,
  bars = LEVEL_BARS,
}: {
  rmsLevel: number;
  peakLevel: number;
  bars?: number;
}) {
  const filled = filledBarCount(rmsLevel, peakLevel, bars);
  return (
    <div className="flex h-4 items-end gap-[3px]" aria-hidden>
      {Array.from({ length: bars }, (_, index) => (
        <span
          key={index}
          className={`h-3.5 min-w-0 flex-1 rounded-full ${
            index < filled ? 'bg-[var(--af-accent)]' : 'bg-[var(--af-border)]'
          }`}
        />
      ))}
    </div>
  );
}

interface AudioLevelMeterProps {
  rmsLevel: number;    // 0.0 to 1.0
  peakLevel: number;   // 0.0 to 1.0
  isActive: boolean;   // Whether audio is being detected
  deviceName: string;
  className?: string;
  size?: 'small' | 'medium' | 'large';
}

export function AudioLevelMeter({
  rmsLevel,
  peakLevel,
  isActive,
  deviceName,
  className = '',
  size = 'medium'
}: AudioLevelMeterProps) {
  return (
    <div className={className} title={deviceName} data-active={isActive} data-size={size}>
      <LevelBarStrip rmsLevel={rmsLevel} peakLevel={peakLevel} />
    </div>
  );
}

interface CompactAudioLevelMeterProps {
  rmsLevel: number;
  peakLevel: number;
  isActive: boolean;
  className?: string;
}

// Compact version for inline display in dropdowns
export function CompactAudioLevelMeter({
  rmsLevel,
  peakLevel,
  isActive,
  className = ''
}: CompactAudioLevelMeterProps) {
  return (
    <div className={className} data-active={isActive}>
      <LevelBarStrip rmsLevel={rmsLevel} peakLevel={peakLevel} bars={16} />
    </div>
  );
}