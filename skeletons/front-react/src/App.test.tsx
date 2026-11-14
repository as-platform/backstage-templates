import { render, screen } from '@testing-library/react';
import { App, SERVICE } from './App';

it('shows the service name as the page heading', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: SERVICE })).toBeTruthy();
});

it('renders again without leftovers from the previous test', () => {
  render(<App />);
  expect(screen.getAllByRole('heading')).toHaveLength(1);
});
