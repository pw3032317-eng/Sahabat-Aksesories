import { useCallback, useEffect, useRef, useState } from 'react';
import { FKEYS, ICON_DATA_URI, MENUS } from './constants/branding';
import {
  callApi,
  isIdleExpired,
  isMobileDevice,
  probeServerHealth,
  readStoredSession,
  registerSessionExpiredHandler,
  signOutAccount,
  subscribeAuthSession,
  subscribeNetworkStatus,
  touchUserActivity,
} from './services/api';
import type {
  CartItem,
  GlobalTransactionSearchItem,
  PageId,
  Product,
  Session,
  TransactionNote,
} from './types/pos';
import { ToastContainer, type ToastItem } from './components/ui/Toast';
import { ConfirmModal, ReceiptModal } from './components/ui/Dialog';
import { GlobalHelpModal } from './components/ui/GlobalHelpModal';
import { ProductDetailModal } from './components/ui/ProductDetailModal';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { TransactionPage } from './pages/TransactionPage';
import { SearchPage } from './pages/SearchPage';
import { ProductPage } from './pages/ProductPage';
import { ExpensePage } from './pages/ExpensePage';
import { ReportPage } from './pages/ReportPage';
import { MasterPage } from './pages/MasterPage';
import { UtilityPage } from './pages/UtilityPage';
import { AccountPage } from './pages/AccountPage';

