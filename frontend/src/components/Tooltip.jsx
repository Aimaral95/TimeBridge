import * as RadixTooltip from '@radix-ui/react-tooltip'

/* Thin wrapper around Radix Tooltip so the rest of the app can do:
     <Tooltip label="Settings"><button>…</button></Tooltip>

   Radix gives us:
     - portal'd positioning (no clipping inside scroll containers)
     - keyboard focus support
     - delay / open animations / arrow
     - proper aria-describedby wiring

   We render a single shared Provider at app root via TooltipProvider below, so
   individual tooltips don't have to know about it. */

export function TooltipProvider({ children, delay = 200 }) {
  return (
    <RadixTooltip.Provider delayDuration={delay} skipDelayDuration={120}>
      {children}
    </RadixTooltip.Provider>
  )
}

export function Tooltip({ label, side = 'right', sideOffset = 8, children }) {
  if (!label) return children
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={sideOffset}
          className="tt-content"
        >
          {label}
          <RadixTooltip.Arrow className="tt-arrow" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}
