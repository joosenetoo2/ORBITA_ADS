# Page Design Override: Grid Workspace (Grade Horária)

> Overrides MASTER.md for the main interactive timetable grid.

## Core Rules for Timetable Grid

1. **Typography**:
   - Headers & App UI: 'Plus Jakarta Sans', system-ui, sans-serif
   - Timetable Time Slots & Codes: Tabular numbers (`font-variant-numeric: tabular-nums`)
   - High legibility on dense data screens.

2. **Colors & Accessibility**:
   - Primary Surface: `#FFFFFF`
   - Background Canvas: `#F8FAFC`
   - Timetable Headers: `#F1F5F9` with `#334155` text and uppercase weekday indicators.
   - Time Column: Sticky left column with `#0F172A` text, `#F8FAFC` background and distinct right border.
   - Lesson Blocks: Left accent stripe (distinct per discipline) + high-contrast text (contrast >= 4.5:1).
   - Drop Target: `#EFF6FF` with `2px dashed #2563EB` border.
   - Focus State: Visible 2px focus ring (`#2563EB`) with 2px offset.

3. **Interactivity & Ergonomics**:
   - Touch targets minimum 44px height.
   - Drag & drop with immediate feedback (drag preview, hover highlighting).
   - Fast filtering by class group or teacher to avoid excessive scrolling.
   - Clear KPI metrics banner for schedule health (total lessons, total hours, groups covered).
   - Floating dismissible toasts with aria-live="polite".