function getInitialDarkTheme(): boolean {
  try {
    const saved = localStorage.getItem('sahabat_theme');
    if (saved === 'dark') return true;
    if (saved === 'light') return false;
  } catch {
    // ignore
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function getPageFromHash(): PageId {
  const match = location.hash.match(/^#\/(\w+)/);
  const candidate = match?.[1] as PageId | undefined;
  if (candidate && MENUS.some((m) => m.id === candidate)) {
    return candidate;
  }
  return 'dashboard';
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => readStoredSession());
  const sessionRef = useRef<Session | null>(session);
  sessionRef.current = session;
  const [activePage, setActivePage] = useState<PageId>(() => getPageFromHash());
  const [products, setProducts] = useState<Product[]>([]);
  const [globalTransactions, setGlobalTransactions] = useState<GlobalTransactionSearchItem[]>([]);
  const [txRefreshKey, setTxRefreshKey] = useState(0);
  const [salesCart, setSalesCart] = useState<CartItem[]>([]);
  const [purchaseCart, setPurchaseCart] = useState<CartItem[]>([]);
  const [initialSearchFilter, setInitialSearchFilter] = useState<'' | 'low' | 'out'>('');

  const [dark, setDark] = useState<boolean>(() => getInitialDarkTheme());
  const [offline, setOffline] = useState<boolean>(() => !navigator.onLine);
  const [checkingConnection, setCheckingConnection] = useState<boolean>(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [receiptModal, setReceiptModal] = useState<{
    note: TransactionNote;
    kind: 'sales' | 'purchase';
  } | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Apply favicon dynamically
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.href = ICON_DATA_URI;
    document.head.appendChild(link);
    return () => link.remove();
  }, []);

  // Sync dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add('dark');
      try {
        localStorage.setItem('sahabat_theme', 'dark');
      } catch {
        // ignore
      }
    } else {
      root.classList.remove('dark');
      try {
        localStorage.setItem('sahabat_theme', 'light');
      } catch {
        // ignore
      }
    }
  }, [dark]);

  // Online / Offline listeners + live server reachability check
  useEffect(() => {
    const unsubNet = subscribeNetworkStatus((online) => {
      setOffline(!online);
    });
    const onOnline = () => {
      setOffline(false);
      probeServerHealth().catch(() => {});
    };
    const onOffline = () => setOffline(true);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        if (!navigator.onLine) {
          setOffline(true);
        } else {
          probeServerHealth().catch(() => {});
        }
      }
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);

    // Initial check + lightweight periodic probe for intermittent connectivity
    probeServerHealth().catch(() => {});
    const probeTimer = window.setInterval(() => {
      if (!document.hidden) {
        probeServerHealth().catch(() => {});
      }
    }, 25000);

    return () => {
      unsubNet();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(probeTimer);
    };
  }, []);

  const addToast = useCallback(
    (
      message: string,
      type: 'ok' | 'warn' | 'err' | 'info' = 'info',
      actionLabel?: string,
      onAction?: () => void,
    ) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setToasts((prev) => [...prev.slice(-3), { id, message, type, actionLabel, onAction }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, actionLabel ? 5500 : 3500);
    },
    [],
  );

  const handleCheckConnection = useCallback(async () => {
    setCheckingConnection(true);
    try {
      const ok = await probeServerHealth();
      setOffline(!ok);
      addToast(
        ok ? 'Koneksi terhubung (Online)' : 'Masih offline — periksa koneksi internet Anda',
        ok ? 'ok' : 'warn',
      );
    } finally {
      setCheckingConnection(false);
    }
  }, [addToast]);

  const clearUiModals = useCallback(() => {
    setDetailProduct(null);
    setReceiptModal(null);
    setHelpOpen(false);
    setInitialSearchFilter('');
  }, []);

  // Subscribe to Firebase Authentication state (in-memory ID token)
  useEffect(() => {
    const unsub = subscribeAuthSession(
      (nextSession) => {
        setSession((prev) => {
          if (prev?.email && nextSession?.email && prev.email !== nextSession.email) {
            setSalesCart([]);
            setPurchaseCart([]);
          }
          if (!nextSession) {
            setProducts([]);
            setGlobalTransactions([]);
          }
          return nextSession;
        });
      },
      (errMessage) => {
        addToast(errMessage, 'err');
      },
    );
    return () => unsub();
  }, [addToast]);

  const canAccess = useCallback(
    (page: PageId): boolean => {
      if (!session) return false;
      if (page === 'utility' || page === 'account') {
        return session.role === 'owner';
      }
      if (session.role === 'owner' || session.perms === '*' || page === 'dashboard') {
        return true;
      }
      return Array.isArray(session.perms) && session.perms.includes(page);
    },
    [session],
  );

  const navigate = useCallback(
    (page: PageId) => {
      if (!canAccess(page)) {
        addToast('Anda tidak memiliki akses ke menu ini', 'err');
        setActivePage('dashboard');
        location.hash = '#/dashboard';
        return;
      }
      setActivePage(page);
      if (location.hash !== `#/${page}`) {
        location.hash = `#/${page}`;
      }
    },
    [canAccess, addToast],
  );

  // Sync hash changes
  useEffect(() => {
    const onHashChange = () => {
      const target = getPageFromHash();
      if (session && !canAccess(target)) {
        setActivePage('dashboard');
      } else {
        setActivePage(target);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [session, canAccess]);

  // Update document title
  useEffect(() => {
    if (!session) {
      document.title = 'Masuk — SAHABAT POS';
      return;
    }
    const label = MENUS.find((m) => m.id === activePage)?.label || 'Dashboard';
    document.title = `${label} — SAHABAT POS`;
  }, [session, activePage]);

  // Keyboard shortcuts (F1-F9 menu navigation, F10 global help overlay)
  useEffect(() => {
    if (!session) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F10') {
        e.preventDefault();
        if (helpOpen) {
          setHelpOpen(false);
        } else if (!document.querySelector('[role="dialog"]')) {
          setHelpOpen(true);
        }
        return;
      }

      const targetPage = FKEYS[e.key];
      if (targetPage && (!document.querySelector('[role="dialog"]') || helpOpen)) {
        e.preventDefault();
        if (helpOpen) setHelpOpen(false);
        navigate(targetPage);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, navigate, helpOpen]);

  const forceAutoLogout = useCallback(
    (message: string) => {
      if (!sessionRef.current) return;
      sessionRef.current = null;
      signOutAccount().catch(() => {});
      setSession(null);
      setProducts([]);
      setGlobalTransactions([]);
      setConfirmLogout(false);
      clearUiModals();
      addToast(message, 'warn');
    },
    [addToast, clearUiModals],
  );

  // Session expiration callback
  useEffect(() => {
    registerSessionExpiredHandler((reason) => {
      forceAutoLogout(reason || 'Sesi berakhir, silakan masuk lagi');
    });
  }, [forceAutoLogout]);

  // 20-minute inactivity & app-reopen auto-logout on mobile devices (desktop stays signed in until explicit logout)
  useEffect(() => {
    if (!session) return;

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'sahabat_active_session' && !e.newValue) {
        forceAutoLogout('Anda telah keluar dari aplikasi.');
      }
    };
    window.addEventListener('storage', onStorage);

    if (!isMobileDevice()) {
      return () => {
        window.removeEventListener('storage', onStorage);
      };
    }

    const checkAndTrack = (onlyCheck = false) => {
      if (isIdleExpired()) {
        forceAutoLogout('Tidak ada aktivitas selama 20 menit di HP. Silakan login ulang.');
        return;
      }
      if (!onlyCheck) {
        touchUserActivity();
      }
    };

    const onInteract = () => checkAndTrack(false);
    const onVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        checkAndTrack(true);
      }
    };

    window.addEventListener('pointerdown', onInteract, { passive: true });
    window.addEventListener('keydown', onInteract, { passive: true });
    window.addEventListener('touchstart', onInteract, { passive: true });
    window.addEventListener('scroll', onInteract, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    window.addEventListener('focus', onVisibilityOrFocus);

    const interval = window.setInterval(() => checkAndTrack(true), 15000);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pointerdown', onInteract);
      window.removeEventListener('keydown', onInteract);
      window.removeEventListener('touchstart', onInteract);
      window.removeEventListener('scroll', onInteract);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
      window.removeEventListener('focus', onVisibilityOrFocus);
      window.clearInterval(interval);
    };
  }, [session, forceAutoLogout]);

  const loadGlobalTransactions = useCallback(async () => {
    if (!session) return;
    try {
      const list = await callApi<GlobalTransactionSearchItem[]>(
        'searchGlobalTransactions',
        {},
        session,
      );
      setGlobalTransactions(list || []);
    } catch {
      // non-fatal for global search cache
    }
  }, [session]);

  const loadProducts = useCallback(async (): Promise<Product[]> => {
    if (!session) return [];
    try {
      const list = await callApi<Product[]>('getProducts', {}, session);
      const safeList = list || [];
      setProducts(safeList);
      loadGlobalTransactions();
      return safeList;
    } catch (err) {
      addToast((err as Error).message, 'err');
      return [];
    }
  }, [session, addToast, loadGlobalTransactions]);

  useEffect(() => {
    if (!session) return;
    loadProducts();
    const timer = window.setInterval(loadProducts, 120000);
    return () => window.clearInterval(timer);
  }, [session, loadProducts]);

  useEffect(() => {
    if (!session || txRefreshKey === 0) return;
    loadGlobalTransactions();
  }, [session, txRefreshKey, loadGlobalTransactions]);

  const handleLoginSuccess = (newSession: Session) => {
    if (session?.email && session.email !== newSession.email) {
      setSalesCart([]);
      setPurchaseCart([]);
    }
    setSession(newSession);
    setActivePage('dashboard');
    location.hash = '#/dashboard';
  };

  const handleLogoutConfirm = async () => {
    setConfirmLogout(false);
    try {
      await signOutAccount();
    } catch {
      // ignore
    }
    setSession(null);
    setProducts([]);
    setGlobalTransactions([]);
    setSalesCart([]);
    setPurchaseCart([]);
    clearUiModals();
  };

  const clearInitialSearchFilter = useCallback(() => {
    setInitialSearchFilter('');
  }, []);

  const handleAddProductFromDetail = (product: Product): boolean => {
    if (!product.jasa) {
      if (product.stok <= 0) {
        addToast(`Stok barang "${product.nama}" kosong! Tidak dapat dipilih atau di-checkout.`, 'err');
        return false;
      }
      const inCart = salesCart
        .filter((i) => i.kode === product.kode)
        .reduce((a, i) => a + i.qty, 0);
      if (inCart + 1 > product.stok) {
        addToast(`Stok ${product.nama} habis / tidak cukup`, 'err');
        return false;
      }
    }
    setSalesCart((prev) => {
      const existing = prev.findIndex(
        (i) => i.kode === product.kode && i.harga === product.harga && !i.dp && !i.dr,
      );
      if (existing >= 0) {
        return prev.map((item, idx) =>
          idx === existing ? { ...item, qty: item.qty + 1 } : item,
        );
      }
      return [
        ...prev,
        {
          kode: product.kode,
          nama: product.nama,
          harga: product.harga,
          qty: 1,
          satuan: product.satuan || 'Pcs',
          dp: 0,
          dr: 0,
          tier: 'harga',
          min: product.harga_min || 0,
          hpp: product.hpp || 0,
        },
      ];
    });
    addToast(`"${product.nama}" ditambahkan ke nota`, 'ok', 'Buka Nota', () =>
      navigate('sales'),
    );
    return true;
  };

  const handleSelectGlobalTransaction = useCallback(
    async (tx: GlobalTransactionSearchItem) => {
      if (!session) return;
      try {
        const note = await callApi<TransactionNote>(
          tx.kind === 'sales' ? 'getSale' : 'getPurchase',
          { no: tx.no },
          session,
        );
        setReceiptModal({ note, kind: tx.kind });
      } catch (err) {
        addToast((err as Error).message || 'Gagal membuka detail nota', 'err');
      }
    },
    [session, addToast],
  );

  const handleCancelReceiptNote = async (alasan: string) => {
    if (!receiptModal || !session) return;
    const action = receiptModal.kind === 'sales' ? 'cancelSale' : 'cancelPurchase';
    try {
      await callApi(action, { no: receiptModal.note.no, alasan }, session);
      addToast('Nota berhasil dibatalkan', 'ok');
      setReceiptModal(null);
      setTxRefreshKey((k) => k + 1);
      await loadProducts();
    } catch (err) {
      addToast((err as Error).message, 'err');
    }
  };

  const handleQuickRestock = useCallback(
    (items: Product[]) => {
      if (!items.length) return;
      if (canAccess('purchase')) {
        const existingCodes = new Set(purchaseCart.map((item) => item.kode));
        const toAdd = items.filter((p) => !existingCodes.has(p.kode));
        const alreadyInCart = items.length - toAdd.length;

        if (toAdd.length > 0) {
          setPurchaseCart((prev) => {
            const seen = new Set(prev.map((item) => item.kode));
            const additions: CartItem[] = [];
            for (const p of items) {
              if (seen.has(p.kode)) continue;
              seen.add(p.kode);
              additions.push({
                kode: p.kode,
                nama: p.nama,
                harga: p.hpp || 0,
                qty: 1,
                satuan: p.satuan || 'Pcs',
                dp: 0,
                dr: 0,
                tier: '',
                min: p.harga_min || 0,
                hpp: p.hpp || 0,
              });
            }
            return additions.length > 0 ? [...prev, ...additions] : prev;
          });
        }

        navigate('purchase');
        if (items.length === 1) {
          addToast(
            toAdd.length > 0
              ? `"${items[0].nama}" ditambahkan ke keranjang Pembelian`
              : `"${items[0].nama}" sudah ada di keranjang Pembelian`,
            'ok',
          );
        } else if (toAdd.length > 0) {
          addToast(
            `${toAdd.length} barang ditambahkan ke keranjang Pembelian${alreadyInCart > 0 ? ` (${alreadyInCart} sudah ada)` : ''}`,
            'ok',
          );
        } else {
          addToast('Semua barang yang dipilih sudah ada di keranjang Pembelian', 'info');
        }
        return;
      }

      if (canAccess('product')) {
        navigate('product');
        addToast(`Buka menu Produk untuk update stok "${items[0].nama}"`, 'info');
        return;
      }

      if (canAccess('search')) {
        setInitialSearchFilter('low');
        navigate('search');
      }
    },
    [canAccess, purchaseCart, navigate, addToast],
  );

  return (
    <>
      <ToastContainer
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />

      {!session ? (
        <LoginPage onSuccess={handleLoginSuccess} />
      ) : (
        <AppShell
          session={session}
          activePage={activePage}
          canAccess={canAccess}
          products={products}
          transactions={globalTransactions}
          salesCartCount={salesCart.reduce((sum, i) => sum + i.qty, 0)}
          dark={dark}
          offline={offline}
          checkingConnection={checkingConnection}
          onCheckConnection={handleCheckConnection}
          onToggleTheme={() => setDark((d) => !d)}
          onNavigate={navigate}
          onSelectGlobalProduct={(p) => setDetailProduct(p)}
          onSelectGlobalTransaction={handleSelectGlobalTransaction}
          onOpenHelp={() => setHelpOpen(true)}
          onLogout={() => setConfirmLogout(true)}
        >
          {activePage === 'dashboard' && (
            <DashboardPage
              session={session}
              products={products}
              refreshKey={txRefreshKey}
              canSearch={canAccess('search')}
              canAccess={canAccess}
              onNavigate={navigate}
              onGoLowStock={() => {
                setInitialSearchFilter('low');
                navigate('search');
              }}
              onGoOutStock={() => {
                setInitialSearchFilter('out');
                navigate('search');
              }}
              onQuickRestock={handleQuickRestock}
              onOpenNote={(note) => setReceiptModal({ note, kind: 'sales' })}
              onToast={addToast}
            />
          )}

          {activePage === 'sales' && (
            <TransactionPage
              kind="sales"
              session={session}
              products={products}
              refreshKey={txRefreshKey}
              cart={salesCart}
              onChangeCart={setSalesCart}
              onRefreshProducts={loadProducts}
              onOpenNote={(note) => setReceiptModal({ note, kind: 'sales' })}
              onToast={addToast}
            />
          )}

          {activePage === 'purchase' && (
            <TransactionPage
              kind="purchase"
              session={session}
              products={products}
              refreshKey={txRefreshKey}
              cart={purchaseCart}
              onChangeCart={setPurchaseCart}
              onRefreshProducts={loadProducts}
              onOpenNote={(note) => setReceiptModal({ note, kind: 'purchase' })}
              onToast={addToast}
            />
          )}

          {activePage === 'expense' && (
            <ExpensePage session={session} onToast={addToast} />
          )}

          {activePage === 'product' && (
            <ProductPage
              session={session}
              products={products}
              onReload={loadProducts}
              onToast={addToast}
            />
          )}

          {activePage === 'search' && (
            <SearchPage
              products={products}
              initialStockFilter={initialSearchFilter}
              onClearInitialFilter={clearInitialSearchFilter}
              onReload={loadProducts}
              onSelectProduct={(p) => setDetailProduct(p)}
              onToast={addToast}
            />
          )}

          {activePage === 'report' && (
            <ReportPage session={session} onToast={addToast} />
          )}

          {activePage === 'master' && (
            <MasterPage session={session} onToast={addToast} />
          )}

          {activePage === 'utility' && (
            <UtilityPage
              session={session}
              onRefreshProducts={async () => {
                setTxRefreshKey((k) => k + 1);
                return loadProducts();
              }}
              onToast={addToast}
            />
          )}

          {activePage === 'account' && (
            <AccountPage session={session} onToast={addToast} />
          )}
        </AppShell>
      )}

      {detailProduct && session && (
        <ProductDetailModal
          product={detailProduct}
          isOwner={session.role === 'owner'}
          canSell={canAccess('sales')}
          onAddToCart={handleAddProductFromDetail}
          onClose={() => setDetailProduct(null)}
        />
      )}

      {receiptModal && session && (
        <ReceiptModal
          note={receiptModal.note}
          kind={receiptModal.kind}
          isOwner={session.role === 'owner'}
          onCancelNote={handleCancelReceiptNote}
          onToast={addToast}
          onClose={() => setReceiptModal(null)}
        />
      )}

      {confirmLogout && (
        <ConfirmModal
          message="Keluar dari aplikasi SAHABAT POS?"
          confirmLabel="Keluar"
          danger
          onCancel={() => setConfirmLogout(false)}
          onConfirm={handleLogoutConfirm}
        />
      )}

      {helpOpen && session && (
        <GlobalHelpModal
          activePage={activePage}
          canAccess={canAccess}
          onNavigate={navigate}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </>
  );
}
