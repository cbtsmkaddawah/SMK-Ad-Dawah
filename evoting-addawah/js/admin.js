/**
 * js/admin.js
 * Logika Lengkap Dashboard Admin: Auth, Chart.js Interaktif, CRUD Dinamis,
 * SheetJS Bulk Import/Export Excel, dan Kustomisasi Logo & Background Web
 */

let adminCategories = [];
let adminCandidates = [];
let adminVoters = [];
let adminVoteCounts = [];
let adminVoteLogs = [];
let adminBooths = [];
let adminCallerClassFilter = 'ALL';
let adminRealtimeInitialized = false;
let currentAdminUser = null;
let electionChartInstance = null;
let currentChartType = 'bar';

const ADMIN_SESSION_KEY = 'evoting_addawah_admin_session';

document.addEventListener('DOMContentLoaded', () => {
    initAdminAuth();
    initAdminTabs();
    initChartControls();
    initCandidateCRUD();
    initCategoryCRUD();
    initVoterCRUDAndExcel();
    initWebCustomizationSettings();
    initBoothCallerControls();
});

/* ============================================================
   1. AUTENTIKASI ADMIN & NAVIGASI TAB
   ============================================================ */
function initAdminAuth() {
    const savedSession = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (savedSession) {
        try {
            currentAdminUser = JSON.parse(savedSession);
            showAdminDashboard();
        } catch (e) {
            sessionStorage.removeItem(ADMIN_SESSION_KEY);
        }
    }

    const loginForm = document.getElementById('adminLoginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('adminUsername').value.trim();
            const password = document.getElementById('adminPassword').value.trim();
            const btn = document.getElementById('btnAdminLoginSubmit');

            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Memeriksa...';

            try {
                const { data, error } = await db
                    .from('admins')
                    .select('id, username, full_name, role')
                    .eq('username', username)
                    .eq('password', password)
                    .maybeSingle();

                if (error || !data) {
                    AppUI.toast('Username atau password Admin tidak valid!', 'danger');
                    return;
                }

                currentAdminUser = data;
                sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(data));
                AppUI.toast(`Selamat datang, ${data.full_name} (${data.role.toUpperCase()})!`, 'success');
                showAdminDashboard();
            } catch (err) {
                console.error(err);
                AppUI.toast('Gagal melakukan autentikasi admin.', 'danger');
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i class="bi bi-unlock-fill me-2"></i>Masuk Dashboard';
            }
        });
    }

    document.getElementById('btnAdminLogout')?.addEventListener('click', () => {
        AppUI.confirm('Logout dari Panel Admin?', 'Sesi administrator Anda akan diakhiri.', () => {
            sessionStorage.removeItem(ADMIN_SESSION_KEY);
            currentAdminUser = null;
            document.getElementById('adminDashboardView').classList.add('d-none');
            document.getElementById('adminLoginView').classList.remove('d-none');
            AppUI.toast('Anda telah keluar dari panel admin.', 'info');
        }, 'Ya, Logout', 'btn-danger');
    });

    document.getElementById('btnRefreshDashboard')?.addEventListener('click', async () => {
        await refreshAllAdminData();
        AppUI.toast('Data dashboard berhasil diperbarui.', 'success');
    });
}

async function showAdminDashboard() {
    document.getElementById('adminLoginView').classList.add('d-none');
    document.getElementById('adminDashboardView').classList.remove('d-none');
    await refreshAllAdminData();
}

function initAdminTabs() {
    const navButtons = document.querySelectorAll('#adminTabNav .admin-nav-link');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            navButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const targetId = btn.getAttribute('data-target');
            document.querySelectorAll('.admin-tab-pane').forEach(pane => {
                pane.classList.toggle('d-none', pane.id !== targetId);
            });
        });
    });
}

/* ============================================================
   2. MUAT SELURUH DATA & STATISTIK UTAMA
   ============================================================ */
async function refreshAllAdminData() {
    try {
        const isSuperAdmin = currentAdminUser && currentAdminUser.role === 'superadmin';

        const queries = [
            db.from('categories').select('*').order('urutan', { ascending: true }),
            db.from('candidates').select('*').order('urutan', { ascending: true }),
            db.from('voters').select('*').order('kelas', { ascending: true }).order('nama', { ascending: true }),
            db.from('vote_counts').select('*'),
            db.from('settings').select('*').eq('id', 1).single(),
            db.from('active_booths').select('*').order('booth_code', { ascending: true })
        ];

        if (isSuperAdmin) {
            queries.push(db.from('vote_logs').select('*').order('created_at', { ascending: true }));
        }

        const [catRes, candRes, voterRes, voteRes, setRes, boothRes, logsRes] = await Promise.all(queries);

        adminCategories = catRes.data || [];
        adminCandidates = candRes.data || [];
        adminVoters = voterRes.data || [];
        adminVoteCounts = voteRes.data || [];
        adminBooths = boothRes.data || [];
        adminVoteLogs = isSuperAdmin && logsRes ? (logsRes.data || []) : [];

        updateSummaryStatCards();
        populateCategoryChartFilter();
        renderPodiumWinners();
        renderInteractiveChart();
        renderSuperAdminCandidateAudit();
        renderBoothCallerPanel();
        renderCandidatesGrid();
        renderCategoriesTable();
        populateVoterClassFilter();
        renderVotersTable();

        if (setRes.data) {
            populateSettingsForm(setRes.data);
            populateVoiceConfigForm(setRes.data);
        }

        // Aktifkan sinkronisasi otomatis saat siswa login / selesai voting di bilik
        if (!adminRealtimeInitialized) {
            initAdminRealtimeSync();
        }
    } catch (err) {
        console.error('Gagal memuat data admin:', err);
        AppUI.toast('Gagal memuat sebagian data dari Supabase.', 'danger');
    }
}

function updateSummaryStatCards() {
    const total = adminVoters.length;
    const voted = adminVoters.filter(v => v.has_voted).length;
    const unvoted = total - voted;
    const pct = total > 0 ? ((voted / total) * 100).toFixed(1) : 0;

    document.getElementById('statTotalVoters').textContent = total;
    document.getElementById('statVotedCount').textContent = voted;
    document.getElementById('statUnvotedCount').textContent = unvoted;
    document.getElementById('statTurnoutPercent').textContent = `${pct}%`;
}

/* ============================================================
   3. VISUALISASI GRAFIK INTERAKTIF (CHART.JS) & PODIUM JUARA
   ============================================================ */
function initChartControls() {
    const catSelect = document.getElementById('chartCategoryFilter');
    catSelect?.addEventListener('change', () => renderInteractiveChart());

    document.querySelectorAll('[data-chart-type]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-chart-type]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentChartType = btn.getAttribute('data-chart-type');
            renderInteractiveChart();
        });
    });

    document.getElementById('btnExportFullReport')?.addEventListener('click', exportElectionReportToExcel);
}

function populateCategoryChartFilter() {
    const select = document.getElementById('chartCategoryFilter');
    if (!select) return;
    const prevValue = select.value || 'ALL';

    select.innerHTML = '<option value="ALL">Semua Kategori (Perbandingan)</option>';
    adminCategories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = `Kategori: ${cat.name}`;
        select.appendChild(opt);
    });

    if ([...select.options].some(o => o.value === prevValue)) {
        select.value = prevValue;
    }
}

