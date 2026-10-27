import { useParams, useSearchParams } from 'react-router-dom'
import ChatWorkspace from './ChatWorkspace'

export default function ChatsPage() {
  const params = useParams()
  const [searchParams] = useSearchParams()
  const initialVendorId = params.id || searchParams.get('vendor')
  const initialOrderId = searchParams.get('order')

  return (
    <div>
      <div className="ui-page max-w-6xl">
        <h1 className="sr-only">Percakapan</h1>
        <ChatWorkspace
          initialVendorId={initialVendorId}
          initialOrderId={initialOrderId}
        />
      </div>
    </div>
  )
}
