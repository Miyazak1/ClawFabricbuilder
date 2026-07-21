import { createRoot } from 'react-dom/client';
import { act } from 'react';

import { BuilderApp } from './BuilderApp';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

test('renders only the focused Builder workspace shell', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<BuilderApp />));

  expect(host.querySelector('h1')?.textContent).toBe('What do you want to make?');
  expect(host.querySelector('#builder-idea')).toBeInstanceOf(HTMLTextAreaElement);
  expect(host.querySelectorAll('button')).toHaveLength(2);
  expect(Array.from(host.querySelectorAll('button')).every((button) => button.disabled)).toBe(true);
  expect(host.textContent).not.toMatch(/chat|canvas|job|workspace server|current state/iu);

  act(() => root.unmount());
  host.remove();
});
