'use client';

import type { ReactNode } from 'react';

/**
 * Centers the recording bar, and every card that replaces it, in the open
 * area. The left inset clears the rail plus the collapse control and its
 * shadow. The right inset clears the speakers panel. The card itself stays
 * as wide as its contents.
 */
export function RecordingCardSlot({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none fixed bottom-12 left-0 right-0 z-40">
      <div
        className="flex justify-center transition-[margin] duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{
          marginLeft: 'calc(var(--af-sidebar-width, 16rem) + 3.5rem)',
          marginRight: 'calc(var(--af-speakers-width, 0px) + 1.25rem)',
        }}
      >
        <div className="pointer-events-none flex w-full max-w-[42rem] justify-center">
          {children}
        </div>
      </div>
    </div>
  );
}
