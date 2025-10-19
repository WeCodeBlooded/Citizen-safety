import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';

// Provide a minimal navigator object for modules that check for it in Node test envs.
if (typeof navigator === 'undefined') {
  global.navigator = {};
}
