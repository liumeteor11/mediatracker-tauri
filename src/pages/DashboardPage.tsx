import React, { useMemo, useState } from 'react';
import { useCollectionStore } from '../store/useCollectionStore';
import { useThemeStore } from '../store/useThemeStore';
import { AIConfigPanel } from '../components/AIConfigPanel';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { CollectionCategory, MediaType } from '../types/types';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Bell, RefreshCw } from 'lucide-react';
import { useAIStore } from '../store/useAIStore';
import { toast } from 'react-toastify';
import { checkUpdates, testAuthoritativeDomain } from '../services/aiService';
import { AIIOLogEntry } from '../types/types';

// Helper to get colors from CSS variables would be ideal, but for now we can use a map or just standard colors that work on both
// or rely on the fact that we can pass CSS variables to some SVG props.
// Recharts 2.x+ generally supports CSS variables in string props.

export const DashboardPage: React.FC = () => {
  const { getStats, collection, updateItem } = useCollectionStore();
  const { theme } = useThemeStore();
  const { t } = useTranslation();
  const stats = getStats();
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const lastSearchDurationMs = useAIStore(s => s.lastSearchDurationMs);
  const lastSearchAt = useAIStore(s => s.lastSearchAt);
  const lastSearchQuery = useAIStore(s => s.lastSearchQuery);
  const logs = useAIStore(s => s.logs);
  const clearLogs = useAIStore(s => s.clearLogs);
  const [logFilter, setLogFilter] = useState<'all'|'ai'|'search'>('all');
  const filteredLogs = useMemo(() => {
    const arr = Array.isArray(logs) ? logs : [];
    return arr.filter(l => logFilter === 'all' ? true : l.channel === logFilter);
  }, [logs, logFilter]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpand = (id: string) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(t('dashboard.copied') || '已复制'); } catch {}
  };

  // ... (keep existing charts logic)

  const handleCheckUpdates = async () => {
    setIsCheckingUpdates(true);
    try {
      const now = Date.now();
      const ongoingItems = collection.filter(item => item.isOngoing && item.notificationEnabled !== false);
      if (ongoingItems.length === 0) {
        toast.info(t('dashboard.no_ongoing_items'));
        return;
      }

      const updates = await checkUpdates(ongoingItems);
      let updatedCount = 0;
      updates.forEach(update => {
        const original = collection.find(i => i.id === update.id);
        if (!original) return;
        const changed = update.latestUpdateInfo !== original.latestUpdateInfo;
        updateItem(update.id, {
          latestUpdateInfo: update.latestUpdateInfo,
          isOngoing: update.isOngoing,
          lastCheckedAt: now,
          hasNewUpdate: changed ? true : original.hasNewUpdate
        });
        if (changed) updatedCount++;
      });

      if (updatedCount > 0) {
        toast.success(t('dashboard.updates_found', { count: updatedCount }));
      } else {
        toast.info(t('dashboard.no_new_updates'));
      }
    } catch (error) {
      console.error(error);
      toast.error(t('dashboard.update_check_failed'));
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  const pieData = [
    { name: t('dashboard.status_watched'), value: stats.watched, color: '#22c55e' },
    { name: t('dashboard.to_watch'), value: stats.toWatch, color: '#3b82f6' },
    { name: t('dashboard.status_favorites'), value: stats.favorites, color: '#ef4444' },
  ].filter(d => d.value > 0);

  // Helper for localized type names
  const getLocalizedType = (type: string) => {
    switch (type) {
      case MediaType.MOVIE: return t('search_page.filter_movies');
      case MediaType.TV_SERIES: return t('search_page.filter_tv');
      case MediaType.BOOK: return t('search_page.filter_books');
      case MediaType.COMIC: return t('search_page.filter_comics');
      case MediaType.SHORT_DRAMA: return t('search_page.filter_short_dramas');
      case MediaType.MUSIC: return t('search_page.filter_music');
      case MediaType.OTHER: return t('search_page.filter_other');
      default: return type;
    }
  };

  // Calculate types distribution
  const typeData = Object.values(collection.reduce((acc, item) => {
      const typeName = getLocalizedType(item.type);
      acc[item.type] = acc[item.type] || { name: typeName, count: 0 };
      acc[item.type].count++;
      return acc;
  }, {} as Record<string, { name: string; count: number }>));

  // Dynamic styles for charts based on CSS variables
  // We can't easily use CSS variables in JS objects for Recharts without computing them.
  // However, we can use a small mapping or just use "currentColor" where supported.
  // For simplicity and reliability, let's just use a hook to get the computed style or simple conditional.
  // Since we have specific themes, let's just use a simple lookup for chart specific colors if needed,
  // or use CSS variables directly in string props which usually works for SVG attributes.
  
  const chartStyles = {
    text: 'var(--text-secondary)',
    grid: 'var(--border-color)',
    tooltipBg: 'var(--bg-surface)',
    tooltipBorder: 'var(--border-color)',
    tooltipText: 'var(--text-primary)',
    barFill: 'var(--accent-primary)',
    pieStroke: 'var(--bg-surface)'
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-theme-accent">{t('dashboard.title')}</h1>
        <button
            onClick={handleCheckUpdates}
            disabled={isCheckingUpdates}
            className={clsx(
                "flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors",
                isCheckingUpdates 
                    ? "bg-theme-surface text-theme-subtext cursor-wait border border-theme-border"
                    : "bg-theme-accent text-theme-bg hover:bg-theme-accent-hover shadow-lg shadow-theme-accent/20"
            )}
        >
            <RefreshCw className={clsx("w-4 h-4", isCheckingUpdates && "animate-spin")} />
            {isCheckingUpdates ? t('dashboard.checking_updates') : t('dashboard.check_updates')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="p-6 rounded-theme shadow-theme border bg-theme-surface border-theme-border">
            <h3 className="text-sm font-medium text-theme-subtext">{t('dashboard.total_collection')}</h3>
            <p className="text-4xl font-bold mt-2 text-theme-text">{stats.total}</p>
        </div>
        <div className="p-6 rounded-theme shadow-theme border bg-theme-surface border-theme-border">
            <h3 className="text-sm font-medium text-theme-subtext">{t('dashboard.completed')}</h3>
            <p className="text-4xl font-bold text-green-600 mt-2">{stats.watched}</p>
        </div>
        <div className="p-6 rounded-theme shadow-theme border bg-theme-surface border-theme-border">
            <h3 className="text-sm font-medium text-theme-subtext">{t('dashboard.to_watch')}</h3>
            <p className="text-4xl font-bold text-blue-600 mt-2">{stats.toWatch}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="p-3 rounded-theme shadow-sm border bg-theme-surface border-theme-border flex flex-col justify-center">
          <div className="flex items-center justify-between mb-2">
             <h3 className="text-sm font-medium text-theme-subtext">{t('dashboard.last_search') || '最近搜索'}</h3>
             <span className="text-xs text-theme-subtext">{lastSearchAt || ''}</span>
          </div>
          {lastSearchDurationMs != null ? (
            <div className="flex items-center justify-between text-sm text-theme-text bg-theme-bg/50 px-3 py-2 rounded-md border border-theme-border/50">
               <span className="truncate font-medium max-w-[200px]" title={lastSearchQuery || ''}>{lastSearchQuery || '-'}</span>
               <span className="text-xs px-2 py-0.5 rounded-full bg-theme-accent/10 text-theme-accent">{lastSearchDurationMs}ms</span>
            </div>
          ) : (
            <p className="text-sm text-theme-subtext text-center py-2">{t('dashboard.no_recent_search') || '暂无最近搜索'}</p>
          )}
        </div>
        <div className="p-3 rounded-theme shadow-sm border bg-theme-surface border-theme-border">
          <h3 className="text-sm font-medium text-theme-subtext mb-2">{t('dashboard.authoritative_domains')}</h3>
          <AuthoritativeDomainsPanel />
        </div>
      </div>

      {/* AI Configuration Panel */}
      <div className="mb-8">
        <AIConfigPanel />
      </div>

      <div className="p-6 rounded-theme shadow-theme border bg-theme-surface border-theme-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-theme-text">{t('dashboard.io_logs') || '输入输出日志'}</h3>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              <button className={clsx('px-2 py-1 text-xs rounded-md border', logFilter==='all'?'bg-theme-accent text-theme-bg border-theme-accent':'bg-theme-surface text-theme-subtext border-theme-border hover:text-theme-text')} onClick={()=>setLogFilter('all')}>{t('dashboard.filter_all') || '全部'}</button>
              <button className={clsx('px-2 py-1 text-xs rounded-md border', logFilter==='ai'?'bg-theme-accent text-theme-bg border-theme-accent':'bg-theme-surface text-theme-subtext border-theme-border hover:text-theme-text')} onClick={()=>setLogFilter('ai')}>{t('dashboard.filter_ai') || '大模型'}</button>
              <button className={clsx('px-2 py-1 text-xs rounded-md border', logFilter==='search'?'bg-theme-accent text-theme-bg border-theme-accent':'bg-theme-surface text-theme-subtext border-theme-border hover:text-theme-text')} onClick={()=>setLogFilter('search')}>{t('dashboard.filter_search') || '搜索'}</button>
            </div>
            <button className="px-2 py-1 text-xs rounded-md border-2 border-theme-accent bg-theme-accent text-theme-bg hover:bg-theme-accent-hover transition-colors" onClick={clearLogs}>{t('dashboard.clear_logs') || '清空日志'}</button>
          </div>
        </div>
        {filteredLogs.length === 0 ? (
          <div className="text-sm text-theme-subtext">{t('dashboard.no_logs') || '暂无日志'}</div>
        ) : (
          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
            {filteredLogs.map((l: AIIOLogEntry) => {
              const ts = new Date(l.ts || Date.now()).toLocaleString();
              const head = `${ts} | ${l.channel === 'ai' ? (t('dashboard.filter_ai') || '大模型') : (t('dashboard.filter_search') || '搜索')} | ${l.provider || '-'}${l.searchType ? ' · ' + l.searchType : ''}${l.model ? ' · ' + l.model : ''}`;
              const reqStr = typeof l.request === 'string' ? l.request : JSON.stringify(l.request ?? {}, null, 2);
              const resStr = typeof l.response === 'string' ? l.response : JSON.stringify(l.response ?? {}, null, 2);
              const isExp = !!expanded[l.id];
              return (
                <div key={l.id} className="rounded-md border bg-theme-bg/50 border-theme-border/50">
                  <div className="flex items-center justify-between px-3 py-2">
                    <div className="text-xs font-mono text-theme-subtext truncate" title={head}>{head}</div>
                    <div className="flex gap-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-theme-surface text-theme-subtext border border-theme-border/50">{(l.durationMs ?? 0) + 'ms'}</span>
                      <button className={clsx('text-[11px] px-2 py-0.5 rounded border', 'bg-theme-surface text-theme-accent hover:bg-theme-accent hover:text-theme-bg transition-colors')} onClick={()=>toggleExpand(l.id)}>{isExp ? (t('dashboard.collapse') || '收起') : (t('dashboard.expand') || '展开')}</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 px-3 pb-3">
                    <div className="bg-theme-surface/50 border border-theme-border/50 rounded p-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-theme-subtext">Request</span>
                        <button className="text-[11px] px-2 py-0.5 rounded border bg-theme-surface text-theme-accent hover:bg-theme-accent hover:text-theme-bg transition-colors" onClick={()=>copyText(reqStr)}>{t('dashboard.copy') || '复制'}</button>
                      </div>
                      <pre className={clsx('text-[11px] whitespace-pre-wrap break-all', isExp ? 'max-h-[240px] overflow-auto' : 'max-h-[120px] overflow-hidden')}>{reqStr}</pre>
                    </div>
                    <div className="bg-theme-surface/50 border border-theme-border/50 rounded p-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-theme-subtext">Response</span>
                        <button className="text-[11px] px-2 py-0.5 rounded border bg-theme-surface text-theme-accent hover:bg-theme-accent hover:text-theme-bg transition-colors" onClick={()=>copyText(resStr)}>{t('dashboard.copy') || '复制'}</button>
                      </div>
                      <pre className={clsx('text-[11px] whitespace-pre-wrap break-all', isExp ? 'max-h-[240px] overflow-auto' : 'max-h-[120px] overflow-hidden')}>{resStr}</pre>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Status Distribution */}
        <div className="p-6 rounded-theme shadow-theme border h-[400px] bg-theme-surface border-theme-border min-w-0">
            <h3 className="text-lg font-bold mb-6 text-theme-text">{t('dashboard.collection_status')}</h3>
            {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={360}>
                    <PieChart>
                        <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={5}
                            dataKey="value"
                            stroke={chartStyles.pieStroke}
                        >
                            {pieData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: chartStyles.tooltipBg,
                            borderColor: chartStyles.tooltipBorder,
                            color: chartStyles.tooltipText
                          }}
                          itemStyle={{ color: chartStyles.tooltipText }}
                        />
                        <Legend verticalAlign="bottom" height={36}/>
                    </PieChart>
                </ResponsiveContainer>
            ) : (
                <div className="h-full flex items-center justify-center text-theme-subtext">
                    {t('dashboard.no_data')}
                </div>
            )}
        </div>

        {/* Type Distribution */}
        <div className="p-6 rounded-theme shadow-theme border h-[400px] bg-theme-surface border-theme-border min-w-0">
             <h3 className="text-lg font-bold mb-6 text-theme-text">{t('dashboard.media_types')}</h3>
             {typeData.length > 0 ? (
                 <ResponsiveContainer width="100%" height={360}>
                    <BarChart data={typeData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartStyles.grid} />
                        <XAxis 
                          dataKey="name" 
                          tick={{fontSize: 12, fill: chartStyles.text}} 
                          interval={0} 
                          angle={-30} 
                          textAnchor="end" 
                          height={60}
                        />
                        <YAxis 
                          allowDecimals={false} 
                          tick={{fill: chartStyles.text}}
                        />
                        <Tooltip 
                          cursor={{fill: 'var(--bg-secondary)'}}
                          contentStyle={{ 
                            backgroundColor: chartStyles.tooltipBg,
                            borderColor: chartStyles.tooltipBorder,
                            color: chartStyles.tooltipText
                          }}
                          itemStyle={{ color: chartStyles.tooltipText }}
                        />
                        <Bar dataKey="count" fill={chartStyles.barFill} radius={[4, 4, 0, 0]} />
                    </BarChart>
                 </ResponsiveContainer>
             ) : (
                <div className="h-full flex items-center justify-center text-theme-subtext">
                    {t('dashboard.no_data')}
                </div>
             )}
        </div>
      </div>
    </div>
  );
};

const AuthoritativeDomainsPanel: React.FC = () => {
  const { authoritativeDomains, addDomain, removeDomain } = useAIStore();
  const { t } = useTranslation();
  const [active, setActive] = useState<'movie_tv'|'book'|'comic'|'music'>('movie_tv');
  const [newDomain, setNewDomain] = useState('');
  const [testing, setTesting] = useState<string | null>(null);
  const list = authoritativeDomains[active] || [];

  const handleAdd = () => {
    const d = newDomain.trim();
    if (!d) return;
    addDomain(active, d);
    setNewDomain('');
  };

  const handleTest = async (domain: string) => {
    setTesting(domain);
    try {
      const r = await testAuthoritativeDomain(domain);
      if (r.ok) {
        toast.success(`${domain} 连接正常，返回 ${r.count} 项`);
      } else {
        toast.error(`${domain} 测试失败 ${r.error ? '('+r.error+')' : ''}`);
      }
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="space-y-2 mt-1">
      <div className="flex gap-2 flex-wrap">
        <button className={clsx('px-2 py-1 text-xs rounded-md border-2 transition-colors', active==='movie_tv'?'bg-theme-accent text-theme-bg border-theme-accent':'bg-theme-surface text-theme-subtext border-theme-border hover:text-theme-text')} onClick={()=>setActive('movie_tv')}>{t('search_page.filter_movies')}/{t('search_page.filter_tv')}</button>
        <button className={clsx('px-2 py-1 text-xs rounded-md border-2 transition-colors', active==='book'?'bg-theme-accent text-theme-bg border-theme-accent':'bg-theme-surface text-theme-subtext border-theme-border hover:text-theme-text')} onClick={()=>setActive('book')}>{t('search_page.filter_books')}</button>
        <button className={clsx('px-2 py-1 text-xs rounded-md border-2 transition-colors', active==='comic'?'bg-theme-accent text-theme-bg border-theme-accent':'bg-theme-surface text-theme-subtext border-theme-border hover:text-theme-text')} onClick={()=>setActive('comic')}>{t('search_page.filter_comics')}</button>
        <button className={clsx('px-2 py-1 text-xs rounded-md border-2 transition-colors', active==='music'?'bg-theme-accent text-theme-bg border-theme-accent':'bg-theme-surface text-theme-subtext border-theme-border hover:text-theme-text')} onClick={()=>setActive('music')}>{t('search_page.filter_music')}</button>
      </div>
      
      <div className="flex gap-2">
        <input 
            className="flex-1 px-2 py-1 text-xs rounded-md border bg-theme-bg border-theme-border text-theme-text focus:outline-none focus:ring-1 focus:ring-theme-accent" 
            placeholder="例如 imdb.com" 
            value={newDomain} 
            onChange={e=>setNewDomain(e.target.value)} 
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button className="px-2 py-1 text-xs rounded-md border-2 border-theme-accent bg-theme-accent text-theme-bg hover:bg-theme-accent-hover transition-colors" onClick={handleAdd}>添加</button>
      </div>

      <div className="space-y-1 max-h-[150px] overflow-y-auto pr-1 custom-scrollbar">
        {list.map(d => (
          <div key={d} className="flex items-center justify-between px-2 py-1 rounded-md border bg-theme-bg/50 border-theme-border/50 hover:border-theme-border transition-colors group">
            <span className="text-xs text-theme-text font-mono truncate max-w-[150px]" title={d}>{d}</span>
            <div className="flex gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
              <button className={clsx('px-2 py-0.5 text-[10px] rounded border', 'bg-theme-surface text-theme-subtext hover:text-theme-text hover:border-theme-subtext transition-colors')} onClick={()=>removeDomain(active, d)}>删除</button>
              <button className={clsx('px-2 py-0.5 text-[10px] rounded border transition-colors', testing===d?'bg-theme-surface text-theme-subtext cursor-wait':'bg-theme-surface text-theme-accent border-theme-accent/30 hover:bg-theme-accent hover:text-theme-bg')} onClick={()=>handleTest(d)}>{testing===d?'...':'测试'}</button>
            </div>
          </div>
        ))}
        {list.length===0 && (
          <div className="text-xs text-theme-subtext py-2 text-center border border-dashed border-theme-border/50 rounded-md">暂无域名</div>
        )}
      </div>
    </div>
  );
};
