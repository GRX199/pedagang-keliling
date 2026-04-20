import { isActiveOrderStatus } from './orders'
import { getVendorCoordinates } from './vendor'

export const DEMAND_LOOKBACK_DAYS = 14

const LOCATION_CELL_SIZE = 0.0035

function cleanText(value) {
  return String(value || '').trim()
}

function roundCell(value) {
  return Math.round(Number(value) / LOCATION_CELL_SIZE) * LOCATION_CELL_SIZE
}

function getDemandCoordinate(order) {
  return (
    getVendorCoordinates(order?.meeting_point_location) ||
    getVendorCoordinates(order?.customer_location) ||
    null
  )
}

function getDemandAreaLabel(order) {
  const meetingPointLabel = cleanText(order?.meeting_point_label)
  if (meetingPointLabel) return meetingPointLabel

  if (order?.order_timing === 'preorder') return 'Area titip pelanggan'
  if (order?.fulfillment_type === 'delivery') return 'Area pelanggan'
  return 'Titik temu pelanggan'
}

function getOrderReferenceTimestamp(order) {
  return (
    order?.requested_fulfillment_at ||
    order?.updated_at ||
    order?.created_at ||
    null
  )
}

function getTimeValue(value) {
  const time = new Date(value || 0).getTime()
  return Number.isFinite(time) ? time : 0
}

function getStrengthLabel(intensity) {
  if (intensity >= 4) return 'Sangat ramai'
  if (intensity >= 3) return 'Ramai'
  if (intensity >= 2) return 'Mulai hidup'
  return 'Masih tipis'
}

function pickAreaLabel(labelsMap, fallbackLabel) {
  const sorted = Array.from(labelsMap.entries()).sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1]
    return left[0].localeCompare(right[0], 'id-ID')
  })

  return sorted[0]?.[0] || fallbackLabel
}

export function buildVendorTerritoryInsights(orders, { lookbackDays = DEMAND_LOOKBACK_DAYS } = {}) {
  const safeOrders = Array.isArray(orders) ? orders : []
  const lookbackThreshold = Date.now() - (lookbackDays * 24 * 60 * 60 * 1000)

  const hotspotMap = new Map()
  let mappedOrderCount = 0
  let preorderCount = 0

  safeOrders.forEach((order) => {
    const createdAtValue = getTimeValue(order?.created_at || order?.updated_at)
    if (!isActiveOrderStatus(order?.status) && createdAtValue < lookbackThreshold) {
      return
    }

    const coordinate = getDemandCoordinate(order)
    if (!coordinate) return

    const key = `${roundCell(coordinate.lat).toFixed(4)}:${roundCell(coordinate.lng).toFixed(4)}`
    if (!hotspotMap.has(key)) {
      hotspotMap.set(key, {
        key,
        labels: new Map(),
        orderCount: 0,
        activeCount: 0,
        preorderCount: 0,
        completedCount: 0,
        cancelledCount: 0,
        totalCompletedValue: 0,
        latestAt: null,
      })
    }

    const hotspot = hotspotMap.get(key)
    const areaLabel = getDemandAreaLabel(order)
    hotspot.labels.set(areaLabel, (hotspot.labels.get(areaLabel) || 0) + 1)
    hotspot.orderCount += 1

    if (isActiveOrderStatus(order?.status)) hotspot.activeCount += 1
    if (order?.order_timing === 'preorder') {
      hotspot.preorderCount += 1
      preorderCount += 1
    }
    if (order?.status === 'completed') {
      hotspot.completedCount += 1
      hotspot.totalCompletedValue += Number(order?.total_amount || 0)
    }
    if (order?.status === 'cancelled' || order?.status === 'rejected') {
      hotspot.cancelledCount += 1
    }

    const referenceTimestamp = getOrderReferenceTimestamp(order)
    if (!hotspot.latestAt || getTimeValue(referenceTimestamp) > getTimeValue(hotspot.latestAt)) {
      hotspot.latestAt = referenceTimestamp
    }

    mappedOrderCount += 1
  })

  const hotspots = Array.from(hotspotMap.values())
    .map((hotspot) => {
      const signalScore =
        (hotspot.activeCount * 4) +
        (hotspot.preorderCount * 3) +
        (hotspot.completedCount * 2) +
        hotspot.orderCount -
        hotspot.cancelledCount

      return {
        id: hotspot.key,
        label: pickAreaLabel(hotspot.labels, 'Area pelanggan'),
        orderCount: hotspot.orderCount,
        activeCount: hotspot.activeCount,
        preorderCount: hotspot.preorderCount,
        completedCount: hotspot.completedCount,
        cancelledCount: hotspot.cancelledCount,
        totalCompletedValue: hotspot.totalCompletedValue,
        latestAt: hotspot.latestAt,
        signalScore: Math.max(signalScore, hotspot.orderCount),
      }
    })
    .sort((left, right) => {
      if (right.signalScore !== left.signalScore) return right.signalScore - left.signalScore
      if (right.orderCount !== left.orderCount) return right.orderCount - left.orderCount
      return getTimeValue(right.latestAt) - getTimeValue(left.latestAt)
    })

  const maxSignal = hotspots[0]?.signalScore || 1
  const normalizedHotspots = hotspots.map((hotspot) => {
    const ratio = hotspot.signalScore / maxSignal
    const intensity = Math.max(1, Math.min(4, Math.ceil(ratio * 4)))

    return {
      ...hotspot,
      intensity,
      strengthLabel: getStrengthLabel(intensity),
    }
  })

  return {
    lookbackDays,
    mappedOrderCount,
    preorderCount,
    hotspotCount: normalizedHotspots.length,
    hotspots: normalizedHotspots.slice(0, 5),
    leadHotspot: normalizedHotspots[0] || null,
  }
}
