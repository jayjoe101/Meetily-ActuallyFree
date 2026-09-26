'use client';

import { useEffect, useState } from 'react';

export const SIDEBAR_MIN = 4 * 16;
/** The normal open rail. Narrower than this snaps shut; wider is optional. */
export const SIDEBAR_DEFAULT = 16 * 16;
export const SIDEBAR_ABSOLUTE_MAX = 24 * 16;
const CARD = 27.75 * 16;
const GAP = 0.5 * 16;
const SPEAKERS_FULL = 20 * 16;
const SPEAKERS_CONDENSED = 11 * 16;

/** Narrowest window: collapsed rail, condensed speakers panel, and the shrunk live card. */
export const COMPACT_MIN_WIDTH = SIDEBAR_MIN + GAP + CARD + GAP + SPEAKERS_CONDENSED;

function speakersAreOpen() {
  if (typeof document === 'undefined') return false;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--af-speakers-width').trim();
  return raw !== '' && raw !== '0' && raw !== '0px';
}

/** Largest rail that still leaves the recording card clear. Speakers, if open, stay at the condensed width. */
export function maxSidebarFit(windowWidth: number) {
  const reserved = speakersAreOpen() ? SPEAKERS_CONDENSED : 0;
  return windowWidth - GAP - CARD - GAP - reserved;
}

/** Live drag can sit between shut and the default so the rail can squish. */
export function previewSidebarWidth(next: number, windowWidth = typeof window === 'undefined' ? 1280 : window.innerWidth) {
  const ceiling = Math.min(SIDEBAR_ABSOLUTE_MAX, Math.max(SIDEBAR_MIN, maxSidebarFit(windowWidth)));
  return Math.round(Math.max(SIDEBAR_MIN, Math.min(ceiling, next)));
}

/** Flick left snaps shut. Anything open is at least the default width, then up to the window's cap. */
export function snapSidebarWidth(next: number, windowWidth = typeof window === 'undefined' ? 1280 : window.innerWidth) {
  const ceiling = Math.min(SIDEBAR_ABSOLUTE_MAX, maxSidebarFit(windowWidth));
  if (ceiling < SIDEBAR_DEFAULT) return SIDEBAR_MIN;
  if (next < SIDEBAR_DEFAULT - 36) return SIDEBAR_MIN;
  return Math.round(Math.min(ceiling, Math.max(SIDEBAR_DEFAULT, next)));
}

export function displayedSidebarWidth(preferred: number, windowWidth: number) {
  const ceiling = Math.min(SIDEBAR_ABSOLUTE_MAX, maxSidebarFit(windowWidth));
  if (ceiling < SIDEBAR_DEFAULT || preferred <= SIDEBAR_MIN + 8) return SIDEBAR_MIN;
  return Math.round(Math.min(ceiling, Math.max(SIDEBAR_DEFAULT, preferred)));
}

export function sidebarRoomForSpeakers(windowWidth: number, sidebarWidth: number) {
  return windowWidth - sidebarWidth - GAP - CARD - GAP;
}

export function useChromeFit() {
  const [speakersCondensed, setSpeakersCondensed] = useState(false);

  useEffect(() => {
    const read = () => {
      const sidebar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--af-sidebar-width')) || SIDEBAR_DEFAULT;
      setSpeakersCondensed(sidebarRoomForSpeakers(window.innerWidth, sidebar) < SPEAKERS_FULL);
    };
    read();
    window.addEventListener('resize', read);
    window.addEventListener('af-sidebar-width', read);
    return () => {
      window.removeEventListener('resize', read);
      window.removeEventListener('af-sidebar-width', read);
    };
  }, []);

  return { speakersCondensed };
}
