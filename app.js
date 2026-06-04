// ============================================
// ANIMESTREAM - APP LOGIC
// ============================================

const CONFIG = {
    API_BASE: 'https://api.siputzx.my.id/api/anime/otakudesu',
    ITEMS_PER_PAGE: 12,
    DEBOUNCE_DELAY: 400
};

const app = {
    state: {
        currentPage: 'home',
        ongoingData: null,
        searchResults: null,
        detailData: null,
        downloadData: null,
        searchQuery: '',
        selectedQuality: 'all',
        mobileMenuOpen: false,
        loading: false
    },

    // ============================================
    // INITIALIZATION
    // ============================================
    init() {
        this.goHome();
        this.setupEventListeners();
    },

    setupEventListeners() {
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('mobileMenu');
            const btn = document.querySelector('.mobile-menu-btn');
            if (!menu.contains(e.target) && !btn.contains(e.target) && this.state.mobileMenuOpen) {
                this.toggleMobileMenu();
            }
        });
    },

    // ============================================
    // NAVIGATION
    // ============================================
    goHome() {
        this.state.currentPage = 'home';
        this.updateNavActive('home');
        this.renderHome();
    },

    loadOngoing() {
        this.state.currentPage = 'ongoing';
        this.updateNavActive('ongoing');
        this.renderOngoing();
    },

    focusSearch() {
        const input = document.getElementById('searchInput');
        if (input) {
            input.focus();
            input.scrollIntoView({ behavior: 'smooth' });
        }
    },

    updateNavActive(page) {
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.toggle('active', link.dataset.page === page);
        });
    },

    toggleMobileMenu() {
        this.state.mobileMenuOpen = !this.state.mobileMenuOpen;
        document.getElementById('mobileMenu').classList.toggle('open', this.state.mobileMenuOpen);
    },

    // ============================================
    // API CALLS
    // ============================================
    async fetchAPI(endpoint) {
        try {
            this.setLoading(true);
            const response = await fetch(`${CONFIG.API_BASE}${endpoint}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            this.setLoading(false);
            return data;
        } catch (error) {
            this.setLoading(false);
            this.showToast('Gagal memuat data: ' + error.message, 'error');
            console.error('API Error:', error);
            return null;
        }
    },

    setLoading(loading) {
        this.state.loading = loading;
        const main = document.getElementById('mainContent');
        if (loading && main.innerHTML.trim() === '') {
            main.innerHTML = this.renderSkeletonGrid();
        }
    },

    // ============================================
    // SEARCH
    // ============================================
    handleSearch(event) {
        if (event.key === 'Enter') {
            this.search();
            return;
        }

        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
            const query = event.target.value.trim();
            if (query.length >= 2) {
                this.search(query);
            }
        }, CONFIG.DEBOUNCE_DELAY);
    },

    handleMobileSearch(event) {
        if (event.key === 'Enter') {
            const query = event.target.value.trim();
            if (query) this.search(query);
        }
    },

    async search(query) {
        if (!query) {
            const input = document.getElementById('searchInput');
            query = input ? input.value.trim() : '';
        }
        if (!query) return;

        this.state.searchQuery = query;
        this.state.currentPage = 'search';
        this.updateNavActive('search');

        const data = await this.fetchAPI(`/search?s=${encodeURIComponent(query)}`);
        if (data && data.status) {
            this.state.searchResults = data.data;
            this.renderSearchResults(query);
        }
    },

    // ============================================
    // DETAIL PAGE
    // ============================================
    async loadDetail(animeUrl) {
        this.state.currentPage = 'detail';

        const detailData = await this.fetchAPI(`/detail?url=${encodeURIComponent(animeUrl)}`);
        if (detailData && detailData.status) {
            this.state.detailData = detailData.data;
            this.renderDetail();
        }
    },

    async loadDownload(episodeUrl) {
        const downloadData = await this.fetchAPI(`/download?url=${encodeURIComponent(episodeUrl)}`);
        if (downloadData && downloadData.status) {
            this.state.downloadData = downloadData.data;
            this.renderDownloadSection();
        }
    },

    // ============================================
    // RENDER: HOME
    // ============================================
    renderHome() {
        const main = document.getElementById('mainContent');
        main.innerHTML = `
            <div class="hero">
                <div class="hero-content">
                    <h1><i class="fas fa-tv"></i> AnimeStream</h1>
                    <p>Nonton anime subtitle Indonesia terlengkap dan terupdate. Temukan anime favoritmu dari berbagai genre.</p>
                </div>
            </div>
            <div class="section">
                <div class="section-header">
                    <h2 class="section-title">
                        <i class="fas fa-fire"></i>
                        Anime Ongoing
                    </h2>
                    <button class="btn btn-outline btn-sm" onclick="app.loadOngoing()">
                        Lihat Semua <i class="fas fa-arrow-right"></i>
                    </button>
                </div>
                <div id="ongoingGrid">
                    ${this.renderSkeletonGrid()}
                </div>
            </div>
        `;

        this.fetchOngoingForHome();
    },

    async fetchOngoingForHome() {
        const data = await this.fetchAPI('/ongoing');
        if (data && data.status) {
            this.state.ongoingData = data.data;
            const grid = document.getElementById('ongoingGrid');
            if (grid) {
                grid.innerHTML = this.renderAnimeCards(data.data.slice(0, 8));
            }
        }
    },

    // ============================================
    // RENDER: ONGOING
    // ============================================
    renderOngoing() {
        const main = document.getElementById('mainContent');
        main.innerHTML = `
            <div class="hero" style="padding: 30px;">
                <div class="hero-content">
                    <h1><i class="fas fa-fire"></i> Anime Ongoing</h1>
                    <p>Daftar anime yang sedang tayang dan update terbaru.</p>
                </div>
            </div>
            <div class="section">
                <div id="ongoingFullGrid">
                    ${this.renderSkeletonGrid()}
                </div>
            </div>
        `;

        this.fetchOngoingFull();
    },

    async fetchOngoingFull() {
        const data = await this.fetchAPI('/ongoing');
        if (data && data.status) {
            this.state.ongoingData = data.data;
            const grid = document.getElementById('ongoingFullGrid');
            if (grid) {
                grid.innerHTML = this.renderAnimeCards(data.data);
            }
        }
    },

    // ============================================
    // RENDER: SEARCH RESULTS
    // ============================================
    renderSearchResults(query) {
        const main = document.getElementById('mainContent');
        const results = this.state.searchResults || [];

        main.innerHTML = `
            <div class="hero" style="padding: 30px;">
                <div class="hero-content">
                    <h1><i class="fas fa-search"></i> Hasil Pencarian</h1>
                    <p>${results.length} anime ditemukan untuk "<strong>${this.escapeHtml(query)}</strong>"</p>
                </div>
            </div>
            <div class="section">
                ${results.length > 0 
                    ? `<div class="anime-grid">${this.renderSearchCards(results)}</div>`
                    : this.renderEmptyStateHTML('Tidak ada hasil', 'Coba kata kunci lain')
                }
            </div>
        `;
    },

    // ============================================
    // RENDER: DETAIL PAGE
    // ============================================
    renderDetail() {
        const detail = this.state.detailData;
        if (!detail) return;

        const info = detail.animeInfo;
        const episodes = detail.episodes || [];
        const genres = info.genres ? info.genres.split(',').map(g => g.trim()) : [];

        const main = document.getElementById('mainContent');
        main.innerHTML = `
            <div class="detail-hero">
                <div class="detail-hero-bg" style="background-image: url('${info.imageUrl}')"></div>
                <div class="detail-hero-content">
                    <div class="detail-poster">
                        <img src="${info.imageUrl}" alt="${info.title}" onerror="this.src='https://via.placeholder.com/220x300/252540/9ca3af?text=No+Image'">
                    </div>
                    <div class="detail-info">
                        <button class="back-btn" onclick="app.goHome()">
                            <i class="fas fa-arrow-left"></i> Kembali
                        </button>
                        <h1 class="title">${this.escapeHtml(info.title)}</h1>
                        <p class="jp-title">${this.escapeHtml(info.japaneseTitle || '')}</p>

                        <div class="detail-meta">
                            <div class="detail-meta-item">
                                <i class="fas fa-star"></i>
                                <span>Score: <span class="value">${info.score || 'N/A'}</span></span>
                            </div>
                            <div class="detail-meta-item">
                                <i class="fas fa-tv"></i>
                                <span>Type: <span class="value">${info.type || 'TV'}</span></span>
                            </div>
                            <div class="detail-meta-item">
                                <i class="fas fa-circle"></i>
                                <span>Status: <span class="value">${info.status || 'Unknown'}</span></span>
                            </div>
                            <div class="detail-meta-item">
                                <i class="fas fa-film"></i>
                                <span>Episodes: <span class="value">${info.totalEpisodes || '?'}</span></span>
                            </div>
                            <div class="detail-meta-item">
                                <i class="fas fa-clock"></i>
                                <span>Duration: <span class="value">${info.duration || 'N/A'}</span></span>
                            </div>
                            <div class="detail-meta-item">
                                <i class="fas fa-calendar"></i>
                                <span>Released: <span class="value">${info.releaseDate || 'N/A'}</span></span>
                            </div>
                            <div class="detail-meta-item">
                                <i class="fas fa-building"></i>
                                <span>Studio: <span class="value">${info.studio || 'N/A'}</span></span>
                            </div>
                        </div>

                        <div class="genres-list">
                            ${genres.map(g => `<span class="genre-tag">${this.escapeHtml(g)}</span>`).join('')}
                        </div>

                        <div class="detail-actions" style="margin-top: 20px;">
                            <button class="btn btn-primary" onclick="app.scrollToEpisodes()">
                                <i class="fas fa-play"></i> Tonton Episode
                            </button>
                            <button class="btn btn-outline" onclick="app.showProducer()">
                                <i class="fas fa-info-circle"></i> Info
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="section" id="episodesSection">
                <div class="section-header">
                    <h2 class="section-title">
                        <i class="fas fa-list"></i>
                        Daftar Episode (${episodes.length})
                    </h2>
                </div>

                <div class="stats-bar">
                    <div class="stat-item">
                        <i class="fas fa-film"></i>
                        <div>
                            <div class="stat-value">${episodes.length}</div>
                            <div class="stat-label">Total Episode</div>
                        </div>
                    </div>
                    <div class="stat-item">
                        <i class="fas fa-star"></i>
                        <div>
                            <div class="stat-value">${info.score || 'N/A'}</div>
                            <div class="stat-label">Rating</div>
                        </div>
                    </div>
                    <div class="stat-item">
                        <i class="fas fa-building"></i>
                        <div>
                            <div class="stat-value">${info.studio || 'N/A'}</div>
                            <div class="stat-label">Studio</div>
                        </div>
                    </div>
                </div>

                <div class="episode-list">
                    ${episodes.map((ep, index) => this.renderEpisodeItem(ep, index)).join('')}
                </div>
            </div>
        `;
    },

    renderEpisodeItem(episode, index) {
        const isBatch = episode.title.toLowerCase().includes('batch');
        const match = episode.title.match(/Episode\s+(\d+)/i);
        const epNum = isBatch ? 'BATCH' : (match ? match[1] : index + 1);

        return `
            <div class="episode-item" onclick="app.loadDownload('${episode.link}')">
                <div class="ep-num">${isBatch ? '<i class="fas fa-archive"></i>' : epNum}</div>
                <div class="ep-info">
                    <div class="ep-title">${this.escapeHtml(episode.title)}</div>
                    <div class="ep-date"><i class="fas fa-calendar-alt"></i> ${episode.date || 'N/A'}</div>
                </div>
                <div class="ep-action">
                    <i class="fas fa-download"></i> Download
                </div>
            </div>
        `;
    },

    scrollToEpisodes() {
        const el = document.getElementById('episodesSection');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
    },

    showProducer() {
        const info = this.state.detailData?.animeInfo;
        if (info && info.producer) {
            this.showToast('Producer: ' + info.producer, 'info');
        }
    },

    // ============================================
    // RENDER: DOWNLOAD SECTION
    // ============================================
    renderDownloadSection() {
        const download = this.state.downloadData;
        if (!download) return;

        const downloads = download.downloads || [];
        const qualities = [...new Set(downloads.map(d => d.quality))];

        const main = document.getElementById('mainContent');

        const existingSection = document.getElementById('downloadSection');
        if (existingSection) existingSection.remove();

        const downloadHTML = `
            <div class="section" id="downloadSection">
                <div class="section-header">
                    <h2 class="section-title">
                        <i class="fas fa-download"></i>
                        Link Download
                    </h2>
                    <button class="btn btn-outline btn-sm" onclick="document.getElementById('downloadSection').remove()">
                        <i class="fas fa-times"></i> Tutup
                    </button>
                </div>

                <div class="quality-filter">
                    <button class="quality-btn active" onclick="app.filterQuality('all', this)">Semua</button>
                    ${qualities.map(q => `<button class="quality-btn" onclick="app.filterQuality('${q}', this)">${q}</button>`).join('')}
                </div>

                <div class="download-grid" id="downloadGrid">
                    ${downloads.map(d => this.renderDownloadCard(d)).join('')}
                </div>
            </div>
        `;

        main.insertAdjacentHTML('beforeend', downloadHTML);
        const section = document.getElementById('downloadSection');
        if (section) section.scrollIntoView({ behavior: 'smooth' });
    },

    renderDownloadCard(download) {
        return `
            <div class="download-card" data-quality="${download.quality}">
                <div class="quality"><i class="fas fa-video"></i> ${download.quality}</div>
                <div class="host"><i class="fas fa-server"></i> ${this.escapeHtml(download.host)}</div>
                <button class="download-btn" onclick="window.open('${download.link}', '_blank')">
                    <i class="fas fa-external-link-alt"></i> Buka Link
                </button>
            </div>
        `;
    },

    filterQuality(quality, btn) {
        this.state.selectedQuality = quality;

        document.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        document.querySelectorAll('.download-card').forEach(card => {
            const cardQuality = card.dataset.quality;
            card.style.display = (quality === 'all' || cardQuality === quality) ? 'block' : 'none';
        });
    },

    // ============================================
    // RENDER: CARDS
    // ============================================
    renderAnimeCards(animeList) {
        if (!animeList || animeList.length === 0) {
            return this.renderEmptyStateHTML('Tidak ada anime', 'Data kosong');
        }

        return animeList.map(anime => `
            <div class="anime-card" onclick="app.loadDetail('${anime.link}')">
                <div class="poster">
                    <img src="${anime.image}" alt="${anime.title}" loading="lazy" onerror="this.src='https://via.placeholder.com/200x270/252540/9ca3af?text=No+Image'">
                    <span class="badge badge-episode">${anime.episode}</span>
                    <div class="overlay">
                        <div class="play-btn"><i class="fas fa-play"></i></div>
                    </div>
                </div>
                <div class="info">
                    <div class="title">${this.escapeHtml(anime.title)}</div>
                    <div class="meta">
                        <span><i class="fas fa-calendar"></i> ${anime.date}</span>
                        <span><i class="fas fa-clock"></i> ${anime.type}</span>
                    </div>
                </div>
            </div>
        `).join('');
    },

    renderSearchCards(animeList) {
        if (!animeList || animeList.length === 0) {
            return this.renderEmptyStateHTML('Tidak ada hasil', 'Coba kata kunci lain');
        }

        return animeList.map(anime => `
            <div class="anime-card" onclick="app.loadDetail('${anime.link}')">
                <div class="poster">
                    <img src="${anime.imageUrl}" alt="${anime.title}" loading="lazy" onerror="this.src='https://via.placeholder.com/200x270/252540/9ca3af?text=No+Image'">
                    <span class="badge ${anime.status === 'Ongoing' ? 'badge-ongoing' : 'badge-complete'}">${anime.status}</span>
                    <span class="badge badge-score" style="top: 10px; right: 10px; left: auto;"><i class="fas fa-star"></i> ${anime.rating}</span>
                    <div class="overlay">
                        <div class="play-btn"><i class="fas fa-play"></i></div>
                    </div>
                </div>
                <div class="info">
                    <div class="title">${this.escapeHtml(anime.title)}</div>
                    <div class="meta">
                        <span><i class="fas fa-film"></i> ${anime.genres}</span>
                    </div>
                </div>
            </div>
        `).join('');
    },

    // ============================================
    // RENDER: SKELETON & EMPTY
    // ============================================
    renderSkeletonGrid() {
        return Array(8).fill(0).map(() => `
            <div class="anime-card">
                <div class="poster skeleton skeleton-card"></div>
                <div class="info">
                    <div class="skeleton skeleton-text"></div>
                    <div class="skeleton skeleton-text short"></div>
                </div>
            </div>
        `).join('');
    },

    renderEmptyStateHTML(title, subtitle) {
        return `
            <div class="empty-state">
                <i class="fas fa-film"></i>
                <h3>${title}</h3>
                <p>${subtitle}</p>
            </div>
        `;
    },

    // ============================================
    // UTILITIES
    // ============================================
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const icons = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle' };

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <i class="fas ${icons[type]}"></i>
            <span>${this.escapeHtml(message)}</span>
        `;

        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => app.init());
