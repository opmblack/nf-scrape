import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Toaster, toast } from 'sonner'
import './App.css'

// ==================== Types ====================
interface NetflixImage {
  __typename: string;
  available: boolean;
  focalPoint: { x: number; y: number } | null;
  height: number;
  key: string;
  status: string;
  url: string;
  width: number;
}

interface ContentAdvisoryReason {
  __typename: string;
  iconId: number;
  level: string;
  text: string;
}

interface ContentAdvisory {
  __typename: string;
  boardId: number;
  boardName: string;
  certificationRatingId: number;
  certificationValue: string;
  i18nReasonsText: string;
  maturityDescription: string;
  maturityLevel: number;
  reasons: ContentAdvisoryReason[];
  videoSpecificRatingReason: string | null;
}

interface TaglineMessage {
  __typename: string;
  ctaMessage?: string | null;
  tagline: string;
  typedClassification: string;
}

interface TextEvidence {
  __typename: string;
  key: string;
  text: string;
}

interface PromoVideo {
  __typename: string;
  computeId: string;
  id: number;
  offset: number;
  video: {
    __typename: string;
    videoId: number;
  };
}

interface NetflixEntity {
  __typename: string;
  videoId: number;
  thumbsRating: string;
  title: string;
  unifiedEntityId: string;
  liveEvent: unknown;
  boxart: NetflixImage;
  boxartHighRes: NetflixImage;
  brandLogoSmall: NetflixImage | null;
  liveNow: unknown;
  storyArt: NetflixImage;
  titleLogoBranded: NetflixImage;
  titleLogoUnbranded: NetflixImage;
  availabilityStartTime: string;
  isAvailable: boolean;
  isPlayable: boolean;
  unplayableCauses: string[];
  bookmark: unknown;
  promoVideo: PromoVideo | null;
  taglineMessages: TaglineMessage[];
  isInPlaylist: boolean;
  isInRemindMeList: boolean;
  playlistActions: string[];
  watchStatus: string;
  runtimeSec: number;
  thumbRating: string;
  contentWarning: string | null;
  textEvidence: TextEvidence[];
  latestYear: number;
  contentAdvisory: ContentAdvisory;
  playbackBadges: string[];
  displayRuntimeSec: number;
  mostLikedMessages: TaglineMessage[];
  badges: string[];
}

interface NetflixResponse {
  data?: {
    unifiedEntities: NetflixEntity[];
  };
  error?: string;
}

interface SearchHistoryItem {
  id: string;
  title: string;
  timestamp: number;
}

interface AnalyticsData {
  totalSearches: number;
  avgResponseTime: number;
  searchTimes: number[];
  recentSearches: { id: string; time: number }[];
}

// ==================== Constants ====================
const STORAGE_KEYS = {
  HISTORY: 'nf-search-history',
  THEME: 'nf-theme',
  ANALYTICS: 'nf-analytics',
};

const MAX_HISTORY = 20;

const QUALITY_CAPABILITIES = [
  { key: 'VIDEO_ULTRA_HD', label: 'Ultra 4K HD' },
  { key: 'VIDEO_HD', label: 'HD' },
  { key: 'VIDEO_SD', label: 'SD' },
  { key: 'VIDEO_DOLBY_VISION', label: 'Dolby Vision' },
  { key: 'VIDEO_HDR10_PLUS', label: 'HDR10+' },
  { key: 'VIDEO_HDR', label: 'HDR' },
  { key: 'AUDIO_DOLBY_ATMOS', label: 'Dolby Atmos' },
  { key: 'AUDIO_SPATIAL', label: 'Spatial Audio' },
  { key: 'AUDIO_FIVE_DOT_ONE', label: '5.1 Dolby' },
  { key: 'OFFLINE_DOWNLOAD_AVAILABLE', label: 'Downloads' },
];

// ==================== Helpers ====================
function formatRuntime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function isFutureDate(dateString: string): boolean {
  return new Date(dateString) > new Date();
}

function getFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function setToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function exportAsJSON(entity: NetflixEntity): string {
  return JSON.stringify(entity, null, 2);
}

