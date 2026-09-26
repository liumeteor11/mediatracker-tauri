import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, X, Loader2, AlertTriangle } from 'lucide-react';
import { useCollectionStore } from '../../store/useCollectionStore';
import { useCharacterStore } from '../../store/useCharacterStore';
import { useAIStore } from '../../store/useAIStore';
import { distillCharacters } from '../../services/characterService';

interface DistillModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDone?: (created: number, updated: number) => void;
}

export const DistillModal: React.FC<DistillModalProps> = ({ isOpen, onClose, onDone }) => {
  const { t, i18n } = useTranslation();
  const collection = useCollectionStore(s => s.collection);
  const upsertCharacters = useCharacterStore(s => s.upsertCharacters);
  const characters = useCharacterStore(s => s.characters);
  const apiKey = useAIStore(s => s.apiKey);

  const [itemId, setItemId] = useState<string>('');
  const [extraMaterial, setExtraMaterial] = useState('');
  const [focus, setFocus] = useState('');
  const [count, setCount] = useState(3);
  const [isDistilling, setIsDistilling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedCollection = useMemo(
    () =>
      [...collection].sort((a, b) => {
        const at = a.savedAt || 0;
        const bt = b.savedAt || 0;
        return bt - at;
      }),
    [collection]
  );

  const hasKey = !!apiKey;

  if (!isOpen) return null;

  const handleDistill = async () => {
    const item = collection.find(i => i.id === itemId);
    if (!item) {
      setError(t('characters.error_select_work'));
      return;
    }
    setIsDistilling(true);
    setError(null);
    try {
      const language = (i18n.language || 'en').startsWith('zh') ? 'zh' : 'en';
      const result = await distillCharacters(item, characters, {
        extraMaterial,
        focus,
        maxCharacters: count,
        language,
      });
      upsertCharacters(result.characters);
      onDone?.(result.created, result.updated);
      onClose();
    } catch (e: any) {
      console.error('Distillation failed', e);
      const msg = String(e?.message || e || '');
      if (msg.includes('empty-ai-response')) setError(t('characters.error_no_ai'));
      else setError(t('characters.distill_failed'));
    } finally {
      setIsDistilling(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm p-4">
      <div className="bg-theme-surface border border-theme-border rounded-theme max-w-lg w-full max-h-[90vh] overflow-y-auto text-theme-text">
        <div className="flex items-center justify-between p-4 border-b border-theme-border sticky top-0 bg-theme-surface">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-theme-accent" />
            <h3 className="font-semibold">{t('characters.distill_title')}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-theme hover:bg-theme-bg text-theme-subtext" aria-label="close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-theme-subtext">{t('characters.distill_desc')}</p>

          {!hasKey && (
            <div className="flex items-start gap-2 p-3 rounded-theme bg-yellow-500/10 text-yellow-600 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{t('characters.error_no_key')}</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">{t('characters.select_work')}</label>
            <select
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              className="w-full px-3 py-2 rounded-theme bg-theme-bg border border-theme-border focus:outline-none focus:ring-2 focus:ring-theme-accent text-sm"
            >
              <option value="">{t('characters.select_work_placeholder')}</option>
              {sortedCollection.map(item => (
                <option key={item.id} value={item.id}>
                  {item.title} · {t(`media_type.${item.type}`, { defaultValue: item.type })}
                </option>
              ))}
            </select>
            {sortedCollection.length === 0 && (
              <p className="text-xs text-theme-subtext mt-1">{t('characters.empty_collection')}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">{t('characters.focus')}</label>
              <input
                type="text"
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                placeholder={t('characters.focus_placeholder')}
                className="w-full px-3 py-2 rounded-theme bg-theme-bg border border-theme-border focus:outline-none focus:ring-2 focus:ring-theme-accent text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('characters.count')}</label>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-theme bg-theme-bg border border-theme-border focus:outline-none focus:ring-2 focus:ring-theme-accent text-sm"
              >
                {[1, 2, 3, 4, 5].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">{t('characters.extra_material')}</label>
            <textarea
              value={extraMaterial}
              onChange={(e) => setExtraMaterial(e.target.value)}
              rows={4}
              placeholder={t('characters.extra_material_hint')}
              className="w-full px-3 py-2 rounded-theme bg-theme-bg border border-theme-border focus:outline-none focus:ring-2 focus:ring-theme-accent text-sm resize-y"
            />
            <p className="text-xs text-theme-subtext mt-1">{t('characters.extra_material_note')}</p>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-theme bg-red-500/10 text-red-500 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-theme-border">
          <button
            onClick={onClose}
            disabled={isDistilling}
            className="px-4 py-2 rounded-theme text-sm border border-theme-border text-theme-subtext hover:bg-theme-bg disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleDistill}
            disabled={isDistilling || !itemId || !hasKey}
            className="flex items-center gap-2 px-4 py-2 rounded-theme text-sm font-medium bg-theme-accent text-theme-bg hover:bg-theme-accent-hover disabled:opacity-50"
          >
            {isDistilling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {isDistilling ? t('characters.distilling') : t('characters.distill')}
          </button>
        </div>
      </div>
    </div>
  );
};
