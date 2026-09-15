import { useMemo } from 'react';
import {
  cloudModelOptionLabel,
  cloudModelOptions,
  getEffectiveCloudModelId,
} from '../../utils/llmProviderOptions.js';

/**
 * CloudModelSelect — the only way any surface offers a cloud model.
 *
 * Why a component rather than a shared list: the list was already shared
 * (`buildCloudModelList`), and a surface still managed to show a subset — the
 * `/net` sidebar rendered the resolved *current* model as static text ("Claude
 * Haiku 4.5") while the backend was serving DeepSeek too, so the one place a
 * chat user looks to change models named one provider. Rendering the options is
 * the part that drifted, so rendering them is the part that lives here now.
 *
 * Options come from the live `/llm-providers` payload via
 * `cloudModelOptions()` (see `utils/llmProviderOptions.js` for the source of
 * truth and the fallback rule), which means:
 *
 *   - a provider added on the backend appears here with no frontend change;
 *   - every option is provider-qualified ("DeepSeek-V3 (Chat) (DeepSeek)"),
 *     because two providers can each serve a model with the same plain name;
 *   - the select is never empty, even before the fetch resolves;
 *   - a user who has not chosen a model is shown the CHEAPEST one the server
 *     offers, not whichever model this app used to ship as its default;
 *   - a stored id the server no longer offers — or one the app itself wrote as
 *     the old default — can't be shown as selected (`getEffectiveCloudModelId`
 *     resolves those to the live default instead).
 */
function CloudModelSelect({
  id,
  value,
  onChange,
  providers,
  chosenModelId = '',
  className = '',
  disabled = false,
  ...rest
}) {
  const models = useMemo(() => cloudModelOptions(providers), [providers]);
  const selected = getEffectiveCloudModelId(value, providers, chosenModelId);

  return (
    <select
      id={id}
      className={className}
      value={selected}
      disabled={disabled}
      onChange={(e) => onChange?.(e.target.value)}
      {...rest}
    >
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {cloudModelOptionLabel(m)}
        </option>
      ))}
    </select>
  );
}

export default CloudModelSelect;
