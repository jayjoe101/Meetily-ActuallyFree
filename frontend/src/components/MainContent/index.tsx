'use client';

import React from 'react';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';

interface MainContentProps {
  children: React.ReactNode;
}

const MainContent: React.FC<MainContentProps> = ({ children }) => {
  const { isCollapsed } = useSidebar();

  return (
    // min-w-0 is required: flex items default to min-width:auto and will not
    // shrink below their content, which clipped Settings (and other pages)
    // when the window was narrower than sidebar + content.
    <main
      className={`flex-1 min-w-0 min-h-0 h-screen overflow-hidden transition-[margin-left] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
        isCollapsed ? 'ml-16' : 'ml-64'
      }`}
    >
      <div className="h-full min-w-0 min-h-0 overflow-hidden pl-4 sm:pl-6 lg:pl-8">
        {children}
      </div>
    </main>
  );
};

export default MainContent;
