import test from 'node:test';
import assert from 'node:assert/strict';
import { getOnboardingStep } from '../src/ui-react/setup/OnboardingFlow.js';

test('setup onboarding asks for an account whenever none are configured', () => {
  assert.equal(getOnboardingStep([], []), 'account');
  assert.equal(getOnboardingStep([], [{ alias: 'orphaned-env' }]), 'account');
});

test('setup onboarding asks for an environment only after an account exists', () => {
  assert.equal(getOnboardingStep([{ name: 'work' }], []), 'environment');
  assert.equal(getOnboardingStep([{ name: 'work' }], [{ alias: 'dev' }]), 'done');
});
