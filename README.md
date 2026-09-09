# Inkling

A todo list that likes you back.

Paper, ink, and a sky that follows the hour. No framework, no build step, no account. Everything lives in your browser, and the page works with no network at all.

**Live:** https://sebderhy.github.io/inkling/

## The idea

Most todo apps are databases with a checkbox. Inkling is a sheet of paper that pays attention to you. It knows what time it is, it notices what you keep putting off, and it asks you to close the day before you leave.

## Three places on the page

- **Today**, with a **This evening** shelf under it. Type `tonight` and a task goes there.
- **Up next** for everything else. Dated tasks show their day and climb into Today when it arrives.
- **Someday**, a drawer that stays closed until you open it. Type `someday` to file something there.

Drag between them, or press `t` `v` `l` `s` on a focused task. Overdue things land in Today on their own. Pushing a due-today task back to Up next moves it to tomorrow and says so.

## The unusual parts

- **Ink fades.** A task you have not touched in a while slowly yellows toward sepia. After two weeks the page asks, once, in a small italic line: *Still want this?* Today, Someday, Keep, or Let it go.
- **Tally marks.** A task that rolls over from one day to the next earns a small ink tally under it. Five days, and you get the diagonal stroke. It is the honest count of how often you have looked at it and chosen something else.
- **The daylight meter.** Write `~30m` or `~2h` and Today adds it up against the hours left in the day. *2h 50m planned +2 unsized, 6h 36m left.* When the plan is bigger than the day, the bar turns red and the page tells you.
- **Start here.** Press `n` and the page picks one thing, scoring what is overdue, urgent, carried, or quick, and opens it alone on the paper with an hourglass of ink that drains over the task's estimate. Done, five more minutes, something else, or stop. Focused minutes are written to the ledger.
- **Close the day.** From late afternoon a small moon appears in the footer. It walks you through three steps: what you finished and what to do with what is left (carry, park, let go), lining up tomorrow's three things so the hard choice happens tonight, and one line about the day. In the morning the page greets you with what you lined up.
- **The ledger.** Click the seven bars in the footer, or press `j`. Every day's count, focus time, and the line you wrote.

## Type like you talk

`Call Ada on friday !! #family ~30m // ask about the lease` becomes a task due Friday, high priority, tagged family, half an hour, with a note. Chips preview the parse as you type.

| Write | Get |
|---|---|
| `tomorrow` `fri` `in 3 days` `sep 21` `next week` | a date |
| `tonight` | this evening |
| `someday` | the drawer |
| `every monday` `daily` `every 2 weeks` `weekdays` | a repeat; ticking it writes the next one |
| `~20m` `~1h30` `for 2 hours` | an estimate |
| `!` `!!` `!!!` | priority |
| `#tag` | a tag; click one to see only those |
| `// text` | a note under the task |
| `?ferns` | find instead of add |

## The small things

- The sky changes with the clock. Dawn, day, dusk, and night each tint the page differently. Dark mode has its own four skies.
- The headline reads your list. *Just one thing. A full plate. A tall order. All clear. Day closed.*
- Ticking draws a check and strikes the words through like a pen. Each tick plays a soft two-note chime that climbs a whole tone per streak.
- Finish everything and paper confetti falls.
- Delete is never final. A toast holds the task for five seconds. Undo with a click or `⌘Z`.
- Drag to reorder with a little tilt, or across sections. Press and hold on touch. `alt + ↑↓` from the keyboard.
- Your data is yours. Export and import as JSON, or copy the whole list as plain text. Press `?`.
- Installable. Add it to your home screen and it opens offline.

Full keyboard control. Press `?` for the list.

## Run it

Open `index.html`. That's it. Or serve the folder with anything:

```sh
python3 -m http.server 3000
```

## Made of

- [Fraunces](https://fonts.google.com/specimen/Fraunces) for the headlines, [Instrument Sans](https://fonts.google.com/specimen/Instrument+Sans) for everything else
- Vanilla JS, CSS, and the Web Audio and Web Animations APIs
- `localStorage` for persistence, a small service worker for offline

## Borrowed from the best

Things 3 for Today, This Evening and Someday. TeuxDeux and Tweek for the rollover. Taskwarrior for the urgency score behind *Start here*. Truc for the idea that a list should shrink on its own. Amazing Marvin for counting procrastination instead of hiding it. Super Productivity for estimates and focus. Sunsama and Cal Newport for the shutdown ritual. Ivy Lee for lining up tomorrow tonight. Godspeed for doing everything from the keyboard. todo.txt for keeping your data as text.

## License

MIT