function exportAsMarkdown(entity: NetflixEntity): string {
  const badges = entity.playbackBadges || [];
  const qualities = QUALITY_CAPABILITIES
    .filter(cap => badges.includes(cap.key))
    .map(cap => cap.label)
    .join(', ') || 'None';

  return `# ${entity.title} (${entity.latestYear})

## Overview
- **Video ID:** ${entity.videoId}
- **Type:** ${entity.__typename}
- **Runtime:** ${formatRuntime(entity.runtimeSec)}
- **Available:** ${entity.isAvailable ? 'Yes' : 'No'}
- **Release Date:** ${formatDate(entity.availabilityStartTime)}

## Quality
${qualities}

## Content Advisory
- **Rating:** ${entity.contentAdvisory?.certificationValue || 'N/A'}
- **Board:** ${entity.contentAdvisory?.boardName || 'N/A'}
${entity.contentAdvisory?.reasons?.map(r => `- ${r.text}`).join('\n') || ''}

## Tags
${entity.textEvidence?.[0]?.text || 'None'}

---
*Exported from Netflix Metadata Explorer*
`;
}

// ==================== Hooks ====================
function useCountdown(targetDate: string) {
  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft());

  function calculateTimeLeft() {
    const difference = new Date(targetDate).getTime() - new Date().getTime();
    
    if (difference <= 0) {
      return { days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true };
    }

    return {
      days: Math.floor(difference / (1000 * 60 * 60 * 24)),
      hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
      minutes: Math.floor((difference / 1000 / 60) % 60),
      seconds: Math.floor((difference / 1000) % 60),
      isExpired: false,
    };
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);

    return () => clearInterval(timer);
  }, [targetDate]);

  return timeLeft;
}

function useURLState() {
  const getVideoIdFromURL = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('v') || '';
  }, []);

  const setVideoIdToURL = useCallback((videoId: string) => {
    const url = new URL(window.location.href);
    if (videoId) {
      url.searchParams.set('v', videoId);
    } else {
      url.searchParams.delete('v');
    }
    window.history.pushState({}, '', url.toString());
  }, []);

  return { getVideoIdFromURL, setVideoIdToURL };
}

function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = getFromStorage<string>(STORAGE_KEYS.THEME, 'dark');
    return saved === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    setToStorage(STORAGE_KEYS.THEME, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  return { theme, toggleTheme };
}

