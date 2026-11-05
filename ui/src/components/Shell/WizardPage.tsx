import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../../stores/useStore'
import { DirectorTechnicalPromptField } from '../Sidebar/DirectorTechnicalPromptField'
import { DirectorScriptReconciliationBanner } from '../Sidebar/DirectorScriptReconciliationBanner'
import { DirectorGenerationOptions, StyleForm } from '../Sidebar/DirectorBriefingColumn'
import { DirectorSongSetup } from '../Sidebar/DirectorSongSetup'
import { AdditionalRefsSection } from '../Sidebar/DirectorReferencePanels'
import { DirectorErrorBanner } from '../Sidebar/DirectorErrorBanner'
import { DirectorReview } from '../Director/DirectorReview'
import { DirectorPlanColumn } from '../Sidebar/DirectorPlanColumn'
import { DirectorOutputColumn } from '../Director/DirectorOutputColumn'
import { DirectorStatusBar } from '../Stages/DirectorStatusBar'
import { rejoinPipeline } from '../../api/client'
import './wizard.css'

const steps = [
  ['Base', 'Choose audio or start a short film from a story.'],
  ['Story', 'Describe your video, including scenes and timecodes if needed.'],
  ['References', 'Add characters and images to guide the visual identity. This step is optional.'],
  ['Format', 'Check the format and models before starting.'],
  ['Production', 'Review scenes and approve each stage before generation continues.'],
  ['Results', 'Watch the clips, assemble the video and finish in the Editor.'],
] as const

export function WizardPage() {
  const project = useStore(s => s.activeWorkspace)
  return <Wizard key={project} project={project} />
}

