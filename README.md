# Inkling

A todo list that likes you back.

Paper, ink, and a sky that follows the hour. No framework, no build step, no account. Everything lives in your browser.

**Live:** https://sebderhy.github.io/inkling/

## The small things

- **The sky changes with the clock.** Dawn, day, dusk, and night each tint the page differently. Dark mode has its own four skies.
- **The headline reads your list.** "Just one thing." "A full plate." "A tall order." "All clear."
- **Type like you talk.** `Call Ada on friday !! #family` becomes a task due Friday, high priority, tagged family. Chips preview the parse as you type.
- **Ticking draws a check** and strikes the words through like a pen. Each tick plays a soft two-note chime that climbs a whole tone per streak.
- **Finish everything** and paper confetti falls.
- **Delete is never final.** A toast holds the task for five seconds. Undo with a click or `⌘Z`.
- **Drag to reorder** with a little tilt. Press and hold on touch. `alt + ↑↓` from the keyboard.
- **Seven bars in the footer** show how many tasks you finished each day this week.
- **The placeholder teaches.** It cycles through example tasks that show off the date, priority, and tag syntax.
- Full keyboard control. Press `?` for the list.

## Run it

Open `index.html`. That's it. Or serve the folder with anything:

```sh
python3 -m http.server 3000
```

## Made of

- [Fraunces](https://fonts.google.com/specimen/Fraunces) for the headlines, [Instrument Sans](https://fonts.google.com/specimen/Instrument+Sans) for everything else
- Vanilla JS, CSS, and the Web Audio and Web Animations APIs
- `localStorage` for persistence

## License

MIT
