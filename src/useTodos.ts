import { useCallback, useEffect, useState } from 'react'
import { STORAGE_KEY, loadTodos, parseInput, saveTodos, type Todo } from './todos'

export function useTodos() {
  const [todos, setTodos] = useState<Todo[]>(loadTodos)
  // Snapshot before the last destructive action, so it can be undone.
  const [undoSnapshot, setUndoSnapshot] = useState<{ todos: Todo[]; label: string } | null>(null)

  useEffect(() => saveTodos(todos), [todos])

  // Keep multiple open tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setTodos(loadTodos())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const add = useCallback((raw: string) => {
    const created = parseInput(raw)
    if (created.length) setTodos((prev) => [...created, ...prev])
    return created.length
  }, [])

  const toggle = useCallback((id: string) => {
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)))
  }, [])

  const toggleImportant = useCallback((id: string) => {
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, important: !t.important } : t)))
  }, [])

  const rename = useCallback((id: string, text: string) => {
    const trimmed = text.trim()
    setTodos((prev) =>
      trimmed ? prev.map((t) => (t.id === id ? { ...t, text: trimmed } : t)) : prev.filter((t) => t.id !== id),
    )
  }, [])

  const remove = useCallback(
    (id: string) => {
      setUndoSnapshot({ todos, label: 'To-do deleted' })
      setTodos((prev) => prev.filter((t) => t.id !== id))
    },
    [todos],
  )

  const clearDone = useCallback(() => {
    const count = todos.filter((t) => t.done).length
    if (!count) return
    setUndoSnapshot({ todos, label: `Cleared ${count} completed` })
    setTodos((prev) => prev.filter((t) => !t.done))
  }, [todos])

  const undo = useCallback(() => {
    if (!undoSnapshot) return
    setTodos(undoSnapshot.todos)
    setUndoSnapshot(null)
  }, [undoSnapshot])

  const dismissUndo = useCallback(() => setUndoSnapshot(null), [])

  return { todos, add, toggle, toggleImportant, rename, remove, clearDone, undo, undoLabel: undoSnapshot?.label, dismissUndo }
}
