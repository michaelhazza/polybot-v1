import React, { useEffect, useRef } from 'react';

function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, variant, onConfirm, onCancel }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (open) {
      dialogRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!open) return;
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  const variantClass = variant === 'danger' ? 'confirm-btn-danger' : 'confirm-btn-primary';

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog-container" ref={dialogRef} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>{title || 'Confirm'}</h3>
        </div>
        <div className="dialog-body">
          <p>{message}</p>
        </div>
        <div className="dialog-footer">
          <button className="dialog-btn dialog-btn-cancel" onClick={onCancel}>
            {cancelLabel || 'Cancel'}
          </button>
          <button className={`dialog-btn ${variantClass}`} onClick={onConfirm}>
            {confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