function useSearchHistory() {
  const [history, setHistory] = useState<SearchHistoryItem[]>(() =>
    getFromStorage(STORAGE_KEYS.HISTORY, [])
  );

  const addToHistory = useCallback((id: string, title: string) => {
    setHistory(prev => {
      const filtered = prev.filter(item => item.id !== id);
      const newItem: SearchHistoryItem = { id, title, timestamp: Date.now() };
      const updated = [newItem, ...filtered].slice(0, MAX_HISTORY);
      setToStorage(STORAGE_KEYS.HISTORY, updated);
      return updated;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setToStorage(STORAGE_KEYS.HISTORY, []);
  }, []);

  return { history, addToHistory, clearHistory };
}

function useAnalytics() {
  const [analytics, setAnalytics] = useState<AnalyticsData>(() =>
    getFromStorage(STORAGE_KEYS.ANALYTICS, {
      totalSearches: 0,
      avgResponseTime: 0,
      searchTimes: [],
      recentSearches: [],
    })
  );

  const trackSearch = useCallback((id: string, responseTime: number) => {
    setAnalytics(prev => {
      const searchTimes = [...prev.searchTimes, responseTime].slice(-50);
      const avgResponseTime = searchTimes.reduce((a, b) => a + b, 0) / searchTimes.length;
      const recentSearches = [{ id, time: responseTime }, ...prev.recentSearches].slice(0, 10);
      
      const updated = {
        totalSearches: prev.totalSearches + 1,
        avgResponseTime: Math.round(avgResponseTime),
        searchTimes,
        recentSearches,
      };
      
      setToStorage(STORAGE_KEYS.ANALYTICS, updated);
      return updated;
    });
  }, []);

  return { analytics, trackSearch };
}

function useKeyboardShortcuts(callbacks: {
  onFocusSearch: () => void;
  onEscape: () => void;
  onToggleTheme: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K to focus search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        callbacks.onFocusSearch();
      }
      // Escape to clear/close
      if (e.key === 'Escape') {
        callbacks.onEscape();
      }
      // Cmd/Ctrl + Shift + L to toggle theme
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        callbacks.onToggleTheme();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [callbacks]);
}

// ==================== Components ====================
function SkeletonLoader() {
  return (
    <div className="skeleton-container">
      <div className="skeleton-header">
        <div className="skeleton skeleton-poster" />
        <div className="skeleton-info">
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-meta" />
          <div className="skeleton skeleton-meta short" />
        </div>
      </div>
      <div className="skeleton-grid">
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card tall" />
      </div>
    </div>
  );
}

function SearchForm({ 
  onSearch, 
  onBatchSearch,
  isLoading, 
  history, 
  inputRef,
  initialValue,
  resetKey,
}: { 
  onSearch: (id: string) => void;
  onBatchSearch: (ids: string[]) => void;
  isLoading: boolean;
  history: SearchHistoryItem[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  initialValue: string;
  resetKey: number;
}) {
  const [videoId, setVideoId] = useState(initialValue);
  const [showHistory, setShowHistory] = useState(false);
  const [isBatchMode, setIsBatchMode] = useState(false);

  useEffect(() => {
    setVideoId(initialValue);
  }, [initialValue]);

  useEffect(() => {
    setVideoId('');
  }, [resetKey]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = videoId.trim();
    if (!trimmed) return;

    if (isBatchMode || trimmed.includes(',')) {
      const ids = trimmed.split(',').map(id => id.trim()).filter(Boolean);
      if (ids.length > 0) {
        onBatchSearch(ids);
      }
    } else {
      onSearch(trimmed);
    }
    setShowHistory(false);
  };

  const handleHistoryClick = (id: string) => {
    setVideoId(id);
    onSearch(id);
    setShowHistory(false);
  };

  const filteredHistory = history.filter(item => 
    item.id.includes(videoId) || item.title.toLowerCase().includes(videoId.toLowerCase())
  );

  return (
    <form onSubmit={handleSubmit} className="search-form">
      <div className="search-container">
        <div className="search-input-wrapper">
          <input
            ref={inputRef}
            type="text"
            value={videoId}
            onChange={(e) => setVideoId(e.target.value)}
            onFocus={() => setShowHistory(true)}
            onBlur={() => setTimeout(() => setShowHistory(false), 200)}
            placeholder={isBatchMode ? "Enter IDs (comma-separated)" : "Enter Netflix Video ID"}
            className="search-input"
            disabled={isLoading}
          />
          <kbd className="search-kbd">Ctrl+K</kbd>
        </div>
        
        <button 
          type="button" 
          className={`batch-toggle ${isBatchMode ? 'active' : ''}`}
          onClick={() => setIsBatchMode(!isBatchMode)}
          title="Toggle batch mode"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
          </svg>
        </button>

        <button type="submit" className="search-button" disabled={isLoading || !videoId.trim()}>
          {isLoading ? (
            <span className="loading-spinner" />
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              Search
            </>
          )}
        </button>

        {showHistory && filteredHistory.length > 0 && (
          <div className="search-history">
            {filteredHistory.map(item => (
              <button
                key={item.id}
                type="button"
                className="history-item"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleHistoryClick(item.id);
                }}
                onClick={() => handleHistoryClick(item.id)}
              >
                <span className="history-id">{item.id}</span>
                <span className="history-title">{item.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </form>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: 'dark' | 'light'; onToggle: () => void }) {
  return (
    <button className="theme-toggle" onClick={onToggle} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
      {theme === 'dark' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="M4.93 4.93l1.41 1.41" />
          <path d="M17.66 17.66l1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="M4.93 19.07l1.41-1.41" />
          <path d="M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.5a9 9 0 1 1-9.5-9.5A7 7 0 0 0 21 12.5z" />
        </svg>
      )}
    </button>
  );
}

function AnalyticsPanel({ analytics, onClose }: { analytics: AnalyticsData; onClose: () => void }) {
  return (
    <div className="analytics-panel">
      <div className="analytics-header">
        <h3>Analytics</h3>
        <button className="close-btn" onClick={onClose} title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="analytics-grid">
        <div className="analytics-stat">
          <span className="stat-value">{analytics.totalSearches}</span>
          <span className="stat-label">Total Searches</span>
        </div>
        <div className="analytics-stat">
          <span className="stat-value">{analytics.avgResponseTime}ms</span>
          <span className="stat-label">Avg Response</span>
        </div>
      </div>
      {analytics.recentSearches.length > 0 && (
        <div className="analytics-recent">
          <h4>Recent Queries</h4>
          {analytics.recentSearches.map((s, i) => (
            <div key={i} className="recent-item">
              <span className="recent-id">{s.id}</span>
              <span className="recent-time">{s.time}ms</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RateLimitIndicator({ remaining, limit }: { remaining: number; limit: number }) {
  const percentage = (remaining / limit) * 100;
  const isLow = percentage < 20;

  return (
    <div className={`rate-limit ${isLow ? 'low' : ''}`}>
      <div className="rate-limit-bar">
        <div className="rate-limit-fill" style={{ width: `${percentage}%` }} />
      </div>
      <span className="rate-limit-text">{remaining}/{limit} requests</span>
    </div>
  );
}

function Lightbox({ image, onClose }: { image: { url: string; label: string }; onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="lightbox" onClick={onClose}>
      <button className="lightbox-close" title="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18" />
          <path d="M6 6l12 12" />
        </svg>
      </button>
      <div className="lightbox-content" onClick={e => e.stopPropagation()}>
        <img src={image.url} alt={image.label} />
        <p className="lightbox-label">{image.label}</p>
      </div>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const handleCopy = async () => {
    const success = await copyToClipboard(text);
    if (success) {
      toast.success(`${label} copied to clipboard`);
    } else {
      toast.error('Failed to copy');
    }
  };

  return (
    <button className="copy-btn" onClick={handleCopy} title={`Copy ${label}`}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    </button>
  );
}

function ExportMenu({ entity, onClose }: { entity: NetflixEntity; onClose: () => void }) {
  const handleExport = async (type: 'json' | 'markdown') => {
    const content = type === 'json' ? exportAsJSON(entity) : exportAsMarkdown(entity);
    const success = await copyToClipboard(content);
    if (success) {
      toast.success(`Exported as ${type.toUpperCase()}`);
    } else {
      toast.error('Failed to export');
    }
    onClose();
  };

  const handleShare = async () => {
    const url = `${window.location.origin}?v=${entity.videoId}`;
    const success = await copyToClipboard(url);
    if (success) {
      toast.success('Share link copied');
    }
    onClose();
  };

  return (
    <div className="export-menu" onClick={e => e.stopPropagation()}>
      <button onClick={() => handleExport('json')}>
        <svg className="menu-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
        Export JSON
      </button>
      <button onClick={() => handleExport('markdown')}>
        <svg className="menu-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20V4" />
          <path d="M4 4h8l4 4h4v12" />
        </svg>
        Export Markdown
      </button>
      <button onClick={handleShare}>
        <svg className="menu-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <path d="M12 16V2" />
          <path d="m16 6-4-4-4 4" />
        </svg>
        Copy Share Link
      </button>
    </div>
  );
}

function CountdownTimer({ targetDate }: { targetDate: string }) {
  const { days, hours, minutes, seconds, isExpired } = useCountdown(targetDate);

  if (isExpired) return null;

  return (
    <div className="countdown-container">
      <div className="countdown-label">Available in</div>
      <div className="countdown-timer">
        <div className="countdown-unit">
          <span className="countdown-value">{String(days).padStart(2, '0')}</span>
          <span className="countdown-text">days</span>
        </div>
        <span className="countdown-separator">:</span>
        <div className="countdown-unit">
          <span className="countdown-value">{String(hours).padStart(2, '0')}</span>
          <span className="countdown-text">hrs</span>
        </div>
        <span className="countdown-separator">:</span>
        <div className="countdown-unit">
          <span className="countdown-value">{String(minutes).padStart(2, '0')}</span>
          <span className="countdown-text">min</span>
        </div>
        <span className="countdown-separator">:</span>
        <div className="countdown-unit">
          <span className="countdown-value">{String(seconds).padStart(2, '0')}</span>
          <span className="countdown-text">sec</span>
        </div>
      </div>
    </div>
  );
}

function AvailabilityBadge({ isAvailable, typename }: { isAvailable: boolean; typename: string }) {
  return (
    <span className={`availability-badge ${isAvailable ? 'available' : 'unavailable'}`}>
      {typename} • {isAvailable ? 'Available' : 'Unavailable'}
    </span>
  );
}

function TitleHeader({ entity, onExport }: { entity: NetflixEntity; onExport: () => void }) {
  const isFuture = isFutureDate(entity.availabilityStartTime);

  return (
    <div className="title-header">
      <div className="title-poster">
        <img 
          src={entity.boxartHighRes?.url || entity.boxart?.url} 
          alt={entity.title}
        />
      </div>
      
      <div className="title-info">
        <div className="title-top-row">
          <h1 className="title-name">
            {entity.title} <span className="title-year">({entity.latestYear})</span>
          </h1>
          <div className="title-actions">
            <AvailabilityBadge isAvailable={entity.isAvailable} typename={entity.__typename} />
            <button className="export-btn" onClick={onExport} title="Export / Share">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <path d="M12 16V2" />
                <path d="m16 6-4-4-4 4" />
              </svg>
            </button>
          </div>
        </div>

        {isFuture && <CountdownTimer targetDate={entity.availabilityStartTime} />}

        <div className="title-meta-grid">
          <div className="meta-item">
            <span className="meta-label">Title ID</span>
            <span className="meta-value">
              {entity.videoId}
              <CopyButton text={String(entity.videoId)} label="ID" />
            </span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Runtime</span>
            <span className="meta-value">{formatRuntime(entity.runtimeSec)}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Release Date</span>
            <span className="meta-value">{formatDate(entity.availabilityStartTime)}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Maturity</span>
            <span className="meta-value">{entity.contentAdvisory?.certificationValue || '—'}</span>
          </div>
        </div>

        {entity.taglineMessages?.[0] && (
          <p className="title-tagline">{entity.taglineMessages[0].tagline}</p>
        )}
      </div>
    </div>
  );
}

function QualityCapabilities({ badges }: { badges: string[] }) {
  return (
    <div className="section-card">
      <h2 className="section-title">Title Info</h2>
      <div className="capabilities-grid">
        {QUALITY_CAPABILITIES.map((cap) => {
          const isEnabled = badges.includes(cap.key);
          return (
            <div key={cap.key} className="capability-row">
              <span className="capability-label">{cap.label}</span>
              <span className={`capability-badge ${isEnabled ? 'true' : 'false'}`}>
                {isEnabled ? 'TRUE' : 'FALSE'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ContentWarnings({ advisory }: { advisory: ContentAdvisory }) {
  if (!advisory?.reasons?.length) return null;

  return (
    <div className="section-card">
      <h2 className="section-title">Content Warnings</h2>
      <div className="warnings-container">
        <div className="maturity-badge">
          <span className="maturity-value">{advisory.certificationValue}</span>
          <span className="maturity-board">{advisory.boardName}</span>
        </div>
        <div className="warnings-list">
          {advisory.reasons.map((reason, idx) => (
            <span key={idx} className="warning-tag">{reason.text}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function GenreTags({ textEvidence }: { textEvidence: TextEvidence[] }) {
  if (!textEvidence?.length) return null;
  
  const tags = textEvidence[0]?.text.split(', ') || [];
  
  return (
    <div className="section-card">
      <h2 className="section-title">Genres & Tags</h2>
      <div className="tags-grid">
        {tags.map((tag, idx) => (
          <span key={idx} className="genre-tag">{tag}</span>
        ))}
      </div>
    </div>
  );
}

function ArtworkGallery({ entity, onImageClick }: { entity: NetflixEntity; onImageClick: (img: { url: string; label: string }) => void }) {
  const images = [
    { label: 'Box Art', image: entity.boxart },
    { label: 'Box Art HD', image: entity.boxartHighRes },
    { label: 'Story Art', image: entity.storyArt },
    { label: 'Logo Branded', image: entity.titleLogoBranded },
    { label: 'Logo Unbranded', image: entity.titleLogoUnbranded },
  ].filter(item => item.image?.available);

  return (
    <div className="section-card">
      <h2 className="section-title">Artwork</h2>
      <div className="artwork-grid">
        {images.map((item, idx) => (
          <button 
            key={idx}
            className="artwork-item"
            onClick={() => onImageClick({ url: item.image.url, label: item.label })}
          >
            <img src={item.image.url} alt={item.label} loading="lazy" />
            <div className="artwork-overlay">
              <span className="artwork-label">{item.label}</span>
              <span className="artwork-size">{item.image.width}×{item.image.height}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function TechnicalInfo({ entity }: { entity: NetflixEntity }) {
  const details = [
    { label: 'Video ID', value: entity.videoId, mono: true },
    { label: 'Entity ID', value: entity.unifiedEntityId, mono: true },
    { label: 'Type', value: entity.__typename },
    { label: 'Runtime (sec)', value: entity.runtimeSec },
    { label: 'Maturity Level', value: entity.contentAdvisory?.maturityLevel },
    { label: 'Watch Status', value: entity.watchStatus.replace(/_/g, ' ') },
    { label: 'In My List', value: entity.isInPlaylist ? 'Yes' : 'No' },
    { label: 'Promo Video', value: entity.promoVideo?.id || '—', mono: !!entity.promoVideo },
  ];

  return (
    <div className="section-card">
      <h2 className="section-title">Technical</h2>
      <div className="technical-grid">
        {details.map((item, idx) => (
          <div key={idx} className="technical-item">
            <span className="technical-label">{item.label}</span>
            <span className={`technical-value ${item.mono ? 'mono' : ''}`}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ComparisonView({ entities, onClose }: { entities: NetflixEntity[]; onClose: () => void }) {
  return (
    <div className="comparison-view">
      <div className="comparison-header">
        <h2>Comparison Mode</h2>
        <div className="comparison-actions">
          <button className="back-btn" onClick={onClose} title="Back to search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back
          </button>
          <button className="close-btn" onClick={onClose} title="Close comparison">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div className="comparison-grid">
        {entities.map((entity, idx) => (
          <div key={idx} className="comparison-card">
            <img src={entity.boxartHighRes?.url || entity.boxart?.url} alt={entity.title} />
            <h3>{entity.title}</h3>
            <div className="comparison-details">
              <div className="comparison-row">
                <span>Year</span>
                <span>{entity.latestYear}</span>
              </div>
              <div className="comparison-row">
                <span>Runtime</span>
                <span>{formatRuntime(entity.runtimeSec)}</span>
              </div>
              <div className="comparison-row">
                <span>Rating</span>
                <span>{entity.contentAdvisory?.certificationValue || '—'}</span>
              </div>
              <div className="comparison-row">
                <span>4K</span>
                <span>{entity.playbackBadges.includes('VIDEO_ULTRA_HD') ? 'Yes' : 'No'}</span>
              </div>
              <div className="comparison-row">
                <span>HDR</span>
                <span>{entity.playbackBadges.includes('VIDEO_HDR') ? 'Yes' : 'No'}</span>
              </div>
              <div className="comparison-row">
                <span>Atmos</span>
                <span>{entity.playbackBadges.includes('AUDIO_DOLBY_ATMOS') ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetadataDisplay({ 
  entity, 
  onImageClick,
  onExport,
}: { 
  entity: NetflixEntity;
  onImageClick: (img: { url: string; label: string }) => void;
  onExport: () => void;
}) {
  return (
    <div className="metadata-display">
      <TitleHeader entity={entity} onExport={onExport} />
      
      <div className="content-layout">
        <div className="content-main">
          <QualityCapabilities badges={entity.playbackBadges} />
          <ContentWarnings advisory={entity.contentAdvisory} />
          <GenreTags textEvidence={entity.textEvidence} />
        </div>
        
        <div className="content-sidebar">
          <TechnicalInfo entity={entity} />
          <ArtworkGallery entity={entity} onImageClick={onImageClick} />
        </div>
      </div>
    </div>
  );
}

function ErrorDisplay({ message }: { message: string }) {
  return (
    <div className="error-display">
      <div className="error-icon">!</div>
      <h2>Something went wrong</h2>
      <p>{message}</p>
      <p className="error-hint">Check the Video ID and try again.</p>
    </div>
  );
}

function EmptyState({ onExampleClick }: { onExampleClick: (id: string) => void }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">N</div>
      <h2>Netflix Metadata Explorer</h2>
      <p>Enter a Netflix Video ID to explore detailed metadata, quality info, and artwork.</p>
      <p className="empty-subtext">Supports batch comparisons, shareable links, and export tools.</p>
      <div className="example-ids">
        <span className="example-label">Try:</span>
        <button onClick={() => onExampleClick('82156122')}>82156122</button>
        <button onClick={() => onExampleClick('81767635')}>81767635</button>
        <button onClick={() => onExampleClick('80057281')}>80057281</button>
      </div>
      <div className="shortcuts-hint">
        <span><kbd>Ctrl</kbd>+<kbd>K</kbd> Focus search</span>
        <span><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> Toggle theme</span>
        <span><kbd>Esc</kbd> Clear</span>
      </div>
    </div>
  );
}

// ==================== Main App ====================
function App() {
  const [data, setData] = useState<NetflixResponse | null>(null);
  const [comparisonData, setComparisonData] = useState<NetflixEntity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; label: string } | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [rateLimit, setRateLimit] = useState({ remaining: 100, limit: 100 });
  const [resetCount, setResetCount] = useState(0);
  const [showBackToTop, setShowBackToTop] = useState(false);
  
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  const { theme, toggleTheme } = useTheme();
  const { getVideoIdFromURL, setVideoIdToURL } = useURLState();
  const { history, addToHistory, clearHistory } = useSearchHistory();
  const { analytics, trackSearch } = useAnalytics();

  const initialVideoId = useMemo(() => getVideoIdFromURL(), [getVideoIdFromURL]);

  const handleSearch = useCallback(async (videoId: string) => {
    setIsLoading(true);
    setError(null);
    setData(null);
    setComparisonData([]);
    setVideoIdToURL(videoId);

    const startTime = performance.now();

    try {
      const response = await fetch(`/api/metadata?videoId=${videoId}`);
      
      // Track rate limiting from headers if available
      const remaining = response.headers.get('X-RateLimit-Remaining');
      const limit = response.headers.get('X-RateLimit-Limit');
      if (remaining && limit) {
        setRateLimit({ remaining: parseInt(remaining), limit: parseInt(limit) });
      }

      const result = await response.json() as NetflixResponse;
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch metadata');
      }
      
      if (!result.data?.unifiedEntities?.length) {
        throw new Error('No content found for this Video ID');
      }
      
      const entity = result.data.unifiedEntities[0];
      addToHistory(videoId, entity.title);
      
      const responseTime = Math.round(performance.now() - startTime);
      trackSearch(videoId, responseTime);
      
      setData(result);
      toast.success(`Found: ${entity.title}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [setVideoIdToURL, addToHistory, trackSearch]);

  const handleBatchSearch = useCallback(async (ids: string[]) => {
    setIsLoading(true);
    setError(null);
    setData(null);
    setComparisonData([]);

    const startTime = performance.now();
    const entities: NetflixEntity[] = [];

    try {
      for (const id of ids.slice(0, 4)) { // Limit to 4 for comparison
        const response = await fetch(`/api/metadata?videoId=${id}`);
        const result = await response.json() as NetflixResponse;
        
        if (result.data?.unifiedEntities?.[0]) {
          entities.push(result.data.unifiedEntities[0]);
        }
      }

      if (entities.length === 0) {
        throw new Error('No content found for any of the provided IDs');
      }

      const responseTime = Math.round(performance.now() - startTime);
      trackSearch(ids.join(','), responseTime);

      setComparisonData(entities);
      toast.success(`Comparing ${entities.length} titles`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Batch search failed';
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [trackSearch]);

  const handleBack = useCallback(() => {
    setData(null);
    setComparisonData([]);
    setError(null);
    setLightboxImage(null);
    setShowExportMenu(false);
    setVideoIdToURL('');
    setResetCount(prev => prev + 1);
  }, [setVideoIdToURL]);

  // Load initial video from URL
  useEffect(() => {
    if (initialVideoId) {
      handleSearch(initialVideoId);
    }
  }, [initialVideoId, handleSearch]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onFocusSearch: () => searchInputRef.current?.focus(),
    onEscape: () => {
      setLightboxImage(null);
      setShowExportMenu(false);
      setShowAnalytics(false);
      if (document.activeElement === searchInputRef.current) {
        searchInputRef.current?.blur();
      }
    },
    onToggleTheme: toggleTheme,
  });

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 300);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const entity = data?.data?.unifiedEntities?.[0];

  return (
    <div className="app">
      <Toaster 
        position="bottom-right" 
        theme={theme}
        toastOptions={{
          style: {
            background: theme === 'dark' ? '#1a1a1f' : '#ffffff',
            border: '1px solid rgba(255,255,255,0.1)',
          },
        }}
      />

      <header className="app-header">
        <div className="header-content">
          <div className="logo">
            <span className="logo-n">N</span>
            <span className="logo-text">Metadata</span>
          </div>
          
          <SearchForm 
            onSearch={handleSearch}
            onBatchSearch={handleBatchSearch}
            isLoading={isLoading}
            history={history}
            inputRef={searchInputRef}
            initialValue={initialVideoId}
            resetKey={resetCount}
          />
          
          <div className="header-actions">
            <RateLimitIndicator remaining={rateLimit.remaining} limit={rateLimit.limit} />
            
            <button 
              className="icon-btn" 
              onClick={() => setShowAnalytics(!showAnalytics)}
              title="Analytics"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 20V10" />
                <path d="M12 20V4" />
                <path d="M18 20v-6" />
              </svg>
            </button>
            
            <button 
              className="icon-btn" 
              onClick={clearHistory}
              title="Clear history"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
              </svg>
            </button>
            
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </div>
        <div className="header-hints">
          <span><kbd>Ctrl</kbd>+<kbd>K</kbd> Focus</span>
          <span><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> Theme</span>
          <span><kbd>Esc</kbd> Clear</span>
        </div>
      </header>

      {showAnalytics && (
        <AnalyticsPanel analytics={analytics} onClose={() => setShowAnalytics(false)} />
      )}

      <main className="app-main">
        {error && <ErrorDisplay message={error} />}
        {!error && !data && !isLoading && comparisonData.length === 0 && (
          <EmptyState onExampleClick={handleSearch} />
        )}
        {isLoading && <SkeletonLoader />}
        {!isLoading && (entity || comparisonData.length > 0) && (
          <div className="back-row">
            <button className="back-btn" onClick={handleBack} title="Back to search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Back to search
            </button>
          </div>
        )}
        {comparisonData.length > 0 && (
          <ComparisonView entities={comparisonData} onClose={() => setComparisonData([])} />
        )}
        {entity && !comparisonData.length && (
          <MetadataDisplay 
            entity={entity}
            onImageClick={setLightboxImage}
            onExport={() => setShowExportMenu(true)}
          />
        )}
      </main>

      {lightboxImage && (
        <Lightbox image={lightboxImage} onClose={() => setLightboxImage(null)} />
      )}

      {showExportMenu && entity && (
        <div className="modal-backdrop" onClick={() => setShowExportMenu(false)}>
          <ExportMenu entity={entity} onClose={() => setShowExportMenu(false)} />
        </div>
      )}

      {showBackToTop && (
        <button
          className="back-to-top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          title="Back to top"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5" />
            <path d="m6 11 6-6 6 6" />
          </svg>
          Top
        </button>
      )}

      <footer className="app-footer">
        <p>Built with Cloudflare Workers • Not affiliated with Netflix</p>
      </footer>
    </div>
  );
}

export default App
