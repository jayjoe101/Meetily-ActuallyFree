import React from "react";
import Image from "next/image";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { VisuallyHidden } from "./ui/visually-hidden";
import { About } from "./About";

interface LogoProps {
    /** Wide rail. The mark stays; the wordmark unfolds beside it. */
    expanded: boolean;
}

const Logo = React.forwardRef<HTMLButtonElement, LogoProps>(({ expanded }, ref) => {
  return (
    <Dialog aria-describedby={undefined}>
      <DialogTrigger asChild>
        <button
          ref={ref}
          aria-label="About Meetily"
          className="flex h-10 w-full items-center overflow-hidden rounded-lg text-left transition-colors hover:bg-[var(--af-hover)]"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center">
            <Image
              src="/logo-collapsed.png"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 rounded-[10px]"
            />
          </span>
          <span
            className={`grid min-w-0 flex-1 items-center transition-[grid-template-columns,opacity] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
              expanded
                ? 'grid-cols-[1fr] opacity-100 delay-75 duration-200'
                : 'grid-cols-[0fr] opacity-0 duration-150'
            }`}
          >
            <span className="min-w-0 overflow-hidden pl-0.5">
              <span className="block truncate text-[13px] font-semibold leading-tight tracking-tight text-[var(--af-text)]">
                Meetily
              </span>
              <span className="block truncate text-[11px] leading-tight text-[var(--af-accent)]">
                Actually Free
              </span>
            </span>
          </span>
        </button>
      </DialogTrigger>
      <DialogContent>
        <VisuallyHidden>
          <DialogTitle>About Meetily</DialogTitle>
        </VisuallyHidden>
        <About />
      </DialogContent>
    </Dialog>
  );
});

Logo.displayName = "Logo";

export default Logo;