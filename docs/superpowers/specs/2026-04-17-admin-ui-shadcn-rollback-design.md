# Admin UI shadcn rollback design

## Problem

The admin dashboard currently works functionally, but its visual layer has drifted into a bespoke style system with custom gradients, glow effects, oversized radii, and heavily customized shared primitives. The goal is to keep the current dashboard layout and capabilities while reverting the interface back to a plain, conventional shadcn-style dark UI.

## Scope

This design keeps the current admin dashboard structure and behavior, but rolls back the visual treatment to standard shadcn patterns.

In scope:

- Keep the current admin routes, dashboard sections, forms, tables, and client-side behavior
- Keep dark mode as the default theme
- Revert shared admin primitives to standard shadcn-style defaults
- Simplify admin page styling so it looks like a normal shadcn dashboard instead of a custom visual brand
- Update tests that currently assert the custom chrome or styling

Out of scope:

- Reworking the dashboard information architecture
- Changing admin API behavior, gateway control flow, or authentication flow
- Adding theme switching, light mode, or stored theme preferences
- Reverting the admin UI to an older commit wholesale

## Options considered

### 1. Revert shared primitives and theme tokens while keeping the current layout

Reset the shared `Button`, `Card`, `Input`, `Table`, and `Alert` primitives and the base admin CSS tokens to plain shadcn-style dark defaults, while preserving the current dashboard structure.

**Pros**

- Lowest-risk path
- Preserves the current operator workflow
- Removes the custom look at the layer where it was introduced
- Fits shadcn's composable primitive model

**Cons**

- `App.tsx` may still need some cleanup where page-level classes were written for the custom chrome

### 2. Revert shared primitives and also simplify most page-level layout styling

In addition to reverting the primitives and tokens, simplify many of the page-level classes in `App.tsx` so the page reads more like a default shadcn example.

**Pros**

- Produces the plainest visual result
- Removes more custom styling in one pass

**Cons**

- More likely to disturb layout details the user wants to keep
- Higher chance of mixing visual rollback with structural refactoring

### 3. Revert the admin UI files to a pre-custom commit and patch forward

Reset the admin UI files to an earlier revision, then re-apply any behavior that must remain.

**Pros**

- Can be fast if the styling changes were isolated cleanly

**Cons**

- History here is mixed with other admin work
- Highest risk of dropping wanted behavior or reintroducing old issues
- Harder to review and reason about than a focused visual rollback

## Selected approach

Use option 1: revert the shared visual layer to standard shadcn-style dark defaults and preserve the current dashboard layout and functionality.

This best matches the requested rollback: plain shadcn interface, dark by default, no custom visual system, and no unnecessary behavior changes.

## Current context

- The admin React app lives under `src/admin/`.
- Shared visual primitives live under `src/admin/components/ui/`.
- Global admin theme tokens and base styling live in `src/admin/styles.css`.
- The current dashboard layout and behavior are implemented in `src/admin/App.tsx`.
- Existing tests already cover admin behavior and some styling expectations.

## Design

### Styling and theme

- Keep the admin UI dark by default.
- Replace the custom dark palette and decorative page background in `src/admin/styles.css` with plain shadcn-style dark tokens and base styling.
- Remove the custom glow, glass, gradient, and branded chrome treatments from the page shell.
- Keep semantic token names such as `background`, `foreground`, `card`, `muted`, `border`, `input`, `primary`, and `accent` so the app continues to use a centralized design token model.

### Shared primitives

The shared primitives should go back to conventional shadcn-style definitions:

- `Button`: standard shadcn variants and sizing, without bespoke shadows or custom transition styling
- `Card`: standard card surface, border, spacing, and title treatment rather than the current glassy panel styling
- `Input`: standard dark input styling without custom inner shadows or special translucency
- `Table`: standard shadcn table typography and row styling rather than custom uppercase and accent-heavy presentation
- `Alert`: standard alert styling with a normal destructive variant instead of a custom tinted panel

These primitives should remain generic and reusable. Page-specific presentation should not live inside the shared UI component definitions.

### Page-level layout

- Keep the current dashboard sections, ordering, and workflows intact
- Keep the overall page layout structure, but remove classes in `App.tsx` that exist only to support the custom visual identity
- Preserve readable spacing and hierarchy, but prefer ordinary shadcn-style card and section presentation over hero-style framing
- Keep existing forms, tables, and empty states, but let the simplified primitives carry more of the visual design

### Behavior and data flow

No admin behavior changes are intended:

- Keep login flow unchanged
- Keep gateway polling and refresh flow unchanged
- Keep admin API requests unchanged
- Keep form submission and mutation flow unchanged
- Keep empty-state and error-state messaging unchanged unless a small wording change is needed for consistency

The implementation should remain a visual rollback, not a functional redesign.

### Error handling

No new runtime error handling is needed. Existing error paths should continue to render through the current dashboard logic, but with plain shadcn alert styling instead of the custom presentation layer.

### Testing and verification

- Update admin UI tests that explicitly assert the custom styling or custom chrome
- Keep behavior-oriented admin tests intact
- Rebuild the embedded admin bundle as part of normal repo validation
- Run the existing repo verification commands after the rollback

## Shadcn best-practice constraints

The rollback should follow the upstream shadcn model rather than inventing a new mini design system:

- Prefer open, directly editable component code over wrappers and overrides layered on top of other abstractions
- Keep component APIs composable and predictable
- Use beautiful defaults instead of bespoke decoration
- Keep shared primitives generic; page-level styling belongs in the page
- Stay close to standard shadcn class structure unless a project-specific deviation is clearly justified
