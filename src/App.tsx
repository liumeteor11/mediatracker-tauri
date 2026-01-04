import React, { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { SearchPage } from './pages/SearchPage';
import { CollectionPage } from './pages/CollectionPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuthStore } from './store/useAuthStore';
import { useCollectionStore } from './store/useCollectionStore';
import { checkUpdates } from './services/aiService';
import { useTranslation } from 'react-i18next';

// Protected Route Wrapper
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuthStore();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

const App: React.FC = () => {
  const { t } = useTranslation();
  const { initialize } = useCollectionStore();

  // Initialize store on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Auto-refresh logic on app mount
  useEffect(() => {
    const refreshUpdates = async () => {
      const { collection, updateItem, initialized } = useCollectionStore.getState();
      
      if (!initialized) return; // Wait for store to be ready

      const now = Date.now();
      
      // Filter items: Ongoing AND (Notification Enabled OR Undefined) AND (Not checked in last 24h)
      const itemsToCheck = collection.filter(item => 
        item.isOngoing && 
        item.notificationEnabled !== false && 
        (!item.lastCheckedAt || now - item.lastCheckedAt > 24 * 60 * 60 * 1000)
      );

      if (itemsToCheck.length > 0) {
        console.log("Checking updates for:", itemsToCheck.map(i => i.title));
        const updates = await checkUpdates(itemsToCheck);
        
        let updateCount = 0;
        updates.forEach(update => {
          const originalItem = itemsToCheck.find(i => i.id === update.id);
          if (originalItem) {
             // Only update if info changed to avoid unnecessary writes
             if (update.latestUpdateInfo !== originalItem.latestUpdateInfo) {
               updateItem(update.id, {
                 latestUpdateInfo: update.latestUpdateInfo,
                 isOngoing: update.isOngoing,
                 lastCheckedAt: now
               });
               updateCount++;
             } else {
               updateItem(update.id, { lastCheckedAt: now });
             }
          }
        });

        if (updateCount > 0) {
          toast.info(t('app.updated_tracking_info', { count: updateCount }));
        }
      }
    };

    // Small delay to ensure store is hydrated if initialize is async
    const timer = setTimeout(refreshUpdates, 1000);
    return () => clearTimeout(timer);
  }, []); // This might run before initialize finishes if we don't watch 'initialized'. 
  // But initialize is called in another useEffect.
  // Better to watch 'initialized' in a separate effect or just rely on the check inside.

  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route 
            path="/collection" 
            element={
              <ProtectedRoute>
                <CollectionPage />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/dashboard" 
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            } 
          />
        </Routes>
      </Layout>

      <ToastContainer
          aria-label={t('common.notifications')}
          position="bottom-right" 
          autoClose={3000} 
          hideProgressBar={false}
          newestOnTop
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
          theme="colored"
      />
    </HashRouter>
  );
};

export default App;
