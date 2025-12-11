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
import { checkUpdates } from '../services/aiService';

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
        <div className="p-6 rounded-xl shadow-sm border bg-theme-surface border-theme-border">
            <h3 className="text-sm font-medium text-theme-subtext">{t('dashboard.total_collection')}</h3>
            <p className="text-4xl font-bold mt-2 text-theme-text">{stats.total}</p>
        </div>
        <div className="p-6 rounded-xl shadow-sm border bg-theme-surface border-theme-border">
            <h3 className="text-sm font-medium text-theme-subtext">{t('dashboard.completed')}</h3>
            <p className="text-4xl font-bold text-green-600 mt-2">{stats.watched}</p>
        </div>
        <div className="p-6 rounded-xl shadow-sm border bg-theme-surface border-theme-border">
            <h3 className="text-sm font-medium text-theme-subtext">{t('dashboard.to_watch')}</h3>
            <p className="text-4xl font-bold text-blue-600 mt-2">{stats.toWatch}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="p-6 rounded-xl shadow-sm border bg-theme-surface border-theme-border">
          <h3 className="text-sm font-medium text-theme-subtext">{t('dashboard.last_search') || '最近搜索'}</h3>
          {lastSearchDurationMs != null ? (
            <div className="mt-2 text-sm text-theme-text space-y-1">
              <div>{(t('dashboard.last_search_query') || '查询') + ': '}{lastSearchQuery || '-'}</div>
              <div>{(t('dashboard.last_search_duration') || '总耗时') + ': '}{lastSearchDurationMs}ms</div>
              <div>{(t('dashboard.last_search_at') || '时间') + ': '}{lastSearchAt || '-'}</div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-theme-subtext">{t('dashboard.no_recent_search') || '暂无最近搜索'}</p>
          )}
        </div>
      </div>

      {/* AI Configuration Panel */}
      <div className="mb-8">
        <AIConfigPanel />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Status Distribution */}
        <div className="p-6 rounded-xl shadow-sm border h-[400px] bg-theme-surface border-theme-border min-w-0">
            <h3 className="text-lg font-bold mb-6 text-theme-text">{t('dashboard.collection_status')}</h3>
            {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240}>
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
        <div className="p-6 rounded-xl shadow-sm border h-[400px] bg-theme-surface border-theme-border min-w-0">
             <h3 className="text-lg font-bold mb-6 text-theme-text">{t('dashboard.media_types')}</h3>
             {typeData.length > 0 ? (
                 <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240}>
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
