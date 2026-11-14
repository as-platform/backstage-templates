import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { App, SERVICE } from './App';

it('shows the service name as the page heading', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: SERVICE })).toBeTruthy();
});
