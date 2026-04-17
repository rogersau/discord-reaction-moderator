# Admin dark mode design

## Problem

The admin web interface currently uses a light theme palette. The requested change is to make the interface default to dark mode, and the chosen behavior is to make it always dark for now rather than introducing theme switching.

## Current context

- The admin React entrypoint lives under `src/admin/`.
- Shared visual tokens are defined in `src/admin/styles.css`.
- The UI is already built around shared semantic color tokens such as `background`, `foreground`, `card`, `muted`, `border`, and `input`.
- Components and screens consume those tokens through existing utility classes, so the palette can be changed centrally.

## Options considered

### 1. Replace the shared base palette with dark values

Update the CSS custom properties in `src/admin/styles.css` so the existing UI renders with a dark surface and light foreground colors.

**Pros**
- Smallest change
- Consistent across the full admin UI
- No new React state, storage, or runtime logic

**Cons**
- Does not prepare a user-facing theme toggle

### 2. Introduce a `.dark` class and apply it globally

Define both light and dark tokens, then set the root into dark mode by default.

**Pros**
- Easier future path to a toggle

**Cons**
- More moving parts than needed for the current request
- Adds structure that is unused today

### 3. Override colors per page/component

Manually adjust classes in `App.tsx` and individual UI primitives.

**Pros**
- Fine-grained control

**Cons**
- Highest maintenance cost
- Easy to miss surfaces and create inconsistent styling

## Selected approach

Use option 1: replace the shared admin palette with dark token values in `src/admin/styles.css`, and leave the application always dark.

## Design

### Styling

- Change the `:root` CSS variables in `src/admin/styles.css` from the current light palette to a dark palette.
- Keep semantic token names unchanged so existing components continue to work without refactors.
- Ensure background, card, popover, muted, border, input, primary, and accent values all remain visually coherent in the darker scheme.

### Application behavior

- Do not add a theme toggle.
- Do not read browser theme preferences.
- Do not store theme state in local storage, cookies, or server state.
- The admin UI should render in dark mode immediately on load because the only exported palette is dark.

### Scope boundaries

In scope:
- Admin UI palette updates needed to make the interface dark by default
- Regenerating the embedded admin bundle after the CSS change

Out of scope:
- User-selectable theme switching
- Automatic light/dark switching from OS preferences
- Broader restyling outside what is needed for a coherent dark default

### Error handling

No new runtime error handling is needed because the change is static styling only.

### Verification

- Confirm the admin build still succeeds after the CSS token changes.
- Confirm the existing test and typecheck commands still pass.

