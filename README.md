# lcftodo

A fast, keyboard-first to-do app. No accounts or backend: to-dos are saved in your browser's localStorage and stay in sync across open tabs.

```sh
npm install
npm run dev     # http://localhost:5173
npm test        # unit tests (vitest)
npm run build
```

## Adding to-dos quickly

- The input is focused when the page opens. Type and press **Enter**. The input stays focused, so you can keep typing the next one.
- Start or end a to-do with `!` to mark it important (for example, `Pay rent !`). Important to-dos stay at the top.
- Paste a multi-line list to create one to-do per line.
- Press `/` or `n` from anywhere to jump back to the input, and **Esc** to clear it.
- Click the circle to mark a to-do done. Double-click the text to edit it; saving it empty deletes it.
- If you delete a to-do or clear completed ones, you can bring them back with **Undo** in the toast or with ⌘/Ctrl+Z.
