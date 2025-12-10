import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Star, Clock, Calendar, Heart, Check, Bookmark, MoreVertical, Info, Bell, BellOff, RefreshCw, Edit, Trash2, User, Users } from 'lucide-react';
import { MediaItem, CollectionCategory } from '../types/types';
import clsx from 'clsx';
import { useThemeStore } from '../store/useThemeStore';
import { useCollectionStore } from '../store/useCollectionStore';
import { EditMediaModal } from './EditMediaModal';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';

interface MediaCardProps {
  item: MediaItem;
  onAction?: (item: MediaItem, category: CollectionCategory) => void;
  showActions?: boolean;
  index?: number;
  layoutId?: string;
  onClick?: () => void;
  className?: string;
  variant?: 'search' | 'collection';
}

export const MediaCard: React.FC<MediaCardProps> = ({ 
  item, 
  onAction, 
  showActions = true, 
  index = 0, 
  layoutId, 
  onClick, 
  className,
  variant = 'search' 
}) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { t } = useTranslation();
  const [imgLoading, setImgLoading] = useState(true);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.matchMedia('(max-width: 768px)').matches);
    checkMobile();
    const resizeObserver = new ResizeObserver(() => checkMobile());
    resizeObserver.observe(document.body);
    return () => resizeObserver.disconnect();
  }, []);
  
  const { theme } = useThemeStore();
  const { updateItem, removeFromCollection } = useCollectionStore();

  const getCategoryIcon = (category?: CollectionCategory) => {
    switch (category) {
      case CollectionCategory.FAVORITES: return <Heart className="w-4 h-4 fill-current text-red-500" />;
      case CollectionCategory.WATCHED: return <Check className="w-4 h-4 text-green-500" />;
      case CollectionCategory.TO_WATCH: return <Bookmark className="w-4 h-4 text-blue-500" />;
      default: return null;
    }
  };

  const [imgSrc, setImgSrc] = useState(item.customPosterUrl || item.posterUrl || 'https://placehold.co/600x400/1a1a1a/FFF?text=No+Image');

  useEffect(() => {
    setImgSrc(item.customPosterUrl || item.posterUrl || 'https://placehold.co/600x400/1a1a1a/FFF?text=No+Image');
    setImgLoading(true);
    setImgFailed(false);
  }, [item.customPosterUrl, item.posterUrl]);

  const handleImageError = () => {
      setImgSrc('https://placehold.co/600x400/1a1a1a/FFF?text=Image+Error');
      setImgFailed(true);
      setImgLoading(false);
  };

  return (
    <>
      <motion.div
        layoutId={layoutId}
        initial={layoutId ? undefined : { opacity: 0, y: 20 }}
        animate={layoutId ? undefined : { opacity: 1, y: 0 }}
        transition={{ delay: layoutId ? 0 : index * 0.1, duration: 0.5 }}
        className={clsx(
          "group relative w-full h-full perspective-1000", 
          // Desktop: Elevate z-index on hover to prevent clipping during scaling
          "md:hover:z-50",
          className
        )}
        onMouseEnter={() => !isMobile && !isEditModalOpen && setIsFlipped(true)}
        onMouseLeave={() => !isMobile && !isEditModalOpen && setIsFlipped(false)}
        onClick={() => {
            if (item.hasNewUpdate) {
                updateItem(item.id, { hasNewUpdate: false });
            }
            onClick?.();
        }}
      >
        <motion.div
          className={clsx(
            "relative w-full aspect-[1/1.48] transition-all duration-300 ease-out transform-style-3d cursor-pointer shadow-lg rounded-xl",
            // Hardware acceleration hints
            "will-change-transform backface-visibility-hidden",
            isFlipped ? "rotate-y-180" : "",
            // Desktop: Scale up on hover
            !isMobile && !isEditModalOpen && "md:group-hover:scale-105 md:group-hover:shadow-2xl"
          )}
        >
          {/* Front Side */}
          <div className="absolute inset-0 backface-hidden rounded-xl overflow-hidden border-2 border-theme-border bg-theme-surface">
            <div className="relative h-full w-full">
              {/* Mobile Flip Button */}
              {isMobile && (
                 <div className="absolute top-3 left-3 z-20">
                    <button 
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsFlipped(!isFlipped);
                        }}
                        className="bg-black/60 backdrop-blur-md p-2 rounded-full border border-white/10 text-white active:scale-95 transition-transform"
                        aria-label={t('media_card.flip_card')}
                    >
                        <Info className="w-4 h-4" />
                    </button>
                 </div>
              )}
              
              <img
                src={imgSrc}
                alt={item.title}
                onError={handleImageError}
                onLoad={() => setImgLoading(false)}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
              
              {/* Category Badge */}
              {item.category && (
                <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-md p-1.5 rounded-full border border-white/10">
                  {getCategoryIcon(item.category)}
                </div>
              )}

              {/* New Update Red Dot */}
              {item.isOngoing && item.hasNewUpdate && (
                <div className="absolute top-3 right-10 w-3 h-3 bg-red-500 rounded-full border border-white animate-pulse shadow-lg z-10" />
              )}

              {/* Content Overlay */}
              <div className="absolute bottom-0 left-0 right-0 p-4 transform transition-transform duration-300 group-hover:translate-y-[-10px]">
                {(imgLoading && !imgFailed) && (
                  <p className="text-xs text-yellow-300 mb-1">{t('media_card.image_loading')}</p>
                )}
                {imgFailed && (
                  <p className="text-xs text-red-400 mb-1">{t('media_card.image_failed')}</p>
                )}
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-theme-accent text-theme-bg rounded-sm ring-1 ring-theme-accent/50 shadow-md">
                    {item.type}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-white leading-tight line-clamp-1 mb-1 font-sans text-shadow-gold">
                  {item.title}
                </h3>
                <p className="text-xs text-gray-300 line-clamp-1">
                  {item.releaseDate} • {item.directorOrAuthor}
                </p>
              </div>
            </div>
          </div>

          {/* Back Side */}
          <div className="absolute inset-0 backface-hidden rotate-y-180 rounded-xl overflow-hidden p-5 flex flex-col border-2 bg-theme-surface border-theme-border text-theme-text">
            {/* Spotlight Effect */}
            <div className="absolute inset-0 pointer-events-none bg-gradient-to-tr from-theme-accent/5 via-transparent to-transparent opacity-50" />
            
            <h3 className="text-lg 2xl:text-xl font-bold mb-3 text-theme-accent">
              {item.title}
            </h3>
            
            <div className="flex-1 overflow-y-auto no-scrollbar relative pr-1">
              {/* Metadata Section */}
               <div className="mb-3 space-y-1.5 text-xs text-theme-subtext">
                 <div className="flex items-center gap-2">
                   <Calendar className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
                   <span>{item.releaseDate}</span>
                 </div>
                 
                 <div className="flex items-center gap-2">
                   <User className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
                   <span className="line-clamp-1">{item.directorOrAuthor}</span>
                 </div>

                 {item.cast && item.cast.length > 0 && (
                   <div className="flex items-start gap-2">
                     <Users className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 opacity-70" />
                     <span className="line-clamp-2 leading-tight">
                       {item.cast.join(', ')}
                     </span>
                   </div>
                 )}
               </div>

               <div className="w-full h-px mb-3 bg-theme-border" />

              <div className={clsx(
                "text-sm leading-relaxed mb-4 transition-all duration-300 text-theme-text", 
                !isExpanded && "line-clamp-6"
              )}>
                {item.description}
              </div>
              
              {item.description.length > 150 && (
                <button 
                  onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                  className="text-xs font-medium mb-3 hover:underline text-theme-accent"
                >
                  {isExpanded ? t('media_card.show_less') : t('media_card.view_more')}
                </button>
              )}

              {/* User Review Snippet (Collection Mode) */}
              {variant === 'collection' && item.userReview && (
                <div className="mb-3 p-2 rounded border bg-theme-bg border-theme-border text-theme-subtext overflow-hidden max-h-24 prose prose-sm max-w-none prose-p:text-xs prose-p:text-theme-subtext prose-p:m-0 prose-p:leading-relaxed prose-headings:text-xs prose-headings:text-theme-subtext prose-headings:m-0 prose-ul:m-0 prose-li:m-0 prose-li:text-theme-subtext">
                   <ReactMarkdown>{item.userReview}</ReactMarkdown>
                </div>
              )}
              
              {item.isOngoing && (
                <div className="flex items-center gap-2 text-xs 2xl:text-sm font-medium text-theme-accent mb-3">
                  <Clock className="w-3 h-3 2xl:w-4 2xl:h-4" />
                  <span>{t('media_card.ongoing')}</span>
                </div>
              )}

              {/* Tracking Section for Ongoing Series in Collection */}
              {item.isOngoing && item.category && (
                <div className="mt-2 p-3 2xl:p-4 rounded-lg mb-3 border bg-theme-bg/50 border-theme-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] 2xl:text-xs font-bold uppercase tracking-wider text-theme-accent">{t('media_card.tracking')}</span>
                    
                    <div className="flex gap-2">
                        {/* Manual Toggle for testing */}
                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                updateItem(item.id, { hasNewUpdate: !item.hasNewUpdate });
                            }}
                            className={clsx(
                                "transition-colors",
                                item.hasNewUpdate 
                                ? "text-red-500"
                                : "text-theme-subtext"
                            )}
                            title="Toggle Update Status (Test)"
                        >
                            <RefreshCw className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
                        </button>

                        <button 
                        onClick={(e) => {
                            e.stopPropagation();
                            updateItem(item.id, { notificationEnabled: !item.notificationEnabled });
                        }}
                        className={clsx(
                            "transition-colors",
                            item.notificationEnabled 
                            ? "text-theme-accent"
                            : "text-theme-subtext"
                        )}
                        title={t('media_card.toggle_updates')}
                        >
                        {item.notificationEnabled ? <Bell className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" /> : <BellOff className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />}
                        </button>
                    </div>
                  </div>
                  
                  <div className="space-y-2 2xl:space-y-3">
                    <div className="flex justify-between items-center text-xs 2xl:text-sm">
                      <span className="text-theme-subtext">{t('media_card.latest')}</span>
                      <span className="font-medium text-theme-text">
                        {item.latestUpdateInfo || t('media_card.unknown')}
                      </span>
                    </div>
                    
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] 2xl:text-xs text-theme-subtext">
                        {t('media_card.my_progress')}
                      </label>
                      <input 
                        type="text"
                        value={item.userProgress || ''}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateItem(item.id, { userProgress: e.target.value })}
                        placeholder="e.g. S4E8"
                        className="w-full rounded px-2 py-1 2xl:py-1.5 text-xs 2xl:text-sm border focus:outline-none focus:ring-1 bg-theme-bg border-theme-border text-theme-text focus:border-theme-accent focus:ring-theme-accent/50"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            {variant === 'collection' ? (
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditModalOpen(true);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg font-medium transition-colors bg-theme-accent text-theme-bg hover:bg-theme-accent-hover border-2 border-theme-accent focus:outline-none focus:ring-2 focus:ring-theme-accent"
                >
                  <Edit className="w-4 h-4" />
                  {t('media_card.edit')}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowDeleteConfirm(true);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg font-medium transition-colors bg-theme-accent-warm text-theme-bg hover:bg-theme-accent-warm-2 border-2 border-theme-accent-warm focus:outline-none focus:ring-2 focus:ring-theme-accent"
                >
                  <Trash2 className="w-4 h-4" />
                  {t('media_card.delete')}
                </button>
              </div>
            ) : (
              showActions && onAction && (
                <div className="mt-4 grid grid-cols-3 gap-2">
                <button 
                  onClick={(e) => { e.stopPropagation(); onAction(item, CollectionCategory.FAVORITES); }}
                  className="flex flex-col items-center justify-center p-2 rounded-lg transition-colors hover:bg-theme-bg text-theme-subtext hover:text-red-500 border-2 border-theme-border focus:outline-none focus:ring-2 focus:ring-theme-accent"
                  title={t('media_card.action_favorite_title')}
                >
                  <Heart className="w-5 h-5 mb-1" />
                  <span className="text-[10px]">{t('media_card.action_like')}</span>
                </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onAction(item, CollectionCategory.TO_WATCH); }}
                    className="flex flex-col items-center justify-center p-2 rounded-lg transition-colors hover:bg-theme-bg text-theme-subtext hover:text-blue-500 border-2 border-theme-border focus:outline-none focus:ring-2 focus:ring-theme-accent"
                    title={t('media_card.action_towatch_title')}
                  >
                    <Bookmark className="w-5 h-5 mb-1" />
                    <span className="text-[10px]">{t('media_card.action_save')}</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onAction(item, CollectionCategory.WATCHED); }}
                    className="flex flex-col items-center justify-center p-2 rounded-lg transition-colors hover:bg-theme-bg text-theme-subtext hover:text-green-500 border-2 border-theme-border focus:outline-none focus:ring-2 focus:ring-theme-accent"
                    title={t('media_card.action_watched_title')}
                  >
                    <Check className="w-5 h-5 mb-1" />
                    <span className="text-[10px]">{t('media_card.action_done')}</span>
                  </button>
                </div>
              )
            )}
          </div>
        </motion.div>
      </motion.div>

      {/* Edit Modal */}
      {isEditModalOpen && (
        <EditMediaModal 
          item={item} 
          onClose={() => setIsEditModalOpen(false)} 
          onDelete={() => removeFromCollection(item.id)}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="max-w-sm w-full rounded-2xl shadow-2xl border p-6 relative z-10 transition-colors duration-300 bg-theme-surface border-theme-border">
            <div className="text-center mb-4">
              <h3 className="text-lg font-bold text-theme-text">{t('media_card.delete')}</h3>
              <p className="mt-2 text-sm text-theme-subtext">{t('edit_modal.delete_confirm')}</p>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                className="px-4 py-2 rounded-lg font-medium transition-colors bg-theme-surface text-theme-text border border-theme-border hover:bg-theme-bg"
                onClick={() => setShowDeleteConfirm(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-lg font-medium transition-colors bg-theme-accent-warm text-theme-bg hover:bg-theme-accent-warm-2"
                onClick={() => { removeFromCollection(item.id); setShowDeleteConfirm(false); }}
              >
                {t('media_card.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