function getVotesCount(categoryId, candidateId) {
    const found = adminVoteCounts.find(
        vc => vc.category_id === categoryId && vc.candidate_id === candidateId
    );
    return found ? found.total_votes : 0;
}

function renderPodiumWinners() {
    const container = document.getElementById('podiumWinnersContainer');
    if (!container) return;

    if (adminCategories.length === 0 || adminCandidates.length === 0) {
        container.innerHTML = '<div class="col-12 text-muted small">Belum ada data kategori atau kandidat.</div>';
        return;
    }

    let html = '';
    adminCategories.forEach(cat => {
        let topCandidate = null;
        let maxVotes = -1;
        let totalCategoryVotes = 0;

        adminCandidates.forEach(cand => {
            const v = getVotesCount(cat.id, cand.id);
            totalCategoryVotes += v;
            if (v > maxVotes) {
                maxVotes = v;
                topCandidate = cand;
            }
        });

        const hasVotes = maxVotes > 0 && topCandidate;
        const sharePct = totalCategoryVotes > 0 ? Math.round((maxVotes / totalCategoryVotes) * 100) : 0;
        const avatar = hasVotes && topCandidate.photo_url
            ? topCandidate.photo_url
            : `https://ui-avatars.com/api/?name=${encodeURIComponent(hasVotes ? topCandidate.name : '-')}&background=f1f5f9&color=475569`;

        html += `
            <div class="col-12 col-md-6 col-xl-4">
                <div class="podium-card h-100 d-flex flex-column justify-content-between">
                    <div class="text-uppercase fw-bold text-muted mb-3" style="font-size: 0.72rem; letter-spacing: 0.04em;">
                        ${AppUI.escapeHtml(cat.name)}
                    </div>
                    <div class="d-flex align-items-center justify-content-between gap-3">
                        <div class="d-flex align-items-center gap-3 min-w-0">
                            <img src="${AppUI.escapeHtml(avatar)}" class="rounded-circle border" style="width:48px;height:48px;object-fit:cover;flex-shrink:0;" alt="Foto">
                            <div class="min-w-0">
                                <div class="fw-bold text-dark text-truncate" style="font-size: 0.95rem;">
                                    ${AppUI.escapeHtml(hasVotes ? topCandidate.name : 'Belum ada suara')}
                                </div>
                                <div class="small text-muted text-truncate">
                                    ${AppUI.escapeHtml(hasVotes ? topCandidate.jabatan : '-')}
                                </div>
                            </div>
                        </div>
                        <div class="text-end flex-shrink-0 ps-2">
                            <div class="fw-bold text-dark fs-5 lh-1">${hasVotes ? maxVotes : 0}</div>
                            <div class="text-muted" style="font-size: 0.74rem;">suara (${sharePct}%)</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function renderInteractiveChart() {
    const canvas = document.getElementById('electionResultChart');
    if (!canvas) return;

    if (electionChartInstance) {
        electionChartInstance.destroy();
    }

    const selectedCatId = document.getElementById('chartCategoryFilter')?.value || 'ALL';
    const labels = adminCandidates.map(c => c.name);

    // Palet warna berbeda & kontras untuk setiap kategori agar mudah dibedakan pada grafik & legenda
    const categoryDistinctColors = [
        '#2563eb', // Royal Blue (Kategori 1)
        '#10b981', // Emerald Green (Kategori 2)
        '#f59e0b', // Amber Gold (Kategori 3)
        '#f43f5e', // Rose Red (Kategori 4)
        '#8b5cf6', // Violet Purple (Kategori 5)
        '#06b6d4', // Cyan Teal (Kategori 6)
        '#ea580c', // Deep Orange (Kategori 7)
        '#64748b'  // Slate (Cadangan)
    ];

    let datasets = [];

    if (selectedCatId === 'ALL') {
        datasets = adminCategories.map((cat, idx) => {
            const color = categoryDistinctColors[idx % categoryDistinctColors.length];
            return {
                label: cat.name,
                data: adminCandidates.map(cand => getVotesCount(cat.id, cand.id)),
                backgroundColor: color,
                borderColor: color,
                borderRadius: 6,
                borderWidth: 1,
                maxBarThickness: 28
            };
        });
    } else {
        const catIdx = adminCategories.findIndex(c => c.id === selectedCatId);
        const catObj = adminCategories[catIdx];
        const singleCatColor = categoryDistinctColors[Math.max(0, catIdx) % categoryDistinctColors.length];

        datasets = [{
            label: catObj ? catObj.name : 'Perolehan Suara',
            data: adminCandidates.map(cand => getVotesCount(selectedCatId, cand.id)),
            backgroundColor: currentChartType === 'doughnut'
                ? adminCandidates.map((_, i) => categoryDistinctColors[i % categoryDistinctColors.length])
                : singleCatColor,
            borderColor: '#ffffff',
            borderRadius: currentChartType === 'doughnut' ? 4 : 6,
            borderWidth: currentChartType === 'doughnut' ? 2 : 0,
            maxBarThickness: 36
        }];
    }

    const isHorizontal = currentChartType === 'horizontalBar';
    const chartJsType = currentChartType === 'doughnut' ? 'doughnut' : 'bar';

    electionChartInstance = new Chart(canvas, {
        type: chartJsType,
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: isHorizontal ? 'y' : 'x',
            plugins: {
                legend: {
                    position: 'top',
                    align: 'start',
                    labels: {
                        usePointStyle: true,
                        pointStyle: 'rectRounded',
                        padding: 20,
                        font: { family: 'Plus Jakarta Sans', size: 12, weight: '600' },
                        color: '#334155'
                    }
                },
                tooltip: {
                    backgroundColor: '#0f172a',
                    titleFont: { family: 'Plus Jakarta Sans', size: 13, weight: '700' },
                    bodyFont: { family: 'Plus Jakarta Sans', size: 12 },
                    padding: 12,
                    cornerRadius: 8
                }
            },
            scales: chartJsType === 'doughnut' ? {} : {
                y: {
                    beginAtZero: true,
                    grid: { color: '#f1f5f9' },
                    ticks: { precision: 0, color: '#64748b', font: { size: 11 } }
                },
                x: {
                    beginAtZero: true,
                    grid: { display: isHorizontal },
                    ticks: { precision: 0, color: '#475569', font: { size: 11 } }
                }
            }
        }
    });
}

/**
 * Render daftar kandidat yang bisa diklik oleh Super Admin di menu Hasil & Grafik Live
 */
function renderSuperAdminCandidateAudit() {
    const section = document.getElementById('superAdminAuditSection');
    const grid = document.getElementById('superAdminCandidatesAuditGrid');
    if (!section || !grid) return;

    const isSuperAdmin = currentAdminUser && currentAdminUser.role === 'superadmin';
    if (!isSuperAdmin) {
        section.classList.add('d-none');
        return;
    }

    section.classList.remove('d-none');

    if (adminCandidates.length === 0) {
        grid.innerHTML = '<div class="col-12 text-muted small">Belum ada data kandidat.</div>';
        return;
    }

    grid.innerHTML = adminCandidates.map(cand => {
        const totalCandVotes = adminVoteLogs.filter(log => String(log.candidate_id) === String(cand.id)).length;
        const avatar = cand.photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(cand.name)}&background=059669&color=fff`;

        return `
            <div class="col-12 col-sm-6 col-md-4 col-xl-3">
                <div role="button"
                    class="podium-card h-100 d-flex align-items-center justify-content-between gap-3"
                    style="cursor: pointer; border: 1.5px solid #e2e8f0;"
                    onclick="openSuperAdminCandidateDetail('${cand.id}')">
                    <div class="d-flex align-items-center gap-3 min-w-0">
                        <img src="${AppUI.escapeHtml(avatar)}" alt="Foto" class="rounded-circle border" style="width: 48px; height: 48px; object-fit: cover; flex-shrink: 0;">
                        <div class="min-w-0">
                            <div class="fw-bold text-dark text-truncate" style="font-size: 0.92rem;">${AppUI.escapeHtml(cand.name)}</div>
                            <div class="small text-muted text-truncate">${AppUI.escapeHtml(cand.jabatan)}</div>
                            <span class="badge bg-success-subtle text-success mt-1">${totalCandVotes} Pilihan Masuk</span>
                        </div>
                    </div>
                    <i class="bi bi-chevron-right text-secondary"></i>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Buka Modal Detail Kandidat:
 * - Kolom ke kanan = Kategori Pemilihan (misal: Guru Terbaik, Guru Terajin, dst.)
 * - Baris ke bawah di tiap kolom = Daftar Nama Siswa + Kelas yang memilih kandidat ini
 */
window.openSuperAdminCandidateDetail = function (candidateId) {
    const cand = adminCandidates.find(c => String(c.id) === String(candidateId));
    if (!cand) return;

    const avatar = cand.photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(cand.name)}&background=059669&color=fff`;
    document.getElementById('saModalCandAvatar').src = avatar;
    document.getElementById('saModalCandName').textContent = cand.name;
    document.getElementById('saModalCandRole').textContent = cand.jabatan;

    const thead = document.getElementById('saModalThead');
    const tbody = document.getElementById('saModalTbody');

    // Kelompokkan pemilih berdasarkan kategori untuk kandidat yang diklik
    const votersByCategory = {};
    let maxRows = 0;
    let grandTotalVotes = 0;

    adminCategories.forEach(cat => {
        const matchingLogs = adminVoteLogs.filter(
            log => String(log.candidate_id) === String(cand.id) && String(log.category_id) === String(cat.id)
        );

        const voterList = matchingLogs.map(log => {
            const voterObj = adminVoters.find(v => String(v.id) === String(log.voter_id));
            return voterObj
                ? { nama: voterObj.nama, kelas: voterObj.kelas }
                : { nama: 'Pemilih Terhapus', kelas: '-' };
        });

        votersByCategory[cat.id] = voterList;
        grandTotalVotes += voterList.length;
        if (voterList.length > maxRows) {
            maxRows = voterList.length;
        }
    });

    // 1. Render Header Kolom Kategori (Ke Kanan)
    let headHtml = '<tr>';
    adminCategories.forEach(cat => {
        const count = (votersByCategory[cat.id] || []).length;
        headHtml += `
            <th class="p-3 text-center" style="min-width: 210px;">
                <div class="fw-extrabold text-dark">${AppUI.escapeHtml(cat.name)}</div>
                <span class="badge bg-success rounded-pill mt-1">${count} Pemilih</span>
            </th>
        `;
    });
    headHtml += '</tr>';
    thead.innerHTML = headHtml;

    // 2. Render Baris Nama Siswa (Ke Bawah di Setiap Kolom Kategori)
    if (maxRows === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="${Math.max(1, adminCategories.length)}" class="text-center py-5 text-muted">
                    Belum ada siswa/pemilih yang memilih <strong>${AppUI.escapeHtml(cand.name)}</strong> pada kategori mana pun.
                </td>
            </tr>
        `;
    } else {
        let bodyHtml = '';
        for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
            bodyHtml += '<tr>';
            adminCategories.forEach(cat => {
                const voterItem = votersByCategory[cat.id][rowIndex];
                if (voterItem) {
                    bodyHtml += `
                        <td class="p-2 px-3">
                            <div class="d-flex align-items-center gap-2">
                                <span class="badge bg-light text-secondary border">${rowIndex + 1}</span>
                                <div>
                                    <div class="fw-semibold text-dark small">${AppUI.escapeHtml(voterItem.nama)}</div>
                                    <div class="text-success fw-bold" style="font-size: 0.7rem;">${AppUI.escapeHtml(voterItem.kelas)}</div>
                                </div>
                            </div>
                        </td>
                    `;
                } else {
                    bodyHtml += '<td class="bg-light bg-opacity-50"></td>';
                }
            });
            bodyHtml += '</tr>';
        }
        tbody.innerHTML = bodyHtml;
    }

    document.getElementById('saModalTotalSummary').innerHTML =
        `Total akumulasi suara untuk <strong>${AppUI.escapeHtml(cand.name)}</strong> di seluruh kategori: <strong>${grandTotalVotes} suara</strong>`;

    const modalEl = document.getElementById('superAdminDetailModal');
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
};

/* ============================================================
   4. CRUD KANDIDAT + UPLOAD FOTO + IMPORT EXCEL KANDIDAT
   ============================================================ */
function initCandidateCRUD() {
    const modalEl = document.getElementById('candidateModal');
    const form = document.getElementById('candidateForm');
    const fileInput = document.getElementById('candPhotoFile');

    document.getElementById('btnOpenAddCandidate')?.addEventListener('click', () => {
        form.reset();
        document.getElementById('candId').value = '';
        document.getElementById('candUrutan').value = adminCandidates.length + 1;
        document.getElementById('candidateModalTitle').textContent = 'Tambah Kandidat Baru';
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    });

    // Upload Foto Kandidat ke Supabase Storage
    fileInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            AppUI.toast('Mengunggah foto kandidat...', 'info');
            const publicUrl = await AppUI.uploadImageToStorage(file, 'candidates');
            document.getElementById('candPhotoUrl').value = publicUrl;
            AppUI.toast('Foto kandidat berhasil diunggah!', 'success');
        } catch (err) {
            console.error(err);
            AppUI.toast('Gagal mengunggah foto ke Supabase Storage.', 'danger');
        }
    });

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('candId').value;
        const payload = {
            name: document.getElementById('candName').value.trim(),
            jabatan: document.getElementById('candJabatan').value.trim(),
            photo_url: document.getElementById('candPhotoUrl').value.trim(),
            urutan: parseInt(document.getElementById('candUrutan').value, 10) || 1
        };

        try {
            if (id) {
                const { error } = await db.from('candidates').update(payload).eq('id', id);
                if (error) throw error;
                AppUI.toast('Data kandidat berhasil diperbarui.', 'success');
            } else {
                const { error } = await db.from('candidates').insert([payload]);
                if (error) throw error;
                AppUI.toast('Kandidat baru berhasil ditambahkan.', 'success');
            }
            bootstrap.Modal.getInstance(modalEl).hide();
            await refreshAllAdminData();
        } catch (err) {
            console.error(err);
            AppUI.toast('Gagal menyimpan kandidat.', 'danger');
        }
    });

    // Download Template Excel Kandidat
    document.getElementById('btnDownloadCandidateTemplate')?.addEventListener('click', () => {
        const sample = [
            { Urutan: 1, Nama: 'Riyadi Ilham, S.Kom', Jabatan: 'Guru Produktif TKJ', Foto_URL: '' },
            { Urutan: 2, Nama: 'Ahmad Fauzi, S.Pd', Jabatan: 'Waka Kesiswaan', Foto_URL: '' }
        ];
        const ws = XLSX.utils.json_to_sheet(sample);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Template_Kandidat');
        XLSX.writeFile(wb, 'Template_Kandidat_EVoting.xlsx');
    });

    // Upload Bulk Excel Kandidat
    document.getElementById('inputExcelCandidates')?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const buffer = await file.arrayBuffer();
            const wb = XLSX.read(buffer, { type: 'array' });
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

            const formatted = rows
                .filter(r => r.Nama && r.Jabatan)
                .map((r, i) => ({
                    name: String(r.Nama).trim(),
                    jabatan: String(r.Jabatan).trim(),
                    photo_url: r.Foto_URL ? String(r.Foto_URL).trim() : '',
                    urutan: parseInt(r.Urutan, 10) || (i + 1)
                }));

            if (formatted.length === 0) {
                AppUI.toast('Format file Excel tidak sesuai. Gunakan kolom: Urutan, Nama, Jabatan, Foto_URL.', 'warning');
                return;
            }

            const { error } = await db.from('candidates').insert(formatted);
            if (error) throw error;

            AppUI.toast(`${formatted.length} kandidat berhasil diimpor dari Excel!`, 'success');
            e.target.value = '';
            await refreshAllAdminData();
        } catch (err) {
            console.error(err);
            AppUI.toast('Gagal mengimpor file Excel kandidat.', 'danger');
        }
    });
}

function renderCandidatesGrid() {
    const grid = document.getElementById('candidatesAdminGrid');
    if (!grid) return;

    if (adminCandidates.length === 0) {
        grid.innerHTML = '<div class="col-12 text-center py-4 text-secondary">Belum ada kandidat terdaftar.</div>';
        return;
    }

    grid.innerHTML = adminCandidates.map(cand => {
        const avatar = cand.photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(cand.name)}&background=059669&color=fff`;
        return `
            <div class="col-md-6 col-xl-3">
                <div class="stat-card h-100 d-flex flex-column justify-content-between text-center">
                    <div>
                        <span class="badge bg-success-subtle text-success mb-2">Kolom #${cand.urutan}</span>
                        <div class="mb-3">
                            <img src="${AppUI.escapeHtml(avatar)}" class="candidate-avatar" style="width:76px;height:76px;" alt="Foto">
                        </div>
                        <h6 class="fw-bold mb-1">${AppUI.escapeHtml(cand.name)}</h6>
                        <span class="candidate-role d-inline-block mb-3">${AppUI.escapeHtml(cand.jabatan)}</span>
                    </div>
                    <div class="d-flex gap-2 justify-content-center pt-2 border-top">
                        <button class="btn btn-outline-success btn-sm flex-grow-1" onclick="editCandidate('${cand.id}')">
                            <i class="bi bi-pencil-square me-1"></i>Edit
                        </button>
                        <button class="btn btn-outline-danger btn-sm" onclick="deleteCandidate('${cand.id}')">
                            <i class="bi bi-trash3"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

window.editCandidate = function (id) {
    const cand = adminCandidates.find(c => c.id === id);
    if (!cand) return;
    document.getElementById('candId').value = cand.id;
    document.getElementById('candName').value = cand.name;
    document.getElementById('candJabatan').value = cand.jabatan;
    document.getElementById('candPhotoUrl').value = cand.photo_url || '';
    document.getElementById('candUrutan').value = cand.urutan || 1;
    document.getElementById('candidateModalTitle').textContent = 'Edit Data Kandidat';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('candidateModal')).show();
};

window.deleteCandidate = function (id) {
    const cand = adminCandidates.find(c => c.id === id);
    if (!cand) return;
    AppUI.confirm(
        'Hapus Kandidat?',
        `Apakah Anda yakin ingin menghapus kandidat <strong>${AppUI.escapeHtml(cand.name)}</strong>?`,
        async () => {
            const { error } = await db.from('candidates').delete().eq('id', id);
            if (error) {
                AppUI.toast('Gagal menghapus kandidat.', 'danger');
                return;
            }
            AppUI.toast('Kandidat berhasil dihapus.', 'success');
            await refreshAllAdminData();
        }
    );
};

/* ============================================================
   5. CRUD KATEGORI PEMILIHAN
   ============================================================ */
function initCategoryCRUD() {
    const modalEl = document.getElementById('categoryModal');
    const form = document.getElementById('categoryForm');

    document.getElementById('btnOpenAddCategory')?.addEventListener('click', () => {
        form.reset();
        document.getElementById('catId').value = '';
        document.getElementById('catUrutan').value = adminCategories.length + 1;
        document.getElementById('categoryModalTitle').textContent = 'Tambah Kategori Pemilihan';
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    });

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('catId').value;
        const payload = {
            name: document.getElementById('catName').value.trim(),
            description: document.getElementById('catDesc').value.trim(),
            urutan: parseInt(document.getElementById('catUrutan').value, 10) || 1
        };

        try {
            if (id) {
                const { error } = await db.from('categories').update(payload).eq('id', id);
                if (error) throw error;
                AppUI.toast('Kategori berhasil diperbarui.', 'success');
            } else {
                const { error } = await db.from('categories').insert([payload]);
                if (error) throw error;
                AppUI.toast('Kategori baru berhasil ditambahkan.', 'success');
            }
            bootstrap.Modal.getInstance(modalEl).hide();
            await refreshAllAdminData();
        } catch (err) {
            console.error(err);
            AppUI.toast('Gagal menyimpan kategori.', 'danger');
        }
    });
}

function renderCategoriesTable() {
    const tbody = document.getElementById('categoriesAdminTbody');
    if (!tbody) return;

    tbody.innerHTML = adminCategories.map(cat => `
        <tr>
            <td><span class="badge bg-success rounded-pill">#${cat.urutan}</span></td>
            <td class="fw-bold text-dark">${AppUI.escapeHtml(cat.name)}</td>
            <td class="text-secondary small">${AppUI.escapeHtml(cat.description || '-')}</td>
            <td class="text-end">
                <button class="btn btn-outline-success btn-sm me-1" onclick="editCategory('${cat.id}')">
                    <i class="bi bi-pencil-square"></i>
                </button>
                <button class="btn btn-outline-danger btn-sm" onclick="deleteCategory('${cat.id}')">
                    <i class="bi bi-trash3"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

window.editCategory = function (id) {
    const cat = adminCategories.find(c => c.id === id);
    if (!cat) return;
    document.getElementById('catId').value = cat.id;
    document.getElementById('catName').value = cat.name;
    document.getElementById('catDesc').value = cat.description || '';
    document.getElementById('catUrutan').value = cat.urutan || 1;
    document.getElementById('categoryModalTitle').textContent = 'Edit Kategori Pemilihan';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('categoryModal')).show();
};

window.deleteCategory = function (id) {
    const cat = adminCategories.find(c => c.id === id);
    if (!cat) return;
    AppUI.confirm(
        'Hapus Kategori Pemilihan?',
        `Menghapus kategori <strong>${AppUI.escapeHtml(cat.name)}</strong> juga akan menghapus rekap suara pada kategori ini.`,
        async () => {
            const { error } = await db.from('categories').delete().eq('id', id);
            if (error) {
                AppUI.toast('Gagal menghapus kategori.', 'danger');
                return;
            }
            AppUI.toast('Kategori berhasil dihapus.', 'success');
            await refreshAllAdminData();
        }
    );
};

/* ============================================================
   6. CRUD PEMILIH & BULK IMPORT / EXPORT EXCEL (SHEETJS)
   ============================================================ */
function initVoterCRUDAndExcel() {
    const modalEl = document.getElementById('voterModal');
    const form = document.getElementById('voterForm');

    document.getElementById('btnOpenAddVoter')?.addEventListener('click', () => {
        form.reset();
        document.getElementById('voterId').value = '';
        document.getElementById('voterModalTitle').textContent = 'Tambah Akun Pemilih';
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    });

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('voterId').value;
        const payload = {
            kelas: document.getElementById('voterKelas').value.trim().toUpperCase(),
            nama: document.getElementById('voterNama').value.trim(),
            password: document.getElementById('voterPassword').value.trim()
        };

        try {
            if (id) {
                const { error } = await db.from('voters').update(payload).eq('id', id);
                if (error) throw error;
                AppUI.toast('Data akun pemilih diperbarui.', 'success');
            } else {
                const { error } = await db.from('voters').insert([payload]);
                if (error) throw error;
                AppUI.toast('Akun pemilih baru ditambahkan.', 'success');
            }
            bootstrap.Modal.getInstance(modalEl).hide();
            await refreshAllAdminData();
        } catch (err) {
            console.error(err);
            AppUI.toast('Gagal menyimpan akun pemilih. Pastikan Nama & Kelas tidak duplikat.', 'danger');
        }
    });

    // Filter Tabel Pemilih
    document.getElementById('adminFilterKelas')?.addEventListener('change', renderVotersTable);
    document.getElementById('adminFilterStatus')?.addEventListener('change', renderVotersTable);
    document.getElementById('adminSearchVoter')?.addEventListener('input', renderVotersTable);

    // Unduh Template Excel Pemilih
    document.getElementById('btnDownloadVoterTemplate')?.addEventListener('click', () => {
        const templateData = [
            { Kelas: 'X TKJ 1', Nama: 'Aditya Pratama', Password: '12345' },
            { Kelas: 'XI TKJ 1', Nama: 'Dimas Anggara', Password: '12345' },
            { Kelas: 'DEWAN GURU', Nama: 'Hendro Wibowo, S.Pd', Password: 'guru123' }
        ];
        const ws = XLSX.utils.json_to_sheet(templateData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Data_Pemilih');
        XLSX.writeFile(wb, 'Template_Pemilih_SMK_Addawah.xlsx');
    });

    // Upload & Bulk Upsert Excel Pemilih
    document.getElementById('inputExcelVoters')?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const buffer = await file.arrayBuffer();
            const wb = XLSX.read(buffer, { type: 'array' });
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

            const votersPayload = rows
                .filter(r => r.Kelas && r.Nama && r.Password !== undefined)
                .map(r => ({
                    kelas: String(r.Kelas).trim().toUpperCase(),
                    nama: String(r.Nama).trim(),
                    password: String(r.Password).trim()
                }));

            if (votersPayload.length === 0) {
                AppUI.toast('Format Excel tidak valid. Pastikan terdapat kolom: Kelas, Nama, Password.', 'warning');
                return;
            }

            const { error } = await db
                .from('voters')
                .upsert(votersPayload, { onConflict: 'kelas,nama' });

            if (error) throw error;

            AppUI.toast(`${votersPayload.length} akun pemilih berhasil diunggah/diperbarui!`, 'success');
            e.target.value = '';
            await refreshAllAdminData();
        } catch (err) {
            console.error(err);
            AppUI.toast('Gagal memproses file Excel pemilih.', 'danger');
        }
    });
}

