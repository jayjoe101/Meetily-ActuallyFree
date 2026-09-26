'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

interface MainContentProps {
  children: React.ReactNode;
}

const MainContent: React.FC<MainContentProps> = ({ children }) => {
  const pathname = usePathname();
  // The recording chat sits flush against the rail divider. A left inset
  // exposed the darker canvas as its own strip beside the transcript.
  const chat = pathname === '/';

  return (
    // min-w-0 is required: flex items default to min-width:auto and will not
    // shrink below their content, which clipped Settings (and other pages)
    // when the window was narrower than sidebar + content.
    <main
      className={`relative z-30 flex-1 min-w-0 min-h-0 h-screen overflow-hidden transition-[margin-left] duration-300 ease-[cubic-bezier(0.22,1.25,0.36,1)] motion-reduce:transition-none ${
        chat ? 'bg-[var(--af-panel)]' : 'bg-[var(--af-bg)]'
      }`}
      style={{ marginLeft: 'var(--af-sidebar-width, 16rem)' }}
    >
      <div className={`h-full min-w-0 min-h-0 overflow-hidden ${chat ? '' : 'pl-4 sm:pl-6 lg:pl-8'}`}>
        {children}
      </div>
    </main>
  );
};

export default MainContent;
