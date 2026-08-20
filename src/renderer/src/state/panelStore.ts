import { create } from 'zustand'
import type { ViewName } from '@shared/ipc'

// Window/panel chrome state: which view the main window shows, collapse,
// transcript visibility, and the ⌘K find overlay.

interface FindSlice {
  open: boolean
  query: string
  selectedIndex: number
}

interface PanelState {
  view: ViewName
  collapsed: boolean
  transcriptVisible: boolean
  find: FindSlice

  setView(v: ViewName): void
  setCollapsed(c: boolean): void
  toggleTranscript(): void
  openFind(): void
  closeFind(): void
  setFindQuery(q: string): void
  moveFind(delta: number, resultCount: number): void
}

export const usePanelStore = create<PanelState>((set) => ({
  view: 'setup',
  collapsed: false,
  transcriptVisible: true,
  find: { open: false, query: '', selectedIndex: 0 },

  setView: (view) => set({ view }),
  setCollapsed: (collapsed) => set({ collapsed }),
  toggleTranscript: () => set((s) => ({ transcriptVisible: !s.transcriptVisible })),
  openFind: () => set({ find: { open: true, query: '', selectedIndex: 0 } }),
  closeFind: () => set((s) => ({ find: { ...s.find, open: false } })),
  setFindQuery: (query) => set((s) => ({ find: { ...s.find, query, selectedIndex: 0 } })),
  moveFind: (delta, resultCount) =>
    set((s) => ({
      find: {
        ...s.find,
        selectedIndex:
          resultCount === 0 ? 0 : Math.min(Math.max(s.find.selectedIndex + delta, 0), resultCount - 1)
      }
    }))
}))