function populateVoterClassFilter() {
    const select = document.getElementById('adminFilterKelas');
    if (!select) return;
    const current = select.value || 'ALL';
    const classes = [...new Set(adminVoters.map(v => v.kelas))];

    select.innerHTML = '<option value="ALL">Semua Kelas / Unit</option>';
    classes.forEach(kls => {
        const opt = document.createElement('option');
        opt.value = kls;
        opt.textContent = kls;
        select.appendChild(opt);
    });

    if ([...select.options].some(o => o.value === current)) {
        select.value = current;
    }
}

function renderVotersTable() {
    const tbody = document.getElementById('votersAdminTbody');
    if (!tbody) return;

    const klsFilter = document.getElementById('adminFilterKelas')?.value || 'ALL';
    const statusFilter = document.getElementById('adminFilterStatus')?.value || 'ALL';
    const query = (document.getElementById('adminSearchVoter')?.value || '').toLowerCase();

    const filtered = adminVoters.filter(v => {
        const matchKls = klsFilter === 'ALL' || v.kelas === klsFilter;
        const matchStatus =
            statusFilter === 'ALL' ||
            (statusFilter === 'VOTED' && v.has_voted) ||
            (statusFilter === 'UNVOTED' && !v.has_voted);
        const matchQuery = v.nama.toLowerCase().includes(query) || v.kelas.toLowerCase().includes(query);
        return matchKls && matchStatus && matchQuery;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-secondary">Tidak ada data pemilih yang cocok.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(v => `
        <tr>
            <td><span class="badge bg-light text-dark border">${AppUI.escapeHtml(v.kelas)}</span></td>
            <td class="fw-semibold text-dark">${AppUI.escapeHtml(v.nama)}</td>
            <td><code>${AppUI.escapeHtml(v.password)}</code></td>
            <td>
                ${v.has_voted
                    ? '<span class="badge bg-success-subtle text-success rounded-pill"><i class="bi bi-check-circle-fill me-1"></i>Sudah Memilih</span>'
                    : '<span class="badge bg-secondary-subtle text-secondary rounded-pill">Belum Memilih</span>'}
            </td>
            <td class="small text-secondary">${v.voted_at ? new Date(v.voted_at).toLocaleString('id-ID') : '-'}</td>
            <td class="text-end">
                ${v.has_voted ? `
                    <button class="btn btn-outline-warning btn-sm me-1" title="Reset Status Pilih" onclick="resetSingleVoterStatus('${v.id}')">
                        <i class="bi bi-arrow-counterclockwise"></i>
                    </button>
                ` : ''}
                <button class="btn btn-outline-success btn-sm me-1" onclick="editVoter('${v.id}')">
                    <i class="bi bi-pencil-square"></i>
                </button>
                <button class="btn btn-outline-danger btn-sm" onclick="deleteVoter('${v.id}')">
                    <i class="bi bi-trash3"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

window.editVoter = function (id) {
    const v = adminVoters.find(item => item.id === id);
    if (!v) return;
    document.getElementById('voterId').value = v.id;
    document.getElementById('voterKelas').value = v.kelas;
    document.getElementById('voterNama').value = v.nama;
    document.getElementById('voterPassword').value = v.password;
    document.getElementById('voterModalTitle').textContent = 'Edit Akun Pemilih';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('voterModal')).show();
};

window.resetSingleVoterStatus = function (id) {
    const v = adminVoters.find(item => item.id === id);
    if (!v) return;
    AppUI.confirm(
        'Reset Status Suara Pemilih?',
        `Izinkan <strong>${AppUI.escapeHtml(v.nama)}</strong> untuk login kembali? (Catatan: Suara anonim yang sudah masuk ke matriks tetap tersimpan).`,
        async () => {
            const { error } = await db.from('voters').update({ has_voted: false, voted_at: null }).eq('id', id);
            if (error) {
                AppUI.toast('Gagal mereset status pemilih.', 'danger');
                return;
            }
            AppUI.toast('Status pemilih berhasil direset.', 'success');
            await refreshAllAdminData();
        },
        'Ya, Reset Status',
        'btn-warning'
    );
};

window.deleteVoter = function (id) {
    const v = adminVoters.find(item => item.id === id);
    if (!v) return;
    AppUI.confirm(
        'Hapus Akun Pemilih?',
        `Hapus <strong>${AppUI.escapeHtml(v.nama)} (${AppUI.escapeHtml(v.kelas)})</strong> dari daftar pemilih?`,
        async () => {
            const { error } = await db.from('voters').delete().eq('id', id);
            if (error) {
                AppUI.toast('Gagal menghapus pemilih.', 'danger');
                return;
            }
            AppUI.toast('Akun pemilih dihapus.', 'success');
            await refreshAllAdminData();
        }
    );
};

/* ============================================================
   7. KUSTOMISASI UI (LOGO, BACKGROUND) & EXPORT LAPORAN EXCEL
   ============================================================ */
function initWebCustomizationSettings() {
    const form = document.getElementById('settingsForm');
    const fileLogo = document.getElementById('fileUploadLogo');
    const fileBg = document.getElementById('fileUploadBg');

    fileLogo?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            AppUI.toast('Mengunggah logo sekolah...', 'info');
            const url = await AppUI.uploadImageToStorage(file, 'branding');
            document.getElementById('setLogoUrl').value = url;
            AppUI.toast('Logo berhasil diunggah! Klik Simpan Pengaturan.', 'success');
        } catch (err) {
            console.error(err);
            AppUI.toast('Gagal mengunggah logo.', 'danger');
        }
    });

    fileBg?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            AppUI.toast('Mengunggah background web...', 'info');
            const url = await AppUI.uploadImageToStorage(file, 'branding');
            document.getElementById('setBgUrl').value = url;
            AppUI.toast('Background berhasil diunggah! Klik Simpan Pengaturan.', 'success');
        } catch (err) {
            console.error(err);
            AppUI.toast('Gagal mengunggah background.', 'danger');
        }
    });

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            school_name: document.getElementById('setSchoolName').value.trim(),
            election_title: document.getElementById('setElectionTitle').value.trim(),
            logo_url: document.getElementById('setLogoUrl').value.trim(),
            bg_url: document.getElementById('setBgUrl').value.trim(),
            is_voting_open: document.getElementById('setVotingOpen').checked,
            updated_at: new Date().toISOString()
        };

        try {
            const { error } = await db.from('settings').upsert({ id: 1, ...payload });
            if (error) throw error;
            await AppUI.loadAndApplySettings();
            AppUI.toast('Pengaturan tampilan web berhasil diterapkan!', 'success');
        } catch (err) {
            console.error(err);
            AppUI.toast('Gagal menyimpan pengaturan tampilan.', 'danger');
        }
    });

    // Reset Seluruh Suara Pemilihan
    document.getElementById('btnResetAllElectionVotes')?.addEventListener('click', () => {
        AppUI.confirm(
            'Reset Seluruh Perolehan Suara?',
            'Tindakan ini akan mengosongkan seluruh grafik suara (<strong>0 suara</strong>) dan mengembalikan status seluruh pemilih menjadi <strong>Belum Memilih</strong>.',
            async () => {
                try {
                    await db.from('vote_logs').delete().neq('voter_id', '00000000-0000-0000-0000-000000000000');
                    await db.from('vote_counts').delete().neq('total_votes', -1);
                    await db.from('voters').update({ has_voted: false, voted_at: null }).neq('nama', '');
                    AppUI.toast('Seluruh perolehan suara dan status pemilih telah direset!', 'success');
                    await refreshAllAdminData();
                } catch (err) {
                    console.error(err);
                    AppUI.toast('Gagal mereset seluruh suara.', 'danger');
                }
            },
            'Ya, Reset Semuanya',
            'btn-danger'
        );
    });
}

