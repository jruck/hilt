'use client';

// Script to inject into head to prevent FOUC (flash of unstyled content)
// This runs before React hydrates, setting the correct theme class immediately
const themeScript = `
(function() {
  const stored = localStorage.getItem('claude-kanban-theme');
  let theme = stored || 'system';
  if (theme === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.classList.add(theme);
})();
`;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        dangerouslySetInnerHTML={{ __html: themeScript }}
        suppressHydrationWarning
      />
      {children}
    </>
  );
}
