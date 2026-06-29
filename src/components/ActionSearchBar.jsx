import { MapPin, Navigation, Search, Send } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useDebounce from '../hooks/useDebounce';
import './ActionSearchBar.css';

const ANIMATION_VARIANTS = {
  container: {
    hidden: { opacity: 0, height: 0 },
    show: {
      opacity: 1,
      height: 'auto',
      transition: { height: { duration: 0.4 }, staggerChildren: 0.05 },
    },
    exit: {
      opacity: 0,
      height: 0,
      transition: { height: { duration: 0.3 }, opacity: { duration: 0.2 } },
    },
  },
  item: {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { duration: 0.2 } },
    exit: { opacity: 0, y: -8, transition: { duration: 0.15 } },
  },
};

/**
 * ActionSearchBar for ParkFasto Dashboard
 * Props:
 *  - parkingLots: array of lot objects { _id, name, lat, lon, pricePerHour, totalSpots, occupiedSpots }
 *  - onSelectLot(lot): called when user picks a parking lot suggestion
 *  - onSelectPlace({ label, lat, lon }): called when user picks a place suggestion
 *  - onSearch(query): called on Enter when no suggestion selected (fallback)
 */
export default function ActionSearchBar({ parkingLots = [], onSelectLot, onSelectPlace, onSearch, inputRef }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isFocused, setIsFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debouncedQuery = useDebounce(query, 250);
  const containerRef = useRef(null);

  // Local lot matches
  const localMatches = useMemo(() => {
    if (!debouncedQuery.trim()) return [];
    const lower = debouncedQuery.toLowerCase();
    return parkingLots
      .filter((l) => l.name?.toLowerCase().includes(lower))
      .slice(0, 3)
      .map((l) => ({
        id: `lot-${l._id}`,
        type: 'lot',
        label: l.name,
        description: `NPR ${l.pricePerHour}/hr · ${(l.totalSpots || 0) - (l.occupiedSpots || 0)} spots free`,
        icon: <MapPin size={15} color="#6366f1" />,
        end: 'Parking Lot',
        raw: l,
      }));
  }, [debouncedQuery, parkingLots]);

  // Nominatim place suggestions
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(debouncedQuery + ', Nepal')}&limit=4`
        );
        const places = await res.json();
        if (cancelled) return;
        const placeSuggestions = places.map((p) => ({
          id: `place-${p.place_id}`,
          type: 'place',
          label: p.display_name.split(',').slice(0, 2).join(','),
          description: p.display_name.split(',').slice(2, 4).join(',').trim(),
          icon: <Navigation size={15} color="#10b981" />,
          end: 'Place',
          raw: { label: p.display_name, lat: parseFloat(p.lat), lon: parseFloat(p.lon) },
        }));

        // Merge: lots first, then places, dedupe by label
        const seen = new Set();
        const merged = [...localMatches, ...placeSuggestions].filter((s) => {
          if (seen.has(s.label)) return false;
          seen.add(s.label);
          return true;
        });
        setSuggestions(merged.slice(0, 6));
      } catch {
        if (!cancelled) setSuggestions(localMatches);
      }
    })();

    return () => { cancelled = true; };
  }, [debouncedQuery, localMatches]);

  // Reset active index when suggestions change
  useEffect(() => { setActiveIndex(-1); }, [suggestions]);

  const handleSelect = useCallback(
    (item) => {
      setQuery(item.label);
      setIsFocused(false);
      if (item.type === 'lot') onSelectLot?.(item.raw);
      else onSelectPlace?.(item.raw);
    },
    [onSelectLot, onSelectPlace]
  );

  const handleKeyDown = useCallback(
    (e) => {
      if (!suggestions.length) {
        if (e.key === 'Enter' && query.trim()) onSearch?.(query);
        return;
      }
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((p) => (p < suggestions.length - 1 ? p + 1 : 0));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((p) => (p > 0 ? p - 1 : suggestions.length - 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (activeIndex >= 0) handleSelect(suggestions[activeIndex]);
          else if (query.trim()) onSearch?.(query);
          break;
        case 'Escape':
          setIsFocused(false);
          break;
      }
    },
    [suggestions, activeIndex, query, handleSelect, onSearch]
  );

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsFocused(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, []);

  const showDropdown = isFocused && suggestions.length > 0;

  return (
    <div className="asb-wrapper" ref={containerRef}>
      <div className="asb-input-row">
        <input
          ref={inputRef}
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          autoComplete="off"
          className="asb-input"
          onBlur={() => setTimeout(() => setIsFocused(false), 150)}
          onChange={(e) => { setQuery(e.target.value); setIsFocused(true); }}
          onFocus={() => setIsFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search location in Nepal..."
          role="combobox"
          type="text"
          value={query}
        />
        <span className="asb-icon" aria-hidden="true">
          <AnimatePresence mode="popLayout">
            {query.length > 0 ? (
              <motion.span
                key="send"
                initial={{ y: -14, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 14, opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <Send size={16} />
              </motion.span>
            ) : (
              <motion.span
                key="search"
                initial={{ y: -14, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 14, opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <Search size={16} />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        <kbd className="asb-kbd" aria-hidden="true">⌘ K</kbd>
      </div>

      <AnimatePresence>
        {showDropdown && (
          <motion.div
            className="asb-dropdown"
            variants={ANIMATION_VARIANTS.container}
            initial="hidden"
            animate="show"
            exit="exit"
            role="listbox"
          >
            <motion.ul role="none">
              {suggestions.map((item, idx) => (
                <motion.li
                  key={item.id}
                  className={`asb-item${activeIndex === idx ? ' asb-item--active' : ''}`}
                  role="option"
                  aria-selected={activeIndex === idx}
                  variants={ANIMATION_VARIANTS.item}
                  layout
                  onMouseDown={() => handleSelect(item)}
                >
                  <div className="asb-item-left">
                    <span className="asb-item-icon" aria-hidden="true">{item.icon}</span>
                    <span className="asb-item-label">{item.label}</span>
                    {item.description && (
                      <span className="asb-item-desc">{item.description}</span>
                    )}
                  </div>
                  <span className="asb-item-end">{item.end}</span>
                </motion.li>
              ))}
            </motion.ul>
            <div className="asb-footer">
              <span>↑↓ navigate</span>
              <span>ESC to close</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
