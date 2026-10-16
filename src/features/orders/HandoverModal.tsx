import { Modal } from '../../shared/components/Modal'

type Props = {
  open: boolean
  cash: boolean
  disabled: boolean
  onConfirm: () => void
  onClose: () => void
}
const button =
  'min-h-11 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium disabled:opacity-50'

export default function HandoverModal({
  open,
  cash,
  disabled,
  onConfirm,
  onClose,
}: Props) {
  return (
    <Modal open={open} title="Selesaikan pesanan" onClose={onClose}>
      <p className="text-sm text-slate-700">
        {cash
          ? 'Barang sudah diserahkan dan uang COD sudah diterima?'
          : 'Barang sudah diserahkan kepada pelanggan atau kurirnya?'}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className={`${button} bg-teal-700 text-white`}
          disabled={disabled}
          onClick={onConfirm}
        >
          {cash ? 'Ya, selesaikan pesanan' : 'Ya, sudah diserahkan'}
        </button>
        <button className={button} disabled={disabled} onClick={onClose}>
          Belum
        </button>
      </div>
    </Modal>
  )
}
