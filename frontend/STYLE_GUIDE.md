# Frontend Style Guide & Architecture

## Core Tech Stack
- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript (Strict mode, no `any`)
- **Styling**: Tailwind CSS + `cn` utility (clsx + tailwind-merge)
- **State Management**: Zustand
- **Animations**: Framer Motion
- **Icons**: Lucide React
- **Charts**: Recharts (dynamically imported to optimize initial load)

## Directory Structure
- `src/app/`: Next.js App Router pages and layouts. Pages should default to Server Components.
- `src/components/`: Reusable UI components. Break down monolithic pages into modular components here.
- `src/lib/`: Utility functions (e.g., `utils.ts` for `cn`).
- `src/store/`: Zustand global state slices.

## Server vs. Client Components (Next.js)
- **Default to Server Components**: Pages (`page.tsx`) and Layouts (`layout.tsx`) should primarily be Server Components.
- **Client Components**: Only add `"use client"` to interactive leaf components (e.g., those using `framer-motion`, `useState`, `onClick`, or heavy client-side libraries like `recharts`).

## Styling Guidelines
- **Tailwind First**: Avoid inline styles.
- **Dynamic Classes**: Always use the `cn()` utility from `src/lib/utils` when combining conditional Tailwind classes.
- **Design System**: 
  - **Dark Theme Default**: The application is primarily dark mode.
  - **Primary Colors**: Sky (`sky-400`, `sky-500`) and Blue (`blue-500`, `blue-600`, `blue-900`).
  - **Glassmorphism**: Use `glass-panel` and `glass-header` classes (defined in `globals.css`) alongside semi-transparent background colors (e.g., `bg-white/10`).

## Performance & Optimization
- **Code Splitting**: Use `next/dynamic` to lazily load large client-side libraries (like charts) so they do not block the initial page render.
- **Rendering**: Memoize expensive computations with `useMemo` or `React.memo` where applicable.

## State Management
- **Zustand**: Use Zustand for cross-component global state. Avoid prop-drilling.
- **Slices**: Break stores down into logical slices if they grow too large.

## Security
- **No Secrets in Client**: Never store API keys or secrets in client-side code. Use `process.env` in server components and `import.meta.env` (or Next.js equivalent `process.env.NEXT_PUBLIC_`) for public config.
