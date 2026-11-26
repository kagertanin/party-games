const fruits = [
  {
    body: '<path d="M12 8c-3.8-3.5-9.7-1-9.3 4.7.3 3.9 3 9 6.1 9 1.3 0 2.3-.8 3.2-.8s1.9.8 3.2.8c3.1 0 5.8-5.1 6.1-9 .4-5.7-5.5-8.2-9.3-4.7Z"/>',
    leaf: '<path d="M12 7c.1-3.6 2.2-5.4 5.8-5.3C17.1 5 15 6.9 12 7Z"/>',
    stem: 'M12 8c-.2-1.8-.7-3-1.8-4',
    shading: 'M4.6 15.1l1-1.5m-.2 3.3 1.8-2.8m-.7 4.4 2.4-3.7m-.8 4.5 2.1-3.1m-.2 3.1 1.2-1.9',
  },
  {
    body: '<circle cx="12" cy="13.5" r="8.2"/>',
    leaf: '<path d="M12.3 6.2c.8-3.6 3.1-4.8 6.9-4.1-1.3 3-3.6 4.5-6.9 4.1Z"/>',
    stem: 'M12 6.4c-.2-1.3-.8-2.5-1.7-3.4',
    shading: 'M6.2 13.9l.1-.25m.7 2.7.13-.42m.8 2.2.22-.3m.6-4 .1-.32m1.2 3.2.15-.37m.55 2.5.17-.38m.75-5.6.1-.23m.7 3.15.16-.27',
  },
  {
    body: '<path d="M19.2 7c3.2 3.6.5 9.1-3 12.1-4 3.6-8.8 3.7-11.5.6-2.6-3-1.6-7.4 2-11 3.5-3.6 9.7-4.9 12.5-1.7Z"/>',
    leaf: '<path d="M14 6.3c1.6-3.6 4.5-4.9 7.5-4-1.3 2.9-4.1 4.5-7.5 4Z"/>',
    stem: 'M15 6.1c0-1.4-.4-2.7-1.2-3.7',
    shading: 'M6.2 19.3c.7-2.9 2.4-6.2 4.9-9.1m-3.6 9.8c.4-1.6 1.2-3.5 2.1-5m-.5 4.8 1.3-2.8',
  },
];

export function renderFruit(team: number, className = ""): string {
  const fruit = fruits[team];
  if (!fruit) return "";

  return `<svg class="survey-fruit ${className}" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <g class="survey-fruit-body" fill="var(--fruit-fill, var(--team-soft))" stroke="currentColor" stroke-width="1.25">${fruit.body}</g>
    <g fill="var(--fruit-fill, var(--team-soft))" stroke="currentColor" stroke-width="1.05" stroke-linejoin="round">${fruit.leaf}</g>
    <path d="${fruit.stem}" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
    <path d="${fruit.shading}" fill="none" stroke="currentColor" stroke-width=".75" stroke-linecap="round"/>
  </svg>`;
}
