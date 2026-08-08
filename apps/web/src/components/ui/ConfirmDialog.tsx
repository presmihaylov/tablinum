import { Modal } from './Overlay';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

interface ConfirmDialogProps {
  request: ConfirmRequest | null;
  onClose: () => void;
}

export function ConfirmDialog({ request, onClose }: ConfirmDialogProps) {
  if (!request) return null;

  return (
    <Modal
      open
      title={request.title}
      onClose={onClose}
      width="24rem"
      footer={
        <>
          <button type="button" className="btn btn--outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={request.danger ? 'btn btn--primary btn--destructive' : 'btn btn--primary'}
            onClick={() => {
              onClose();
              request.onConfirm();
            }}
          >
            {request.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
        {request.message}
      </p>
    </Modal>
  );
}
