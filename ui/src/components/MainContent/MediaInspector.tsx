import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react'
import {
  BookMarked,
  Check,
  Combine,
  Copy,
  Download,
  FastForward,
  FolderInput,
  Heart,
  Info,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Scissors,
  Trash2,
  X,
  Film,
  Music,
  Image as ImageIcon,
  ArrowLeftToLine,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

import { useStore } from '../../stores/useStore'
import { SaveRecipeDialog } from '../Recipes/SaveRecipeDialog'
import { fetchOutputMetadata, getFileUrl, getUploadUrl, moveOutput, uploadImage } from '../../api/client'
import type { OutputMetadata } from '../../types'
import { formatGenerationDuration } from '../../lib/format'
import { modelDisplayName } from '../../lib/modelDisplay'

interface BulkProps {
  selectedNames: string[]
  onClearSelection: () => void
  onConfirmDelete: () => void
  busy: boolean
}

function BulkActionPanel({ selectedNames, onClearSelection, onConfirmDelete, busy }: BulkProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">Bulk actions</h3>
          <p className="text-2xs text-text-muted">
            {selectedNames.length} item{selectedNames.length === 1 ? '' : 's'} selected
          </p>
        </div>
        <button
          type="button"
          onClick={onClearSelection}
          className="rounded-md p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary"
          title="Clear selection"
          aria-label="Clear selection"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        <button
          type="button"
          onClick={onConfirmDelete}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-sm text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
          aria-label={`Delete ${selectedNames.length} selected items`}
        >
          {busy
            ? <Loader2 size={15} className="animate-spin" />
            : <Trash2 size={15} />}
          Delete {selectedNames.length} item{selectedNames.length === 1 ? '' : 's'}
        </button>
        <p className="text-2xs leading-relaxed text-text-muted">
          Delete is permanent. Bulk download / move-to-workspace / favorite
          will land in a follow-up release — these are the most-requested
          ship-it-now actions for triage.
        </p>
        <div className="rounded-lg border border-border bg-bg-tertiary/60 p-3">
          <div className="mb-2 text-2xs font-medium uppercase tracking-wide text-text-muted">
            Selected
          </div>
          <ul className="space-y-1 max-h-64 overflow-y-auto">
            {selectedNames.map(name => (
              <li key={name} className="truncate text-xs text-text-secondary" title={name}>
                {name}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function RetryImage({ url, alt }: { url: string; alt: string }) {
  // Same lazy retry as MediaFeedItem — keep the inspector visually robust
  // against the tiny "file exists on disk but the kernel hasn't flushed
  // it" window after a generation completes.
  const [src, setSrc] = useState(url)
  const retries = useRef(0)
  const maxRetries = 5

  const scheduleRetry = useCallback(() => {
    if (retries.current < maxRetries) {
      retries.current++
      setTimeout(() => {
        setSrc(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`)
      }, 800 * retries.current)
    }
  }, [url])

  return (
    <img
      key={src}
      src={src}
      alt={alt}
      className="h-full w-full object-contain"
      onError={scheduleRetry}
      onLoad={e => {
        const img = e.currentTarget
        if (img.naturalWidth === 0 || img.naturalHeight === 0) scheduleRetry()
      }}
    />
  )
}

function DetailRows({ meta, modelLabel }: { meta: OutputMetadata; modelLabel: string }) {
  const params = meta?.params as Record<string, unknown> | null
  if (!params) return null

  const modelType = (params.model_type as string) || ''
  const resolution = (params.resolution as string) || ''
  const seed = params.seed as number | undefined
  const inferenceSteps = params.num_inference_steps as number | undefined
  const guidanceScale = params.guidance_scale as number | undefined
  const generationTime = meta.generation_time

  const activeLoras = (() => {
    const value = params.activated_loras
    if (Array.isArray(value)) return value.map(item => String(item)).filter(Boolean)
    return typeof value === 'string' && value ? [value] : []
  })()

  const loraWeights = (() => {
    const value = params.loras_multipliers
    if (Array.isArray(value)) return value.map(item => String(item))
    if (typeof value === 'string' && value) return value.split(/[;,]/).map(item => item.trim())
    return []
  })()

  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
      <dt className="text-text-muted">Model</dt>
      <dd className="break-words text-text-secondary">{modelLabel || modelType || 'Unknown'}</dd>
      {resolution && (
        <>
          <dt className="text-text-muted">Resolution</dt>
          <dd className="text-text-secondary">{resolution}</dd>
        </>
      )}
      {inferenceSteps != null && (
        <>
          <dt className="text-text-muted">Sampling</dt>
          <dd className="text-text-secondary">
            {inferenceSteps} steps{guidanceScale != null ? ` · guidance ${guidanceScale}` : ''}
          </dd>
        </>
      )}
      {generationTime != null && (
        <>
          <dt className="text-text-muted">Generation time</dt>
          <dd className="text-text-secondary">{formatGenerationDuration(generationTime)}</dd>
        </>
      )}
      {seed != null && seed >= 0 && (
        <>
          <dt className="text-text-muted">Seed</dt>
          <dd className="text-text-secondary">{seed}</dd>
        </>
      )}
      {activeLoras.length > 0 && (
        <>
          <dt className="text-text-muted">LoRAs</dt>
          <dd className="break-words text-text-secondary">
            {activeLoras.map((lora, i) => (
              <div key={`${lora}-${i}`} className="flex gap-2">
                <span className="min-w-0 flex-1 break-all">{lora}</span>
                {loraWeights[i] && <span className="shrink-0 text-text-muted">{loraWeights[i]}x</span>}
              </div>
            ))}
          </dd>
        </>
      )}
    </dl>
  )
}

export function MediaInspector() {
  const outputs = useStore(s => s.filteredOutputs())
  const selectedIndex = useStore(s => s.selectedOutput)
  const meta = useStore(s => s.selectedOutputMeta)
  const metadataLoading = useStore(s => s.metadataLoading)
  const selectedNames = useStore(s => s.mediaGallerySelectedNames)
  const bulkDeleteSelected = useStore(s => s.bulkDeleteSelectedOutputs)
  const setMediaGallerySelectedNames = useStore(s => s.setMediaGallerySelectedNames)
  const toggleFavorite = useStore(s => s.toggleFavorite)
  const deleteSelectedOutput = useStore(s => s.deleteSelectedOutput)
  const setSelectedOutput = useStore(s => s.setSelectedOutput)
  const loadSettingsFromOutput = useStore(s => s.loadSettingsFromOutput)
  const rerollGeneration = useStore(s => s.rerollGeneration)
  const openRetakeDialog = useStore(s => s.openRetakeDialog)
  const rejoinClipGroup = useStore(s => s.rejoinClipGroup)
  const saveRecipeFromOutput = useStore(s => s.saveRecipeFromOutput)
  const setStartImage = useStore(s => s.setStartImage)
  const addImageRef = useStore(s => s.addImageRef)
  const setContinueVideo = useStore(s => s.setContinueVideo)
  const setStudioVideoWorkflow = useStore(s => s.setStudioVideoWorkflow)
  const setSidebarMode = useStore(s => s.setSidebarMode)
  const setSidebarOpen = useStore(s => s.setSidebarOpen)
  const generationMode = useStore(s => s.generationMode)
  const workspaces = useStore(s => s.workspaces)
  const activeWorkspace = useStore(s => s.activeWorkspace)
  const browsingUploads = useStore(s => s.browsingUploads)
  const models = useStore(s => s.models)
  const nsfwMode = useStore(s => !!s.servicesConfig?.nsfw_mode)

  const file = outputs[selectedIndex]
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showSaveRecipe, setShowSaveRecipe] = useState(false)
  const confirmRef = useRef(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [copied, setCopied] = useState(false)
  const [rejoining, setRejoining] = useState(false)
  const [sentToInput, setSentToInput] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const bulkTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [showPrompt, setShowPrompt] = useState(true)
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const [moving, setMoving] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Sidecar metadata can arrive after the initial render. Re-fetch here so
  // the inspector shows the *authoritative* prompt/plan instead of any
  // embedded in-progress copy.
  useEffect(() => {
    if (!file || !file.metadata_ready) return
    if (meta?.source === 'sidecar') return
    let cancelled = false
    fetchOutputMetadata(file.name)
      .then(next => {
        if (!cancelled) useStore.setState({ selectedOutputMeta: next })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [file?.name, file?.metadata_ready, file?.metadata_updated_at, meta?.source])

  // Pause the inline video when the user navigates to a different clip.
  useEffect(() => {
    if (!videoRef.current) return
    videoRef.current.pause()
  }, [selectedIndex])

  // Auto-collapse confirm state if the user walks away.
  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (bulkTimeoutRef.current) clearTimeout(bulkTimeoutRef.current)
  }, [])

  if (selectedNames.size > 1) {
    const handleBulkDelete = async () => {
      if (!bulkConfirm) {
        setBulkConfirm(true)
        clearTimeout(bulkTimeoutRef.current)
        bulkTimeoutRef.current = setTimeout(() => setBulkConfirm(false), 3000)
        return
      }
      clearTimeout(bulkTimeoutRef.current)
      setBulkConfirm(false)
      setBulkBusy(true)
      try {
        await bulkDeleteSelected()
      } finally {
        setBulkBusy(false)
      }
    }

    return (
      <BulkActionPanel
        selectedNames={Array.from(selectedNames)}
        onClearSelection={() => setMediaGallerySelectedNames(new Set())}
        onConfirmDelete={handleBulkDelete}
        busy={bulkBusy}
      />
    )
  }

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 text-center text-text-muted">
          <div className="rounded-2xl bg-bg-active p-4">
            <Play size={20} />
          </div>
          <p className="text-xs">Select an asset on the left to inspect it.</p>
        </div>
      </div>
    )
  }

  const params = meta?.params as Record<string, unknown> | null
  const prompt = String(params?.prompt || '')
  const modelType = (params?.model_type as string) || ''
  const modelLabel = modelDisplayName(modelType, models)
  const groupId = (() => {
    const info = params?.multi_clip_info as { group_id: string; index: number; total: number } | undefined
    return info?.group_id
  })()
  const clipTotal = (() => {
    const info = params?.multi_clip_info as { total: number } | undefined
    return info?.total
  })()

  const uploadFilenames = meta?.upload_filenames as Record<string, string | string[]> | undefined
  const rawStart = uploadFilenames?.image_start
  const rawEnd = uploadFilenames?.image_end
  const imageStartFile = Array.isArray(rawStart) ? (rawStart.find(f => f) || null) : rawStart
  const imageEndFile = Array.isArray(rawEnd) ? (rawEnd.find(f => f) || null) : rawEnd

  const handleCopyPrompt = () => {
    if (!prompt) return
    navigator.clipboard?.writeText(prompt).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleDelete = async () => {
    if (!confirmRef.current) {
      confirmRef.current = true
      setConfirmDelete(true)
      clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        confirmRef.current = false
        setConfirmDelete(false)
      }, 3000)
      return
    }
    clearTimeout(timeoutRef.current)
    confirmRef.current = false
    setConfirmDelete(false)
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.removeAttribute('src')
      videoRef.current.load()
    }
    setSelectedOutput(selectedIndex)
    setTimeout(() => deleteSelectedOutput(), 200)
  }

  const handleReroll = () => {
    setSelectedOutput(selectedIndex)
    setTimeout(() => rerollGeneration(), 50)
  }

  const handleLoadSettings = () => {
    setSelectedOutput(selectedIndex)
    setTimeout(() => loadSettingsFromOutput(), 50)
  }

  const handleRejoin = async () => {
    if (!groupId) return
    setRejoining(true)
    try {
      await rejoinClipGroup(groupId)
    } finally {
      setRejoining(false)
    }
  }

  const handleMove = async (targetWs: string) => {
    setMoving(true)
    setShowMoveMenu(false)
    try {
      await moveOutput(file.name, targetWs)
      const store = useStore.getState()
      const filtered = store.outputs.filter(o => o.name !== file.name)
      useStore.setState({
        outputs: filtered,
        selectedOutput: Math.min(store.selectedOutput, Math.max(0, filtered.length - 1)),
      })
    } catch (e) {
      console.error('Move failed:', e)
    } finally {
      setMoving(false)
    }
  }

  const handleSendToInput = async () => {
    if (file.type !== 'image') return
    try {
      const res = await fetch(getFileUrl(file.name))
      const blob = await res.blob()
      const imageFile = new File([blob], file.name, { type: blob.type || 'image/png' })
      if (generationMode === 'image') {
        addImageRef(imageFile)
      } else {
        setStartImage(imageFile)
      }
      setSentToInput(true)
      setTimeout(() => setSentToInput(false), 2000)
    } catch (e) {
      console.error('Failed to send image to input:', e)
    }
  }

  const handleSendFrameToRefs = async () => {
    if (file.type !== 'video') return
    try {
      let video = videoRef.current
      if (!video || video.videoWidth === 0) {
        video = document.createElement('video')
        video.src = getFileUrl(file.name)
        video.muted = true
        await new Promise<void>((resolve, reject) => {
          video!.onloadeddata = () => resolve()
          video!.onerror = () => reject(new Error('video load failed'))
        })
      }
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas unavailable')
      ctx.drawImage(video, 0, 0)
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('frame capture failed'))), 'image/png')
      )
      const stem = file.name.replace(/\.[^.]+$/, '')
      const frameFile = new File([blob], `${stem}_t${video.currentTime.toFixed(2)}s.png`, { type: 'image/png' })
      addImageRef(frameFile)
      setSentToInput(true)
      setTimeout(() => setSentToInput(false), 2000)
    } catch (e) {
      console.error('Failed to capture video frame:', e)
    }
  }

  const handleContinueFrom = async () => {
    if (file.type !== 'video') return
    let url = ''
    try {
      const res = await fetch(getFileUrl(file.name))
      if (!res.ok) throw new Error(`Could not read source video (${res.status})`)
      const blob = await res.blob()
      const videoFile = new File([blob], file.name, { type: blob.type || 'video/mp4' })
      url = URL.createObjectURL(videoFile)
      const video = document.createElement('video')
      video.preload = 'metadata'
      const duration = await new Promise<number>((resolve, reject) => {
        video.onloadedmetadata = () => resolve(
          video.duration && isFinite(video.duration) ? video.duration : 0,
        )
        video.onerror = () => reject(new Error('Could not read source video metadata'))
        video.src = url
        video.load()
      })
      const uploaded = await uploadImage(videoFile)
      setSidebarMode('studio')
      setStudioVideoWorkflow('extend')
      setContinueVideo(videoFile, uploaded.path, url, duration)
      setSidebarOpen(true)
    } catch (e) {
      if (url) URL.revokeObjectURL(url)
      console.error('Failed to load video for continuation:', e)
    }
  }

  const handleDownload = () => {
    const link = document.createElement('a')
    link.href = getFileUrl(file.name)
    link.download = file.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // The viewer takes the larger share of the inspector column so the user
  // can read the asset without scrolling, while metadata + actions live in
  // a scrollable drawer underneath.
  const previewHeightStyle: CSSProperties = { minHeight: 0 }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        {imageStartFile && (
          <img
            src={getUploadUrl(imageStartFile)}
            alt="Start"
            className="h-7 w-7 shrink-0 rounded border border-border object-cover"
            title="Start image"
          />
        )}
        {imageEndFile && (
          <img
            src={getUploadUrl(imageEndFile)}
            alt="End"
            className="h-7 w-7 shrink-0 rounded border border-border object-cover"
            title="End image"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-text-primary truncate" title={file.name}>
            {file.type === 'video' && <Film size={13} className="shrink-0 text-text-muted" />}
            {file.type === 'audio' && <Music size={13} className="shrink-0 text-text-muted" />}
            {file.type === 'image' && <ImageIcon size={13} className="shrink-0 text-text-muted" />}
            <span className="truncate">{file.name}</span>
          </div>
          {modelLabel && (
            <div className="truncate text-2xs text-text-muted" title={modelType}>{modelLabel}</div>
          )}
        </div>
        {!browsingUploads && (
          <button
            type="button"
            onClick={() => toggleFavorite(file.name)}
            className={`rounded-lg p-1.5 transition-colors ${
              file.favorite
                ? 'text-red-400 hover:text-red-300'
                : 'text-text-secondary hover:bg-bg-hover hover:text-red-400'
            }`}
            title={file.favorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={file.favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Heart size={15} fill={file.favorite ? 'currentColor' : 'none'} />
          </button>
        )}
        <button
          type="button"
          onClick={handleDelete}
          className={`rounded-lg p-1.5 transition-colors ${
            confirmDelete
              ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
              : 'text-text-secondary hover:bg-bg-hover hover:text-red-400'
          }`}
          title={confirmDelete ? 'Click again to delete' : 'Delete'}
          aria-label={confirmDelete ? 'Click again to delete' : 'Delete'}
        >
          <Trash2 size={15} />
        </button>
      </div>

      {/* Preview */}
      <div className="shrink-0 bg-media-canvas p-3" style={previewHeightStyle}>
        <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-black">
          {file.type === 'video' ? (
            <video
              key={file.url}
              ref={videoRef}
              src={file.url}
              controls
              loop
              playsInline
              className="h-full w-full object-contain"
            />
          ) : file.type === 'audio' ? (
            <div className="flex flex-col items-center gap-4 p-8 text-text-muted">
              <div className="rounded-2xl bg-white/5 p-4">
                <Music size={36} />
              </div>
              <p className="text-xs">{file.name}</p>
              <audio key={file.url} src={file.url} controls className="w-72 max-w-full" />
            </div>
          ) : (
            <RetryImage key={file.url} url={file.url} alt={file.name} />
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="shrink-0 flex flex-wrap items-center gap-1 border-b border-border px-3 py-2">
        {params && (
          <button
            type="button"
            onClick={handleLoadSettings}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
            title="Load settings into Studio"
          >
            <Pencil size={13} /> Load settings
          </button>
        )}
        {params && (
          <button
            type="button"
            onClick={handleReroll}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
            title="Regenerate with the same settings"
          >
            <RefreshCw size={13} /> Regenerate
          </button>
        )}
        {params && file.type === 'video' && (
          <button
            type="button"
            onClick={() => openRetakeDialog(file.name)}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-indicator-warning"
            title="Retake a time region"
          >
            <Scissors size={13} /> Retake
          </button>
        )}
        {params && file.type === 'video' && (
          <button
            type="button"
            onClick={handleContinueFrom}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-accent-blue"
            title="Extend this video"
          >
            <FastForward size={13} /> Extend
          </button>
        )}
        {groupId && (
          <button
            type="button"
            onClick={handleRejoin}
            disabled={rejoining}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-accent-blue transition-colors hover:bg-bg-hover disabled:opacity-50"
            title={`Rejoin all ${clipTotal} clips`}
          >
            {rejoining ? <Loader2 size={13} className="animate-spin" /> : <Combine size={13} />} Rejoin
          </button>
        )}
        {file.type === 'image' && (
          <button
            type="button"
            onClick={handleSendToInput}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-accent-blue"
          >
            {sentToInput ? <Check size={13} className="text-accent-green" /> : <ArrowLeftToLine size={13} />}
            {generationMode === 'image' ? 'Use as input image' : 'Use as start frame'}
          </button>
        )}
        {file.type === 'video' && (
          <button
            type="button"
            onClick={handleSendFrameToRefs}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-accent-blue"
          >
            {sentToInput ? <Check size={13} className="text-accent-green" /> : <ArrowLeftToLine size={13} />}
            Use current frame
          </button>
        )}
        <button
          type="button"
          onClick={handleDownload}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
          title="Download"
        >
          <Download size={13} /> Download
        </button>

        {params && (
          <button
            type="button"
            onClick={() => setShowSaveRecipe(true)}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-accent-blue transition-colors hover:bg-bg-hover"
            title="Save as Recipe"
          >
            <BookMarked size={13} /> Save Recipe
          </button>
        )}

        {!browsingUploads && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMoveMenu(v => !v)}
              disabled={moving}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
              aria-expanded={showMoveMenu}
              title="Move to workspace"
            >
              {moving ? <Loader2 size={13} className="animate-spin text-accent-blue" /> : <FolderInput size={13} />}
              Move
              {showMoveMenu ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>
            {showMoveMenu && (
              <div className="absolute right-0 top-full z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-border bg-bg-secondary p-1 shadow-2xl">
                {workspaces.filter(ws => ws.name !== activeWorkspace).map(ws => (
                  <button
                    key={ws.name}
                    onClick={() => handleMove(ws.name)}
                    className="block w-full rounded-md px-2.5 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
                  >
                    {ws.name}
                  </button>
                ))}
                {workspaces.filter(ws => ws.name !== activeWorkspace).length === 0 && (
                  <div className="px-2.5 py-1.5 text-2xs text-text-muted">No other workspaces</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Scrollable metadata */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {metadataLoading && !meta && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Loader2 size={13} className="animate-spin" /> Loading metadata…
          </div>
        )}

        {meta && (
          <section>
            <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-text-muted">
              <Info size={11} /> Details
            </div>
            <DetailRows meta={meta} modelLabel={modelLabel} />
          </section>
        )}

        {prompt && (
          <section>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-2xs font-medium uppercase tracking-wide text-text-muted">Prompt</span>
              <button
                type="button"
                onClick={handleCopyPrompt}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-text-muted hover:bg-bg-hover hover:text-text-primary"
                title="Copy prompt"
              >
                {copied ? <Check size={11} className="text-accent-green" /> : <Copy size={11} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div
              className={`whitespace-pre-wrap break-words rounded-lg border border-border bg-bg-tertiary p-2.5 text-xs leading-relaxed text-text-secondary ${
                showPrompt ? '' : 'line-clamp-3'
              }`}
            >
              {prompt}
            </div>
            {prompt.length > 240 && (
              <button
                type="button"
                onClick={() => setShowPrompt(v => !v)}
                className="mt-1 flex items-center gap-1 text-2xs text-accent-blue hover:text-accent-blue/80"
              >
                {showPrompt ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                {showPrompt ? 'Collapse' : 'Show full prompt'}
              </button>
            )}
          </section>
        )}
      </div>

      {showSaveRecipe && (
        <SaveRecipeDialog
          defaultNsfw={nsfwMode}
          onCancel={() => setShowSaveRecipe(false)}
          onSave={async (name, description, nsfw) => {
            await saveRecipeFromOutput(file.name, name, description, nsfw)
            setShowSaveRecipe(false)
          }}
        />
      )}
    </div>
  )
}
