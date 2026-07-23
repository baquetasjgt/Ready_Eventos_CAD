export interface CloudIssue {
  id: string
  title: string
  message: string
  retry?: () => Promise<boolean>
}

type Listener = (issues: CloudIssue[]) => void

const issues = new Map<string, CloudIssue>()
const listeners = new Set<Listener>()

function emit(): void {
  const current = [...issues.values()]
  for (const listener of listeners) listener(current)
}

export function getCloudIssues(): CloudIssue[] {
  return [...issues.values()]
}

export function subscribeCloudIssues(listener: Listener): () => void {
  listeners.add(listener)
  listener(getCloudIssues())
  return () => listeners.delete(listener)
}

export function reportCloudIssue(issue: CloudIssue): void {
  issues.set(issue.id, issue)
  emit()
}

export function resolveCloudIssue(id: string): void {
  if (!issues.delete(id)) return
  emit()
}

export function errorMessage(error: unknown): string {
  if (!error) return 'Error desconocido'
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return String(error)
}
