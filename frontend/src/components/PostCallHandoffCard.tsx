'use client';

import type { ReactNode } from 'react';
import { Users } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { RecordingCardSlot } from '@/components/RecordingCardSlot';

/**
 * The recording card's successor. Stopping, saving, and the speaker question
 * all use this same bottom card so the handoff does not jump between popups.
 */
export function PostCallHandoffCard({
  title,
  detail,
  busy = false,
  icon,
  children,
}: {
  sidebarCollapsed?: boolean;
  title: string;
  detail?: string;
  busy?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <RecordingCardSlot>
        <div className="pointer-events-auto w-full max-w-[36rem] rounded-3xl border border-white/10 bg-[#0f1218]/95 px-5 py-4 text-white shadow-2xl">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
              {busy ? (
                <Spinner size={18} />
              ) : (
                icon ?? <Users size={18} strokeWidth={1.75} />
              )}
            </span>
            <div className="min-w-0 text-left leading-tight">
              <div className="text-sm font-semibold tracking-tight">{title}</div>
              {detail && <div className="mt-0.5 text-[11px] text-white/50">{detail}</div>}
            </div>
          </div>
          {children && <div className="mt-4">{children}</div>}
        </div>
    </RecordingCardSlot>
  );
}
