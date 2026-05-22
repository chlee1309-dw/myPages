// ============================================
// Guestbook Application — Supabase Edition
// ============================================

(function () {
    'use strict';

    // --- Supabase Config ---
    const SUPABASE_URL = 'https://nebjaexkacnrtqkygmlo.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lYmphZXhrYWNucnRxa3lnbWxvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3Njc5MTUsImV4cCI6MjA5NDM0MzkxNX0.nDWZR-L-rBmzKY5rVYAKk3EHkY224J7b2caMniU-fm8';

    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // --- Local Storage Keys (for local-only data) ---
    const NAME_STORAGE_KEY = 'class_guestbook_username';
    const LIKES_STORAGE_KEY = 'class_guestbook_likes';

    // --- DOM Elements ---
    const dom = {
        form: document.getElementById('guestbookForm'),
        nameInput: document.getElementById('nameInput'),
        messageInput: document.getElementById('messageInput'),
        nameCharCount: document.getElementById('nameCharCount'),
        msgCharCount: document.getElementById('msgCharCount'),
        moodOptions: document.getElementById('moodOptions'),
        submitBtn: document.getElementById('submitBtn'),
        messagesList: document.getElementById('messagesList'),
        emptyState: document.getElementById('emptyState'),
        noResults: document.getElementById('noResults'),
        searchInput: document.getElementById('searchInput'),
        searchClear: document.getElementById('searchClear'),
        sortNewest: document.getElementById('sortNewest'),
        sortOldest: document.getElementById('sortOldest'),
        scrollTopBtn: document.getElementById('scrollTopBtn'),
        toast: document.getElementById('toast'),
        toastIcon: document.getElementById('toastIcon'),
        toastMessage: document.getElementById('toastMessage'),
        deleteModal: document.getElementById('deleteModal'),
        modalCancel: document.getElementById('modalCancel'),
        modalConfirm: document.getElementById('modalConfirm'),
        totalCount: document.getElementById('totalCount'),
        todayCount: document.getElementById('todayCount'),
        authorCount: document.getElementById('authorCount'),
        bgParticles: document.getElementById('bgParticles'),
    };

    // --- State ---
    let messages = [];
    let sortOrder = 'newest';
    let searchQuery = '';
    let selectedMood = '😊';
    let deleteTargetId = null;
    let likedIds = new Set();
    let toastTimeout = null;
    let isSubmitting = false;

    // --- Initialize ---
    async function init() {
        loadLikes();
        loadSavedName();
        initParticles();
        selectMood('😊');
        bindEvents();

        // Supabase에서 메시지 로드
        await fetchMessages();
        renderMessages();
        updateStats();

        // 실시간 구독 시작
        subscribeRealtime();
    }

    // --- Supabase: Fetch Messages ---
    async function fetchMessages() {
        try {
            const { data, error } = await supabase
                .from('guestbook')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Supabase fetch error:', error);
                showToast('❌', '메시지를 불러오는데 실패했어요.');
                return;
            }

            messages = (data || []).map(row => ({
                id: row.id,
                name: row.name,
                message: row.message,
                mood: row.mood || '😊',
                likes: row.likes || 0,
                timestamp: new Date(row.created_at).getTime(),
            }));
        } catch (err) {
            console.error('Fetch error:', err);
            showToast('❌', '서버 연결에 실패했어요.');
        }
    }

    // --- Supabase: Insert Message ---
    async function insertMessage(name, message, mood) {
        const { data, error } = await supabase
            .from('guestbook')
            .insert([{ name, message, mood }])
            .select()
            .single();

        if (error) {
            console.error('Insert error:', error);
            throw error;
        }

        return {
            id: data.id,
            name: data.name,
            message: data.message,
            mood: data.mood,
            likes: data.likes || 0,
            timestamp: new Date(data.created_at).getTime(),
        };
    }

    // --- Supabase: Delete Message ---
    async function deleteMessage(id) {
        const { error } = await supabase
            .from('guestbook')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Delete error:', error);
            throw error;
        }
    }

    // --- Supabase: Update Likes ---
    async function updateLikes(id, likes) {
        const { error } = await supabase
            .from('guestbook')
            .update({ likes })
            .eq('id', id);

        if (error) {
            console.error('Update likes error:', error);
            throw error;
        }
    }

    // --- Supabase: Realtime Subscription ---
    function subscribeRealtime() {
        supabase
            .channel('guestbook-changes')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'guestbook' },
                (payload) => {
                    handleRealtimeChange(payload);
                }
            )
            .subscribe();
    }

    function handleRealtimeChange(payload) {
        const { eventType, new: newRow, old: oldRow } = payload;

        if (eventType === 'INSERT') {
            // 이미 로컬에 있는 메시지면 무시 (내가 추가한 것)
            const exists = messages.find(m => m.id === newRow.id);
            if (exists) return;

            const msg = {
                id: newRow.id,
                name: newRow.name,
                message: newRow.message,
                mood: newRow.mood || '😊',
                likes: newRow.likes || 0,
                timestamp: new Date(newRow.created_at).getTime(),
            };
            messages.unshift(msg);
            renderMessages(msg.id);
            updateStats();
            showToast('💌', `${msg.name}님이 글을 남겼어요!`);
        }

        if (eventType === 'DELETE') {
            const existed = messages.find(m => m.id === oldRow.id);
            if (!existed) return;
            messages = messages.filter(m => m.id !== oldRow.id);
            renderMessages();
            updateStats();
        }

        if (eventType === 'UPDATE') {
            const msg = messages.find(m => m.id === newRow.id);
            if (msg) {
                msg.likes = newRow.likes || 0;
                renderMessages();
            }
        }
    }

    // --- Local Storage (for non-DB data) ---
    function loadLikes() {
        try {
            const data = localStorage.getItem(LIKES_STORAGE_KEY);
            likedIds = data ? new Set(JSON.parse(data)) : new Set();
        } catch {
            likedIds = new Set();
        }
    }

    function saveLikes() {
        localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify([...likedIds]));
    }

    function loadSavedName() {
        const savedName = localStorage.getItem(NAME_STORAGE_KEY);
        if (savedName) {
            dom.nameInput.value = savedName;
            updateCharCount(dom.nameInput, dom.nameCharCount, 20);
        }
    }

    function saveName(name) {
        localStorage.setItem(NAME_STORAGE_KEY, name);
    }

    // --- Particles ---
    function initParticles() {
        const colors = [
            'rgba(129, 140, 248, 0.3)',
            'rgba(167, 139, 250, 0.25)',
            'rgba(192, 132, 252, 0.2)',
            'rgba(52, 211, 153, 0.2)',
            'rgba(251, 191, 36, 0.15)',
        ];
        for (let i = 0; i < 25; i++) {
            const particle = document.createElement('div');
            particle.classList.add('particle');
            const size = Math.random() * 6 + 2;
            particle.style.width = size + 'px';
            particle.style.height = size + 'px';
            particle.style.left = Math.random() * 100 + '%';
            particle.style.background = colors[Math.floor(Math.random() * colors.length)];
            particle.style.animationDuration = Math.random() * 15 + 10 + 's';
            particle.style.animationDelay = Math.random() * 10 + 's';
            dom.bgParticles.appendChild(particle);
        }
    }

    // --- Events ---
    function bindEvents() {
        // Form submission
        dom.form.addEventListener('submit', handleSubmit);

        // Character counters
        dom.nameInput.addEventListener('input', () => {
            updateCharCount(dom.nameInput, dom.nameCharCount, 20);
        });
        dom.messageInput.addEventListener('input', () => {
            updateCharCount(dom.messageInput, dom.msgCharCount, 500);
        });

        // Mood selector
        dom.moodOptions.addEventListener('click', (e) => {
            const btn = e.target.closest('.mood-btn');
            if (btn) {
                selectMood(btn.dataset.mood);
            }
        });

        // Search
        dom.searchInput.addEventListener('input', handleSearch);
        dom.searchClear.addEventListener('click', clearSearch);

        // Sort
        dom.sortNewest.addEventListener('click', () => setSort('newest'));
        dom.sortOldest.addEventListener('click', () => setSort('oldest'));

        // Scroll to top
        window.addEventListener('scroll', handleScroll);
        dom.scrollTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        // Delete modal
        dom.modalCancel.addEventListener('click', closeDeleteModal);
        dom.deleteModal.addEventListener('click', (e) => {
            if (e.target === dom.deleteModal) closeDeleteModal();
        });
        dom.modalConfirm.addEventListener('click', confirmDelete);

        // Keyboard shortcut for modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && dom.deleteModal.classList.contains('show')) {
                closeDeleteModal();
            }
        });
    }

    // --- Character Count ---
    function updateCharCount(input, countEl, max) {
        const len = input.value.length;
        countEl.textContent = `${len}/${max}`;
        countEl.classList.remove('warning', 'danger');
        if (len >= max) {
            countEl.classList.add('danger');
        } else if (len >= max * 0.8) {
            countEl.classList.add('warning');
        }
    }

    // --- Mood ---
    function selectMood(mood) {
        selectedMood = mood;
        document.querySelectorAll('.mood-btn').forEach((btn) => {
            btn.classList.toggle('selected', btn.dataset.mood === mood);
        });
    }

    // --- Submit ---
    async function handleSubmit(e) {
        e.preventDefault();

        if (isSubmitting) return;

        const name = dom.nameInput.value.trim();
        const message = dom.messageInput.value.trim();

        if (!name || !message) return;

        isSubmitting = true;
        dom.submitBtn.disabled = true;
        dom.submitBtn.querySelector('.btn-text').textContent = '업로드 중...';

        try {
            const newMessage = await insertMessage(name, message, selectedMood);

            messages.unshift(newMessage);
            saveName(name);

            // Reset form (keep name)
            dom.messageInput.value = '';
            updateCharCount(dom.messageInput, dom.msgCharCount, 500);

            // Render
            renderMessages(newMessage.id);
            updateStats();
            showToast('✅', '글이 등록되었습니다!');

            // Scroll to the new message
            setTimeout(() => {
                const newCard = document.querySelector(`[data-id="${newMessage.id}"]`);
                if (newCard) {
                    newCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
        } catch (err) {
            showToast('❌', '글 등록에 실패했어요. 다시 시도해주세요.');
            console.error('Submit error:', err);
        } finally {
            isSubmitting = false;
            dom.submitBtn.disabled = false;
            dom.submitBtn.querySelector('.btn-text').textContent = '글 남기기';
        }
    }

    // --- Render Messages ---
    function renderMessages(newId) {
        const filtered = getFilteredMessages();
        dom.messagesList.innerHTML = '';

        // Show/hide empty states
        if (messages.length === 0) {
            dom.emptyState.style.display = 'block';
            dom.noResults.style.display = 'none';
            return;
        }

        dom.emptyState.style.display = 'none';

        if (filtered.length === 0) {
            dom.noResults.style.display = 'block';
            return;
        }

        dom.noResults.style.display = 'none';

        filtered.forEach((msg, index) => {
            const card = createMessageCard(msg, index, msg.id === newId);
            dom.messagesList.appendChild(card);
        });
    }

    function createMessageCard(msg, index, isNew) {
        const card = document.createElement('div');
        card.className = `message-card${isNew ? ' new' : ''}`;
        card.dataset.id = msg.id;
        card.style.animationDelay = `${index * 0.05}s`;

        const isLiked = likedIds.has(msg.id);
        const timeStr = formatTime(msg.timestamp);
        const bodyHtml = searchQuery
            ? highlightText(escapeHtml(msg.message), searchQuery)
            : escapeHtml(msg.message);
        const nameHtml = searchQuery
            ? highlightText(escapeHtml(msg.name), searchQuery)
            : escapeHtml(msg.name);

        card.innerHTML = `
            <div class="message-header">
                <div class="message-author-info">
                    <div class="message-mood">${msg.mood || '😊'}</div>
                    <div class="message-meta">
                        <span class="message-author">${nameHtml}</span>
                        <span class="message-time">${timeStr}</span>
                    </div>
                </div>
                <div class="message-actions">
                    <button class="action-btn like-btn ${isLiked ? 'liked' : ''}" data-action="like" data-id="${msg.id}" title="좋아요">
                        ❤️ <span class="like-count">${msg.likes || 0}</span>
                    </button>
                    <button class="action-btn delete-btn" data-action="delete" data-id="${msg.id}" title="삭제">
                        🗑️
                    </button>
                </div>
            </div>
            <div class="message-body">${bodyHtml}</div>
        `;

        // Bind action buttons
        const likeBtn = card.querySelector('.like-btn');
        const deleteBtn = card.querySelector('.delete-btn');

        likeBtn.addEventListener('click', () => handleLike(msg.id));
        deleteBtn.addEventListener('click', () => openDeleteModal(msg.id));

        return card;
    }

    // --- Like ---
    async function handleLike(id) {
        const msg = messages.find((m) => m.id === id);
        if (!msg) return;

        if (likedIds.has(id)) {
            likedIds.delete(id);
            msg.likes = Math.max(0, (msg.likes || 0) - 1);
        } else {
            likedIds.add(id);
            msg.likes = (msg.likes || 0) + 1;
        }

        saveLikes();
        renderMessages();

        // Supabase에 좋아요 수 업데이트
        try {
            await updateLikes(id, msg.likes);
        } catch (err) {
            console.error('Like update failed:', err);
        }
    }

    // --- Delete ---
    function openDeleteModal(id) {
        deleteTargetId = id;
        dom.deleteModal.classList.add('show');
    }

    function closeDeleteModal() {
        dom.deleteModal.classList.remove('show');
        deleteTargetId = null;
    }

    async function confirmDelete() {
        if (!deleteTargetId) return;

        const targetId = deleteTargetId;
        const card = document.querySelector(`[data-id="${targetId}"]`);

        if (card) {
            card.classList.add('deleting');
        }

        try {
            await deleteMessage(targetId);

            setTimeout(() => {
                messages = messages.filter((m) => m.id !== targetId);
                renderMessages();
                updateStats();
                closeDeleteModal();
                showToast('🗑️', '글이 삭제되었습니다.');
            }, card ? 400 : 0);
        } catch (err) {
            closeDeleteModal();
            showToast('❌', '삭제에 실패했어요. 다시 시도해주세요.');
            if (card) card.classList.remove('deleting');
            console.error('Delete error:', err);
        }
    }

    // --- Search & Sort ---
    function handleSearch() {
        searchQuery = dom.searchInput.value.trim();
        dom.searchClear.classList.toggle('visible', searchQuery.length > 0);
        renderMessages();
    }

    function clearSearch() {
        dom.searchInput.value = '';
        searchQuery = '';
        dom.searchClear.classList.remove('visible');
        renderMessages();
    }

    function setSort(order) {
        sortOrder = order;
        dom.sortNewest.classList.toggle('active', order === 'newest');
        dom.sortOldest.classList.toggle('active', order === 'oldest');
        renderMessages();
    }

    function getFilteredMessages() {
        let filtered = [...messages];

        // Search filter
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(
                (m) =>
                    m.name.toLowerCase().includes(q) ||
                    m.message.toLowerCase().includes(q)
            );
        }

        // Sort
        filtered.sort((a, b) => {
            return sortOrder === 'newest'
                ? b.timestamp - a.timestamp
                : a.timestamp - b.timestamp;
        });

        return filtered;
    }

    // --- Stats ---
    function updateStats() {
        dom.totalCount.textContent = messages.length;

        // Today's messages
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTs = today.getTime();
        const todayMessages = messages.filter((m) => m.timestamp >= todayTs);
        dom.todayCount.textContent = todayMessages.length;

        // Unique authors
        const authors = new Set(messages.map((m) => m.name));
        dom.authorCount.textContent = authors.size;

        // Animate counters
        animateCounter(dom.totalCount, messages.length);
        animateCounter(dom.todayCount, todayMessages.length);
        animateCounter(dom.authorCount, authors.size);
    }

    function animateCounter(el, target) {
        const current = parseInt(el.textContent) || 0;
        if (current === target) return;

        const duration = 500;
        const startTime = performance.now();

        function step(now) {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.round(current + (target - current) * eased);
            if (progress < 1) requestAnimationFrame(step);
        }

        requestAnimationFrame(step);
    }

    // --- Scroll ---
    function handleScroll() {
        dom.scrollTopBtn.classList.toggle('visible', window.scrollY > 400);
    }

    // --- Toast ---
    function showToast(icon, message) {
        if (toastTimeout) clearTimeout(toastTimeout);

        dom.toastIcon.textContent = icon;
        dom.toastMessage.textContent = message;
        dom.toast.classList.add('show');

        toastTimeout = setTimeout(() => {
            dom.toast.classList.remove('show');
        }, 2500);
    }

    // --- Utility ---
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function highlightText(html, query) {
        if (!query) return html;
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escaped})`, 'gi');
        return html.replace(regex, '<span class="highlight">$1</span>');
    }

    function formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        // Less than 1 minute
        if (diff < 60000) return '방금 전';

        // Less than 1 hour
        if (diff < 3600000) {
            const mins = Math.floor(diff / 60000);
            return `${mins}분 전`;
        }

        // Less than 24 hours
        if (diff < 86400000) {
            const hours = Math.floor(diff / 3600000);
            return `${hours}시간 전`;
        }

        // Less than 7 days
        if (diff < 604800000) {
            const days = Math.floor(diff / 86400000);
            return `${days}일 전`;
        }

        // Format full date
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');

        if (year === now.getFullYear()) {
            return `${month}월 ${day}일 ${hours}:${minutes}`;
        }

        return `${year}. ${month}. ${day}. ${hours}:${minutes}`;
    }

    // --- Start ---
    document.addEventListener('DOMContentLoaded', init);
})();
