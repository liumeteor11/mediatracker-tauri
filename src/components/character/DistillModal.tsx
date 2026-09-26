import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, X, Loader2, AlertTriangle } from 'lucide-react';
import { useCollectionStore } from '../../store/useCollectionStore';
import { useCharacterStore } from '../../store/useCharacterStore';
import { useAIStore } from '../../store/useAIStore';
import { distillCharacters } from '../../services/characterService';
import { MediaItem, MediaType } from '../../types/types';

interface DistillModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDone?: (created: number, updated: number) => void;
}

const MANUAL_WORK = '__manual__';

/** Build a synthetic source item for a manually typed work title. */
const buildManualItem = (title: string): MediaItem => ({
  id: `manual-${title.trim().toLowerCase().replace(/\s+/g, '-')}`,
  title: title.trim(),
  directorOrAuthor: '',
  description: '',
  releaseDate: '',
  type: MediaType.OTHER,
  isOngoing: false,
  cast: [],
});

export const DistillModal: React.FC<DistillModalProps> = ({ isOpen, onClose, onDone }) => {
  const { t, i18n } = useTranslation();
  const collection = useCollectionStore(s => s.collection);
  const upsertCharacters = useCharacterStore(s => s.upsertCharacters);
  const characters = useCharacterStore(s => s.characters);
  const apiKey = useAIStore(s => s.apiKey);

  const [workSelection, setWorkSelection] = useState<string>('');
  const [manualTitle, setManualTitle] = useState('');
  const [characterName, setCharacterName] = useState('');
  const [extraMaterial, setExtraMaterial] = useState('');
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

  // No collection works to pick from -> manual entry is the only option.
  const isManual = workSelection === MANUAL_WORK || sortedCollection.length === 0;

  const hasKey = !!apiKey;

  if (!isOpen) return null;

  const handleDistill = async () => {
    const name = characterName.trim();
    let item: MediaItem | undefined;
    if (!isManual) {
      item = collection.find(i => i.id === workSelection);
    } else if (manualTitle.trim()) {
      item = buildManualItem(manualTitle);
    }
    if (!item) {
      setError(t(isManual ? 'characters.error_enter_work' : 'characters.error_select_work'));
      return;
    }
    if (!name) {
      setError(t('characters.error_character_name'));
      return;
    }
    setIsDistilling(true);
    setError(null);
    try {
      const language = (i18n.language || 'en').startsWith('zh') ? 'zh' : 'en';
      const result = await distillCharacters(item, characters, {
        characterName: name,
        extraMaterial,
        maxCharacters: 1,
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

  const inputClass =
    'w-full px-3 py-2 rounded-theme bg-theme-bg border border-theme-border focus:outline-none focus:ring-2 focus:ring-theme-accent text-sm';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm p-4">
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
            <div className="flex items-start gap-2 p-3 rounded-theme bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{t('characters.error_no_key')}</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">{t('characters.select_work')}</label>
            {sortedCollection.length > 0 && (
              <select
                value={isManual ? MANUAL_WORK : workSelection}
                onChange={(e) => setWorkSelection(e.target.value)}
                className={`${inputClass} mb-2`}
              >
                <option value="">{t('characters.select_work_placeholder')}</option>
                {sortedCollection.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {t(`media_type.${item.type}`, { defaultValue: item.type })}
                  </option>
                ))}
                <option value={MANUAL_WORK}>{t('characters.select_work_manual')}</option>
              </select>
            )}
            {isManual && (
              <input
                type="text"
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                placeholder={t('characters.work_name_placeholder')}
                className={inputClass}
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">{t('characters.character_name')}</label>
            <input
              type="text"
              value={characterName}
              onChange={(e) => setCharacterName(e.target.value)}
              placeholder={t('characters.character_name_placeholder')}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('characters.extra_material')}</label>
            <textarea
              value={extraMaterial}
              onChange={(e) => setExtraMaterial(e.target.value)}
              rows={4}
              placeholder={t('characters.extra_material_hint')}
              className={`${inputClass} resize-y`}
            />
            <p className="text-xs text-theme-subtext mt-1">{t('characters.extra_material_note')}</p>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-theme bg-theme-accent-warm/10 text-theme-accent-warm text-sm">
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
            disabled={isDistilling || (isManual ? !manualTitle.trim() : !workSelection) || !characterName.trim() || !hasKey}
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
