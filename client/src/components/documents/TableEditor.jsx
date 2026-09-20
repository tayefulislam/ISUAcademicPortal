import { useState } from 'react';
import { Grid3x3, Minus, Plus } from 'lucide-react';

// The grid editor for a TABLE element — the Word-like "table" part of the
// element panel. Rows and columns are resized here, each cell's text is typed
// directly into the grid, and any cell can instead be bound to one of the
// official sources (a student's name, a course code) so a row prints real data.
//
// Cells are stored FLAT and row-major (see the server's normalizeTable), which
// is why the resize helper below preserves the overlapping block rather than
// reshaping nested arrays.

const MAX_ROWS = 40;
const MAX_COLS = 12;

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Keeps the top-left rows × cols block of `list` when the grid is resized. */
function resizeGrid(list, oldRows, oldCols, rows, cols) {
  const source = Array.isArray(list) ? list : [];
  const next = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      next.push(r < oldRows && c < oldCols ? (source[r * oldCols + c] ?? '') : '');
    }
  }
  return next;
}

/** Column/row weights padded/truncated to the new count (all 1 by default). */
function resizeWeights(list, count) {
  const next = Array.isArray(list) ? list.slice(0, count) : [];
  while (next.length < count) next.push(1);
  return next;
}

const stepperButton = 'w-7 h-7 shrink-0 grid place-items-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40';
const inputClass = 'w-full h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white';
const labelClass = 'block text-[11px] text-slate-500 mb-1';

export default function TableEditor({ table, meta, onChange }) {
  const grid = table && typeof table === 'object' ? table : {};
  const rows = Math.min(MAX_ROWS, Math.max(1, Math.round(num(grid.rows, 1))));
  const cols = Math.min(MAX_COLS, Math.max(1, Math.round(num(grid.cols, 1))));
  const cells = Array.isArray(grid.cells) ? grid.cells : [];
  const cellSources = Array.isArray(grid.cellSources) ? grid.cellSources : [];

  const [active, setActive] = useState(0);
  const activeIndex = Math.min(active, rows * cols - 1);
  const activeRow = Math.floor(activeIndex / cols);
  const activeCol = activeIndex % cols;

  const set = (patch) => onChange({ ...grid, ...patch });

  const setSize = (nextRows, nextCols) => {
    const r = Math.min(MAX_ROWS, Math.max(1, nextRows));
    const c = Math.min(MAX_COLS, Math.max(1, nextCols));
    onChange({
      ...grid,
      rows: r,
      cols: c,
      cells: resizeGrid(cells, rows, cols, r, c),
      cellSources: resizeGrid(cellSources, rows, cols, r, c),
      columnWidths: resizeWeights(grid.columnWidths, c),
      rowHeights: resizeWeights(grid.rowHeights, r),
    });
    setActive(0);
  };

  const setCellText = (index, value) => {
    const next = cells.slice();
    while (next.length < rows * cols) next.push('');
    next[index] = value;
    set({ cells: next });
  };

  const setCellSource = (index, value) => {
    const next = cellSources.slice();
    while (next.length < rows * cols) next.push('');
    next[index] = value;
    set({ cellSources: next });
  };

  const sources = meta?.sources || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Grid3x3 size={14} className="text-slate-400 shrink-0" />
        <span className="text-xs font-semibold text-slate-500">Table</span>
      </div>

      {/* Grid size */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { key: 'rows', label: 'Rows', value: rows, max: MAX_ROWS, set: (v) => setSize(v, cols) },
          { key: 'cols', label: 'Columns', value: cols, max: MAX_COLS, set: (v) => setSize(rows, v) },
        ].map(({ key, label, value, max, set: apply }) => (
          <div key={key}>
            <label className={labelClass}>{label}</label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => apply(value - 1)}
                disabled={value <= 1}
                className={stepperButton}
                title={`Remove a ${key === 'rows' ? 'row' : 'column'}`}
              >
                <Minus size={13} />
              </button>
              <input
                type="number"
                min="1"
                max={max}
                value={value}
                onChange={(e) => apply(Number(e.target.value) || 1)}
                className={`${inputClass} text-center`}
              />
              <button
                type="button"
                onClick={() => apply(value + 1)}
                disabled={value >= max}
                className={stepperButton}
                title={`Add a ${key === 'rows' ? 'row' : 'column'}`}
              >
                <Plus size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Cells — type straight into the grid, like a spreadsheet. */}
      <div>
        <label className={labelClass}>Cells</label>
        <div className="overflow-auto rounded-lg border border-slate-200 p-1">
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(64px, 1fr))` }}
          >
            {Array.from({ length: rows * cols }).map((_, index) => {
              const isDynamic = Boolean(cellSources[index]);
              const isActiveCell = index === activeIndex;
              return (
                <input
                  key={index}
                  value={cells[index] ?? ''}
                  onFocus={() => setActive(index)}
                  onChange={(e) => setCellText(index, e.target.value)}
                  placeholder={`${Math.floor(index / cols) + 1},${(index % cols) + 1}`}
                  title={isDynamic ? 'Filled from the record — see “Cell source” below' : 'Type the cell text'}
                  className={`h-8 rounded border px-1.5 text-xs ${
                    isActiveCell ? 'border-brand-400 ring-1 ring-brand-200' : 'border-slate-200'
                  } ${isDynamic ? 'bg-brand-50 text-brand-700' : 'bg-white text-slate-700'}`}
                />
              );
            })}
          </div>
        </div>
        <p className="text-[10px] text-slate-400 mt-1">Tinted cells print an official value instead of their text.</p>
      </div>

      {/* The focused cell's official source (optional). */}
      <div>
        <label className={labelClass}>
          Cell source — row {activeRow + 1}, column {activeCol + 1}
        </label>
        <select
          value={cellSources[activeIndex] || ''}
          onChange={(e) => setCellSource(activeIndex, e.target.value)}
          className={inputClass}
        >
          <option value="">Typed text (as entered above)</option>
          {sources.map((source) => (
            <option key={source.value} value={source.value}>{source.label}</option>
          ))}
        </select>
        {cellSources[activeIndex] && (
          <p className="text-[10px] text-slate-400 mt-1">
            This cell ignores its typed text and prints the selected value.
          </p>
        )}
      </div>

      {/* Header, padding */}
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={Boolean(grid.headerRow)}
          onChange={(e) => set({ headerRow: e.target.checked })}
        />
        Header row (bold, shaded)
      </label>
      {grid.headerRow && (
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(grid.headerBackground || '') ? grid.headerBackground : '#f1f5f9'}
            onChange={(e) => set({ headerBackground: e.target.value })}
            className="w-7 h-7 rounded border border-slate-300"
          />
          Header shading
        </label>
      )}
      <div>
        <label className={labelClass}>Cell padding (mm)</label>
        <input
          type="number"
          step="0.5"
          min="0"
          value={grid.cellPadding ?? 1.5}
          onChange={(e) => set({ cellPadding: e.target.value })}
          className={inputClass}
        />
      </div>
    </div>
  );
}
