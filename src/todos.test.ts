import { describe, expect, it } from 'vitest'
import { filterTodos, parseInput, sortTodos, type Todo } from './todos'

describe('parseInput', () => {
  it('creates one todo per non-empty line', () => {
    const todos = parseInput('milk\n\n  eggs  \r\nbread')
    expect(todos.map((t) => t.text)).toEqual(['milk', 'eggs', 'bread'])
    expect(todos.every((t) => !t.done)).toBe(true)
  })

  it('marks leading or trailing "!" as important', () => {
    const [a, b, c] = parseInput('!call mom\npay rent !\nplain')
    expect(a).toMatchObject({ text: 'call mom', important: true })
    expect(b).toMatchObject({ text: 'pay rent', important: true })
    expect(c).toMatchObject({ text: 'plain', important: false })
  })

  it('ignores whitespace-only and bare "!" input', () => {
    expect(parseInput('   \n!\n')).toEqual([])
  })
})

describe('sortTodos / filterTodos', () => {
  const t = (id: string, done: boolean, important: boolean, createdAt: number): Todo => ({
    id,
    text: id,
    done,
    important,
    createdAt,
  })
  const todos = [t('old', false, false, 1), t('new', false, false, 2), t('imp', false, true, 0), t('fin', true, true, 3)]

  it('puts important first, newest next, done last', () => {
    expect(sortTodos(todos).map((x) => x.id)).toEqual(['imp', 'new', 'old', 'fin'])
  })

  it('filters by status', () => {
    expect(filterTodos(todos, 'done').map((x) => x.id)).toEqual(['fin'])
    expect(filterTodos(todos, 'active')).toHaveLength(3)
  })
})
