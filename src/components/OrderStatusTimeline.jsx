import React from 'react'
import { getOrderStatusSteps } from '../lib/orders'

export default function OrderStatusTimeline({ status }) {
  const steps = getOrderStatusSteps(status)

  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <div className="mb-3 text-sm font-medium text-slate-900">Progress Pesanan</div>
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {steps.map((step) => (
          <div key={step.key} className="flex items-center gap-3">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                step.complete
                  ? 'bg-emerald-600 text-white'
                  : step.active
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-400 ring-1 ring-slate-200'
              }`}
            >
              {step.complete ? '✓' : '•'}
            </div>
            <div className={`text-xs leading-5 ${step.active ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>
              {step.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
