export function normalizeReviewRating(value) {
  const rating = Number(value)
  if (!Number.isFinite(rating)) return 0
  return Math.max(1, Math.min(5, Math.round(rating)))
}

export function formatReviewScore(value) {
  const rating = Number(value)
  if (!Number.isFinite(rating) || rating <= 0) return 'Belum ada rating'
  return `${rating.toFixed(1)}/5`
}

export function getReviewRatingLabel(value) {
  switch (normalizeReviewRating(value)) {
    case 5:
      return 'Sangat bagus'
    case 4:
      return 'Bagus'
    case 3:
      return 'Cukup'
    case 2:
      return 'Kurang'
    case 1:
      return 'Buruk'
    default:
      return 'Belum dinilai'
  }
}

export function getReviewSummary(reviews) {
  const list = Array.isArray(reviews) ? reviews.filter(Boolean) : []
  if (list.length === 0) {
    return {
      count: 0,
      average: 0,
      averageLabel: 'Belum ada rating',
    }
  }

  const total = list.reduce((sum, review) => sum + normalizeReviewRating(review.rating), 0)
  const average = total / list.length

  return {
    count: list.length,
    average,
    averageLabel: formatReviewScore(average),
  }
}

export function canBuyerReviewOrder(order, buyerId) {
  return Boolean(
    order &&
    buyerId &&
    order.status === 'completed' &&
    order.buyer_id === buyerId
  )
}