function Wizard({ project }: { project: string }) {
  const s = useStore(useShallow(s => ({
    skill: s.directorSkill, path: s.shortFilmPath, analysis: s.directorAnalysis,
    audio: s.directorAudioFile, audioPath: s.directorAudioPath, musicSource: s.directorMusicSource, songDescription: s.directorSongDescription,
    description: s.directorSceneDescription, loading: s.directorLoading,
    message: s.directorLoadingMessage, error: s.directorError,
    status: s.pipelineStatus, pid: s.pipelineId,
    ratio: s.directorAspectRatio, resolution: s.directorResolution,
    duration: s.shortFilmTargetDuration, models: s.selectedModelPerMode,
    speakers: s.directorSpeakerMappings,
  })))
  const step = useStore(s => s.wizardStep)
  const setStep = (value: number) => { useStore.setState({ wizardStep: value }); void useStore.getState().saveDirectorDraftNow() }
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const actions = useStore.getState()
  const story = s.skill === 'short_film' && s.path === 'story'
  const running = s.loading || s.status?.status === 'running' || s.status?.status === 'queued'
  const paused = s.status?.status === 'paused'
  const completed = s.status?.status === 'completed'
  const generateMusic = s.skill !== 'short_film' && s.musicSource === 'generate'
  const baseReady = story || Boolean(s.analysis && s.audioPath)
  const briefReady = baseReady && Boolean(s.description.trim())
  const canNext = step === 0 ? baseReady : step === 1 ? briefReady
    : step === 4 ? completed : briefReady

  // A resumed production is owned by the server, not by an old UI cursor.
  useEffect(() => {
    if (!s.pid) return
    if (s.status?.status === 'completed') useStore.setState({ wizardStep: 5 })
    else if (['running', 'queued', 'paused'].includes(s.status?.status || '')) useStore.setState({ wizardStep: 4 })
  }, [s.pid, s.status?.status])

  const draftLoading = useStore(s => s.directorDraftLoading)
  const draftFingerprint = useStore(s => JSON.stringify([
    s.directorAudioPath, s.directorAnalysis, s.directorSceneDescription, s.directorTechnicalPrompt,
    s.directorSongDescription, s.directorSongLyrics, s.directorSpeakerMappings.map(m => [m.speakerId,m.name,m.role,m.imagePath]),
    s.directorAspectRatio, s.directorResolution, s.shortFilmPath, s.shortFilmTargetDuration,
  ]))
  useEffect(() => {
    if (draftLoading) return
    const timer = window.setTimeout(() => { void useStore.getState().saveDirectorDraftNow() }, 1000)
    return () => window.clearTimeout(timer)
  }, [project, draftFingerprint, draftLoading])

  const perform = async (task: () => Promise<unknown>) => {
    setBusy(true); setNotice('')
    try { await task() } catch (e) { setNotice(e instanceof Error ? e.message : 'The operation could not be completed.') }
    finally { setBusy(false) }
  }
  const start = () => perform(async () => {
    if (!briefReady || running || paused) return
    actions.setDirectorAutoMode(false)
    await actions.startDirectorPipeline()
  })
  const openEditor = () => perform(async () => {
    if (!s.pid) return
    const { useEditorStore } = await import('../../editor/useEditorStore')
    const editor = useEditorStore.getState()
    if (editor.workspace !== project) await editor.initialize(project)
    await editor.openDirectorRunInEditor(s.pid)
    actions.setAppSection('editor')
  })

  return <div className="wizard-page">
    <header className="wizard-heading"><div><span className="text-2xs text-accent-blue">WIZARD · {project}</span><h1>Your video, step by step</h1></div>
      <button className="wizard-button" onClick={() => actions.setAppSection('director')}>Open in Director</button>
    </header>
    <ol className="wizard-steps" aria-label="Creation steps">{steps.map(([label], index) => <li key={label}>
      <button aria-current={step === index ? 'step' : undefined} disabled={busy || (index > 0 && !baseReady) || (index > 1 && !briefReady) || (index === 5 && !completed)}
        onClick={() => { setStep(index); setNotice('') }}><span>{String(index + 1).padStart(2, '0')}</span>{label}</button>
    </li>)}</ol>
    <section className="wizard-surface" aria-labelledby="wizard-step-heading">
      <h2 id="wizard-step-heading" tabIndex={-1}>{step + 1}. {steps[step][0]}</h2><p className="text-sm text-text-secondary">{steps[step][1]}</p>
      {notice && <p role="status" className="text-sm">{notice}</p>}
      <DirectorErrorBanner error={s.error} pipelineStatus={s.status} />
      {step === 0 && <div className="wizard-fields">
        {s.skill !== 'short_film' && <div className="flex gap-2"><button className="wizard-button" disabled={running || busy} aria-pressed={!generateMusic} onClick={() => actions.setDirectorMusicSource('upload')}>Upload music</button><button className="wizard-button" disabled={running || busy} aria-pressed={generateMusic} onClick={() => actions.setDirectorMusicSource('generate')}>Create music with AI</button></div>}
        {s.skill === 'short_film' && <div className="flex gap-2"><button className="wizard-button" aria-pressed={story} disabled={running} onClick={() => actions.shortFilmSetPath('story')}>From a story</button><button className="wizard-button" aria-pressed={s.path === 'audio'} disabled={running} onClick={() => actions.shortFilmSetPath('audio')}>With audio or dialogue</button></div>}
        {story ? <label>Target duration (seconds)<input type="number" min={1} max={3600} value={s.duration} onChange={e => { const n = Number(e.target.value); if (n > 0 && n <= 3600) actions.shortFilmSetTargetDuration(n) }} /></label>
          : generateMusic ? <><DirectorSongSetup /><label>Describe the music<textarea rows={3} value={s.songDescription} disabled={running || busy} onChange={e => actions.setDirectorSongDescription(e.target.value)} /></label><button className="wizard-button primary" disabled={running || busy || !s.songDescription.trim()} onClick={() => { actions.setDirectorAutoMode(false); void perform(() => actions.directorGenerateTrack()) }}>Generate and analyze music</button></>
          : <><label className="wizard-upload">Source music, dialogue or video<input aria-label="Source audio" type="file" accept=".wav,.mp3,.flac,.ogg,.m4a,.mp4,.mov,.mkv,.webm" disabled={running || busy} onChange={e => { const file = e.target.files?.[0]; if (file) { actions.setDirectorAutoMode(false); void perform(() => s.skill === 'short_film' ? actions.shortFilmUploadAndAnalyze(file) : actions.directorUploadAndAnalyze(file)); } e.target.value = '' }} /></label>
          {s.audio && <p>{s.audio.name}</p>}{s.analysis && <p className="text-sm text-emerald-400">Audio analyzed · {Math.round(s.analysis.duration)} seconds</p>}</>}
        {(running || busy) && <p role="status">{s.message || 'Analyzing source material…'}</p>}
      </div>}
      {step === 1 && <div className="wizard-fields"><label>Story and scenes<textarea rows={12} value={s.description} disabled={running || paused} onChange={e => actions.directorSetSceneDescription(e.target.value)} placeholder="Describe what happens in the video, who appears and how each scene should look." /></label>
        <DirectorTechnicalPromptField /><DirectorScriptReconciliationBanner />
      </div>}
      {step === 2 && <div className="wizard-fields"><AdditionalRefsSection />
        {s.speakers.length > 0 && <StyleForm speakers={s.speakers.map(m => m.speakerId)} speakerMappings={s.speakers} speakerSamples={{}} setSpeakerMapping={actions.directorSetSpeakerMapping} setSpeakerImage={actions.directorSetSpeakerImage} insertSpeakerMention={actions.directorInsertSpeakerMention} />}
      </div>}
      {step === 3 && <div className="wizard-fields">
        <div className="wizard-format"><label>Aspect ratio<select value={s.ratio} disabled={running || paused} onChange={e => actions.setDirectorAspectRatio(e.target.value as typeof s.ratio)}>{['16:9', '9:16', '1:1'].map(v => <option key={v}>{v}</option>)}</select></label>
          <label>Resolution<select value={s.resolution} disabled={running || paused} onChange={e => actions.setDirectorResolution(e.target.value as typeof s.resolution)}>{['480p', '720p', '1080p'].map(v => <option key={v}>{v}</option>)}</select></label></div>
        <p className="text-sm text-text-secondary">Image: {s.models.image || 'flux2_klein_9b'} · Video: {s.models.video || 'ltx2_22B_distilled_1_1'}</p>
        <p className="text-sm text-text-secondary">Models and defaults come from project settings. The first generation may download models.</p>
        <details><summary>Advanced options (optional)</summary><DirectorGenerationOptions embedded /></details>
      </div>}
      {step === 4 && <div className="wizard-fields">
        {!running && !paused && !completed && <><p>Production plans the scenes, creates the storyboard and generates videos. Reviews appear here for approval.</p><button className="wizard-button primary" disabled={!briefReady || busy} onClick={() => void start()}>Start guided production</button></>}
        {running && <p role="status">{s.status?.progress?.message || s.message || 'Preparing production…'}</p>}
        {paused ? <div className="wizard-review"><DirectorReview /></div> : s.pid ? <div className="wizard-plan"><DirectorPlanColumn /></div> : null}
        {completed && <p className="text-emerald-400">Production completed. Continue to watch and finish.</p>}
        {(running || paused) && <button className="wizard-button" disabled={busy} onClick={() => void perform(actions.stopPipeline)}>Stop production</button>}
      </div>}
      {step === 5 && <div className="wizard-fields"><div className="wizard-output"><DirectorOutputColumn /></div><div className="flex flex-wrap gap-2"><button className="wizard-button primary" disabled={!completed || busy} onClick={() => void perform(async () => { if (s.pid) { const result = await rejoinPipeline(s.pid) as { filename?: string }; setNotice(`Video assembled: ${result.filename || 'completed'}`); await actions.loadOutputs() } })}>Assemble full video</button><button className="wizard-button" disabled={!completed || busy} onClick={() => void openEditor()}>Finish in Editor</button><button className="wizard-button" onClick={() => actions.setAppSection('medias')}>Open project files</button></div></div>}
    </section>
    <footer className="wizard-footer"><button className="wizard-button" disabled={step === 0 || busy} onClick={() => { setStep(step - 1); setNotice('') }}>Back</button><span className="text-xs text-text-muted">Step {step + 1} of {steps.length}</span><button className="wizard-button primary" disabled={step === 5 || !canNext || busy || running} onClick={() => { setStep(step + 1); setNotice('') }}>Continue</button></footer>
    <DirectorStatusBar />
  </div>
}
