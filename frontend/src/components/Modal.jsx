import * as Dialog from '@radix-ui/react-dialog'

/* Drop-in replacement for the old hand-rolled Modal.

   Same API as before: <Modal open onClose title subtitle footer>{...}</Modal>.

   What we get for free from Radix Dialog:
     - Focus trap (Tab cycles inside the modal, Shift+Tab works)
     - Body scroll lock while open
     - Escape closes (no manual keydown listener)
     - Backdrop click closes
     - Animated open/close (overlay fade, content scale)
     - aria-labelledby / aria-describedby wired up automatically
     - Returns focus to the trigger element on close

   Why the conditional render on `open`:
     The pages that use Modal pass `open={false}` initially. Radix Dialog
     handles its own visibility, but mounting it unconditionally would
     register a global Escape handler even when closed — so we gate on `open`
     to keep behaviour identical to the old component. */

export default function Modal({ open, onClose, title, subtitle, children, footer }) {
  return (
    <Dialog.Root open={!!open} onOpenChange={v => { if (!v) onClose?.() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content className="dlg-content">
          {title && <Dialog.Title className="dlg-title">{title}</Dialog.Title>}
          {subtitle && <Dialog.Description className="dlg-sub">{subtitle}</Dialog.Description>}
          {children}
          {footer && <div className="dlg-footer">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
