import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { superAdminApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';

function ToggleCard({ title, description, enabled, onToggle }) {
  return (
    <div className="max-w-xl bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">{title}</h2>
      <p className="text-sm text-slate-500 mb-4">{description}</p>
      <div className="flex items-center gap-3">
        <button
          onClick={onToggle}
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
            enabled ? 'bg-brand-600' : 'bg-slate-300'
          }`}
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
        <span className="text-sm font-medium text-slate-700">{enabled ? 'ON' : 'OFF'}</span>
      </div>
    </div>
  );
}

// A non-negative integer limit — 0 always means "unlimited" (see
// Settings.js NUMERIC_SETTINGS). Saves on blur, not on every keystroke.
function NumericLimitCard({ title, description, value, onSave }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  return (
    <div className="max-w-xl bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">{title}</h2>
      <p className="text-sm text-slate-500 mb-4">{description}</p>
      <div className="flex items-center gap-3">
        <input
          type="number"
          min={0}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const num = Math.max(0, Number(draft) || 0);
            setDraft(String(num));
            if (num !== value) onSave(num);
          }}
          className="w-24 h-10 rounded-lg border border-slate-300 px-3 text-sm"
        />
        <span className="text-sm text-slate-500">{Number(draft) === 0 ? 'Unlimited' : 'max'}</span>
      </div>
    </div>
  );
}

// Friendly labels for the fixed option lists (Settings.js STRING_SETTINGS).
// Anything not listed falls back to the raw value.
const OPTION_LABELS = {
  imgbb: 'ImgBB',
  s3: 'S3',
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  gemini: 'Gemini',
};

// One value from Settings.js STRING_SETTINGS. A setting with a fixed `options`
// list is a radio group; one validated by a `pattern` instead (the AI model) is
// free text. The control is chosen from the data — assuming every string
// setting has `options` is what used to crash this page with
// "Cannot read properties of undefined (reading 'map')" once aiModel was added.
function StringSettingCard({ title, description, options, value, onSave }) {
  const [draft, setDraft] = useState(value ?? '');

  // Follow the stored value when the query refetches after a save.
  useEffect(() => setDraft(value ?? ''), [value]);

  const commit = () => {
    const next = String(draft ?? '').trim();
    if (!next || next === value) {
      setDraft(value ?? '');
      return;
    }
    onSave(next);
  };

  return (
    <div className="max-w-xl bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">{title}</h2>
      <p className="text-sm text-slate-500 mb-4">{description}</p>
      {options ? (
        <div className="flex flex-wrap gap-4">
          {options.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
              <input type="radio" checked={value === opt} onChange={() => onSave(opt)} />
              {OPTION_LABELS[opt] || opt}
            </label>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
            }}
            onBlur={commit}
            className="w-64 h-10 rounded-lg border border-slate-300 px-3 text-sm"
          />
          <button type="button" onClick={commit} className="h-10 px-3 rounded-lg bg-brand-600 text-white text-sm font-medium">
            Save
          </button>
        </div>
      )}
    </div>
  );
}

// A list of admin-managed values (see Settings.js LIST_SETTINGS) — chips
// with a remove button, plus an add-one input. `onSave` always receives the
// FULL replacement array (whole-array replace, same convention every other
// setting type here uses), so add/remove both just compute the next array
// client-side and send it.
function ListSettingCard({ title, description, items, hint, onSave }) {
  const [draft, setDraft] = useState('');

  // The server normalizes and de-duplicates (a domain is lower-cased and has
  // its "@" stripped; a display label keeps its spelling), so the raw entry is
  // sent as typed rather than being guessed at here.
  const add = () => {
    const cleaned = draft.trim();
    if (!cleaned) return;
    onSave([...items, cleaned]);
    setDraft('');
  };

  const remove = (item) => onSave(items.filter((i) => i !== item));

  return (
    <div className="max-w-xl bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">{title}</h2>
      <p className="text-sm text-slate-500 mb-4">{description}</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {items.length === 0 && <span className="text-xs text-slate-400">Nothing configured yet.</span>}
        {items.map((item) => (
          <span key={item} className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium bg-brand-50 text-brand-700 border border-brand-200">
            {item}
            <button type="button" onClick={() => remove(item)} className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-brand-100" aria-label={`Remove ${item}`}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={hint || 'Add a value'}
          className="w-56 h-10 rounded-lg border border-slate-300 px-3 text-sm"
        />
        <button type="button" onClick={add} className="h-10 px-3 rounded-lg bg-brand-600 text-white text-sm font-medium">
          Add
        </button>
      </div>
    </div>
  );
}

/**
 * The flat setting lists, bucketed under the `group` each entry declares and
 * ordered the way Settings.js SETTING_GROUPS does. An entry whose group is
 * unknown still renders (under no heading) rather than silently vanishing.
 */
function SettingSections({ items, groups, render }) {
  const order = groups.map((g) => g.key);
  const buckets = new Map();
  for (const item of items) {
    const key = item.group || '';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }

  return [...buckets.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([key, entries]) => {
      const group = groups.find((g) => g.key === key) || null;
      return (
        <section key={key || 'other'} className="mb-10">
          {group && (
            <>
              <h2 className="text-xl font-bold text-slate-800 mb-1">{group.label}</h2>
              <p className="text-sm text-slate-500 mb-5">{group.description}</p>
            </>
          )}
          <div className="space-y-6">{entries.map(render)}</div>
        </section>
      );
    });
}

// System settings — generic over whatever GET /super-admin/settings returns
// (see server models/Settings.js): `flags` for the on/off toggles, plus the
// numeric/string/list settings and the groups that label them. Adding a new
// setting server-side makes it appear here automatically.
export default function SuperAdminSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['system-settings'], queryFn: superAdminApi.getSettings });

  const values = data?.data || {};
  const flags = data?.flags || [];
  const numericSettings = data?.numericSettings || [];
  const stringSettings = data?.stringSettings || [];
  const listSettings = data?.listSettings || [];
  const settingGroups = data?.settingGroups || [];

  const saveValue = async (key, value, label) => {
    try {
      await superAdminApi.updateSettings({ [key]: value });
      toast(`${label} updated`, 'success');
      qc.invalidateQueries({ queryKey: ['system-settings'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Update failed', 'error');
    }
  };

  if (isLoading) return <p className="text-slate-400">Loading...</p>;

  return (
    <div>
      {stringSettings.length > 0 && (
        <SettingSections
          items={stringSettings}
          groups={settingGroups}
          render={(s) => (
            <StringSettingCard
              key={s.key}
              title={s.label}
              description={s.description}
              options={s.options}
              value={values[s.key]}
              onSave={(v) => saveValue(s.key, v, s.label)}
            />
          )}
        />
      )}

      <h1 className="text-2xl font-bold text-slate-800 mb-1">Feature Management</h1>
      <p className="text-sm text-slate-500 mb-6">Turn platform-wide features ON or OFF. Changes take effect immediately.</p>
      <div className="space-y-6 mb-10">
        {flags.map((f) => (
          <ToggleCard
            key={f.key}
            title={f.label}
            description={f.description}
            enabled={!!values[f.key]}
            onToggle={() => saveValue(f.key, !values[f.key], f.label)}
          />
        ))}
      </div>

      {listSettings.length > 0 && (
        <div className="space-y-6 mb-10">
          {listSettings.map((l) => (
            <ListSettingCard
              key={l.key}
              title={l.label}
              description={l.description}
              items={values[l.key] || []}
              hint={l.itemHint}
              onSave={(v) => saveValue(l.key, v, l.label)}
            />
          ))}
        </div>
      )}

      {numericSettings.length > 0 && (
        <SettingSections
          items={numericSettings}
          groups={settingGroups}
          render={(n) => (
            <NumericLimitCard
              key={n.key}
              title={n.label}
              description={n.description}
              value={values[n.key] || 0}
              onSave={(v) => saveValue(n.key, v, n.label)}
            />
          )}
        />
      )}
    </div>
  );
}
