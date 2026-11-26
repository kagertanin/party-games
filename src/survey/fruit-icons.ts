const fruits = [
  {
    body: '<path d="M12 8c-3.8-3.5-9.7-1-9.3 4.7.3 3.9 3 9 6.1 9 1.3 0 2.3-.8 3.2-.8s1.9.8 3.2.8c3.1 0 5.8-5.1 6.1-9 .4-5.7-5.5-8.2-9.3-4.7Z"/>',
    leaf: '<path d="M12 7c.1-3.6 2.2-5.4 5.8-5.3C17.1 5 15 6.9 12 7Z"/>',
    stem: '<path d="M12 8c-.2-1.8-.7-3-1.8-4"/>',
  },
  {
    body: '<circle cx="12" cy="13.5" r="8.2"/>',
    leaf: '<path d="M12.3 6.2c.8-3.6 3.1-4.8 6.9-4.1-1.3 3-3.6 4.5-6.9 4.1Z"/>',
    stem: '<path d="M12 6.4c-.2-1.3-.8-2.5-1.7-3.4"/>',
  },
  {
    body: '<path d="M19.2 7c3.2 3.6.5 9.1-3 12.1-4 3.6-8.8 3.7-11.5.6-2.6-3-1.6-7.4 2-11 3.5-3.6 9.7-4.9 12.5-1.7Z"/>',
    leaf: '<path d="M14 6.3c1.6-3.6 4.5-4.9 7.5-4-1.3 2.9-4.1 4.5-7.5 4Z"/>',
    stem: '<path d="M15 6.1c0-1.4-.4-2.7-1.2-3.7"/>',
  },
];

export function renderFruit(team: number, className = ""): string {
  const fruit = fruits[team];
  if (!fruit) return "";

  return `<svg class="survey-fruit ${className}" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <g class="survey-fruit-body" fill="currentColor" stroke="currentColor" stroke-width="1.35">${fruit.body}</g>
    <g fill="currentColor">${fruit.leaf}</g>
    <g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">${fruit.stem}</g>
  </svg>`;
}