function populateSettingsForm(s) {
    document.getElementById('setSchoolName').value = s.school_name || '';
    document.getElementById('setElectionTitle').value = s.election_title || '';
    document.getElementById('setLogoUrl').value = s.logo_url || '';
    document.getElementById('setBgUrl').value = s.bg_url || '';
    document.getElementById('setVotingOpen').checked = s.is_voting_open !== false;
}

/**
 * Export Laporan Rekap Matriks & Partisipasi ke File Excel (.xlsx)
 */
function exportElectionReportToExcel() {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Matriks Perolehan Suara
    const matrixRows = adminCategories.map(cat => {
        const rowObj = { Kategori: cat.name };
        adminCandidates.forEach(cand => {
            rowObj[`${cand.name} (${cand.jabatan})`] = getVotesCount(cat.id, cand.id);
        });
        return rowObj;
    });
    const wsMatrix = XLSX.utils.json_to_sheet(matrixRows);
    XLSX.utils.book_append_sheet(wb, wsMatrix, 'Rekap_Matriks_Suara');

    // Sheet 2: Status Kehadiran Pemilih (Tanpa Pilihan Kandidat - Anonim)
    const voterRows = adminVoters.map(v => ({
        Kelas: v.kelas,
        Nama: v.nama,
        Status: v.has_voted ? 'SUDAH MEMILIH' : 'BELUM MEMILIH',
        Waktu_Memilih: v.voted_at ? new Date(v.voted_at).toLocaleString('id-ID') : '-'
    }));
    const wsVoters = XLSX.utils.json_to_sheet(voterRows);
    XLSX.utils.book_append_sheet(wb, wsVoters, 'Partisipasi_Pemilih');

    XLSX.writeFile(wb, `Laporan_EVoting_SMK_Addawah_${new Date().toISOString().slice(0, 10)}.xlsx`);
    AppUI.toast('Laporan Excel berhasil diunduh!', 'success');
}

