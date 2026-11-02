// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  sanitizeSpeakerMapping,
  serializeSpeakerMapping,
  speakerImagePath,
  speakerImageSrc,
} from './speakerImage'
import type { SpeakerMapping } from '../types'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return { ...actual, getUploadUrl: (name: string) => `/api/v1/uploads/${name}` }
})

describe('speakerImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('speakerImagePath', () => {
    it('reads the uploaded server path', () => {
      expect(speakerImagePath({ imagePath: '/app/uploads/a1b2.png' })).toBe('/app/uploads/a1b2.png')
    })

    it('treats a blank or missing path as absent', () => {
      expect(speakerImagePath({ imagePath: '   ' })).toBeNull()
      expect(speakerImagePath({ imagePath: null })).toBeNull()
      expect(speakerImagePath({})).toBeNull()
    })
  })

  describe('speakerImageSrc', () => {
    it('serves the photo from the server when a path is known', () => {
      const src = speakerImageSrc({
        imagePath: '/app/uploads/a1b2.png',
        imagePreview: 'blob:http://localhost/dead',
      })
      expect(src).toBe('/api/v1/uploads/a1b2.png')
    })

    it('falls back to the in-memory preview while the upload is in flight', () => {
      const src = speakerImageSrc({ imagePreview: 'blob:http://localhost/live' })
      expect(src).toBe('blob:http://localhost/live')
    })

    it('has no source when the mapping carries no photo', () => {
      expect(speakerImageSrc({})).toBeNull()
      expect(speakerImageSrc({ imagePreview: null })).toBeNull()
    })
  })

  describe('sanitizeSpeakerMapping', () => {
    it('drops the dead blob preview a restored draft carries', () => {
      const restored = sanitizeSpeakerMapping({
        speakerId: 'SPEAKER_00',
        name: 'gary',
        role: 'singing',
        image: {},
        imagePreview: 'blob:http://127.0.0.1:7860/21f367b5-46d8-4fc1-b0ca-64fc33b18c5b',
      })
      expect(restored.imagePreview).toBeNull()
      expect(restored.image).toBeUndefined()
      expect(restored.name).toBe('gary')
      expect(restored.role).toBe('singing')
    })

    it('keeps the server path so the photo survives the reload', () => {
      const restored = sanitizeSpeakerMapping({
        speakerId: 'SPEAKER_00',
        name: 'gary',
        role: 'singing',
        imagePath: '/app/uploads/a1b2.png',
        imagePreview: 'blob:http://127.0.0.1:7860/dead',
      })
      expect(restored.imagePath).toBe('/app/uploads/a1b2.png')
      expect(restored.imagePreview).toBeNull()
      expect(speakerImageSrc(restored)).toBe('/api/v1/uploads/a1b2.png')
    })

    it('keeps a non-blob preview (a real URL) intact', () => {
      const restored = sanitizeSpeakerMapping({
        speakerId: 'SPEAKER_00',
        name: 'gary',
        role: '',
        imagePreview: 'https://example.com/gary.png',
      })
      expect(restored.imagePreview).toBe('https://example.com/gary.png')
    })

    it('normalizes an unknown role', () => {
      const restored = sanitizeSpeakerMapping({
        speakerId: 'SPEAKER_00',
        name: 'gary',
        role: 'yelling',
      })
      expect(restored.role).toBe('')
    })

    it('survives a completely unknown shape', () => {
      const restored = sanitizeSpeakerMapping(null)
      expect(restored.speakerId).toBe('')
      expect(restored.name).toBe('')
      expect(restored.role).toBe('')
    })
  })

  describe('serializeSpeakerMapping', () => {
    it('never writes the File or a blob preview into the draft', () => {
      const mapping: SpeakerMapping = {
        speakerId: 'SPEAKER_00',
        name: 'gary',
        role: 'singing',
        image: new File(['x'], 'gary.png', { type: 'image/png' }),
        imagePreview: 'blob:http://127.0.0.1:7860/dead',
      }
      const saved = serializeSpeakerMapping(mapping)
      expect(saved).not.toHaveProperty('image')
      expect(saved.imagePreview).toBeUndefined()
      expect(saved.speakerId).toBe('SPEAKER_00')
    })

    it('writes the server path so the photo can come back', () => {
      const saved = serializeSpeakerMapping({
        speakerId: 'SPEAKER_00',
        name: 'gary',
        role: 'singing',
        imagePath: '/app/uploads/a1b2.png',
      })
      expect(saved.imagePath).toBe('/app/uploads/a1b2.png')
    })

    it('round-trips a mapping through the draft without losing the photo', () => {
      const saved = serializeSpeakerMapping({
        speakerId: 'SPEAKER_00',
        name: 'gary',
        role: 'singing',
        imagePath: '/app/uploads/a1b2.png',
      })
      const restored = sanitizeSpeakerMapping(JSON.parse(JSON.stringify(saved)))
      expect(speakerImageSrc(restored)).toBe('/api/v1/uploads/a1b2.png')
    })
  })
})
