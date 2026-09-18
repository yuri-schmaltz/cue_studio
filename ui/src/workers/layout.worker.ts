// Layout / scroll-alignment worker.
//
// Receives a list of gallery items plus a viewport rectangle and
// returns the index that should be in view, the average scroll
// offset, and per-item "should be in DOM" booleans. The main thread
// uses the result to drive a virtualized list.
//
// Protocol:
//   request  = { id, op: 'computeLayout', payload: { items, viewportWidth, viewportHeight, itemSize } }
//   response = { id, ok, result: { centerIndex, inView: boolean[] } }
//
// Errors are returned in the standard WorkerResponse error channel;
// the main thread catches them and falls back to a synchronous
// computation.

import type { WorkerRequest, WorkerResponse } from '../lib/webWorker'

type LayoutItem = {
  id: string
  width: number
  height: number
}

type LayoutPayload = {
  items: LayoutItem[]
  viewportWidth: number
  viewportHeight: number
  itemSize: number
  scrollTop: number
}

type LayoutResult = {
  centerIndex: number
  inView: boolean[]
  totalHeight: number
}

function computeLayout(payload: LayoutPayload): LayoutResult {
  const { items, viewportWidth, itemSize, scrollTop } = payload
  const totalHeight = items.reduce((acc, item) => acc + item.height, 0)
  // Find the item whose vertical centre is closest to the viewport's
  // centre. Computing this on the worker keeps the main thread free
  // when the gallery has hundreds of items.
  let cumulative = 0
  const centre = scrollTop + payload.viewportHeight / 2
  let centreIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < items.length; i++) {
    const itemCentre = cumulative + items[i].height / 2
    const distance = Math.abs(itemCentre - centre)
    if (distance < bestDistance) {
      bestDistance = distance
      centreIndex = i
    }
    cumulative += items[i].height
  }
  // Mark which items should be in the DOM (within viewport + one row
  // of overscan).
  const overscan = itemSize * 2
  const top = scrollTop - overscan
  const bottom = scrollTop + payload.viewportHeight + overscan
  const inView: boolean[] = []
  cumulative = 0
  for (const item of items) {
    const topEdge = cumulative
    const bottomEdge = cumulative + item.height
    inView.push(bottomEdge >= top && topEdge <= bottom)
    cumulative = bottomEdge
  }
  void viewportWidth
  return {
    centerIndex: Math.min(centreIndex, items.length - 1),
    inView,
    totalHeight,
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest<LayoutPayload>>) => {
  const { id, op, payload } = event.data
  try {
    let result: unknown
    switch (op) {
      case 'computeLayout':
        result = computeLayout(payload)
        break
      default:
        throw new Error(`unknown op: ${op}`)
    }
    const response: WorkerResponse<unknown> = { id, ok: true, result }
    ;(self as unknown as Worker).postMessage(response)
  } catch (error) {
    const response: WorkerResponse<unknown> = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
    ;(self as unknown as Worker).postMessage(response)
  }
}

export {}
