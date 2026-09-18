import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useStore } from '../../stores/useStore'

// Options mirror the dropdowns that used to live on the Performance
// settings tab. Kept inline (not in SystemSettingsPanel) so this file
// can be imported by the sidebar without pulling in the rest of the
// system-settings tree.
const videoCodecOptions = [
  { value: 'libx264_8', label: 'H.264 Quality 8' },
  { value: 'libx264_10', label: 'H.264 Quality 10' },
  { value: 'libx264_lossless', label: 'H.264 Lossless' },
  { value: 'libx265_8', label: 'H.265 CRF 8' },
  { value: 'libx265_28', label: 'H.265 CRF 28 (Fast)' },
  { value: 'h264_nvenc', label: 'NVIDIA NVENC (HW)' },
  { value: 'h264_amf', label: 'AMD AMF (HW)' },
  { value: 'h264_qsv', label: 'Intel Quick Sync (HW)' },
  { value: 'h264_videotoolbox', label: 'Apple VideoToolbox (HW)' },
  { value: 'h264_vaapi', label: 'VA-API (Linux, HW)' },
]

const imageCodecOptions = [
  { value: 'jpeg_95', label: 'JPEG 95%' },
  { value: 'jpeg_85', label: 'JPEG 85%' },
  { value: 'jpeg_70', label: 'JPEG 70%' },
  { value: 'png', label: 'PNG (Lossless)' },
  { value: 'webp_95', label: 'WebP 95%' },
  { value: 'webp_85', label: 'WebP 85%' },
  { value: 'webp_lossless', label: 'WebP Lossless' },
]

// Output Codecs — the codec/container/quality applied by the backend
// (wgp.save_video / save_image) when it writes each generated file.
// Lives in the sidebar next to Post Processing because both are
// "applied to the output of this generation" choices, as opposed to
// the global infrastructure knobs (models, hardware, linked folders)
// on the Performance settings tab.
//
// Defaults are collapsed so the sidebar stays scannable; the user can
// pin it open if they switch codecs frequently.
export function OutputCodecs() {
  const systemConfig = useStore(s => s.systemConfig)
  const updateSystemConfig = useStore(s => s.updateSystemConfig)
  const [open, setOpen] = useState(false)

  // systemConfig may still be loading on first render — render an
  // empty state instead of throwing so the section never crashes the
  // sidebar.
  if (!systemConfig) return null

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-text-muted uppercase tracking-wider w-full hover:text-text-primary transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="flex-1 text-left">Output Codecs</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div>
            <label className="text-xs text-text-muted uppercase tracking-wider mb-1.5 block">
              Video Codec
            </label>
            <select
              value={systemConfig.video_output_codec}
              onChange={e => updateSystemConfig({ video_output_codec: e.target.value })}
              className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
            >
              {videoCodecOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-text-muted uppercase tracking-wider mb-1.5 block">
              Image Codec
            </label>
            <select
              value={systemConfig.image_output_codec}
              onChange={e => updateSystemConfig({ image_output_codec: e.target.value })}
              className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
            >
              {imageCodecOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