/* ============================================================
   8. PEMANGGIL BILIK DINAMIS, PENGATURAN SUARA & SINKRONISASI REALTIME
   ============================================================ */
function initAdminRealtimeSync() {
    adminRealtimeInitialized = true;

    let refreshDebounce = null;
    const triggerLightRefresh = () => {
        clearTimeout(refreshDebounce);
        refreshDebounce = setTimeout(async () => {
            const [voterRes, boothRes, voteRes] = await Promise.all([
                db.from('voters').select('*').order('kelas', { ascending: true }).order('nama', { ascending: true }),
                db.from('active_booths').select('*').order('booth_code', { ascending: true }),
                db.from('vote_counts').select('*')
            ]);
            if (voterRes.data) adminVoters = voterRes.data;
            if (boothRes.data) adminBooths = boothRes.data;
            if (voteRes.data) adminVoteCounts = voteRes.data;

            updateSummaryStatCards();
            renderPodiumWinners();
            renderInteractiveChart();
            renderBoothCallerPanel();
            renderVotersTable();
        }, 400);
    };

    db.channel('admin-live-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'active_booths' }, triggerLightRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'voters' }, triggerLightRefresh)
        .subscribe();
}

function initBoothCallerControls() {
    document.getElementById('callerSearchInput')?.addEventListener('input', renderCallerStudentsTable);
    document.getElementById('callerStatusFilter')?.addEventListener('change', renderCallerStudentsTable);

    // Tambah Bilik Dinamis
    document.getElementById('btnAddDynamicBooth')?.addEventListener('click', async () => {
        let maxNum = 0;
        adminBooths.forEach(b => {
            const num = parseInt(b.booth_code, 10);
            if (!isNaN(num) && num > maxNum) maxNum = num;
        });
        const nextCode = String(maxNum + 1).padStart(2, '0');

        const { error } = await db.from('active_booths').insert([{
            booth_code: nextCode,
            booth_name: `Bilik Laptop ${nextCode}`,
            status: 'empty'
        }]);

        if (error) {
            AppUI.toast('Gagal menambah bilik baru.', 'danger');
            return;
        }
        AppUI.toast(`Bilik Laptop ${nextCode} berhasil ditambahkan! URL: index.html?bilik=${nextCode}`, 'success');
        await refreshAllAdminData();
    });

    // Update label kecepatan suara
    document.getElementById('adminVoiceRate')?.addEventListener('input', (e) => {
        updateAdminVoiceRateLabel(e.target.value);
    });

    // Simpan Pengaturan Suara ke tabel settings
    document.getElementById('btnSaveVoiceConfig')?.addEventListener('click', async () => {
        const style = document.getElementById('adminVoiceStyle').value;
        const rate = parseFloat(document.getElementById('adminVoiceRate').value);

        const { error } = await db.from('settings').update({
            voice_style: style,
            voice_rate: rate,
            updated_at: new Date().toISOString()
        }).eq('id', 1);

        if (error) {
            AppUI.toast('Gagal menyimpan pengaturan suara.', 'danger');
            return;
        }
        AppUI.toast('Pengaturan suara berhasil disimpan dan langsung diterapkan ke live.html!', 'success');
    });

    // Tombol Tes Suara -> Dikirim ke live_announcements agar berbunyi di TV live.html
    document.getElementById('btnTestVoiceLogin')?.addEventListener('click', async () => {
        await db.from('live_announcements').insert([{
            event_type: 'test_login',
            student_name: 'Alif Rahman Hakim',
            kelas: 'X TKJ 1',
            booth_code: '01'
        }]);
        AppUI.toast('Sinyal Tes Panggilan Bilik dikirim ke layar live.html!', 'info');
    });

    document.getElementById('btnTestVoiceDone')?.addEventListener('click', async () => {
        await db.from('live_announcements').insert([{
            event_type: 'test_done',
            student_name: 'Nabila Zahra Putri',
            kelas: 'X TKJ 1',
            class_pct: 85
        }]);
        AppUI.toast('Sinyal Tes Selesai Voting dikirim ke layar live.html!', 'info');
    });
}

function populateVoiceConfigForm(settings) {
    const styleEl = document.getElementById('adminVoiceStyle');
    const rateEl = document.getElementById('adminVoiceRate');
    if (styleEl && settings.voice_style) styleEl.value = settings.voice_style;
    if (rateEl && settings.voice_rate) {
        rateEl.value = settings.voice_rate;
        updateAdminVoiceRateLabel(settings.voice_rate);
    }
}

function updateAdminVoiceRateLabel(val) {
    const num = parseFloat(val);
    const desc = num >= 1.25 ? 'Cepat' : num >= 1.1 ? 'Sigap' : 'Normal';
    const el = document.getElementById('adminVoiceRateLabel');
    if (el) el.textContent = `${num}x (${desc})`;
}

function renderBoothCallerPanel() {
    renderAdminBoothsStrip();
    renderCallerClassPills();
    renderCallerStudentsTable();
}

function renderAdminBoothsStrip() {
    const container = document.getElementById('adminBoothsStripGrid');
    if (!container) return;

    if (adminBooths.length === 0) {
        container.innerHTML = '<div class="col-12 text-muted small">Belum ada bilik terdaftar. Klik "Tambah Bilik Laptop".</div>';
        return;
    }

    container.innerHTML = adminBooths.map(b => {
        const isOccupied = b.status !== 'empty' && b.voter_id;
        const isVoting = b.status === 'voting';

        if (isOccupied) {
            return `
                <div class="col-6 col-md-4 col-xl-2">
                    <div class="p-3 rounded-4 border ${isVoting ? 'bg-success-subtle border-success' : 'bg-warning-subtle border-warning'} h-100 d-flex flex-column justify-content-between">
                        <div>
                            <div class="d-flex justify-content-between align-items-center mb-1">
                                <span class="fw-extrabold small text-dark">${AppUI.escapeHtml(b.booth_name)}</span>
                                <span class="badge ${isVoting ? 'bg-success' : 'bg-warning text-dark'}" style="font-size: 0.65rem;">
                                    ${isVoting ? 'Memilih' : 'Dipanggil'}
                                </span>
                            </div>
                            <div class="fw-bold small text-dark text-truncate" title="${AppUI.escapeHtml(b.voter_name)}">
                                ${AppUI.escapeHtml(b.voter_name)}
                            </div>
                            <div class="text-secondary" style="font-size: 0.72rem;">${AppUI.escapeHtml(b.voter_kelas)}</div>
                        </div>
                        <div class="d-flex gap-1 mt-2 pt-2 border-top border-dark border-opacity-10">
                            <button class="btn btn-light btn-sm py-0 px-2 border flex-grow-1" style="font-size: 0.7rem;" title="Panggil Ulang Suara" onclick="recallStudentBooth('${b.booth_code}')">
                                <i class="bi bi-volume-up-fill text-success"></i> Ulang
                            </button>
                            <button class="btn btn-outline-danger btn-sm py-0 px-2" style="font-size: 0.7rem;" title="Batalkan / Kosongkan Bilik" onclick="cancelBoothAssignment('${b.booth_code}')">
                                <i class="bi bi-x-lg"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        } else {
            return `
                <div class="col-6 col-md-4 col-xl-2">
                    <div class="p-3 rounded-4 border border-dashed bg-light h-100 d-flex flex-column justify-content-between">
                        <div>
                            <div class="d-flex justify-content-between align-items-center mb-1">
                                <span class="fw-extrabold small text-secondary">${AppUI.escapeHtml(b.booth_name)}</span>
                                <span class="badge bg-secondary-subtle text-secondary" style="font-size: 0.65rem;">Kosong</span>
                            </div>
                            <div class="text-success fw-semibold" style="font-size: 0.72rem;">Siap Dipanggil</div>
                            <div class="text-muted" style="font-size: 0.68rem;">?bilik=${AppUI.escapeHtml(b.booth_code)}</div>
                        </div>
                        <div class="mt-2 text-end">
                            <button class="btn btn-link text-danger p-0 text-decoration-none" style="font-size: 0.72rem;" onclick="deleteDynamicBooth('${b.booth_code}')">
                                <i class="bi bi-trash3"></i> Hapus
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }
    }).join('');
}

function renderCallerClassPills() {
    const wrap = document.getElementById('callerClassPills');
    if (!wrap) return;

    const classes = [...new Set(adminVoters.map(v => v.kelas))].sort();
    let html = `
        <button type="button" class="btn btn-sm rounded-3 ${adminCallerClassFilter === 'ALL' ? 'btn-success fw-bold' : 'btn-outline-success'}" onclick="setCallerClassFilter('ALL')">
            Semua Kelas
        </button>
    `;

    classes.forEach(cls => {
        const active = adminCallerClassFilter === cls;
        html += `
            <button type="button" class="btn btn-sm rounded-3 ${active ? 'btn-success fw-bold' : 'btn-outline-success'}" onclick="setCallerClassFilter('${AppUI.escapeHtml(cls).replace(/'/g, "\\'")}')">
                ${AppUI.escapeHtml(cls)}
            </button>
        `;
    });

    wrap.innerHTML = html;
}

window.setCallerClassFilter = function (cls) {
    adminCallerClassFilter = cls;
    renderCallerClassPills();
    renderCallerStudentsTable();
};

function renderCallerStudentsTable() {
    const tbody = document.getElementById('callerStudentsTbody');
    const countBadge = document.getElementById('callerFilteredCount');
    if (!tbody) return;

    const query = (document.getElementById('callerSearchInput')?.value || '').trim().toLowerCase();
    const statusFilter = document.getElementById('callerStatusFilter')?.value || 'ALL';

    const enriched = adminVoters.map(v => {
        const assignedBooth = adminBooths.find(b => b.status !== 'empty' && String(b.voter_id) === String(v.id));
        let liveStatus = 'belum';
        if (v.has_voted) liveStatus = 'sudah';
        else if (assignedBooth) liveStatus = 'bilik';
        return { ...v, liveStatus, assignedBooth };
    });

    const filtered = enriched.filter(v => {
        const matchClass = adminCallerClassFilter === 'ALL' || v.kelas === adminCallerClassFilter;
        const matchStatus = statusFilter === 'ALL' || v.liveStatus === statusFilter;
        const matchQuery = !query || v.nama.toLowerCase().includes(query) || v.kelas.toLowerCase().includes(query);
        return matchClass && matchStatus && matchQuery;
    });

    if (countBadge) countBadge.textContent = `${filtered.length} Pemilih`;

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted small">Tidak ada pemilih yang sesuai filter.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.slice(0, 100).map(v => {
        let badgeHtml = '';
        let actionHtml = '';

        if (v.liveStatus === 'sudah') {
            badgeHtml = '<span class="badge bg-success-subtle text-success rounded-pill"><i class="bi bi-check-circle-fill me-1"></i>Sudah Memilih</span>';
            actionHtml = '<span class="small text-muted fst-italic">Otomatis sinkron selesai</span>';
        } else if (v.liveStatus === 'bilik') {
            const b = v.assignedBooth;
            const isVoting = b.status === 'voting';
            badgeHtml = `<span class="badge ${isVoting ? 'bg-success' : 'bg-warning text-dark'} rounded-pill">${isVoting ? 'Memilih' : 'Dipanggil'} di B${AppUI.escapeHtml(b.booth_code)}</span>`;
            actionHtml = `
                <div class="d-flex justify-content-end gap-1">
                    <button class="btn btn-warning btn-sm fw-bold text-dark" onclick="recallStudentBooth('${b.booth_code}')">
                        <i class="bi bi-megaphone-fill me-1"></i>Panggil Ulang
                    </button>
                    <button class="btn btn-outline-danger btn-sm" title="Batalkan Panggilan" onclick="cancelBoothAssignment('${b.booth_code}')">
                        Batal
                    </button>
                </div>
            `;
        } else {
            badgeHtml = '<span class="badge bg-secondary-subtle text-secondary rounded-pill">Belum Memilih</span>';
            const btns = adminBooths.map(b => {
                const busy = b.status !== 'empty' && b.voter_id;
                if (busy) {
                    return `<button disabled class="btn btn-light btn-sm border text-muted" style="font-size:0.72rem;" title="Terisi oleh ${AppUI.escapeHtml(b.voter_name)}">B${AppUI.escapeHtml(b.booth_code)}</button>`;
                }
                return `<button class="btn btn-emerald btn-sm py-1 px-2" style="font-size:0.72rem;" onclick="callStudentToBooth('${v.id}', '${b.booth_code}')">Bilik ${AppUI.escapeHtml(b.booth_code)}</button>`;
            }).join('');
            actionHtml = `<div class="d-flex flex-wrap justify-content-end gap-1">${btns}</div>`;
        }

        return `
            <tr>
                <td class="fw-bold text-dark small">${AppUI.escapeHtml(v.nama)}</td>
                <td><span class="badge bg-light text-dark border">${AppUI.escapeHtml(v.kelas)}</span></td>
                <td>${badgeHtml}</td>
                <td class="text-end">${actionHtml}</td>
            </tr>
        `;
    }).join('');
}

