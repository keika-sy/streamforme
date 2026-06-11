// ============================================
// ANIMESTREAM - APP LOGIC v5.1
// Bug Fixed | Mobile Optimized | PWA Ready
// ============================================

const CONFIG = {
    API_BASE: 'https://api.siputzx.my.id/api/anime/otakudesu',
    ITEMS_PER_PAGE: 12,
    DEBOUNCE_DELAY: 300,
    PULL_THRESHOLD: 80,
    CACHE_DURATION: 1000 * 60 * 30,
    TIMEOUT_MS: 12000,
    MAX_HISTORY: 50,
    MAX_WATCHLIST: 100
};

const STORAGE_KEYS = {
    THEME: 'as_theme',
    WATCHLIST: 'as_watchlist',
    HISTORY: 'as_history',
    LAST_VISIT: 'as_lastvisit',
    CACHE: 'as_cache'
};

// ============================================
// SINGLETON APP
// ============================================
const app = (() => {
    'use strict';

    // ---- Private State ----
    let state = {
        currentPage: 'home',
        ongoingData: null,
        searchResults: null,
        detailData: null,
        downloadData: null,
        searchQuery: '',
        selectedQuality: 'all',
        mobileMenuOpen: false,
        loading: false,
        ptrStartY: 0,
        ptrActive: false,
        theme: 'dark',
        watchlist: [],
        history: [],
        filterGenre: 'all',
        sortBy: 'default',
        newEpisodesAvailable: false,
        isOnline: navigator.onLine,
        abortController: null,
        searchTimeout: null,
        imageObserver: null,
        apiCache: new Map()
    };

    let listeners = [];
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // ============================================
    // LIFECYCLE & CLEANUP
    // ============================================
    function addListener(el, evt, fn, opts = {}) {
        el.addEventListener(evt, fn, opts);
        listeners.push({ el, evt, fn });
    }

    function cleanupListeners() {
        listeners.forEach(({ el, evt, fn }) => el.removeEventListener(evt, fn));
        listeners = [];
    }

    function abortPending() {
        if (state.abortController) {
            state.abortController.abort();
            state.abortController = null;
        }
        if (state.searchTimeout) {
            clearTimeout(state.searchTimeout);
            state.searchTimeout = null;
        }
    }

    // ============================================
    // THEME SYSTEM - No FOUC
    // ============================================
    function initTheme() {
        const saved = localStorage.getItem(STORAGE_KEYS.THEME);
        state.theme = saved || 'dark';
        document.documentElement.setAttribute('data-theme', state.theme);
    }

    function toggleTheme() {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem(STORAGE_KEYS.THEME, state.theme);
        document.documentElement.setAttribute('data-theme', state.theme);
        updateThemeIcons();
        showToast(state.theme === 'dark' ? 'Mode gelap aktif 🌙' : 'Mode terang aktif ☀️', 'info');
    }

    function updateThemeIcons() {
        const iconClass = state.theme === 'dark' ? 'fa-moon' : 'fa-sun';
        const themeIcon = $('#themeIcon');
        const mobileThemeIcon = $('#mobileThemeIcon');
        if (themeIcon) themeIcon.className = `fas ${iconClass}`;
        if (mobileThemeIcon) mobileThemeIcon.className = `fas ${iconClass}`;
    }

    // ============================================
    // STORAGE - Safe JSON
    // ============================================
    function safeGet(key, def = []) {
        try { return JSON.parse(localStorage.getItem(key)) || def; }
        catch { return def; }
    }

    function safeSet(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); }
        catch { /* quota exceeded */ }
    }

    // ============================================
    // WATCHLIST
    // ============================================
    function loadWatchlist() {
        state.watchlist = safeGet(STORAGE_KEYS.WATCHLIST);
    }

    function saveWatchlist() {
        safeSet(STORAGE_KEYS.WATCHLIST, state.watchlist.slice(-CONFIG.MAX_WATCHLIST));
    }

    function toggleWatchlist(anime) {
        const idx = state.watchlist.findIndex(w => w.link === anime.link);
        if (idx >= 0) {
            state.watchlist.splice(idx, 1);
            showToast('Dihapus dari Watchlist', 'info');
        } else {
            state.watchlist.push({
                title: anime.title,
                link: anime.link,
                image: anime.image || anime.imageUrl || '',
                addedAt: Date.now()
            });
            showToast('Ditambahkan ke Watchlist ⭐', 'success');
            vibrate([30, 50, 30]);
        }
        saveWatchlist();
        updateWatchlistUI();
    }

    function isInWatchlist(link) {
        return state.watchlist.some(w => w.link === link);
    }

    function updateWatchlistUI() {
        $$('.watchlist-btn, .watchlist-btn-mini').forEach(btn => {
            const link = btn.dataset.link;
            if (!link) return;
            const saved = isInWatchlist(link);
            btn.classList.toggle('saved', saved);
            const icon = btn.querySelector('i');
            if (icon) icon.className = saved ? 'fas fa-heart' : 'far fa-heart';
            if (btn.classList.contains('watchlist-btn') && !btn.classList.contains('watchlist-btn-mini')) {
                const text = btn.querySelector('span');
                if (text) text.textContent = saved ? 'Tersimpan' : 'Simpan';
            }
        });
    }

    // ============================================
    // HISTORY
    // ============================================
    function loadHistory() {
        state.history = safeGet(STORAGE_KEYS.HISTORY);
    }

    function saveHistory() {
        safeSet(STORAGE_KEYS.HISTORY, state.history.slice(-CONFIG.MAX_HISTORY));
    }

    function addToHistory(anime) {
        state.history = state.history.filter(h => h.link !== anime.link);
        state.history.push({
            title: anime.title,
            link: anime.link,
            image: anime.image || '',
            visitedAt: Date.now()
        });
        saveHistory();
    }

    function getHistory() {
        return [...state.history].reverse();
    }

    function clearHistory() {
        state.history = [];
        saveHistory();
        showToast('Riwayat dibersihkan', 'info');
        if (state.currentPage === 'history') renderHistory();
    }

    // ============================================
    // NEW EPISODE BADGE
    // ============================================
    function checkNewEpisodes() {
        const last = parseInt(localStorage.getItem(STORAGE_KEYS.LAST_VISIT) || '0');
        state.newEpisodesAvailable = last && (Date.now() - last) < 86400000;
        localStorage.setItem(STORAGE_KEYS.LAST_VISIT, Date.now().toString());
    }

    // ============================================
    // CACHE SYSTEM
    // ============================================
    function getCached(key) {
        const cached = state.apiCache.get(key);
        if (cached && Date.now() - cached.t < CONFIG.CACHE_DURATION) return cached.d;
        state.apiCache.delete(key);
        return null;
    }

    function setCached(key, data) {
        if (state.apiCache.size > 50) state.apiCache.delete(state.apiCache.keys().next().value);
        state.apiCache.set(key, { d: data, t: Date.now() });
    }

    // ============================================
    // API - Robust with AbortController
    // ============================================
    async function fetchAPI(endpoint) {
        if (!state.isOnline) {
            showToast('Tidak ada koneksi internet', 'error');
            return null;
        }

        const cacheKey = endpoint;
        const cached = getCached(cacheKey);
        if (cached) return cached;

        abortPending();
        state.abortController = new AbortController();
        const timeoutId = setTimeout(() => state.abortController.abort(), CONFIG.TIMEOUT_MS);

        try {
            setLoading(true);
            const res = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
                signal: state.abortController.signal
            });
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setCached(cacheKey, data);
            setLoading(false);
            return data;
        } catch (err) {
            clearTimeout(timeoutId);
            setLoading(false);
            if (err.name === 'AbortError') {
                showToast('Request timeout. Coba lagi.', 'error');
            } else {
                showToast('Gagal memuat: ' + err.message, 'error');
            }
            return null;
        } finally {
            state.abortController = null;
        }
    }

    function setLoading(v) {
        state.loading = v;
        const main = $('#mainContent');
        if (v && main && !main.innerHTML.trim()) {
            main.innerHTML = renderSkeletonGrid();
        }
    }

    // ============================================
    // FILTER & SORT (Client-side)
    // ============================================
    function filterAndSort(list) {
        if (!list) return [];
        let result = [...list];
        if (state.filterGenre !== 'all') {
            const g = state.filterGenre.toLowerCase();
            result = result.filter(a => 
                (a.title && a.title.toLowerCase().includes(g)) ||
                (a.genres && a.genres.toLowerCase().includes(g))
            );
        }
        switch (state.sortBy) {
            case 'rating':
                result.sort((a, b) => parseFloat(b.rating || b.score || 0) - parseFloat(a.rating || a.score || 0));
                break;
            case 'title':
                result.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
                break;
            case 'date':
                result.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
                break;
        }
        return result;
    }

    // ============================================
    // IMAGE LAZY LOADING - IntersectionObserver
    // ============================================
    function setupImageObserver() {
        if (state.imageObserver) state.imageObserver.disconnect();
        state.imageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const src = img.dataset.src;
                    if (src) {
                        img.src = src;
                        img.removeAttribute('data-src');
                    }
                    state.imageObserver.unobserve(img);
                }
            });
        }, { rootMargin: '100px' });
    }

    function observeImages() {
        $$('img[data-src]').forEach(img => state.imageObserver.observe(img));
    }

    // ============================================
    // PULL TO REFRESH - FIXED: event parameter
    // ============================================
    function setupPullToRefresh() {
        const indicator = $('#ptrIndicator');
        if (!indicator) return;

        addListener(document, 'touchstart', (e) => {
            if (window.scrollY === 0) {
                state.ptrStartY = e.touches[0].clientY;
                state.ptrActive = true;
            }
        }, { passive: true });

        addListener(document, 'touchmove', (e) => {
            if (!state.ptrActive) return;
            const diff = e.touches[0].clientY - state.ptrStartY;
            if (diff > 0 && diff < 150) indicator.classList.toggle('visible', diff > 30);
        }, { passive: true });

        // FIXED: Added 'e' parameter to touchend handler
        addListener(document, 'touchend', (e) => {
            if (!state.ptrActive) return;
            const diff = e.changedTouches[0].clientY - state.ptrStartY;
            if (diff > CONFIG.PULL_THRESHOLD) refreshCurrentPage();
            indicator.classList.remove('visible');
            state.ptrActive = false;
        }, { passive: true });
    }

    function refreshCurrentPage() {
        state.apiCache.clear();
        switch (state.currentPage) {
            case 'home': goHome(); break;
            case 'ongoing': loadOngoing(); break;
            case 'search': search(state.searchQuery); break;
            case 'watchlist': renderWatchlist(); break;
            case 'history': renderHistory(); break;
            case 'detail': if (state.detailData) renderDetail(); break;
        }
    }

    // ============================================
    // BOTTOM NAV
    // ============================================
    function setupBottomNav() {
        const nav = $('#bottomNav');
        if (!nav) return;
        const update = () => { nav.style.display = window.innerWidth < 769 ? 'flex' : 'none'; };
        update();
        addListener(window, 'resize', debounce(update, 150));
    }

    function updateBottomNav(page) {
        $$('.bottom-nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === page));
    }

    // ============================================
    // OFFLINE DETECTION
    // ============================================
    function setupNetworkDetection() {
        addListener(window, 'online', () => {
            state.isOnline = true;
            showToast('Koneksi tersambung kembali', 'success');
        });
        addListener(window, 'offline', () => {
            state.isOnline = false;
            showToast('Koneksi terputus', 'error');
        });
    }

    // ============================================
    // EVENT LISTENERS
    // ============================================
    function setupEventListeners() {
        // Close menu on outside click
        addListener(document, 'click', (e) => {
            const menu = $('#mobileMenu');
            const btn = $('.mobile-menu-btn');
            if (state.mobileMenuOpen && menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
                closeMobileMenu();
            }
        });

        // Escape key
        addListener(document, 'keydown', (e) => {
            if (e.key === 'Escape' && state.mobileMenuOpen) closeMobileMenu();
        });

        // Prevent double-tap zoom
        let lastTouchEnd = 0;
        addListener(document, 'touchend', (e) => {
            const now = Date.now();
            if (now - lastTouchEnd <= 300) e.preventDefault();
            lastTouchEnd = now;
        }, { passive: false });
    }

    // ============================================
    // NAVIGATION
    // ============================================
    function navigateTo(page, renderFn) {
        abortPending();
        cleanupListeners();
        state.currentPage = page;
        updateNavActive(page);
        updateBottomNav(page);
        renderFn();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setupEventListeners(); // Re-attach for new DOM
        setupImageObserver();
        observeImages();
    }

    function goHome() {
        navigateTo('home', renderHome);
    }

    function loadOngoing() {
        navigateTo('ongoing', renderOngoing);
    }

    function loadWatchlistPage() {
        navigateTo('watchlist', renderWatchlist);
    }

    function loadHistoryPage() {
        navigateTo('history', renderHistory);
    }

    function focusSearch() {
        if (window.innerWidth < 769) {
            toggleMobileMenu();
            setTimeout(() => {
                const input = $('#mobileSearchInput');
                if (input) input.focus();
            }, 350);
        } else {
            const input = $('#searchInput');
            if (input) { input.focus(); input.scrollIntoView({ behavior: 'smooth' }); }
        }
    }

    function updateNavActive(page) {
        $$('.nav-link, .bottom-nav-item').forEach(link => {
            link.classList.toggle('active', link.dataset.page === page);
        });
    }

    // FIXED: Separate open/close functions instead of toggle
    function openMobileMenu() {
        state.mobileMenuOpen = true;
        const menu = $('#mobileMenu');
        const overlay = $('#mobileOverlay');
        if (menu) menu.classList.add('open');
        if (overlay) overlay.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closeMobileMenu() {
        state.mobileMenuOpen = false;
        const menu = $('#mobileMenu');
        const overlay = $('#mobileOverlay');
        if (menu) menu.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
        document.body.style.overflow = '';
    }

    function toggleMobileMenu() {
        if (state.mobileMenuOpen) closeMobileMenu();
        else openMobileMenu();
    }

    // ============================================
    // SEARCH - FIXED: proper parameter handling
    // ============================================
    function handleSearch(event) {
        if (event.key === 'Enter') {
            const query = event.target.value.trim();
            if (query) search(query);
            event.target.blur();
            return;
        }
        if (state.searchTimeout) clearTimeout(state.searchTimeout);
        state.searchTimeout = setTimeout(() => {
            const query = event.target.value.trim();
            if (query.length >= 2) search(query);
        }, CONFIG.DEBOUNCE_DELAY);
    }

    function handleMobileSearch(event) {
        if (event.key === 'Enter') {
            const query = $('#mobileSearchInput')?.value.trim();
            if (query) { closeMobileMenu(); search(query); }
            event.target.blur();
        }
    }

    async function search(query) {
        if (!query) {
            const input = $('#searchInput');
            query = input ? input.value.trim() : '';
        }
        if (!query) return;

        abortPending();
        state.searchQuery = query;
        state.currentPage = 'search';
        updateNavActive('search');
        updateBottomNav('');

        const data = await fetchAPI(`/search?s=${encodeURIComponent(query)}`);
        if (data?.status) {
            state.searchResults = data.data;
            renderSearchResults(query);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    // ============================================
    // DETAIL
    // ============================================
    async function loadDetail(animeUrl) {
        abortPending();
        state.currentPage = 'detail';
        updateNavActive('');
        updateBottomNav('');

        const data = await fetchAPI(`/detail?url=${encodeURIComponent(animeUrl)}`);
        if (data?.status) {
            state.detailData = data.data;
            addToHistory({
                title: data.data.animeInfo.title,
                link: animeUrl,
                image: data.data.animeInfo.imageUrl
            });
            renderDetail();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            setupImageObserver();
            observeImages();
        }
    }

    async function loadDownload(episodeUrl) {
        const data = await fetchAPI(`/download?url=${encodeURIComponent(episodeUrl)}`);
        if (data?.status) {
            state.downloadData = data.data;
            renderDownloadSection();
        }
    }

    // ============================================
    // RENDER: HOME
    // ============================================
    function renderHome() {
        const main = $('#mainContent');
        if (!main) return;
        const recent = getHistory().slice(0, 5);

        main.innerHTML = `
            <div class="hero">
                <div class="hero-content">
                    <h1><i class="fas fa-tv"></i> AnimeStream</h1>
                    <p>Nonton anime subtitle Indonesia terlengkap dan terupdate.</p>
                    <div class="hero-stats">
                        <div class="hero-stat"><i class="fas fa-heart"></i><span>${state.watchlist.length} Watchlist</span></div>
                        <div class="hero-stat"><i class="fas fa-history"></i><span>${state.history.length} History</span></div>
                    </div>
                </div>
            </div>
            ${recent.length ? `
            <div class="section">
                <div class="section-header">
                    <h2 class="section-title"><i class="fas fa-history"></i> Lanjutkan Nonton</h2>
                    <button class="btn btn-outline btn-sm" onclick="app.loadHistoryPage()">Lihat Semua <i class="fas fa-arrow-right"></i></button>
                </div>
                <div class="anime-grid">${renderHistoryCards(recent)}</div>
            </div>` : ''}
            <div class="section">
                <div class="section-header">
                    <h2 class="section-title"><i class="fas fa-fire"></i> Anime Ongoing</h2>
                    <button class="btn btn-outline btn-sm" onclick="app.loadOngoing()">Lihat Semua <i class="fas fa-arrow-right"></i></button>
                </div>
                <div id="ongoingGrid">${renderSkeletonGrid()}</div>
            </div>
        `;
        fetchOngoingForHome();
    }

    // FIXED: Added try-catch for fetchOngoingForHome
    async function fetchOngoingForHome() {
        try {
            if (state.ongoingData) {
                const grid = $('#ongoingGrid');
                if (grid) grid.innerHTML = renderAnimeCards(state.ongoingData.slice(0, 8));
                return;
            }
            const data = await fetchAPI('/ongoing');
            if (data?.status) {
                state.ongoingData = data.data;
                const grid = $('#ongoingGrid');
                if (grid) grid.innerHTML = renderAnimeCards(data.data.slice(0, 8));
            }
        } catch (err) {
            console.error('fetchOngoingForHome error:', err);
        }
    }

    // ============================================
    // RENDER: ONGOING
    // ============================================
    function renderOngoing() {
        const main = $('#mainContent');
        if (!main) return;
        main.innerHTML = `
            <div class="hero" style="padding:20px 12px 16px">
                <div class="hero-content">
                    <h1><i class="fas fa-fire"></i> Anime Ongoing</h1>
                    <p>Daftar anime yang sedang tayang dan update terbaru.</p>
                </div>
            </div>
            <div class="section">
                <div class="filter-bar">
                    <div class="filter-group">
                        <span class="filter-label"><i class="fas fa-filter"></i></span>
                        <select class="filter-select" onchange="app.setFilter(this.value)">
                            <option value="all">Semua Genre</option>
                            <option value="action">Action</option>
                            <option value="adventure">Adventure</option>
                            <option value="comedy">Comedy</option>
                            <option value="drama">Drama</option>
                            <option value="fantasy">Fantasy</option>
                            <option value="romance">Romance</option>
                            <option value="school">School</option>
                            <option value="shounen">Shounen</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <span class="filter-label"><i class="fas fa-sort"></i></span>
                        <select class="filter-select" onchange="app.setSort(this.value)">
                            <option value="default">Default</option>
                            <option value="rating">Rating</option>
                            <option value="title">Judul</option>
                            <option value="date">Tanggal</option>
                        </select>
                    </div>
                </div>
                <div id="ongoingFullGrid">${renderSkeletonGrid()}</div>
            </div>
        `;
        if (state.ongoingData) {
            renderOngoingList();
        } else {
            fetchOngoingFull();
        }
    }

    async function fetchOngoingFull() {
        const data = await fetchAPI('/ongoing');
        if (data?.status) {
            state.ongoingData = data.data;
            renderOngoingList();
        }
    }

    function renderOngoingList() {
        const grid = $('#ongoingFullGrid');
        if (!grid) return;
        const list = filterAndSort(state.ongoingData);
        grid.innerHTML = list.length ? renderAnimeCards(list) : renderEmptyState('Tidak ada anime', 'Coba filter lain');
    }

    function setFilter(val) { state.filterGenre = val; renderOngoingList(); }
    function setSort(val) { state.sortBy = val; renderOngoingList(); }

    // ============================================
    // RENDER: WATCHLIST
    // ============================================
    function renderWatchlist() {
        const main = $('#mainContent');
        if (!main) return;
        const list = state.watchlist;
        main.innerHTML = `
            <div class="hero" style="padding:20px 12px 16px">
                <div class="hero-content">
                    <h1><i class="fas fa-heart"></i> Watchlist</h1>
                    <p>${list.length} anime tersimpan.</p>
                </div>
            </div>
            <div class="section">
                ${list.length ? `<div class="anime-grid">${renderWatchlistCards(list)}</div>`
                    : renderEmptyState('Watchlist Kosong', 'Klik ❤️ di anime untuk menyimpan')}
            </div>
        `;
        updateWatchlistUI();
    }

    function renderWatchlistCards(list) {
        return list.map(a => `
            <div class="anime-card">
                <div class="poster" onclick="app.loadDetail('${a.link}')">
                    <img data-src="${a.image}" alt="${esc(a.title)}" onerror="this.src='https://via.placeholder.com/200x270/252540/9ca3af?text=No+Image'">
                    <div class="overlay"><div class="play-btn"><i class="fas fa-play"></i></div></div>
                </div>
                <div class="info">
                    <div class="title">${esc(a.title)}</div>
                    <div class="watchlist-actions">
                        <button class="watchlist-btn saved" data-link="${a.link}" onclick="event.stopPropagation(); app.toggleWatchlist({title:'${esc(a.title)}',link:'${a.link}',image:'${a.image}'})">
                            <i class="fas fa-heart"></i> Hapus
                        </button>
                        <button class="watchlist-btn" onclick="app.loadDetail('${a.link}')">
                            <i class="fas fa-play"></i> Tonton
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    // ============================================
    // RENDER: HISTORY
    // ============================================
    function renderHistory() {
        const main = $('#mainContent');
        if (!main) return;
        const list = getHistory();
        main.innerHTML = `
            <div class="hero" style="padding:20px 12px 16px">
                <div class="hero-content">
                    <h1><i class="fas fa-history"></i> Riwayat</h1>
                    <p>${list.length} anime pernah dikunjungi.</p>
                </div>
            </div>
            <div class="section">
                ${list.length ? `
                    <div style="margin-bottom:16px;text-align:right">
                        <button class="btn btn-outline btn-sm" onclick="app.clearHistory()">
                            <i class="fas fa-trash"></i> Bersihkan
                        </button>
                    </div>
                    <div class="anime-grid">${renderHistoryCards(list)}</div>
                ` : renderEmptyState('Belum Ada Riwayat', 'Mulai jelajahi anime!')}
            </div>
        `;
    }

    function renderHistoryCards(list) {
        return list.map(a => `
            <div class="anime-card" onclick="app.loadDetail('${a.link}')">
                <div class="poster">
                    <img data-src="${a.image}" alt="${esc(a.title)}" onerror="this.src='https://via.placeholder.com/200x270/252540/9ca3af?text=No+Image'">
                    <div class="overlay"><div class="play-btn"><i class="fas fa-play"></i></div></div>
                </div>
                <div class="info">
                    <div class="title">${esc(a.title)}</div>
                    <div class="meta"><span><i class="fas fa-clock"></i> ${timeAgo(a.visitedAt)}</span></div>
                </div>
            </div>
        `).join('');
    }

    // ============================================
    // RENDER: SEARCH
    // ============================================
    function renderSearchResults(query) {
        const main = $('#mainContent');
        if (!main) return;
        const results = state.searchResults || [];
        main.innerHTML = `
            <div class="hero" style="padding:20px 12px 16px">
                <div class="hero-content">
                    <h1><i class="fas fa-search"></i> Hasil Pencarian</h1>
                    <p>${results.length} anime untuk "<strong>${esc(query)}</strong>"</p>
                </div>
            </div>
            <div class="section">
                ${results.length ? `<div class="anime-grid">${renderSearchCards(results)}</div>`
                    : renderEmptyState('Tidak ada hasil', 'Coba kata kunci lain')}
            </div>
        `;
        updateWatchlistUI();
        observeImages();
    }

    // ============================================
    // RENDER: DETAIL
    // ============================================
    function renderDetail() {
        const detail = state.detailData;
        if (!detail) return;
        const info = detail.animeInfo;
        const episodes = detail.episodes || [];
        const genres = info.genres ? info.genres.split(',').map(g => g.trim()) : [];
        const isSaved = isInWatchlist(info.link || detail.link);
        const main = $('#mainContent');
        if (!main) return;

        main.innerHTML = `
            <div class="detail-hero">
                <div class="detail-hero-bg" style="background-image:url('${info.imageUrl}')"></div>
                <div class="detail-hero-content">
                    <div class="detail-poster">
                        <img data-src="${info.imageUrl}" alt="${esc(info.title)}" onerror="this.src='https://via.placeholder.com/220x300/252540/9ca3af?text=No+Image'">
                    </div>
                    <div class="detail-info">
                        <button class="back-btn" onclick="app.goHome()"><i class="fas fa-arrow-left"></i> Kembali</button>
                        <h1 class="title">${esc(info.title)}</h1>
                        <p class="jp-title">${esc(info.japaneseTitle || '')}</p>
                        <div class="rating-stars">${renderStars(info.score)} <span class="rating-score">${info.score || 'N/A'}</span></div>
                        <div class="detail-meta">
                            ${renderMetaItem('fa-star', 'Score', info.score)}
                            ${renderMetaItem('fa-tv', 'Type', info.type || 'TV')}
                            ${renderMetaItem('fa-circle', 'Status', info.status)}
                            ${renderMetaItem('fa-film', 'Episodes', info.totalEpisodes)}
                            ${renderMetaItem('fa-clock', 'Duration', info.duration)}
                            ${renderMetaItem('fa-calendar', 'Released', info.releaseDate)}
                            ${renderMetaItem('fa-building', 'Studio', info.studio)}
                        </div>
                        <div class="genres-list">${genres.map(g => `<span class="genre-tag">${esc(g)}</span>`).join('')}</div>
                        <div class="detail-actions" style="margin-top:12px">
                            <button class="btn btn-primary" onclick="app.scrollToEpisodes()"><i class="fas fa-play"></i> Tonton</button>
                            <button class="btn btn-outline watchlist-btn ${isSaved ? 'saved' : ''}" data-link="${info.link || detail.link}" onclick="app.toggleWatchlist({title:'${esc(info.title)}',link:'${info.link || detail.link}',image:'${info.imageUrl}'})">
                                <i class="${isSaved ? 'fas' : 'far'} fa-heart"></i> <span>${isSaved ? 'Tersimpan' : 'Simpan'}</span>
                            </button>
                            <button class="btn btn-outline" onclick="app.shareAnime({title:'${esc(info.title)}'})"><i class="fas fa-share-alt"></i> Share</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="section" id="episodesSection">
                <div class="section-header">
                    <h2 class="section-title"><i class="fas fa-list"></i> Episode (${episodes.length})</h2>
                </div>
                <div class="stats-bar">
                    <div class="stat-item"><i class="fas fa-film"></i><div><div class="stat-value">${episodes.length}</div><div class="stat-label">Total</div></div></div>
                    <div class="stat-item"><i class="fas fa-star"></i><div><div class="stat-value">${info.score || 'N/A'}</div><div class="stat-label">Rating</div></div></div>
                    <div class="stat-item"><i class="fas fa-building"></i><div><div class="stat-value">${esc(info.studio || 'N/A')}</div><div class="stat-label">Studio</div></div></div>
                </div>
                <div class="episode-list">${episodes.map((ep, i) => renderEpisodeItem(ep, i)).join('')}</div>
            </div>
        `;
    }

    function renderMetaItem(icon, label, value) {
        return value ? `<div class="detail-meta-item"><i class="fas ${icon}"></i><span>${label}: <span class="value">${esc(value)}</span></span></div>` : '';
    }

    function renderStars(score) {
        if (!score) return '<i class="far fa-star"></i>'.repeat(5);
        const r = parseFloat(score) / 2;
        let s = '';
        for (let i = 1; i <= 5; i++) {
            if (i <= r) s += '<i class="fas fa-star"></i>';
            else if (i - 0.5 <= r) s += '<i class="fas fa-star-half-alt"></i>';
            else s += '<i class="far fa-star"></i>';
        }
        return s;
    }

    function renderEpisodeItem(ep, idx) {
        const isBatch = ep.title.toLowerCase().includes('batch');
        const match = ep.title.match(/Episode\s+(\d+)/i);
        const epNum = isBatch ? 'BATCH' : (match ? match[1] : idx + 1);
        return `
            <div class="episode-item" onclick="app.loadDownload('${ep.link}')">
                <div class="ep-num">${isBatch ? '<i class="fas fa-archive"></i>' : epNum}</div>
                <div class="ep-info">
                    <div class="ep-title">${esc(ep.title)}</div>
                    <div class="ep-date"><i class="fas fa-calendar-alt"></i> ${ep.date || 'N/A'}</div>
                </div>
                <div class="ep-action"><i class="fas fa-download"></i> Download</div>
            </div>
        `;
    }

    function scrollToEpisodes() {
        const el = $('#episodesSection');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ============================================
    // RENDER: DOWNLOAD - FIXED: proper DOM insertion
    // ============================================
    function renderDownloadSection() {
        const download = state.downloadData;
        if (!download) return;
        const downloads = download.downloads || [];
        const qualities = [...new Set(downloads.map(d => d.quality))];
        const main = $('#mainContent');
        if (!main) return;

        const existing = $('#downloadSection');
        if (existing) existing.remove();

        const section = document.createElement('div');
        section.className = 'section';
        section.id = 'downloadSection';
        section.innerHTML = `
            <div class="section-header">
                <h2 class="section-title"><i class="fas fa-download"></i> Download</h2>
                <button class="btn btn-outline btn-sm" onclick="document.getElementById('downloadSection').remove()">
                    <i class="fas fa-times"></i> Tutup
                </button>
            </div>
            <div class="quality-filter">
                <button class="quality-btn active" onclick="app.filterQuality('all',this)">Semua</button>
                ${qualities.map(q => `<button class="quality-btn" onclick="app.filterQuality('${q}',this)">${q}</button>`).join('')}
            </div>
            <div class="download-grid" id="downloadGrid">
                ${downloads.map(d => `
                    <div class="download-card" data-quality="${d.quality}">
                        <div class="quality-row">
                            <div class="quality"><i class="fas fa-video"></i> ${d.quality}</div>
                            <div class="host"><i class="fas fa-server"></i> ${esc(d.host)}</div>
                        </div>
                        <button class="download-btn" onclick="window.open('${d.link}','_blank')">
                            <i class="fas fa-external-link-alt"></i> Buka Link
                        </button>
                    </div>
                `).join('')}
            </div>
        `;
        main.appendChild(section);
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function filterQuality(quality, btn) {
        state.selectedQuality = quality;
        $$('.quality-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        $$('.download-card').forEach(card => {
            card.style.display = (quality === 'all' || card.dataset.quality === quality) ? 'flex' : 'none';
        });
    }

    // ============================================
    // RENDER: CARDS (Unified)
    // ============================================
    function renderAnimeCards(list) {
        if (!list?.length) return renderEmptyState('Tidak ada anime', 'Data kosong');
        return list.map(a => `
            <div class="anime-card" onclick="app.loadDetail('${a.link}')">
                <div class="poster">
                    <img data-src="${a.image}" alt="${esc(a.title)}" onerror="this.src='https://via.placeholder.com/200x270/252540/9ca3af?text=No+Image'">
                    <span class="badge badge-episode">${a.episode}</span>
                    ${state.newEpisodesAvailable ? '<span class="badge badge-new">BARU</span>' : ''}
                    <div class="overlay"><div class="play-btn"><i class="fas fa-play"></i></div></div>
                </div>
                <div class="info">
                    <div class="title">${esc(a.title)}</div>
                    <div class="meta">
                        <span><i class="fas fa-calendar"></i> ${a.date}</span>
                        <span><i class="fas fa-clock"></i> ${a.type}</span>
                    </div>
                </div>
            </div>
        `).join('');
    }

    // FIXED: Proper spacing in onclick handler
    function renderSearchCards(list) {
        if (!list?.length) return renderEmptyState('Tidak ada hasil', 'Coba kata kunci lain');
        return list.map(a => {
            const saved = isInWatchlist(a.link);
            return `
            <div class="anime-card">
                <div class="poster" onclick="app.loadDetail('${a.link}')">
                    <img data-src="${a.imageUrl}" alt="${esc(a.title)}" onerror="this.src='https://via.placeholder.com/200x270/252540/9ca3af?text=No+Image'">
                    <span class="badge ${a.status === 'Ongoing' ? 'badge-ongoing' : 'badge-complete'}">${a.status}</span>
                    <span class="badge badge-score"><i class="fas fa-star"></i> ${a.rating}</span>
                    <div class="overlay"><div class="play-btn"><i class="fas fa-play"></i></div></div>
                </div>
                <div class="info">
                    <div class="title">${esc(a.title)}</div>
                    <div class="meta"><span><i class="fas fa-film"></i> ${a.genres}</span></div>
                    <button class="watchlist-btn-mini ${saved ? 'saved' : ''}" data-link="${a.link}" onclick="event.stopPropagation(); app.toggleWatchlist({title:'${esc(a.title)}',link:'${a.link}',image:'${a.imageUrl}'})">
                        <i class="${saved ? 'fas' : 'far'} fa-heart"></i>
                    </button>
                </div>
            </div>
        `}).join('');
    }

    // ============================================
    // RENDER: SKELETON & EMPTY
    // ============================================
    function renderSkeletonGrid() {
        return `<div class="anime-grid">${Array(8).fill(0).map(() => `
            <div class="anime-card">
                <div class="poster skeleton skeleton-card"></div>
                <div class="info">
                    <div class="skeleton skeleton-text"></div>
                    <div class="skeleton skeleton-text short"></div>
                </div>
            </div>
        `).join('')}</div>`;
    }

    function renderEmptyState(title, subtitle) {
        return `<div class="empty-state"><i class="fas fa-film"></i><h3>${title}</h3><p>${subtitle}</p></div>`;
    }

    // ============================================
    // SHARE
    // ============================================
    async function shareAnime(anime) {
        const url = window.location.href;
        const text = `Nonton ${anime.title} di AnimeStream!`;
        if (navigator.share) {
            try { await navigator.share({ title: anime.title, text, url }); }
            catch (err) { if (err.name !== 'AbortError') copyToClipboard(url); }
        } else {
            copyToClipboard(url);
        }
    }

    function copyToClipboard(text) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => showToast('Link disalin!', 'success'));
        } else {
            const input = document.createElement('input');
            input.value = text;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            showToast('Link disalin!', 'success');
        }
    }

    // ============================================
    // UTILITIES
    // ============================================
    function esc(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function timeAgo(ts) {
        const s = Math.floor((Date.now() - ts) / 1000);
        if (s < 60) return 'Baru';
        const m = Math.floor(s / 60);
        if (m < 60) return `${m}m`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}j`;
        const d = Math.floor(h / 24);
        if (d < 30) return `${d}h`;
        return `${Math.floor(d / 30)}b`;
    }

    function vibrate(pattern) {
        if (navigator.vibrate) navigator.vibrate(pattern);
    }

    function debounce(fn, ms) {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    }

    function showToast(msg, type = 'info') {
        const container = $('#toastContainer');
        if (!container) return;
        const icons = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle' };
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<i class="fas ${icons[type]}"></i><span>${esc(msg)}</span>`;
        container.appendChild(toast);
        if (type === 'error') vibrate(50);
        if (type === 'success') vibrate([20, 30, 20]);
        setTimeout(() => toast.remove(), 3000);
    }

    // ============================================
    // INIT
    // ============================================
    function init() {
        initTheme();
        loadWatchlist();
        loadHistory();
        checkNewEpisodes();
        setupNetworkDetection();
        setupEventListeners();
        setupPullToRefresh();
        setupBottomNav();
        setupImageObserver();
        goHome();
    }

    // ---- Public API ----
    return {
        init, goHome, loadOngoing, loadWatchlistPage, loadHistoryPage,
        loadDetail, loadDownload, focusSearch, toggleMobileMenu, closeMobileMenu,
        handleSearch, handleMobileSearch, search, mobileSearch: search,
        toggleTheme, toggleWatchlist, shareAnime, clearHistory,
        scrollToEpisodes, filterQuality, setFilter, setSort
    };
})();

// Bootstrap
document.addEventListener('DOMContentLoaded', () => app.init());
