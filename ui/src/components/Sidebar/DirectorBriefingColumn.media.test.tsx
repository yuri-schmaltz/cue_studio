/**
 * Unit tests for the Director's reference-photo card and the
 * Generation Options model pickers.
 *
 * Two visual defects motivated these tests:
 *
 *  1. The reference photo used `object-cover`, which crops a portrait
 *     or square photo to the card's 16:9-ish box and hides the very
 *     subject the Director is supposed to copy. The card must contain
 *     the photo and let its own background be the matte.
 *
 *  2. The "Image model" / "Video model" labels had a fixed 68px
 *     width, which was narrower than the rendered uppercase text
 *     ("IMAGE MODEL" needs ~77px), so they wrapped onto two lines and
 *     looked compressed. The label must not wrap, and the combobox
 *     next to it must shrink instead.
 */

// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { DirectorModelPicker, ReferenceImageUpload, StyleForm } from './DirectorBriefingColumn'
import { SpeakerRefCard } from './DirectorReferencePanels'
import { useStore } from '../../stores/useStore'

describe('DirectorModelPicker', () => {
  const options = [
    { value: 'flux_klein', label: 'Flux 2 Klein 9B' },
    { value: 'krea_raw', label: 'Krea 2 RAW' },
  ]

  it('renders the label with the full text (no truncation)', () => {
    render(
      <DirectorModelPicker
        id="director-image-model-select"
        label="Image model"
        value="flux_klein"
        options={options}
        onChange={() => {}}
      />,
    )
    expect(screen.getByText('Image model')).toBeTruthy()
  })

  it('keeps the label on a single line (never wraps)', () => {
    render(
      <DirectorModelPicker
        id="director-image-model-select"
        label="Image model"
        value="flux_klein"
        options={options}
        onChange={() => {}}
      />,
    )
    const label = screen.getByText('Image model') as HTMLLabelElement
    // `whitespace-nowrap` is what actually prevents the two-line
    // "IMAGE / MODEL" break seen in the Generation Options column.
    expect(label.className).toContain('whitespace-nowrap')
    // The width must be wide enough for the uppercase text: measured
    // at 10px with 0.5px tracking, "IMAGE MODEL" needs ~77px.
    const width = Number(/w-\[(\d+)px\]/.exec(label.className)?.[1] ?? '0')
    expect(width).toBeGreaterThanOrEqual(80)
  })

  it('gives the label a fixed width so both pickers stay aligned', () => {
    render(
      <>
        <DirectorModelPicker id="a" label="Image model" value="flux_klein" options={options} onChange={() => {}} />
        <DirectorModelPicker id="b" label="Video model" value="flux_klein" options={options} onChange={() => {}} />
      </>,
    )
    const image = screen.getByText('Image model').className
    const video = screen.getByText('Video model').className
    expect(image).toBe(video)
  })

  it('lets the combobox shrink instead of squeezing the label', () => {
    render(
      <DirectorModelPicker
        id="director-image-model-select"
        label="Image model"
        value="flux_klein"
        options={options}
        onChange={() => {}}
      />,
    )
    const select = screen.getByLabelText('Image model') as HTMLSelectElement
    // `min-w-0` allows the flex item to shrink below its content
    // width; without it the select refuses to give room to the label.
    expect(select.className).toContain('min-w-0')
    expect(select.className).toContain('flex-1')
  })

  it('reports the chosen model', async () => {
    const onChange = vi.fn()
    render(
      <DirectorModelPicker
        id="director-video-model-select"
        label="Video model"
        value="flux_klein"
        options={options}
        onChange={onChange}
      />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Video model'), 'krea_raw')
    expect(onChange).toHaveBeenCalledWith('krea_raw')
  })
})

describe('ReferenceImageUpload', () => {
  beforeEach(() => {
    useStore.setState({ directorReferenceImagePath: null } as never)
  })

  it('shows the drop zone when no photo is loaded', () => {
    render(
      <ReferenceImageUpload
        referenceImage={null}
        refImagePreview={null}
        setReferenceImage={() => {}}
      />,
    )
    expect(screen.getByText(/Drop reference photo or click to upload/)).toBeTruthy()
    expect(screen.queryByAltText('Reference')).toBeNull()
  })

  it('contains the photo inside the card instead of cropping it', () => {
    render(
      <ReferenceImageUpload
        referenceImage={new File(['x'], 'ref.png', { type: 'image/png' })}
        refImagePreview="blob:fake"
        setReferenceImage={() => {}}
      />,
    )
    const img = screen.getByAltText('Reference') as HTMLImageElement
    // `object-contain` keeps the whole photo visible; `object-cover`
    // cropped it and hid the subject.
    expect(img.className).toContain('object-contain')
    expect(img.className).not.toContain('object-cover')
  })

  it('keeps the card height fixed at 192px so the layout never shifts', () => {
    render(
      <ReferenceImageUpload
        referenceImage={new File(['x'], 'ref.png', { type: 'image/png' })}
        refImagePreview="blob:fake"
        setReferenceImage={() => {}}
      />,
    )
    const card = screen.getByAltText('Reference').closest('.relative')
    expect(card?.className).toContain('h-[192px]')
  })

  it('clears the photo when the remove button is clicked', async () => {
    const setReferenceImage = vi.fn()
    render(
      <ReferenceImageUpload
        referenceImage={new File(['x'], 'ref.png', { type: 'image/png' })}
        refImagePreview="blob:fake"
        setReferenceImage={setReferenceImage}
      />,
    )
    await userEvent.click(screen.getByTitle('Remove'))
    expect(setReferenceImage).toHaveBeenCalledWith(null)
  })
})

describe('speaker reference photos', () => {
  const mapping = {
    speakerId: 'SPEAKER_01',
    name: 'Gary',
    role: 'rapping' as const,
    imagePreview: 'blob:fake',
    imagePath: '/uploads/gary.png',
  }

  it('contains the speaker photo in the StyleForm avatar', () => {
    render(
      <StyleForm
        speakers={['SPEAKER_01']}
        speakerMappings={[mapping]}
        speakerSamples={{}}
        setSpeakerMapping={() => {}}
        setSpeakerImage={async () => {}}
        insertSpeakerMention={() => {}}
      />,
    )
    const img = screen.getByAltText('Gary') as HTMLImageElement
    expect(img.className).toContain('object-contain')
    expect(img.className).not.toContain('object-cover')
  })

  it('contains the speaker photo in the References card', () => {
    render(
      <SpeakerRefCard
        mapping={mapping}
        onRemoveImage={() => {}}
        onImageChange={() => {}}
        onNameChange={() => {}}
      />,
    )
    const img = screen.getByAltText('Gary') as HTMLImageElement
    expect(img.className).toContain('object-contain')
    expect(img.className).not.toContain('object-cover')
  })
})
