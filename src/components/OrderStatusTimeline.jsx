import React from 'react'
import { getOrderStatusSteps } from '../lib/orders'

export default function OrderStatusTimeline({ status }) {
  const steps = getOrderStatusSteps(status)
  const activeIndex = Math.max(0, steps.findIndex((step) => step.active))
  const activeStep = steps[activeIndex] || steps[0]
  const nextStep = steps.find((step) => step.pending)
  const progressPercent = steps.length > 1
    ? Math.round((activeIndex / (steps.length - 1)) * 100)
    : 100
  const isStopped = status === 'cancelled' || status === 'rejected'
  const progressColor = isStopped ? 'bg-rose-500' : 'bg-emerald-500'

  function getStepClass(step) {
    if (step.complete) return 'bg-emerald-600 text-white'
    if (step.active) return isStopped ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'
    return 'bg-white text-slate-400 ring-1 ring-slate-200'
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl bg-slate-50 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-900">Progress Pesanan</div>
          <div className="mt-1 text-xs text-slate-500 sm:hidden">
            Status sekarang: <span className="font-medium text-slate-700">{activeStep?.label || '-'}</span>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
          {activeIndex + 1}/{steps.length}
        </span>
      </div>

      <div className="mt-3 sm:hidden">
        <div className="h-2 overflow-hidden rounded-full bg-white ring-1 ring-slate-200">
          <div
            className={`h-full rounded-full ${progressColor} transition-all`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-slate-400">
          <span className="line-clamp-1">{steps[0]?.label}</span>
          <span className="line-clamp-1 text-right">{steps[steps.length - 1]?.label}</span>
        </div>
        {nextStep && (
          <div className="mt-3 rounded-2xl bg-white px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
            Berikutnya: <span className="font-medium text-slate-800">{nextStep.label}</span>
          </div>
        )}
      </div>

      <div className="mt-3 hidden gap-3 sm:grid sm:grid-cols-3 xl:grid-cols-6">
        {steps.map((step) => (
          <div key={step.key} className="min-w-0 rounded-2xl bg-white/70 p-3 ring-1 ring-slate-200/80">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${getStepClass(step)}`}
            >
              {step.complete ? '✓' : '•'}
            </div>
            <div className={`mt-2 break-words text-xs leading-5 ${step.active ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>
              {step.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
