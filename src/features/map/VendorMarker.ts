import L from '../../shared/lib/leaflet'
import type { VendorMapItem } from '../../types/domain.types'
import {
  getVendorCategory,
  getVendorReviewCount,
  formatVendorRatingMeta,
  formatVendorPromoTeaser,
} from './map-model'
import {
  formatVendorCategoryLabel,
  isVendorPromoActive,
  formatVendorPromoExpiry,
} from '../../lib/vendor'
export type PopupAction = {
  label: string
  colors: { border: string; background: string; color: string }
  onClick: () => void
}

function createActionButton(label: string, colors: PopupAction['colors'], onClick: () => void) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.style.padding = '6px 10px'
  button.style.borderRadius = '8px'
  button.style.border = `1px solid ${colors.border}`
  button.style.background = colors.background
  button.style.color = colors.color
  button.style.cursor = 'pointer'
  button.style.fontSize = '12px'
  button.addEventListener('click', onClick)
  return button
}

export function buildPopupContent(vendor: VendorMapItem, actions: PopupAction[] = []) {
  const wrapper = document.createElement('div')
  wrapper.style.minWidth = '220px'

  const title = document.createElement('strong')
  title.textContent = vendor.name || 'Pedagang'
  wrapper.appendChild(title)

  const status = document.createElement('div')
  status.style.fontSize = '12px'
  status.style.marginTop = '4px'
  status.textContent = vendor.online ? 'Sedang online' : 'Sedang offline'
  status.style.color = vendor.online ? '#15803d' : '#6b7280'
  wrapper.appendChild(status)

  const vendorCategory = getVendorCategory(vendor)
  if (vendorCategory) {
    const category = document.createElement('div')
    category.style.fontSize = '12px'
    category.style.marginTop = '6px'
    category.style.color = '#475569'
    category.textContent = `Kategori: ${formatVendorCategoryLabel(vendorCategory)}`
    wrapper.appendChild(category)
  }

  const reviewCount = getVendorReviewCount(vendor)
  if (reviewCount > 0) {
    const rating = document.createElement('div')
    rating.style.fontSize = '12px'
    rating.style.marginTop = '6px'
    rating.style.color = '#92400e'
    rating.textContent = `Rating: ${formatVendorRatingMeta(vendor)}`
    wrapper.appendChild(rating)
  }

  if (isVendorPromoActive(vendor)) {
    const promo = document.createElement('div')
    promo.style.fontSize = '12px'
    promo.style.marginTop = '6px'
    promo.style.color = '#b45309'
    promo.textContent = `Promo: ${formatVendorPromoTeaser(vendor)}`
    wrapper.appendChild(promo)

    const promoExpiry = document.createElement('div')
    promoExpiry.style.fontSize = '11px'
    promoExpiry.style.marginTop = '2px'
    promoExpiry.style.color = '#a16207'
    promoExpiry.textContent = `Berlaku sampai ${formatVendorPromoExpiry(vendor)}`
    wrapper.appendChild(promoExpiry)
  }

  if (vendor.photo_url) {
    const imageWrap = document.createElement('div')
    imageWrap.style.marginTop = '8px'

    const image = document.createElement('img')
    image.src = vendor.photo_url
    image.alt = vendor.name || 'Pedagang'
    image.style.width = '100%'
    image.style.height = '96px'
    image.style.objectFit = 'cover'
    image.style.borderRadius = '8px'

    imageWrap.appendChild(image)
    wrapper.appendChild(imageWrap)
  }

  if (vendor.description) {
    const description = document.createElement('div')
    description.textContent = String(vendor.description).slice(0, 120)
    description.style.marginTop = '8px'
    description.style.fontSize = '13px'
    description.style.color = '#374151'
    wrapper.appendChild(description)
  }

  const actionsRow = document.createElement('div')
  actionsRow.style.display = 'flex'
  actionsRow.style.flexWrap = 'wrap'
  actionsRow.style.gap = '8px'
  actionsRow.style.justifyContent = 'flex-end'
  actionsRow.style.marginTop = '10px'

  for (const action of actions) {
    if (!action?.label || typeof action.onClick !== 'function') continue
    actionsRow.appendChild(createActionButton(action.label, action.colors, action.onClick))
  }

  L.DomEvent.disableClickPropagation(wrapper)
  if (actionsRow.childElementCount > 0) {
    wrapper.appendChild(actionsRow)
  }
  return wrapper
}
