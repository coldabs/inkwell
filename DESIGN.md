# Inkwell Design Direction

## Reading this as

A local-first writing and reading workspace for students, writers and researchers, in an editorial ink language, dial **ENERGY 2 / RHYTHM 2 / MOTION 1**.

## Identity

Inkwell should feel like a well-made stationery cabinet: warm paper, dense ink, one sealing-wax accent, and typography that behaves like a printed book. Calm, tactile, precise. Not a dashboard, not a SaaS landing page, not a notebook emoji.

The identity motif is the **hairline and the running head**. Thin rules separate ideas the way a book separates sections. Small labels sit above content like print running heads. Nothing floats unless it is a physical sheet of paper.

## Palette

- **Paper** `#EDE7DA`: the desk. Warm, low-glare, never pure white.
- **Surface** `#FBF8F0`: raised paper for toolbars, panels and modals.
- **Sheet** `#FFFDF7`: the page itself. The brightest surface on screen.
- **Ink** `#18202B`: text and active tools. Near-black with a blue undertone, like iron-gall ink.
- **Rule** `#D5CCBA`: the hairline. Structure without decoration.
- **Muted** `#6B6558`: secondary text. AA contrast on paper.
- **Vermilion** `#B23A2A`: one accent, used for the primary action, focus, active filters and the book opening mark.

Dark mode is a dark studio, not a neon app: near-black surfaces, warm ink text, and the same vermilion. The page canvas stays paper so the writing surface still reads as paper.

Reasons: the palette comes from the product's own materials (paper, ink, book cloth, sealing wax), not from a generic gradient. One accent keeps attention on the one action that matters on each screen. Warm neutrals are easier on the eyes during long reading and writing sessions.

## Typography

- **Display and reading:** Newsreader. A contemporary literary serif with real editorial presence and comfortable long-form reading.
- **Interface:** Instrument Sans. A compact grotesque with enough character to avoid the system-ui default, and clear at 11–14px.
- **Technical text:** the existing monospace, only for TeX input and code-like values.

No handwritten webfont in the chrome. The handwriting belongs on the page, in the user's own strokes. Caveat made the product feel like a toy; Newsreader gives the titles and reading surfaces the authority of a printed book.

Type scale: 11px labels, 13px controls, 15px body UI, 19px reading default, 28–40px section headings, clamp-based masthead. Headings use tight tracking, not wide uppercase.

## Composition

- **Library:** a floating navigation bar carries the wordmark, search and theme controls over the shelf. Below it, a catalogue masthead, not a hero: shelf title, one line of description, then the filter line. The shelf is a grid of cloth-bound covers with real metadata.
- **Editor:** the page is the focal point. Side rails are flat, separated by hairlines. The toolbar is an instrument rail, not a floating card. The paper sheet has the only substantial shadow because it is the only physical object.
- **Reader:** one narrow measure, generous leading, a running head, and a single drop cap at the start of a book. Sidebar material is reference apparatus, set smaller and quieter than the reading column.
- **Parallel Read:** two equal reading sheets with one page-number rail. The sheets stay equal because the comparison is between two texts, not a dashboard. The rail is reference apparatus, set smaller and quieter than either text.
- **Modals:** rare, paper-white, one elevation, no glass.

## Components

- Radius scale: 2px for inputs and small controls, 4px for buttons and paper edges, 6px for modals, 8px for covers. No pills.
- Buttons are rectangular, with a 40px minimum height and a 44px touch target on mobile. Primary actions use ink; the single accent is reserved for "New notebook", the active filter rule, focus, and the bookmark state.
- Icons are Tabler Icons outline, inline sprite, 1.7px stroke at 18px. Chosen by the owner. The set is consistent and relevant to the tools, not a decorative icon wall.
- Shadows only on the paper sheet, the book covers, the reading sheet, the floating navigation bar, the action dock, and the modal. The navigation bar and action dock are elevated because they float over the scrolling shelf and are the only persistent chrome that overlaps content. Toolbars, panels and sidebar rows sit flat.
- Texture: none. The warmth of the paper and the hairline do the work.

## Motion

MOTION 1. Hover and active transitions only, 120–180ms, colour and a 2px lift on a book cover. No scroll reveals, no floating loops, no pulsing dots. The only moving thing should be the user's ink.

## Copy

Plain, specific, quiet. No em dashes in interface copy. No invented statistics, testimonials or claims. Every control names the action it performs. Sample content stays clearly labelled as sample content.

## Accessibility locks

- Every text pair meets WCAG AA in both light and dark themes.
- Focus is always visible: 2px vermilion outline, 2px offset.
- All controls are keyboard reachable. Modals close on Escape and the backdrop.
- Mobile reflows to one column with no horizontal page overflow. Tool rows may scroll inside their own rail.
