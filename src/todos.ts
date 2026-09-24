export type Todo = {
  id: string
  text: string
  done: boolean
  important: boolean
  createdAt: number
}

export type Filter = 'all' | 'active' | 'done'

const STORAGE_KEY = 'lcftodo:v1'

/**
 * Turns raw input into todos. Every non-empty line becomes a todo, so pasting
 * a list creates them all at once. A leading or trailing "!" marks it important.
 */
export function parseInput(raw: string, now = Date.now()): Todo[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const important = /^!\s*|\s*!$/.test(line)
      const text = line.replace(/^!\s*/, '').replace(/\s*!$/, '').trim()
      return { id: crypto.randomUUID(), text, done: false, important, createdAt: now + i }
    })
    .filter((todo) => todo.text.length > 0)
}

/** Open first (important on top), newest first within each group; done at the bottom. */
export function sortTodos(todos: Todo[]): Todo[] {
  return [...todos].sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      Number(b.important) - Number(a.important) ||
      b.createdAt - a.createdAt,
  )
}

export function filterTodos(todos: Todo[], filter: Filter): Todo[] {
  if (filter === 'active') return todos.filter((t) => !t.done)
  if (filter === 'done') return todos.filter((t) => t.done)
  return todos
}

export function loadTodos(): Todo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as Todo[]) : []
  } catch {
    return []
  }
}

export function saveTodos(todos: Todo[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todos))
}

export { STORAGE_KEY }
