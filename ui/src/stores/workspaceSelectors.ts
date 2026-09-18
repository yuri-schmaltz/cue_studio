import { useStore } from './useStore'

export interface WorkspaceNamespace {
  workspaces: ReturnType<typeof useStore.getState>['workspaces']
  activeWorkspace: string
  activeWorkspaceSetup: ReturnType<typeof useStore.getState>['activeWorkspaceSetup']
  activeWorkspaceSetupLoading: boolean
  workspacesLoading: boolean
  browsingUploads: boolean
}

type StoreState = ReturnType<typeof useStore.getState>

type WorkspaceField = keyof WorkspaceNamespace

const selectors: { [K in WorkspaceField]: (state: StoreState) => WorkspaceNamespace[K] } = {
  workspaces: state => state.workspaces,
  activeWorkspace: state => state.activeWorkspace,
  activeWorkspaceSetup: state => state.activeWorkspaceSetup,
  activeWorkspaceSetupLoading: state => state.activeWorkspaceSetupLoading,
  workspacesLoading: state => state.workspacesLoading,
  browsingUploads: state => state.browsingUploads,
}

export function useWorkspaceSlice<K extends WorkspaceField>(field: K): WorkspaceNamespace[K] {
  return useStore(selectors[field])
}

export function readWorkspaceNamespace(): WorkspaceNamespace {
  const state = useStore.getState()
  return {
    workspaces: state.workspaces,
    activeWorkspace: state.activeWorkspace,
    activeWorkspaceSetup: state.activeWorkspaceSetup,
    activeWorkspaceSetupLoading: state.activeWorkspaceSetupLoading,
    workspacesLoading: state.workspacesLoading,
    browsingUploads: state.browsingUploads,
  }
}
