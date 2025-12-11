import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAIStore, AIProvider, SearchProvider } from '../store/useAIStore';
import { Save, Activity, CheckCircle, AlertCircle, Eye, EyeOff, Info, List, Globe, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { toast } from 'react-toastify';

const PROVIDER_MODELS: Record<string, { name: string; version: string; releaseDate: string }[]> = {
    moonshot: [
      { name: 'moonshot-v1-8k', version: 'V1 8k', releaseDate: '2024-03' },
      { name: 'moonshot-v1-32k', version: 'V1 32k', releaseDate: '2024-03' },
      { name: 'moonshot-v1-128k', version: 'V1 128k', releaseDate: '2024-03' }
    ],
    openai: [
      { name: 'gpt-4o', version: 'GPT-4o', releaseDate: '2024-05' },
      { name: 'gpt-5', version: 'GPT-5 (Preview)', releaseDate: '2025-12' },
      { name: 'gpt-4-turbo', version: 'GPT-4 Turbo', releaseDate: '2024-04' }
    ],
    deepseek: [
      { name: 'deepseek-chat', version: 'DeepSeek V3', releaseDate: '2025-09' },
      { name: 'deepseek-reasoner', version: 'DeepSeek Reasoner (R1)', releaseDate: '2025-01' }
    ],
    qwen: [
      { name: 'qwen-max', version: 'Qwen Max', releaseDate: '2025-11' },
      { name: 'qwen-plus', version: 'Qwen Plus', releaseDate: '2025-11' }
    ],
    google: [
      { name: 'gemini-2.5-flash', version: 'Gemini 2.5 Flash', releaseDate: '2025-12' },
      { name: 'gemini-1.5-pro', version: 'Gemini 1.5 Pro', releaseDate: '2024-04' }
    ],
    mistral: [
      { name: 'mistral-large-latest', version: 'Large 3', releaseDate: '2025-11' }
    ]
  };

export const AIConfigPanel: React.FC = () => {
  const { t } = useTranslation();
  
  const PROVIDER_OPTIONS: { value: AIProvider; label: string }[] = [
    { value: 'openai', label: t('ai_config.provider_openai') },
    { value: 'moonshot', label: t('ai_config.provider_moonshot') },
    { value: 'deepseek', label: t('ai_config.provider_deepseek') },
    { value: 'qwen', label: t('ai_config.provider_qwen') },
    { value: 'google', label: t('ai_config.provider_google') },
    { value: 'mistral', label: t('ai_config.provider_mistral') },
    { value: 'custom', label: t('ai_config.provider_custom') }
  ];

  const SEARCH_PROVIDER_OPTIONS: { value: SearchProvider; label: string }[] = [
    { value: 'google', label: t('ai_config.search_provider_google') },
    { value: 'serper', label: t('ai_config.search_provider_serper') },
    { value: 'yandex', label: t('ai_config.search_provider_yandex') },
  ];

  const { 
    provider, apiKey, model, baseUrl, temperature, maxTokens, systemPrompt,
    enableSearch, searchProvider, googleSearchCx, yandexSearchLogin,
    useSystemProxy, proxyProtocol, proxyHost, proxyPort, proxyUsername,
    setProvider, setConfig, getDecryptedApiKey, getDecryptedGoogleKey, getDecryptedSerperKey, getDecryptedYandexKey, getProxyUrl
  } = useAIStore();

  const [localKey, setLocalKey] = useState(getDecryptedApiKey());
  const [localGoogleKey, setLocalGoogleKey] = useState(getDecryptedGoogleKey());
  const [localSerperKey, setLocalSerperKey] = useState(getDecryptedSerperKey());
  const [localYandexKey, setLocalYandexKey] = useState(getDecryptedYandexKey());
  
  const [showKey, setShowKey] = useState(false);
  const [showGoogleKey, setShowGoogleKey] = useState(false);
  const [showSerperKey, setShowSerperKey] = useState(false);
  const [showYandexKey, setShowYandexKey] = useState(false);
  const [localUseSystemProxy, setLocalUseSystemProxy] = useState(useSystemProxy);
  const [localProxyProtocol, setLocalProxyProtocol] = useState<'http' | 'socks5'>(proxyProtocol || 'http');
  const [localProxyHost, setLocalProxyHost] = useState(proxyHost || '');
  const [localProxyPort, setLocalProxyPort] = useState(proxyPort || '');
  const [localProxyUsername, setLocalProxyUsername] = useState(proxyUsername || '');
  const [localProxyPassword, setLocalProxyPassword] = useState('');

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{status: 'success' | 'error' | null, latency: number | null, message: string}>({
    status: null,
    latency: null,
    message: ''
  });
  const [isManualInput, setIsManualInput] = useState(false);
  const [isProxyHelpOpen, setIsProxyHelpOpen] = useState(false);

  const handleTestProxy = async () => {
    setIsTesting(true);
    setTestResult({ status: null, latency: null, message: '' });
    const start = performance.now();
    try {
      const url = 'https://www.google.com/generate_204';
      const result = await invoke<string>('test_proxy', {
        config: {
          url,
          proxy_url: getProxyUrl(),
          use_system_proxy: localUseSystemProxy
        }
      });
      const parsed = JSON.parse(result || '{}');
      const ok = !!parsed.ok;
      const latency = typeof parsed.latency_ms === 'number' ? parsed.latency_ms : Math.round(performance.now() - start);
      setTestResult({ status: ok ? 'success' : 'error', latency, message: `HTTP ${parsed.status}` });
      if (ok) {
        toast.success(t('ai_config.proxy_test_success'));
      } else {
        toast.error(`${t('ai_config.proxy_test_failed')} HTTP ${parsed.status}`);
      }
    } catch (e: any) {
      setTestResult({ status: 'error', latency: null, message: e?.message || 'Proxy test failed' });
      toast.error(`${t('ai_config.proxy_test_failed')} ${e?.message || ''}`);
    } finally {
      setIsTesting(false);
    }
  };

  // Update local keys and reset manual input when provider changes or store updates
  useEffect(() => {
    setLocalKey(getDecryptedApiKey());
    setLocalGoogleKey(getDecryptedGoogleKey());
    setLocalSerperKey(getDecryptedSerperKey());
    setLocalYandexKey(getDecryptedYandexKey());
    setIsManualInput(false);
  }, [provider, getDecryptedApiKey, getDecryptedGoogleKey, getDecryptedSerperKey, getDecryptedYandexKey]);

  const handleSave = () => {
    if (!localKey) {
        toast.error(t('ai_config.api_key_required'));
        return;
    }
    
    if (enableSearch) {
        if (searchProvider === 'google' && (!localGoogleKey || !googleSearchCx)) {
            toast.warning(t('ai_config.google_warning'));
        }
        if (searchProvider === 'serper' && !localSerperKey) {
            toast.warning(t('ai_config.serper_warning'));
        }
        if (searchProvider === 'yandex' && (!localYandexKey || !yandexSearchLogin)) {
            toast.warning(t('ai_config.yandex_warning'));
        }
    }

    const sanitizedBaseUrl = (baseUrl || '').trim().replace(/[\s)]+$/g, '');
    setConfig({
        apiKey: localKey,
        model,
        baseUrl: sanitizedBaseUrl,
        temperature,
        maxTokens,
        enableSearch,
        searchProvider,
        googleSearchApiKey: localGoogleKey,
        googleSearchCx,
        serperApiKey: localSerperKey,
        yandexSearchApiKey: localYandexKey,
        yandexSearchLogin,
        useSystemProxy: localUseSystemProxy,
        proxyProtocol: localProxyProtocol,
        proxyHost: localProxyHost,
        proxyPort: localProxyPort,
        proxyUsername: localProxyUsername,
        proxyPassword: localProxyPassword
    });
    toast.success(t('ai_config.save_success'));
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult({ status: null, latency: null, message: '' });
    const startTime = performance.now();

    try {
        // Tauri Mode
        if (window.__TAURI__) {
             const rustConfig = {
                 apiKey: localKey,
                 baseURL: (baseUrl || '').trim().replace(/[\s)]+$/g, ''),
                 model: model
             };
             
             await invoke("ai_chat", { 
                 messages: [{ role: 'user', content: 'Hi' }], 
                 temperature: 0.7, 
                 config: rustConfig 
             });
        } else {
             // Web Mode Direct Call
            const sanitized = (baseUrl || '').trim().replace(/[\s)]+$/g, '');
            const response = await fetch(`${sanitized}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localKey}`
                },
                 body: JSON.stringify({
                     model: model,
                     messages: [{ role: 'user', content: 'Hi' }],
                     max_tokens: 5
                 })
             });
             
             if (!response.ok) {
                 const errData = await response.json().catch(() => ({}));
                 throw new Error(errData.error?.message || `HTTP ${response.status}`);
             }
        }

        const endTime = performance.now();
        setTestResult({
            status: 'success',
            latency: Math.round(endTime - startTime),
            message: 'Connection successful'
        });
        toast.success(t('ai_config.connection_verified'));
        setConfig({
          apiKey: localKey,
          model,
          baseUrl,
          temperature,
          maxTokens,
          enableSearch,
          searchProvider,
          googleSearchApiKey: localGoogleKey,
          googleSearchCx,
          serperApiKey: localSerperKey,
          yandexSearchApiKey: localYandexKey,
          yandexSearchLogin,
          useSystemProxy: localUseSystemProxy,
          proxyProtocol: localProxyProtocol,
          proxyHost: localProxyHost,
          proxyPort: localProxyPort,
          proxyUsername: localProxyUsername,
          proxyPassword: localProxyPassword
        });
        toast.success(t('ai_config.auto_saved_after_test'));

    } catch (error: any) {
        setTestResult({
            status: 'error',
            latency: null,
            message: error.message || 'Connection failed'
        });
        toast.error(`${t('ai_config.connection_failed_prefix')}${error.message}`);
    } finally {
        setIsTesting(false);
    }
  };

  const availableModels = PROVIDER_MODELS[provider] || [];
  const isKnownModel = availableModels.some(m => m.name === model);
  const showInput = provider === 'custom' || !isKnownModel || isManualInput;

  return (
    <div className="bg-theme-surface border border-theme-border rounded-xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-6 border-b border-theme-border pb-4">
        <Activity className="w-6 h-6 text-theme-accent" />
        <h2 className="text-xl font-bold text-theme-text">{t('ai_config.title')}</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-theme-text mb-1">{t('ai_config.provider_label')}</label>
            <select 
              value={provider} 
              onChange={(e) => setProvider(e.target.value as AIProvider)}
              className="w-full px-4 py-2 rounded-lg border bg-theme-bg border-theme-border text-theme-text focus:ring-2 focus:ring-theme-accent outline-none"
            >
              {PROVIDER_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-theme-text mb-1">{t('ai_config.base_url_label')}</label>
            <input 
              type="text" 
              value={baseUrl}
              onChange={(e) => setConfig({ baseUrl: e.target.value })}
              className="w-full px-4 py-2 rounded-lg border bg-theme-bg border-theme-border text-theme-text focus:ring-2 focus:ring-theme-accent outline-none"
              placeholder="https://api.example.com/v1"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-theme-text mb-1">{t('ai_config.api_key_label')}</label>
            <div className="relative">
              <input 
                type={showKey ? "text" : "password"} 
                value={localKey}
                onChange={(e) => setLocalKey(e.target.value)}
                className="w-full px-4 py-2 pr-10 rounded-lg border bg-theme-bg border-theme-border text-theme-text focus:ring-2 focus:ring-theme-accent outline-none"
                placeholder="sk-..."
              />
              <button 
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-subtext hover:text-theme-text"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-theme-subtext mt-1 flex items-center gap-1">
              <Info className="w-3 h-3" />
              {t('ai_config.stored_locally')}
            </p>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-theme-text mb-1">{t('ai_config.model_name_label')}</label>
            <div className="relative">
               {showInput ? (
                 <div className="flex gap-2">
                   <input 
                     type="text" 
                     value={model} 
                     onChange={(e) => setConfig({ model: e.target.value })}
                     className="w-full px-4 py-2 rounded-lg border bg-theme-bg border-theme-border text-theme-text focus:ring-2 focus:ring-theme-accent outline-none"
                     placeholder={provider === 'custom' ? t('ai_config.enter_model_name') : t('ai_config.enter_custom_model_name')}
                   />
                   {provider !== 'custom' && (
                     <button
                        onClick={() => {
                            setIsManualInput(false);
                            // If current model is not in list, revert to default
                            if (!availableModels.some(m => m.name === model)) {
                                 setConfig({ model: availableModels[0]?.name || '' });
                            }
                        }}
                        className="px-3 py-2 rounded-lg border border-theme-border bg-theme-surface hover:bg-theme-bg text-theme-subtext transition-colors"
                        title={t('ai_config.switch_to_list')}
                     >
                        <List className="w-4 h-4" />
                     </button>
                   )}
                 </div>
               ) : (
                 <select 
                   value={model} 
                   onChange={(e) => {
                       if (e.target.value === '__manual__') {
                           setIsManualInput(true);
                       } else {
                           setConfig({ model: e.target.value });
                       }
                   }}
                   className="w-full px-4 py-2 rounded-lg border bg-theme-bg border-theme-border text-theme-text focus:ring-2 focus:ring-theme-accent outline-none"
                 >
                   {availableModels.map(m => (
                     <option key={m.name} value={m.name}>
                       {m.name} ({m.version} - {m.releaseDate})
                     </option>
                   ))}
                   <option value="__manual__" className="text-theme-accent font-medium bg-theme-surface">
                       {t('ai_config.manual_input')}
                   </option>
                 </select>
               )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-theme-text mb-1">
              {t('ai_config.temperature')} ({temperature})
            </label>
            <input 
              type="range" 
              min="0" 
              max="1" 
              step="0.1" 
              value={temperature}
              onChange={(e) => setConfig({ temperature: parseFloat(e.target.value) })}
              className="w-full h-2 bg-theme-border rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-xs text-theme-subtext mt-1">
              <span>{t('ai_config.temp_precise')}</span>
              <span>{t('ai_config.temp_balanced')}</span>
              <span>{t('ai_config.temp_creative')}</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-theme-text mb-1">{t('ai_config.max_tokens')}</label>
            <input 
              type="number" 
              value={maxTokens}
              onChange={(e) => setConfig({ maxTokens: parseInt(e.target.value) })}
              className="w-full px-4 py-2 rounded-lg border bg-theme-bg border-theme-border text-theme-text focus:ring-2 focus:ring-theme-accent outline-none"
            />
          </div>
        </div>
      </div>

      {/* Web Search Configuration */}
      <div className="mt-6 border-t border-theme-border pt-6">
        <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-theme-accent" />
                <h3 className="text-lg font-semibold text-theme-text">{t('ai_config.web_search_capabilities')}</h3>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                checked={enableSearch} 
                onChange={(e) => setConfig({ enableSearch: e.target.checked })} 
                className="sr-only peer" 
              />
              <div className="w-11 h-6 bg-theme-border peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-theme-accent rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-theme-accent-warm peer-checked:to-theme-accent-warm-2"></div>
              <span className="ms-3 text-sm font-medium text-theme-text">{t('ai_config.enable_web_search')}</span>
            </label>
        </div>

        {enableSearch && (
          <div className="bg-theme-bg/50 p-4 rounded-lg border border-theme-border space-y-4">
                {/* Search Provider Selection */}
                <div>
                    <label className="block text-sm font-medium text-theme-text mb-1">{t('ai_config.search_engine')}</label>
                    <div className="flex items-center gap-2">
                        <Search className="w-4 h-4 text-theme-subtext" />
                        <select 
                            value={searchProvider} 
                            onChange={(e) => setConfig({ searchProvider: e.target.value as SearchProvider })}
                            className="flex-1 px-4 py-2 rounded-lg border bg-theme-bg border-theme-border text-theme-text focus:ring-2 focus:ring-theme-accent outline-none"
                        >
                            {SEARCH_PROVIDER_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Google Configuration */}
                {searchProvider === 'google' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-theme-text mb-1">{t('ai_config.google_key_label')}</label>
                            <div className="relative">
                                <input 
                                    type={showGoogleKey ? "text" : "password"} 
                                    value={localGoogleKey}
                                    onChange={(e) => setLocalGoogleKey(e.target.value)}
                                    className="w-full px-4 py-2 pr-10 rounded-lg border bg-theme-bg border-theme-border text-theme-text focus:ring-2 focus:ring-theme-accent outline-none"
                                    placeholder="AIza..."
                                />
                                 <button 
                                    type="button"
                                    onClick={() => setShowGoogleKey(!showGoogleKey)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-subtext hover:text-theme-text"
                                  >
                                    {showGoogleKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                  </button>
                            </div>
                             <a href="https://developers.google.com/custom-search/v1/overview" target="_blank" rel="noreferrer" className="text-xs text-theme-accent hover:underline mt-1 inline-block">
                                {t('ai_config.get_google_key')}
                            </a>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-theme-text mb-1">{t('ai_config.google_cx_label')}</label>
                            <input 
                                type="text" 
                                value={googleSearchCx}
                                onChange={(e) => setConfig({ googleSearchCx: e.target.value })}
                                className="w-full px-4 py-2 rounded-lg border bg-theme-bg border-theme-border text-theme-text focus:ring-2 focus:ring-theme-accent outline-none"
                                placeholder="0123456789..."
                            />
                            <a href="https://programmablesearchengine.google.com/controlpanel/all" target="_blank" rel="noreferrer" className="text-xs text-theme-accent hover:underline mt-1 inline-block">
                                {t('ai_config.get_google_cx')}
                            </a>
                        </div>
                    </div>
                )}

                {/* Serper Configuration */}
                {searchProvider === 'serper' && (
                     <div>
                        <label className="block text-sm font-medium text-theme-text mb-1">{t('ai_config.serper_key_label')}</label>
                        <div className="relative">
                            <input 
                                type={showSerperKey ? "text" : "password"} 
                                value={localSerperKey}
                                onChange={(e) => setLocalSerperKey(e.target.value)}
                                className="w-full px-4 py-2 pr-10 rounded-lg border bg-theme-bg border-theme-border text-theme-text focus:ring-2 focus:ring-theme-accent outline-none"
                                placeholder={t('ai_config.serper_key_placeholder')}
                            />
                             <button 
                                type="button"
                                onClick={() => setShowSerperKey(!showSerperKey)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-subtext hover:text-theme-text"
                              >
                                {showSerperKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                        </div>
                         <a href="https://serper.dev/" target="_blank" rel="noreferrer" className="text-xs text-theme-accent hover:underline mt-1 inline-block">
                            {t('ai_config.get_serper_key')}
                        </a>
                    </div>
                )}

                {/* Yandex Configuration */}
                {searchProvider === 'yandex' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-theme-text mb-1">{t('ai_config.yandex_user_label')}</label>
                            <input 
                                type="text" 
                                value={yandexSearchLogin}
                                onChange={(e) => setConfig({ yandexSearchLogin: e.target.value })}
                                className="w-full px-4 py-2 rounded-lg border bg-theme-bg border-theme-border text-theme-text focus:ring-2 focus:ring-theme-accent outline-none"
                                placeholder={t('ai_config.yandex_user_placeholder')}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-theme-text mb-1">{t('ai_config.yandex_key_label')}</label>
                            <div className="relative">
                                <input 
                                    type={showYandexKey ? "text" : "password"} 
                                    value={localYandexKey}
                                    onChange={(e) => setLocalYandexKey(e.target.value)}
                                    className="w-full px-4 py-2 pr-10 rounded-lg border bg-theme-bg border-theme-border text-theme-text focus:ring-2 focus:ring-theme-accent outline-none"
                                    placeholder={t('ai_config.yandex_key_placeholder')}
                                />
                                 <button 
                                    type="button"
                                    onClick={() => setShowYandexKey(!showYandexKey)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-subtext hover:text-theme-text"
                                  >
                                    {showYandexKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                  </button>
                            </div>
                             <a href="https://xml.yandex.com/" target="_blank" rel="noreferrer" className="text-xs text-theme-accent hover:underline mt-1 inline-block">
                                {t('ai_config.get_yandex_key')}
                            </a>
                        </div>
                    </div>
                )}

                

            {/* Proxy Settings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-theme-text">{t('ai_config.use_system_proxy')}</label>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={localUseSystemProxy} 
                    onChange={(e) => setLocalUseSystemProxy(e.target.checked)} 
                    className="sr-only peer" 
                  />
                  <div className="w-11 h-6 bg-theme-border rounded-full peer peer-focus:ring-2 peer-focus:ring-theme-accent peer-checked:bg-gradient-to-r peer-checked:from-theme-accent-warm peer-checked:to-theme-accent-warm-2 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
                </label>
              </div>
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={handleTestProxy}
                  disabled={isTesting}
                  className="px-3 py-2 rounded-lg text-sm font-medium border-2 border-theme-accent bg-theme-surface hover:bg-theme-bg text-theme-text disabled:opacity-50"
                >
                  {isTesting ? t('ai_config.testing_proxy') : t('ai_config.test_proxy')}
                </button>
              </div>
              {!localUseSystemProxy && (
                <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-theme-text mb-1">{t('ai_config.proxy_protocol')}</label>
                    <select 
                      value={localProxyProtocol}
                      onChange={(e) => setLocalProxyProtocol(e.target.value as 'http' | 'socks5')}
                      className="w-full px-4 py-2 rounded-lg border bg-theme-bg border-theme-border text-theme-text focus:ring-2 focus:ring-theme-accent outline-none"
                    >
                      <option value="http">HTTP</option>
                      <option value="socks5">SOCKS5</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text mb-1">{t('ai_config.proxy_host')}</label>
                    <input 
                      type="text" 
                      value={localProxyHost}
                      onChange={(e) => setLocalProxyHost(e.target.value)}
                      className="w-full px-4 py-2 rounded-lg border bg-theme-bg border-theme-border text-theme-text focus:ring-2 focus:ring-theme-accent outline-none"
                      placeholder="127.0.0.1"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text mb-1">{t('ai_config.proxy_port')}</label>
                    <input 
                      type="text" 
                      value={localProxyPort}
                      onChange={(e) => setLocalProxyPort(e.target.value)}
                      className="w-full px-4 py-2 rounded-lg border bg-theme-bg border-theme-border text-theme-text focus:ring-2 focus:ring-theme-accent outline-none"
                      placeholder="7890"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text mb-1">{t('ai_config.proxy_username')}</label>
                    <input 
                      type="text" 
                      value={localProxyUsername}
                      onChange={(e) => setLocalProxyUsername(e.target.value)}
                      className="w-full px-4 py-2 rounded-lg border bg-theme-bg border-theme-border text-theme-text focus:ring-2 focus:ring-theme-accent outline-none"
                      placeholder=""
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text mb-1">{t('ai_config.proxy_password')}</label>
                    <input 
                      type="password" 
                      value={localProxyPassword}
                      onChange={(e) => setLocalProxyPassword(e.target.value)}
                      className="w-full px-4 py-2 rounded-lg border bg-theme-bg border-theme-border text-theme-text focus:ring-2 focus:ring-theme-accent outline-none"
                      placeholder=""
                    />
                  </div>
                  <div className="md:col-span-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setIsProxyHelpOpen(true)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border-2 border-theme-accent bg-theme-surface hover:bg-theme-bg text-theme-text"
                    >
                      <Info className="w-4 h-4" />
                      {t('ai_config.proxy_help_btn')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 flex flex-col md:flex-row items-center justify-between gap-4 border-t border-theme-border pt-6">
        <div className="flex items-center gap-4 w-full md:w-auto">
            <button 
                onClick={handleTestConnection}
                disabled={isTesting}
                className={clsx(
                    "px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors w-full md:w-auto justify-center",
                    isTesting 
                        ? "bg-theme-surface border border-theme-border text-theme-subtext cursor-wait"
                        : "bg-theme-surface border-2 border-theme-accent hover:bg-theme-bg text-theme-text"
                )}
            >
                <Activity className={clsx("w-4 h-4", isTesting && "animate-spin")} />
                {isTesting ? t('ai_config.testing_btn') : t('ai_config.test_connection_btn')}
            </button>
            
            {testResult.status && (
                <div className={clsx(
                    "flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border",
                    testResult.status === 'success' 
                        ? "bg-green-500/10 border-green-500/20 text-green-600"
                        : "bg-red-500/10 border-red-500/20 text-red-600"
                )}>
                    {testResult.status === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    <span>
                        {testResult.status === 'success' 
                            ? `${testResult.latency}ms` 
                            : t('ai_config.test_failed')}
                    </span>
                </div>
            )}
        </div>

        <button 
            onClick={handleSave}
            className="px-6 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors bg-theme-accent text-theme-bg hover:bg-theme-accent-hover shadow-lg w-full md:w-auto justify-center border-2 border-theme-accent"
        >
            <Save className="w-4 h-4" />
            {t('ai_config.save_configuration')}
        </button>
      </div>
      
      <div className="mt-4 text-center md:text-right">
        <a 
            href={
                provider === 'moonshot' ? 'https://platform.moonshot.cn/docs' :
                provider === 'openai' ? 'https://platform.openai.com/docs' :
                provider === 'deepseek' ? 'https://api-docs.deepseek.com/' :
                provider === 'qwen' ? 'https://help.aliyun.com/zh/model-studio/developer-reference/use-compatible-text-generation-interfaces' :
                provider === 'google' ? 'https://ai.google.dev/gemini-api/docs/openai' :
                provider === 'mistral' ? 'https://docs.mistral.ai/' :
                '#'
            } 
            target="_blank" 
            rel="noopener noreferrer" 
            className="text-xs text-theme-accent hover:underline"
        >
            {t('ai_config.view_api_docs')}
        </a>
      </div>
      {isProxyHelpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-theme-surface border border-theme-border rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-4 border-b border-theme-border">
              <div className="flex items-center gap-2">
                <Info className="w-5 h-5 text-theme-accent" />
                <h3 className="text-lg font-bold text-theme-text">{t('ai_config.proxy_help_title')}</h3>
              </div>
              <button onClick={() => setIsProxyHelpOpen(false)} className="p-1 hover:bg-theme-bg rounded-full transition-colors">
                <EyeOff className="w-5 h-5 text-theme-subtext" />
              </button>
            </div>
            <div className="p-4 space-y-3 bg-theme-bg/60 rounded-lg border-2 border-theme-accent">
              <p className="text-sm text-theme-subtext">{t('ai_config.proxy_help_intro')}</p>
              <ul className="list-disc list-inside space-y-2 text-sm text-theme-text marker:text-theme-accent">
                <li>{t('ai_config.proxy_help_item_sys_proxy')}</li>
                <li>{t('ai_config.proxy_help_item_custom_proxy')}</li>
                <li>{t('ai_config.proxy_help_item_protocol')}</li>
                <li>{t('ai_config.proxy_help_item_auth')}</li>
                <li>{t('ai_config.proxy_help_item_examples')}</li>
                <li>{t('ai_config.proxy_help_item_test')}</li>
              </ul>
            </div>
            <div className="p-4 border-t border-theme-border flex justify-end">
              <button onClick={() => setIsProxyHelpOpen(false)} className="px-4 py-2 rounded-lg text-sm font-medium bg-theme-accent text-theme-bg hover:bg-theme-accent-hover border-2 border-theme-accent">
                {t('ai_config.proxy_help_close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
