import React, { useState, useCallback } from 'react';
import type { JLCPCBPart, Point } from '../../core/types';
import { searchByText, searchParts, searchResistors, searchCapacitors } from '../../parts/jlcpcb-api';

interface Props {
  onPlacePart: (part: JLCPCBPart, position: Point) => void;
}

export function PartsPanel({ onPlacePart }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<JLCPCBPart[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'basic' | 'preferred'>('all');
  const [inStockOnly, setInStockOnly] = useState(true);
  const [selectedPart, setSelectedPart] = useState<JLCPCBPart | null>(null);

  const search = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      let parts = await searchByText(query.trim(), 50);

      if (inStockOnly) parts = parts.filter(p => p.stock > 0);
      if (filter === 'basic') parts = parts.filter(p => p.isBasic);
      if (filter === 'preferred') parts = parts.filter(p => p.isPreferred);

      setResults(parts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    }
    setLoading(false);
  }, [query, filter, inStockOnly]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') search();
  }, [search]);

  const placePart = useCallback((part: JLCPCBPart) => {
    // Place at center of visible area (will be adjusted by editor)
    onPlacePart(part, { x: 400, y: 300 });
  }, [onPlacePart]);

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <h3 style={styles.title}>JLCPCB Parts</h3>
      </div>

      <div style={styles.searchRow}>
        <input
          style={styles.input}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search parts (e.g., STM32, 10k resistor)"
        />
        <button style={styles.btn} onClick={search} disabled={loading}>
          {loading ? '...' : 'Search'}
        </button>
      </div>

      <div style={styles.filterRow}>
        <label style={styles.filterLabel}>
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={e => setInStockOnly(e.target.checked)}
          />
          In Stock
        </label>
        <select
          style={styles.select}
          value={filter}
          onChange={e => setFilter(e.target.value as typeof filter)}
        >
          <option value="all">All Parts</option>
          <option value="basic">Basic Only</option>
          <option value="preferred">Preferred Only</option>
        </select>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.resultsList}>
        {results.map(part => (
          <div
            key={part.lcsc}
            style={{
              ...styles.partCard,
              ...(selectedPart?.lcsc === part.lcsc ? styles.partCardSelected : {}),
            }}
            onClick={() => setSelectedPart(part)}
            onDoubleClick={() => placePart(part)}
          >
            <div style={styles.partHeader}>
              <span style={styles.partLcsc}>{part.lcsc}</span>
              {part.isBasic && <span style={styles.badgeBasic}>Basic</span>}
              {part.isPreferred && <span style={styles.badgePref}>Preferred</span>}
            </div>
            <div style={styles.partDesc}>{part.description}</div>
            <div style={styles.partMeta}>
              <span>{part.package}</span>
              <span style={part.stock > 0 ? styles.inStock : styles.outStock}>
                {part.stock > 0 ? `${part.stock.toLocaleString()} in stock` : 'Out of stock'}
              </span>
              <span style={styles.price}>${part.price.toFixed(4)}</span>
            </div>
            <div style={styles.partMfr}>{part.mfr}</div>
          </div>
        ))}
        {results.length === 0 && !loading && (
          <div style={styles.empty}>
            Search for JLCPCB parts to get started.
            <br /><br />
            Try: "STM32F103", "0805 10k", "100nF capacitor", "AMS1117-3.3"
          </div>
        )}
      </div>

      {selectedPart && (
        <div style={styles.detailPanel}>
          <h4 style={styles.detailTitle}>{selectedPart.lcsc} - {selectedPart.mfr}</h4>
          <p style={styles.detailDesc}>{selectedPart.description}</p>
          <table style={styles.detailTable}>
            <tbody>
              <tr><td style={styles.detailKey}>Package:</td><td>{selectedPart.package}</td></tr>
              <tr><td style={styles.detailKey}>Stock:</td><td>{selectedPart.stock.toLocaleString()}</td></tr>
              <tr><td style={styles.detailKey}>Price:</td><td>${selectedPart.price.toFixed(4)}</td></tr>
              <tr><td style={styles.detailKey}>Category:</td><td>{selectedPart.category}</td></tr>
              <tr><td style={styles.detailKey}>Type:</td><td>{selectedPart.isBasic ? 'Basic' : selectedPart.isPreferred ? 'Preferred' : 'Extended'}</td></tr>
            </tbody>
          </table>
          <button
            style={styles.placeBtn}
            onClick={() => placePart(selectedPart)}
          >
            Place on Schematic
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#1a1a2e',
    color: '#ccccee',
    fontSize: 13,
  },
  header: {
    padding: '8px 12px',
    borderBottom: '1px solid #303060',
  },
  title: {
    margin: 0,
    fontSize: 14,
    color: '#66aaff',
  },
  searchRow: {
    display: 'flex',
    padding: '8px',
    gap: 4,
  },
  input: {
    flex: 1,
    padding: '6px 8px',
    background: '#252545',
    border: '1px solid #404080',
    borderRadius: 4,
    color: '#ccccee',
    fontSize: 12,
    outline: 'none',
  },
  btn: {
    padding: '6px 12px',
    background: '#4466aa',
    border: 'none',
    borderRadius: 4,
    color: '#fff',
    cursor: 'pointer',
    fontSize: 12,
  },
  filterRow: {
    display: 'flex',
    padding: '0 8px 8px',
    gap: 8,
    alignItems: 'center',
  },
  filterLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
  },
  select: {
    padding: '3px 6px',
    background: '#252545',
    border: '1px solid #404080',
    borderRadius: 3,
    color: '#ccccee',
    fontSize: 11,
  },
  error: {
    padding: '4px 8px',
    color: '#ff6666',
    fontSize: 11,
  },
  resultsList: {
    flex: 1,
    overflow: 'auto',
    padding: '0 8px',
  },
  partCard: {
    padding: '8px',
    marginBottom: 4,
    background: '#252545',
    borderRadius: 4,
    cursor: 'pointer',
    border: '1px solid transparent',
  },
  partCardSelected: {
    border: '1px solid #4466aa',
    background: '#2a2a5e',
  },
  partHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  partLcsc: {
    fontWeight: 'bold',
    color: '#66aaff',
    fontSize: 12,
  },
  badgeBasic: {
    padding: '1px 4px',
    background: '#2a6a2a',
    borderRadius: 3,
    fontSize: 10,
    color: '#88ff88',
  },
  badgePref: {
    padding: '1px 4px',
    background: '#6a6a2a',
    borderRadius: 3,
    fontSize: 10,
    color: '#ffff88',
  },
  partDesc: {
    fontSize: 11,
    color: '#aaaacc',
    marginBottom: 4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  partMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    color: '#888',
  },
  partMfr: {
    fontSize: 10,
    color: '#666',
    marginTop: 2,
  },
  inStock: { color: '#66cc66' },
  outStock: { color: '#cc6666' },
  price: { color: '#ffaa66' },
  empty: {
    padding: 16,
    textAlign: 'center',
    color: '#666',
    fontSize: 12,
    lineHeight: 1.5,
  },
  detailPanel: {
    padding: 12,
    borderTop: '1px solid #303060',
    background: '#202040',
  },
  detailTitle: {
    margin: '0 0 8px',
    fontSize: 13,
    color: '#66aaff',
  },
  detailDesc: {
    fontSize: 11,
    color: '#aaa',
    margin: '0 0 8px',
  },
  detailTable: {
    width: '100%',
    fontSize: 11,
    marginBottom: 8,
  },
  detailKey: {
    color: '#888',
    paddingRight: 8,
    whiteSpace: 'nowrap',
  },
  placeBtn: {
    width: '100%',
    padding: '8px',
    background: '#44aa44',
    border: 'none',
    borderRadius: 4,
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 'bold',
    fontSize: 12,
  },
};
