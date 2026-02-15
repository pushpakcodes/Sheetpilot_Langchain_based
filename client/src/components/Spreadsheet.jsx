import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { HotTable } from '@handsontable/react-wrapper';
import Handsontable from 'handsontable/base';
import { registerAllModules } from 'handsontable/registry';
import { textRenderer } from 'handsontable/renderers/textRenderer';
import { getSheetWindow, updateCell } from '../services/api';


// Register all Handsontable modules
registerAllModules();

/**
 * Spreadsheet - Handsontable-based Excel viewer/editor with virtualized lazy loading
 * 
 * Features:
 * - Excel-style smooth scrolling
 * - Virtualized rendering with window replacement (NOT appending)
 * - Multi-sheet support
 * - Lazy loading on scroll (vertical and horizontal)
 * - Edit synchronization with backend
 * - Constant memory usage
 */
const Spreadsheet = ({ filePath, sheetId, onDataChange, saveSignal }) => {
  const hotRef = useRef(null);
  const workbookIdRef = useRef(null);

  // Data state - stores ONLY the current window
  const [data, setData] = useState([[]]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Metadata and window tracking
  const metadataRef = useRef(null);
  const currentWindowRef = useRef({ rowStart: 0, rowEnd: 0, colStart: 0, colEnd: 0 });
  const loadingRef = useRef(false);
  const scrollDebounceTimerRef = useRef(null);
  const pendingEditTimerRef = useRef(null);
  const pendingEditsRef = useRef([]);
  const lastValidDataRef = useRef(null);
  const proxyScrollRef = useRef(null);

  // Constants
  const SCROLL_BUFFER = 30; // Rows/cols to load beyond visible area
  const SCROLL_DEBOUNCE_MS = 150; // Debounce scroll requests
  const EDIT_DEBOUNCE_MS = 1000; // Debounce edit sync

  /**
   * Extract workbookId from filePath
   * Note: Don't encode here - api.js will handle encoding
   */
  const workbookId = useMemo(() => {
    if (!filePath) return null;
    return filePath; // Pass raw filePath, api.js will encode it
  }, [filePath]);

  /**
   * Fetch and REPLACE data window (NOT append)
   * This is the core of virtualized loading - we replace the entire data array
   * with only the visible window + buffer
   */
  const fetchDataWindow = useCallback(async (rowStart, rowEnd, colStart, colEnd, force = false) => {
    if (!workbookId || loadingRef.current) return;

    // Check if we're requesting the same window (prevent duplicate requests)
    const currentWindow = currentWindowRef.current;
    if (!force &&
      currentWindow.rowStart === rowStart &&
      currentWindow.rowEnd === rowEnd &&
      currentWindow.colStart === colStart &&
      currentWindow.colEnd === colEnd) {
      return;
    }

    try {
      loadingRef.current = true;
      setLoading(true);
      setError(null);

      console.log('🔄 Fetching window:', { rowStart, rowEnd, colStart, colEnd, sheetId });

      if (!sheetId) {
        throw new Error('Sheet ID (name) is required');
      }

      const response = await getSheetWindow(workbookId, rowStart, rowEnd, colStart, colEnd, sheetId);
      const { data: responseData, meta } = response.data;

      // Store metadata
      if (meta) {
        metadataRef.current = meta;
      }

      // CRITICAL: Replace entire data array with window data
      // This ensures we never accumulate data - memory stays constant
      if (responseData && Array.isArray(responseData)) {
        // Create a full-size sparse array for the entire sheet
        // But only populate the window we fetched
        const totalRows = meta?.totalRows || Math.max(rowEnd, 1000);
        const totalCols = meta?.totalColumns || Math.max(colEnd, 26);

        // Initialize full array with nulls
        const newData = Array(totalRows).fill(null).map(() => Array(totalCols).fill(null));

        // Fill only the window we fetched
        responseData.forEach((row, rowIdx) => {
          const actualRow = rowStart - 1 + rowIdx; // Convert to 0-based
          if (actualRow >= 0 && actualRow < newData.length && Array.isArray(row)) {
            row.forEach((cell, colIdx) => {
              const actualCol = colStart - 1 + colIdx; // Convert to 0-based
              if (actualCol >= 0 && actualCol < newData[actualRow].length) {
                newData[actualRow][actualCol] = cell;
              }
            });
          }
        });

        // REPLACE data (not merge/append)
        setData(newData);
        currentWindowRef.current = { rowStart, rowEnd, colStart, colEnd };

        console.log('✅ Window loaded:', {
          rows: newData.length,
          cols: newData[0]?.length || 0,
          window: { rowStart, rowEnd, colStart, colEnd }
        });
      }

      setLoading(false);
    } catch (error) {
      console.error('❌ Error fetching window:', error);
      setError(error.response?.data?.message || error.message || 'Failed to load spreadsheet data');
      setLoading(false);
    } finally {
      loadingRef.current = false;
    }
  }, [workbookId, sheetId]);

  // Track previous viewport to detect scroll direction
  const previousViewportRef = useRef({ row: 0, col: 0 });

  /**
   * Handle scroll - lazy load both rows and columns
   * Uses afterScroll hook which fires on any scroll
   */
  const requestWindow = useCallback(() => {
    if (!hotRef.current?.hotInstance || !metadataRef.current || loadingRef.current) return;
    if (!metadataRef.current.totalRows || !metadataRef.current.totalColumns) return;

    // Debounce the ENTIRE logic including DOM reads to prevent forced reflows during scroll
    if (scrollDebounceTimerRef.current) {
      clearTimeout(scrollDebounceTimerRef.current);
    }

    scrollDebounceTimerRef.current = setTimeout(() => {
      try {
        const instance = hotRef.current.hotInstance;
        // Compute viewport from DOM scroll positions to avoid API differences
        const holder = instance.rootElement?.querySelector('.wtHolder');
        if (!holder) return;

        const scrollTop = holder.scrollTop;
        const viewportHeight = holder.clientHeight;

        const rowHeight = 28; // matches rowHeights

        const firstVisibleRow = Math.max(0, Math.floor(scrollTop / rowHeight));
        const visibleRowCount = Math.max(1, Math.ceil(viewportHeight / rowHeight));
        const lastVisibleRow = firstVisibleRow + visibleRowCount - 1;

        // Check if viewport actually changed
        const prevViewport = previousViewportRef.current;
        if (prevViewport.row === firstVisibleRow) {
          return; // No change, skip
        }

        previousViewportRef.current = { row: firstVisibleRow, col: 0 };

        // Calculate window with buffer for both dimensions
        const rowStart = Math.max(1, firstVisibleRow - SCROLL_BUFFER + 1); // Convert to 1-based
        const rowEnd = Math.min(
          metadataRef.current.totalRows,
          lastVisibleRow + SCROLL_BUFFER + 1
        );

        const colStart = 1;
        const colEnd = 100;

        fetchDataWindow(rowStart, rowEnd, colStart, colEnd);
      } catch (error) {
        console.error('Error in scroll handler:', error);
      }
    }, SCROLL_DEBOUNCE_MS);
  }, [fetchDataWindow]);

  /**
   * Handle cell changes - sync to backend
   */
  const handleAfterChange = useCallback((changes, source) => {
    // CRITICAL: Ignore programmatic changes to prevent loops
    if (!changes || source === 'loadData' || source === 'updateData' || source === 'CopyPaste.paste') {
      return;
    }

    if (!workbookId || !hotRef.current?.hotInstance) return;

    // Collect changes
    changes.forEach(([row, col, oldValue, newValue]) => {
      if (oldValue !== newValue) {
        pendingEditsRef.current.push({
          row: row + 1, // Convert to 1-based for backend
          col: col + 1,
          value: newValue
        });
      }
    });

    // Debounce edit sync
    if (pendingEditTimerRef.current) {
      clearTimeout(pendingEditTimerRef.current);
    }

    pendingEditTimerRef.current = setTimeout(async () => {
      const edits = [...pendingEditsRef.current];
      pendingEditsRef.current = [];

      // Sync each edit to backend
      for (const edit of edits) {
        try {
          if (!sheetId) {
            throw new Error('Sheet ID (name) is required for cell updates');
          }
          await updateCell(workbookId, sheetId, edit.row, edit.col, edit.value);
          console.log('✅ Cell synced:', edit);
        } catch (error) {
          console.error('❌ Failed to sync cell:', edit, error);
          // Re-add failed edit to retry queue
          pendingEditsRef.current.push(edit);
        }
      }

      // Notify parent component
      if (onDataChange && edits.length > 0) {
        onDataChange(edits);
      }
    }, EDIT_DEBOUNCE_MS);
  }, [workbookId, sheetId, onDataChange]);

  const flushPendingEdits = useCallback(async () => {
    if (!workbookId) return;
    const edits = [...pendingEditsRef.current];
    pendingEditsRef.current = [];
    for (const edit of edits) {
      try {
        await updateCell(workbookId, sheetId, edit.row, edit.col, edit.value);
      } catch {
        pendingEditsRef.current.push(edit);
      }
    }
  }, [workbookId, sheetId]);

  useEffect(() => {
    const run = async () => {
      if (!workbookId) return;
      await flushPendingEdits();
    };
    if (typeof saveSignal !== 'undefined') {
      run();
    }
  }, [saveSignal, workbookId, flushPendingEdits]);

  /**
   * Initial load - fetch first window
   */
  useEffect(() => {
    if (!workbookId) {
      setData([[]]);
      setLoading(false);
      return;
    }

    workbookIdRef.current = workbookId;

    // Reset state when workbook or sheet changes
    setData([[]]);
    setLoading(true);
    setError(null);
    metadataRef.current = null;
    currentWindowRef.current = { rowStart: 0, rowEnd: 0, colStart: 0, colEnd: 0 };
    loadingRef.current = false;

    // Load initial window
    const loadInitial = async () => {
      if (sheetId) {
        await fetchDataWindow(1, 100, 1, 100, true);
      }
    };

    loadInitial();
  }, [workbookId, sheetId, fetchDataWindow]);

  /**
   * Update Handsontable when data changes
   */
  useEffect(() => {
    if (!hotRef.current?.hotInstance) return;

    const instance = hotRef.current.hotInstance;

    const isValid2DArray = (arr) => {
      if (!Array.isArray(arr) || arr.length === 0) return false;
      const firstRow = arr[0];
      if (!Array.isArray(firstRow) || firstRow.length === 0) return false;
      return true;
    };

    if (!isValid2DArray(data)) {
      return;
    }

    const currentData = instance.getData();
    if (JSON.stringify(currentData) !== JSON.stringify(data)) {
      lastValidDataRef.current = data;
      instance.loadData(data);
      console.log('📊 Data loaded into Handsontable');
    }
  }, [data]);

  // Calculate container height
  const [containerHeight, setContainerHeight] = useState(() =>
    typeof window !== 'undefined' ? window.innerHeight - 120 : 600
  );

  useEffect(() => {
    const handleResize = () => {
      setContainerHeight(window.innerHeight - 120);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Sync proxy horizontal scrollbar with grid holder
  useEffect(() => {
    if (!hotRef.current?.hotInstance || !proxyScrollRef.current) return;
    const instance = hotRef.current.hotInstance;
    const holder = instance.rootElement?.querySelector('.wtHolder');
    if (!holder) return;
    const proxy = proxyScrollRef.current;
    const syncProxyFromGrid = () => {
      proxy.scrollLeft = holder.scrollLeft;
    };
    const syncGridFromProxy = () => {
      holder.scrollLeft = proxy.scrollLeft;
    };
    holder.addEventListener('scroll', syncProxyFromGrid);
    proxy.addEventListener('scroll', syncGridFromProxy);
    // Initialize proxy position
    syncProxyFromGrid();
    return () => {
      holder.removeEventListener('scroll', syncProxyFromGrid);
      proxy.removeEventListener('scroll', syncGridFromProxy);
    };
  }, [data]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (scrollDebounceTimerRef.current) {
        clearTimeout(scrollDebounceTimerRef.current);
      }
      if (pendingEditTimerRef.current) {
        clearTimeout(pendingEditTimerRef.current);
      }
    };
  }, []);

  const displayData = (() => {
    const isValid2DArray = (arr) => {
      if (!Array.isArray(arr) || arr.length === 0) return false;
      const firstRow = arr[0];
      if (!Array.isArray(firstRow) || firstRow.length === 0) return false;
      return true;
    };
    if (isValid2DArray(data)) return data;
    if (isValid2DArray(lastValidDataRef.current)) return lastValidDataRef.current;
    return [[null]];
  })();

  const isFormulaString = useCallback((v) => typeof v === 'string' && v.trim().startsWith('='), []);

  const columnLettersToIndex = useCallback((letters) => {
    const s = String(letters || '').toUpperCase();
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      if (code < 65 || code > 90) return -1;
      n = n * 26 + (code - 64);
    }
    return n;
  }, []);

  const getCellValueByA1 = useCallback((ref) => {
    const m = String(ref || '').trim().match(/^\$?([A-Z]+)\$?(\d+)$/i);
    if (!m) return null;
    const colIndex = columnLettersToIndex(m[1]);
    const rowIndex = parseInt(m[2], 10);
    if (!Number.isFinite(rowIndex) || rowIndex < 1 || colIndex < 1) return null;
    return displayData[rowIndex - 1]?.[colIndex - 1] ?? null;
  }, [displayData, columnLettersToIndex]);

  const splitTopLevelArgs = useCallback((s) => {
    const out = [];
    let depth = 0;
    let inQuotes = false;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '"') inQuotes = !inQuotes;
      if (inQuotes) continue;
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === ',' && depth === 0) {
        out.push(s.slice(start, i).trim());
        start = i + 1;
      }
    }
    out.push(s.slice(start).trim());
    return out.filter(Boolean);
  }, []);

  const findTopLevelOperator = useCallback((s, ops) => {
    let depth = 0;
    let inQuotes = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '"') inQuotes = !inQuotes;
      if (inQuotes) continue;
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      if (depth !== 0) continue;

      for (const op of ops) {
        if (s.slice(i, i + op.length) === op) return { index: i, op };
      }
    }
    return null;
  }, []);

  const evalScalar = useCallback((expr) => {
    const raw = String(expr ?? '').trim();
    if (!raw) return null;
    if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
    if (/^\$?[A-Z]+\$?\d+$/i.test(raw)) return getCellValueByA1(raw);
    const n = Number(raw);
    if (!Number.isNaN(n) && raw !== '') return n;
    return null;
  }, [getCellValueByA1]);

  const evalCondition = useCallback((cond) => {
    const s = String(cond ?? '').trim();
    const opInfo = findTopLevelOperator(s, ['>=', '<=', '<>', '!=', '>', '<', '=']);
    if (!opInfo) return false;
    const left = s.slice(0, opInfo.index).trim();
    const right = s.slice(opInfo.index + opInfo.op.length).trim();
    const lv = evalScalar(left);
    const rv = evalScalar(right);
    const ln = typeof lv === 'number' ? lv : Number(lv);
    const rn = typeof rv === 'number' ? rv : Number(rv);
    const bothNumbers = Number.isFinite(ln) && Number.isFinite(rn);
    const a = bothNumbers ? ln : String(lv ?? '');
    const b = bothNumbers ? rn : String(rv ?? '');

    switch (opInfo.op) {
      case '>': return a > b;
      case '<': return a < b;
      case '>=': return a >= b;
      case '<=': return a <= b;
      case '=': return a === b;
      case '<>':
      case '!=': return a !== b;
      default: return false;
    }
  }, [evalScalar, findTopLevelOperator]);

  const evalRange = useCallback((rangeExpr) => {
    const s = String(rangeExpr ?? '').trim();
    const m = s.match(/^\$?([A-Z]+)\$?(\d+)\s*:\s*\$?([A-Z]+)\$?(\d+)$/i);
    if (!m) return [];
    const c1 = columnLettersToIndex(m[1]);
    const r1 = parseInt(m[2], 10);
    const c2 = columnLettersToIndex(m[3]);
    const r2 = parseInt(m[4], 10);
    if (c1 < 1 || c2 < 1 || !Number.isFinite(r1) || !Number.isFinite(r2)) return [];
    const rowStart = Math.min(r1, r2);
    const rowEnd = Math.max(r1, r2);
    const colStart = Math.min(c1, c2);
    const colEnd = Math.max(c1, c2);
    const out = [];
    for (let r = rowStart; r <= rowEnd; r++) {
      for (let c = colStart; c <= colEnd; c++) {
        const v = displayData[r - 1]?.[c - 1];
        const n = typeof v === 'number' ? v : Number(v);
        if (Number.isFinite(n)) out.push(n);
      }
    }
    return out;
  }, [displayData, columnLettersToIndex]);

  const evaluatePreviewFormula = useCallback((formulaString) => {
    const raw = String(formulaString ?? '').trim();
    if (!raw.startsWith('=')) return null;
    const f = raw.slice(1).trim();
    const upper = f.toUpperCase();

    const parseFuncArgs = (prefix) => {
      if (!upper.startsWith(prefix + '(') || !f.endsWith(')')) return null;
      const inside = f.slice(prefix.length + 1, -1);
      return splitTopLevelArgs(inside);
    };

    const ifArgs = parseFuncArgs('IF');
    if (ifArgs && ifArgs.length >= 2) {
      const cond = ifArgs[0];
      const tExpr = ifArgs[1];
      const fExpr = ifArgs[2] ?? '""';
      const pass = evalCondition(cond);
      const chosen = pass ? tExpr : fExpr;
      if (String(chosen).trim().toUpperCase().startsWith('IF(')) {
        return evaluatePreviewFormula('=' + chosen.trim());
      }
      return evalScalar(chosen);
    }

    const sumArgs = parseFuncArgs('SUM');
    if (sumArgs) {
      let sum = 0;
      let any = false;
      for (const arg of sumArgs) {
        if (arg.includes(':')) {
          const nums = evalRange(arg);
          for (const n of nums) {
            sum += n;
            any = true;
          }
        } else {
          const v = evalScalar(arg);
          const n = typeof v === 'number' ? v : Number(v);
          if (Number.isFinite(n)) {
            sum += n;
            any = true;
          }
        }
      }
      return any ? sum : null;
    }

    const avgArgs = parseFuncArgs('AVERAGE');
    if (avgArgs) {
      let sum = 0;
      let count = 0;
      for (const arg of avgArgs) {
        if (arg.includes(':')) {
          const nums = evalRange(arg);
          for (const n of nums) {
            sum += n;
            count++;
          }
        } else {
          const v = evalScalar(arg);
          const n = typeof v === 'number' ? v : Number(v);
          if (Number.isFinite(n)) {
            sum += n;
            count++;
          }
        }
      }
      return count > 0 ? sum / count : null;
    }

    return null;
  }, [evalCondition, evalRange, evalScalar, splitTopLevelArgs]);

  const formulaAwareRenderer = useCallback((instance, td, row, col, prop, value, cellProperties) => {
    const isFormula = isFormulaString(value);
    if (!isFormula) {
      td.classList.remove('sp-formula-cell');
      td.removeAttribute('title');
      textRenderer(instance, td, row, col, prop, value, cellProperties);
      return td;
    }

    const previewValue = evaluatePreviewFormula(value);
    const displayValue = previewValue === null || previewValue === undefined ? value : previewValue;

    td.classList.add('sp-formula-cell');
    td.setAttribute(
      'title',
      previewValue === null || previewValue === undefined
        ? 'Calculated when opened in Excel'
        : 'Preview value only. Calculated when opened in Excel'
    );

    textRenderer(instance, td, row, col, prop, displayValue, cellProperties);
    return td;
  }, [evaluatePreviewFormula, isFormulaString]);

  if (!workbookId) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        No file selected
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-red-500">
        <p className="mb-2">Error loading spreadsheet:</p>
        <p className="text-sm text-slate-400">{error}</p>
      </div>
    );
  }

  return (
    <div
      id="sheet-container"
      className="w-full"
      style={{
        height: `${containerHeight}px`,
        width: '100%',
        position: 'relative',
        overflowX: 'auto',
        overflowY: 'hidden',
        paddingBottom: '40px',
        paddingTop: '14px',
        minHeight: '400px'
      }}
    >
      {loading && (!data.length || (data.length === 1 && !data[0]?.length)) && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-slate-900/50 z-10">
          <div className="text-slate-500">Loading spreadsheet data...</div>
        </div>
      )}
      <div
        className="text-[11px] text-slate-500 dark:text-slate-400"
        style={{
          position: 'absolute',
          top: '14px',
          right: '10px',
          zIndex: 110,
          background: 'rgba(255,255,255,0.8)',
          padding: '2px 6px',
          borderRadius: '6px',
          border: '1px solid rgba(148,163,184,0.35)',
          backdropFilter: 'blur(6px)'
        }}
        title="SheetPilot stores formulas; Excel calculates them when opened."
      >
        Formulas calculate in Excel
      </div>
      <HotTable
        key={`${workbookId}-${sheetId}`} // Force re-render when workbook or sheet changes
        ref={hotRef}
        data={displayData}
        colHeaders={true}
        rowHeaders={true}
        width="100%"
        height={containerHeight - 14}
        rowHeights={28}
        colWidths={100}
        autoRowSize={false}
        autoColumnSize={false}
        stretchH="none"
        manualRowResize={true}
        manualColumnResize={true}
        renderAllRows={false}
        viewportRowRenderingOffset={SCROLL_BUFFER}
        viewportColumnRenderingOffset={SCROLL_BUFFER}
        licenseKey="non-commercial-and-evaluation"
        themeName="ht-theme-main"
        enterBeginsEditing={true}
        tabMoves={{ row: 0, col: 1 }}
        enterMoves={{ row: 1, col: 0 }}
        cells={(row, col) => {
          const cellMeta = row === 0 ? { readOnly: true } : {};
          const v = displayData?.[row]?.[col];
          if (isFormulaString(v)) {
            cellMeta.renderer = formulaAwareRenderer;
          }
          return cellMeta;
        }}
        afterChange={handleAfterChange}
        afterScrollVertically={requestWindow}
        afterInit={() => {
          console.log('✅ Handsontable initialized');
          if (hotRef.current?.hotInstance) {
            const instance = hotRef.current.hotInstance;
            console.log('Instance info:', {
              rows: instance.countRows(),
              cols: instance.countCols()
            });
          }
        }}
      />
      <div
        ref={proxyScrollRef}
        className="custom-scrollbar"
        style={{
          position: 'absolute',
          top: '0',
          left: '0',
          right: '0',
          height: '12px',
          zIndex: 100,
          overflowX: 'auto',
          overflowY: 'hidden',
        }}
        aria-label="Horizontal scroll"
      >
        <div style={{ width: `${100 * 100}px`, height: '1px' }} />
      </div>
    </div>
  );
};

export default React.memo(Spreadsheet);