window.callStudentToBooth = async function (voterId, boothCode) {
    const voter = adminVoters.find(v => String(v.id) === String(voterId));
    if (!voter) return;

    try {
        // 1. Update status bilik menjadi 'called' agar laptop ?bilik=XX auto-fill & muncul di live.html
        const { error: boothErr } = await db.from('active_booths').update({
            voter_id: voter.id,
            voter_name: voter.nama,
            voter_kelas: voter.kelas,
            status: 'called',
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }).eq('booth_code', boothCode);

        if (boothErr) throw boothErr;

        // 2. Kirim event suara ke live.html
        await db.from('live_announcements').insert([{
            event_type: 'booth_call',
            student_name: voter.nama,
            kelas: voter.kelas,
            booth_code: boothCode
        }]);

        AppUI.toast(`Memanggil ${voter.nama} (${voter.kelas}) ke Bilik ${boothCode}. Suara berbunyi di live.html!`, 'success');
    } catch (err) {
        console.error(err);
        AppUI.toast('Gagal memanggil siswa ke bilik.', 'danger');
    }
};

window.recallStudentBooth = async function (boothCode) {
    const booth = adminBooths.find(b => b.booth_code === boothCode);
    if (!booth || !booth.voter_name) return;

    await db.from('live_announcements').insert([{
        event_type: 'booth_recall',
        student_name: booth.voter_name,
        kelas: booth.voter_kelas,
        booth_code: boothCode
    }]);
    AppUI.toast(`Panggilan ulang untuk ${booth.voter_name} dikirim ke layar live.html!`, 'info');
};

