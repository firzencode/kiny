export interface StoryEntry {
  id: string
  dir: string
  name: string
  author?: string
  cover?: string
  description?: string
}

export interface LibraryItem extends StoryEntry {
  coverUrl?: string
}
