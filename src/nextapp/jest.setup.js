// Polyfill "window.fetch" used in the React component.
import 'whatwg-fetch';
import { setLogger } from 'react-query';
import '@testing-library/jest-dom/extend-expect';

import { queryClient } from './test/wrapper';
import { server } from '../mocks/server';

const originalError = console.error;

setLogger({
  log: console.log,
  warn: console.warn,
  error: () => {},
});

beforeAll(() => {
  server.listen();
  console.error = jest.fn();
});

afterEach(() => {
  queryClient.clear();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
  console.error = originalError;
});