window.cancelBoothAssignment = async function (boothCode) {
    const booth = adminBooths.find(b => b.booth_code === boothCode);
    if (!booth) return;

    AppUI.confirm(
        `Kosongkan ${booth.booth_name}?`,
        `Batalkan panggilan/sesi <strong>${AppUI.escapeHtml(booth.voter_name)}</strong> di bilik ini? (Status suara siswa tetap Belum Memilih).`,
        async () => {
            await db.from('active_booths').update({
                voter_id: null,
                voter_name: '',
                voter_kelas: '',
                status: 'empty',
                updated_at: new Date().toISOString()
            }).eq('booth_code', boothCode);
            AppUI.toast(`${booth.booth_name} berhasil dikosongkan.`, 'info');
        },
        'Ya, Kosongkan',
        'btn-warning'
    );
};

window.deleteDynamicBooth = function (boothCode) {
    AppUI.confirm(
        `Hapus Bilik Laptop ${boothCode}?`,
        'Bilik yang dihapus tidak lagi tampil di panel pemanggil dan layar live.',
        async () => {
            const { error } = await db.from('active_booths').delete().eq('booth_code', boothCode);
            if (error) {
                AppUI.toast('Gagal menghapus bilik.', 'danger');
                return;
            }
            AppUI.toast(`Bilik Laptop ${boothCode} telah dihapus.`, 'success');
            await refreshAllAdminData();
        },
        'Ya, Hapus Bilik',
        'btn-danger'
    );
};