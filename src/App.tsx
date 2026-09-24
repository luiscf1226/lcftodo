import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { filterTodos, sortTodos, type Filter, type Todo } from './todos'
import { useTodos } from './useTodos'

const FILTERS: Filter[] = ['all', 'active', 'done']

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

export default function App() {
  const { todos, add, toggle, toggleImportant, rename, remove, clearDone, undo, undoLabel, dismissUndo } = useTodos()
  const [draft, setDraft] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const inputRef = useRef<HTMLInputElement>(null)

  const visible = useMemo(() => sortTodos(filterTodos(todos, filter)), [todos, filter])
  const remaining = todos.filter((t) => !t.done).length
  const doneCount = todos.length - remaining

  // Global shortcuts: "/" or "n" focuses the input, Cmd/Ctrl+Z undoes the last delete.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (isTyping(e.target)) return
      if ((e.key === '/' || e.key === 'n') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        inputRef.current?.focus()
      } else if (e.key === 'z' && (e.metaKey || e.ctrlKey) && undoLabel) {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, undoLabel])

  useEffect(() => {
    if (!undoLabel) return
    const timer = setTimeout(dismissUndo, 5000)
    return () => clearTimeout(timer)
  }, [undoLabel, dismissUndo])

  const submit = () => {
    if (add(draft)) {
      setDraft('')
      // A new to-do is always "active"; make sure it's visible.
      if (filter === 'done') setFilter('all')
    }
  }

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submit()
    else if (e.key === 'Escape') {
      setDraft('')
      e.currentTarget.blur()
    }
  }

  // Pasting a multi-line list creates one to-do per line immediately.
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!/\r?\n/.test(text.trim())) return
    e.preventDefault()
    add(draft + text)
    setDraft('')
  }

  return (
    <main className="app">
      <header>
        <h1>To-do</h1>
        <p className="count">{remaining === 0 ? 'All clear' : `${remaining} left`}</p>
      </header>

      <div className="composer">
        <input
          ref={inputRef}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onInputKey}
          onPaste={onPaste}
          placeholder="What needs doing?  Press Enter"
          aria-label="New to-do"
          enterKeyHint="done"
        />
        <button type="button" className="add" onClick={submit} disabled={!draft.trim()} aria-label="Add to-do">
          +
        </button>
      </div>
      <p className="hint">
        <kbd>Enter</kbd> add · end with <kbd>!</kbd> for important · paste a list to add many · <kbd>/</kbd> to focus
      </p>

      {todos.length > 0 && (
        <nav className="toolbar">
          <div className="filters" role="tablist">
            {FILTERS.map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
                {f}
              </button>
            ))}
          </div>
          {doneCount > 0 && (
            <button className="link" onClick={clearDone}>
              Clear completed ({doneCount})
            </button>
          )}
        </nav>
      )}

      <ul className="list">
        {visible.map((todo) => (
          <TodoItem
            key={todo.id}
            todo={todo}
            onToggle={toggle}
            onStar={toggleImportant}
            onRename={rename}
            onRemove={remove}
          />
        ))}
      </ul>

      {visible.length === 0 && (
        <p className="empty">{todos.length === 0 ? 'Nothing yet — type above and hit Enter.' : `No ${filter} to-dos.`}</p>
      )}

      {undoLabel && (
        <div className="toast" role="status">
          {undoLabel}
          <button onClick={undo}>Undo</button>
        </div>
      )}
    </main>
  )
}

type ItemProps = {
  todo: Todo
  onToggle: (id: string) => void
  onStar: (id: string) => void
  onRename: (id: string, text: string) => void
  onRemove: (id: string) => void
}

function TodoItem({ todo, onToggle, onStar, onRename, onRemove }: ItemProps) {
  const [editing, setEditing] = useState(false)

  const finish = (text: string) => {
    setEditing(false)
    if (text !== todo.text) onRename(todo.id, text)
  }

  return (
    <li className={`item${todo.done ? ' done' : ''}${todo.important ? ' important' : ''}`}>
      <button
        className="check"
        role="checkbox"
        aria-checked={todo.done}
        aria-label={todo.done ? `Mark "${todo.text}" not done` : `Mark "${todo.text}" done`}
        onClick={() => onToggle(todo.id)}
      >
        {todo.done ? '✓' : ''}
      </button>

      {editing ? (
        <input
          className="edit"
          autoFocus
          defaultValue={todo.text}
          aria-label="Edit to-do"
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => finish(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <span className="text" onDoubleClick={() => setEditing(true)} title="Double-click to edit">
          {todo.text}
        </span>
      )}

      <button
        className="star"
        aria-pressed={todo.important}
        aria-label={todo.important ? 'Unmark important' : 'Mark important'}
        onClick={() => onStar(todo.id)}
      >
        {todo.important ? '★' : '☆'}
      </button>
      <button className="remove" aria-label={`Delete "${todo.text}"`} onClick={() => onRemove(todo.id)}>
        ×
      </button>
    </li>
  )
}
