/**
 * @jest-environment jsdom
 *
 * Declared per-file on purpose: `frontend/package.json`'s jest config has no
 * `testEnvironment`, so a run from inside `frontend/` (as CI's frontend job does)
 * would default this DOM suite to node and fail it with "document is not
 * defined". The root config is the canonical runner; this docblock makes the
 * file correct under either.
 */
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import CloudModelSelect from './CloudModelSelect.jsx';
import { DEFAULT_CLOUD_MODEL_ID } from '../../constants/aiModel.js';

/**
 * The `/net` sidebar used to render the *current* cloud model as static text, so
 * with DeepSeek configured server-side the chat offered Claude and nothing else.
 * These tests pin the behaviour that fixes it: the picker renders what the live
 * provider payload reports, all of it, provider-qualified.
 */
const LIVE_PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    models: {
      'deepseek-chat': { name: 'DeepSeek-V3 (Chat)', inputRate: 0.27, outputRate: 1.10, isDefault: true },
      'deepseek-reasoner': { name: 'DeepSeek-R1 (Reasoner)', inputRate: 0.55, outputRate: 2.19, isDefault: false },
    },
  },
  bedrock: {
    name: 'AWS Bedrock',
    models: { [DEFAULT_CLOUD_MODEL_ID]: { name: 'Claude Haiku 4.5', inputRate: 1, outputRate: 5, isDefault: false } },
  },
};

const renderSelect = (props = {}) =>
  render(
    <CloudModelSelect
      id="test-model"
      providers={LIVE_PROVIDERS}
      value={DEFAULT_CLOUD_MODEL_ID}
      onChange={() => {}}
      {...props}
    />
  );

afterEach(cleanup);

describe('CloudModelSelect', () => {
  test('offers every model from every configured provider', () => {
    renderSelect();
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.value)).toEqual([
      'deepseek-chat',
      'deepseek-reasoner',
      DEFAULT_CLOUD_MODEL_ID,
    ]);
  });

  test('qualifies each option with its provider', () => {
    renderSelect();
    expect(screen.getByRole('option', { name: 'DeepSeek-V3 (Chat) (DeepSeek)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Claude Haiku 4.5 (AWS Bedrock)' })).toBeInTheDocument();
  });

  test('reports the chosen model id', () => {
    const onChange = jest.fn();
    renderSelect({ onChange });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'deepseek-reasoner' } });
    expect(onChange).toHaveBeenCalledWith('deepseek-reasoner');
  });

  test('is never empty, even before the provider payload arrives', () => {
    renderSelect({ providers: undefined });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].value).toBe(DEFAULT_CLOUD_MODEL_ID);
  });

  describe('what it selects', () => {
    test('the cheapest model for a user who has never chosen one', () => {
      renderSelect({ value: '' });
      expect(screen.getByRole('combobox')).toHaveValue('deepseek-chat');
    });

    test('the model the app used to ship as its default is not a choice', () => {
      // Every existing account stores this id — the app wrote it, nobody picked it.
      renderSelect({ value: DEFAULT_CLOUD_MODEL_ID });
      expect(screen.getByRole('combobox')).toHaveValue('deepseek-chat');
    });

    test('the user\'s recorded choice, even when it is not the cheapest', () => {
      renderSelect({ value: DEFAULT_CLOUD_MODEL_ID, chosenModelId: DEFAULT_CLOUD_MODEL_ID });
      expect(screen.getByRole('combobox')).toHaveValue(DEFAULT_CLOUD_MODEL_ID);
    });

    test('never a stored id the server no longer offers', () => {
      renderSelect({ value: 'gpt-4o-mini' });
      expect(screen.getByRole('combobox')).toHaveValue('deepseek-chat');
    });
  });

  test('can be disabled (e.g. while offline)', () => {
    renderSelect({ disabled: true });
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
