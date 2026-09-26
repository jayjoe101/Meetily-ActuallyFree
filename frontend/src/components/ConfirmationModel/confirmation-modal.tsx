'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface ConfirmationModalProps {
  onConfirm: () => void;
  onCancel: () => void;
  text: string;
  isOpen: boolean;
}

export function ConfirmationModal({ onConfirm, onCancel, text, isOpen }: ConfirmationModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  // Portaled to the document so the overlay is not trapped in the rail.
  // The rail is a lower stacking layer than the chat, which hid this dialog
  // and left only its backdrop eating clicks on the sidebar.
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        className="mx-4 w-full max-w-md rounded-lg bg-white p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-delete-title" className="mb-4 text-xl font-semibold">Confirm Delete</h2>
        <p className="mb-6 text-gray-600">{text}</p>
        <div className="flex justify-end space-x-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-4 py-2 text-gray-600 transition-colors hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-red-600 px-4 py-2 text-white transition-colors hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
