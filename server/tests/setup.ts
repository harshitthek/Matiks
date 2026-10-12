/**
 * Test Environment Setup
 * Executed before any test files are loaded.
 */
process.env.NODE_ENV = 'test';
process.env.LOAD_TEST_MAX_LATENCY_MS = process.env.LOAD_TEST_MAX_LATENCY_MS || '150';

