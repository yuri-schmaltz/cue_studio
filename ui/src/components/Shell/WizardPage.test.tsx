// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useStore } from '../../stores/useStore'
import { WizardPage } from './WizardPage'
import { parseRoute, routeFromState, serializeRoute } from '../../navigation/types'

vi.mock('../Sidebar/DirectorReferencePanels', () => ({ AdditionalRefsSection: () => <div>Reference controls</div> }))
vi.mock('../Sidebar/DirectorBriefingColumn', () => ({ DirectorGenerationOptions: () => <div>Advanced options</div>, StyleForm: () => null }))
vi.mock('../Sidebar/DirectorTechnicalPromptField', () => ({ DirectorTechnicalPromptField: () => null }))
vi.mock('../Sidebar/DirectorScriptReconciliationBanner', () => ({ DirectorScriptReconciliationBanner: () => null }))
vi.mock('../Director/DirectorReview', () => ({ DirectorReview: () => <div>Scene approval</div> }))
vi.mock('../Sidebar/DirectorPlanColumn', () => ({ DirectorPlanColumn: () => <div>Production plan</div> }))
vi.mock('../Director/DirectorOutputColumn', () => ({ DirectorOutputColumn: () => <div>Preview</div> }))
vi.mock('../Sidebar/DirectorErrorBanner', () => ({ DirectorErrorBanner: () => null }))
vi.mock('../Stages/DirectorStatusBar', () => ({ DirectorStatusBar: () => null }))

beforeEach(() => {
  localStorage.clear()
  useStore.setState({ activeWorkspace: 'wizard-test', wizardStep: 0, saveDirectorDraftNow: vi.fn().mockResolvedValue(undefined), directorSkill: 'music_video', directorAudioPath: null, directorAnalysis: null, directorSceneDescription: '', directorLoading: false, pipelineId: null, pipelineStatus: null, directorError: null })
})

describe('Wizard', () => {
  it('round-trips a project URL and gates default workspace', () => {
    const route = routeFromState('wizard', 'a project')
    expect(parseRoute(serializeRoute(route))).toEqual(route)
    expect(routeFromState('wizard', 'default')).toEqual({ kind: 'projects' })
  })
  it('requires analyzed audio before moving to the script', () => {
    render(<WizardPage />)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Story/ })).toBeDisabled()
  })
  it('requires a description even when the audio is ready', () => {
    useStore.setState({ directorAudioPath: '/audio.wav', directorAnalysis: { duration: 30 } as never })
    render(<WizardPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('heading', { name: '2. Story' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })
  it('starts only on explicit request and keeps automatic approvals disabled', async () => {
    const start = vi.fn()
    useStore.setState({ directorSceneDescription: 'A story', directorAudioPath: '/audio.wav', directorAnalysis: { duration: 30 } as never, startDirectorPipeline: start })
    render(<WizardPage />)
    fireEvent.click(screen.getByRole('button', { name: /Production/ }))
    expect(start).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Start guided production' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Start guided production' }))
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1))
    expect(useStore.getState().directorAutoMode).toBe(false)
  })
  it('shows approval controls for a paused production without offering a new start', () => {
    useStore.setState({ directorSceneDescription: 'A story', directorAudioPath: '/audio.wav', directorAnalysis: { duration: 30 } as never, pipelineId: 'run-1', pipelineStatus: { status: 'paused', pause_reason: 'review_images' } as never })
    render(<WizardPage />)
    fireEvent.click(screen.getByRole('button', { name: /Production/ }))
    expect(screen.getByText('Scene approval')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start guided production' })).not.toBeInTheDocument()
  })
})
