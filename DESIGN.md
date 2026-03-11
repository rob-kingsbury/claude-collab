# Claude Collab — Design System

> Living document. Update as decisions are made.
> Morgan references this for any UI/UX work on this project.

---

## Identity

**Product type:** Internal developer tool / AI collaboration chatroom
**Style anchor:** Swiss/International + Dark Mode
**Personality:** Utilitarian precision — no decoration for its own sake. Clarity > personality.

---

## Color Tokens

```css
/* Use Tailwind semantic tokens — never hardcode hex */
--color-bg:           #0a0a0a   /* OLED-safe near-black */
--color-surface:      #141414   /* Card / panel surface */
--color-border:       #262626   /* Subtle dividers */
--color-text:         #f5f5f5   /* Primary text */
--color-text-muted:   #a3a3a3   /* Secondary / timestamps */
--color-accent:       #7c3aed   /* Violet — AI/tech energy */
--color-accent-alt:   #06b6d4   /* Cyan — for highlights / links */
--color-danger:       #ef4444   /* Errors, destructive actions */
--color-success:      #22c55e   /* Confirmations */
```

*Decision rationale: Dark-first because the primary users (Rob + AI participants) are in extended sessions. Violet accent reads as "AI-native" without being cliché blue.*

---

## Typography

**Primary font:** Inter (Google Fonts) — system fallback: `-apple-system, BlinkMacSystemFont, sans-serif`
**Monospace (code/IDs):** JetBrains Mono or `ui-monospace, 'Cascadia Code', monospace`

| Role | Size | Weight | Line height |
|------|------|--------|-------------|
| Heading | 18px | 600 | 1.3 |
| Body | 14px | 400 | 1.6 |
| Small / meta | 12px | 400 | 1.5 |
| Code | 13px | 400 | 1.5 |

---

## Spacing Scale

Base unit: **4px**. Allowed values: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96px.
No arbitrary values. If something needs 17px padding, the spec is wrong.

**Key layout values:**
- Panel padding: 16px
- Message padding: 12px 16px
- Chat container max-width: 800px (centered in main panel)
- Sidebar width: 260px

---

## Component Standards

### Messages
- Participant name: accent color, 12px, semibold
- Timestamp: muted, 11px, right-aligned
- Content: 14px body, markdown rendered
- System messages: centered, muted italic, no avatar

### Sidebar
- Active item: surface + accent left-border (3px)
- Hover: surface bg, 150ms transition
- Unread badge: accent bg, white text, 10px, pill shape

### Inputs
- Height: 40px minimum
- Border: 1px border-color, 6px radius
- Focus: accent color outline, 2px offset
- No box-shadow on focus — outline only

### Buttons
- Primary: accent bg, white text, 6px radius, 8px 16px padding
- Secondary: transparent bg, border, muted text
- Hover transitions: 150ms ease
- All interactive elements: `cursor: pointer`

---

## Breakpoints

| Name | Width | Notes |
|------|-------|-------|
| Mobile | 375px | Single column, no sidebar |
| Tablet | 768px | Collapsible sidebar |
| Desktop | 1024px | Two-panel layout |
| Wide | 1440px | Max comfortable width |

---

## Stack

- **CSS framework:** Tailwind CSS
- **Component primitives:** shadcn/ui (when adding component library)
- **Icons:** Lucide icons only (SVG, no emojis in UI chrome)
- **Current state:** Vanilla JS + hand-rolled CSS — migrate to Tailwind incrementally

---

## Anti-Patterns (never do these)

- Content touching viewport edge without padding
- Arbitrary spacing values outside the 4pt scale
- Hardcoded hex colors (use tokens)
- Raster icons or emoji in UI chrome
- No visible focus state
- `cursor: default` on clickable elements
- Transitions > 300ms or instant (0ms) transitions on hover
- Dark mode implemented by inverting colors — use semantic tokens from the start

---

## Open Decisions

- [ ] Font loading strategy (self-hosted vs Google Fonts CDN)
- [ ] Whether to add animation system (Framer Motion / CSS keyframes)
- [ ] Mobile layout for sidebar (drawer vs bottom nav)
- [ ] Avatar/identity system for participants (initials vs custom icons)
