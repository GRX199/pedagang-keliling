import React from 'react'

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('Uncaught application error', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
            <h1 className="text-xl font-semibold text-slate-950">Halaman belum dapat ditampilkan</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Terjadi kendala yang tidak terduga. Muat ulang halaman untuk mencoba kembali.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white"
            >
              Muat Ulang
            </button>
          </div>
        </main>
      )
    }

    return this.props.children
  }
}
