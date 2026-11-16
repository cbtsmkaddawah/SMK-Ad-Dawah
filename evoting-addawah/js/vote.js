/**
 * js/vote.js
 * Logika Pemilihan Konsep Wizard (Step-by-Step), Pencarian Cepat,
 * Validasi Kandidat Unik Antar-Kategori, & Halaman Ringkasan (Review)
 */

let wizardCategories = [];
let wizardCandidates = [];
// Menyimpan pilihan: { [categoryId]: candidateId }
let voterSelections = {};
let currentStepIndex = 0; // 0 s.d (wizardCategories.length - 1) = Step Kategori, wizardCategories.length = Halaman Review

document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('wizardSearchInput');
    const btnPrev = document.getElementById('btnWizardPrev');
    const btnNext = document.getElementById('btnWizardNext');
    const btnBackFromReview = document.getElementById('btnBackFromReview');
    const btnResetAll = document.getElementById('btnResetAllWizardChoices');
    const btnSubmitFinal = document.getElementById('btnSubmitFinalVote');
    const btnCancelSession = document.getElementById('btnCancelVoteSession');

    // Filter kandidat secara real-time saat mengetik di Search Bar
    searchInput?.addEventListener('input', () => {
        renderCandidateCardsGrid();
    });

    // Tombol Sebelumnya
    btnPrev?.addEventListener('click', () => {
        if (currentStepIndex > 0) {
            currentStepIndex--;
            document.getElementById('wizardSearchInput').value = '';
            renderWizardView();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });

    // Tombol Selanjutnya (Pindah ke Kategori Berikutnya atau ke Halaman Review)
    btnNext?.addEventListener('click', () => {
        const currentCategory = wizardCategories[currentStepIndex];
        if (!currentCategory || !voterSelections[currentCategory.id]) {
            AppUI.toast('Silakan pilih 1 kandidat terlebih dahulu untuk melanjutkan.', 'warning');
            return;
        }

        if (currentStepIndex < wizardCategories.length) {
            currentStepIndex++;
            document.getElementById('wizardSearchInput').value = '';
            renderWizardView();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });

    // Tombol Kembali dari Halaman Review ke Kategori Terakhir
    btnBackFromReview?.addEventListener('click', () => {
        currentStepIndex = Math.max(0, wizardCategories.length - 1);
        renderWizardView();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Tombol Ulangi Semua Pilihan dari Awal
    btnResetAll?.addEventListener('click', () => {
        AppUI.confirm(
            'Ulangi Seluruh Pilihan?',
            'Semua pilihan Anda dari Kategori 1 hingga selesai akan dikosongkan kembali.',
            () => {
                voterSelections = {};
                currentStepIndex = 0;
                document.getElementById('wizardSearchInput').value = '';
                renderWizardView();
                AppUI.toast('Seluruh pilihan telah direset. Silakan mulai dari Kategori 1.', 'info');
            },
            'Ya, Ulangi',
            'btn-warning'
        );
    });

    // Tombol Keluar Sesi
    btnCancelSession?.addEventListener('click', () => {
        AppUI.confirm(
            'Keluar dari Bilik Pemilihan?',
            'Suara Anda belum dikirim. Anda dapat masuk kembali selama belum menekan tombol kirim final.',
            () => resetVoterLoginScreen(),
            'Keluar Sekarang',
            'btn-danger'
        );
    });

    // Tombol Kirim Pilihan Saya (Final)
    btnSubmitFinal?.addEventListener('click', submitAnonymousBallotToSupabase);
});

/**
 * Dipanggil oleh js/auth.js setelah pemilih berhasil login
 */
async function enterMatrixVotingBooth(voter) {
    document.getElementById('navVoterName').textContent = voter.nama;
    document.getElementById('navVoterClass').textContent = voter.kelas;

    const badge = document.getElementById('activeVoterBadge');
    badge.classList.remove('d-none');
    badge.classList.add('d-flex');

    document.getElementById('loginSection').classList.add('d-none');
    document.getElementById('votingSection').classList.remove('d-none');

    voterSelections = {};
    currentStepIndex = 0;
    const searchInput = document.getElementById('wizardSearchInput');
    if (searchInput) searchInput.value = '';

    await loadWizardDataFromSupabase();
}

/**
 * Ambil data Kategori & 26 Kandidat dari Supabase
 */
async function loadWizardDataFromSupabase() {
    const grid = document.getElementById('wizardCandidatesGrid');
    grid.innerHTML = `
        <div class="col-12 text-center py-5">
            <div class="spinner-border text-success mb-2"></div>
            <div class="small text-secondary fw-semibold">Memuat daftar kategori dan kandidat...</div>
        </div>
    `;

    try {
        const [catRes, candRes] = await Promise.all([
            db.from('categories').select('*').order('urutan', { ascending: true }),
            db.from('candidates').select('*').order('urutan', { ascending: true })
        ]);

        if (catRes.error) throw catRes.error;
        if (candRes.error) throw candRes.error;

        wizardCategories = catRes.data || [];
        wizardCandidates = candRes.data || [];

        if (wizardCategories.length === 0 || wizardCandidates.length === 0) {
            grid.innerHTML = `
                <div class="col-12 text-center py-5 text-secondary">
                    Belum ada data kategori atau kandidat yang diatur oleh Admin.
                </div>
            `;
            return;
        }

        renderWizardView();
    } catch (err) {
        console.error(err);
        AppUI.toast('Gagal memuat data pemilihan.', 'danger');
    }
}

/**
 * Cek apakah seorang kandidat sudah dipilih di kategori LAIN
 * Mengembalikan nama kategori tempat kandidat tersebut sudah digunakan, atau null jika belum
 */
// function getUsedCategoryName(candidateId, activeCategoryId) {
//     for (const [catId, chosenCandId] of Object.entries(voterSelections)) {
//         if (catId !== String(activeCategoryId) && String(chosenCandId) === String(candidateId)) {
//             const foundCat = wizardCategories.find(c => String(c.id) === String(catId));
//             return foundCat ? foundCat.name : 'Kategori Lain';
//         }
//     }
//     return null;
// }

/**
 * Mengatur tampilan utama: Apakah sedang di Langkah Pemilihan (1..N) atau di Halaman Ringkasan (Review)
 */
function renderWizardView() {
    const totalCategories = wizardCategories.length;
    const filledCount = Object.keys(voterSelections).length;
    const progressPct = totalCategories > 0 ? Math.round((filledCount / totalCategories) * 100) : 0;

    document.getElementById('wizardProgressText').textContent = `${filledCount} / ${totalCategories} Terisi`;
    document.getElementById('wizardProgressBar').style.width = `${progressPct}%`;

    const stepCandidateView = document.getElementById('wizardCandidateStepView');
    const stepReviewView = document.getElementById('wizardReviewStepView');

    // Jika sudah melewati kategori terakhir -> Tampilkan Halaman Ringkasan (Review)
    if (currentStepIndex >= totalCategories) {
        document.getElementById('wizardStepBadge').textContent = 'Tahap Akhir: Konfirmasi & Review';
        document.getElementById('wizardCategoryTitle').textContent = 'Periksa Kembali Pilihan Anda';
        document.getElementById('wizardCategoryDesc').textContent =
            'Pastikan pilihan di seluruh kategori sudah sesuai sebelum menekan tombol kirim final.';

        stepCandidateView.classList.add('d-none');
        stepReviewView.classList.remove('d-none');
        renderReviewSummaryCards();
        return;
    }

    // Jika sedang berada di langkah kategori (0 s.d totalCategories - 1)
    stepReviewView.classList.add('d-none');
    stepCandidateView.classList.remove('d-none');

    const activeCat = wizardCategories[currentStepIndex];
    document.getElementById('wizardStepBadge').textContent = `Kategori ${currentStepIndex + 1} dari ${totalCategories}`;
    document.getElementById('wizardCategoryTitle').textContent = `${currentStepIndex + 1}/${totalCategories}: Pilih ${activeCat.name}`;
    document.getElementById('wizardCategoryDesc').textContent =
        activeCat.description || 'Pilih 1 kandidat untuk kategori ini. Klik kembali kartu kandidat terpilih jika ingin mengganti pilihan.';

    // Atur tombol Sebelumnya & Selanjutnya
    const btnPrev = document.getElementById('btnWizardPrev');
    const btnNext = document.getElementById('btnWizardNext');

    btnPrev.disabled = currentStepIndex === 0;
    const hasSelectedCurrent = Boolean(voterSelections[activeCat.id]);
    btnNext.disabled = !hasSelectedCurrent;

    if (currentStepIndex === totalCategories - 1) {
        btnNext.innerHTML = 'Lihat Ringkasan Pilihan<i class="bi bi-clipboard2-check ms-2"></i>';
    } else {
        btnNext.innerHTML = 'Selanjutnya<i class="bi bi-arrow-right ms-2"></i>';
    }

    updateCurrentStepSelectionBanner(activeCat);
    renderCandidateCardsGrid();
}

/**
 * Informasi kandidat yang sedang terpilih di baris atas grid
 */
function updateCurrentStepSelectionBanner(activeCat) {
    const infoEl = document.getElementById('currentStepSelectionInfo');
    const selectedCandId = voterSelections[activeCat.id];

    if (!selectedCandId) {
        infoEl.innerHTML = '<i class="bi bi-hand-index-thumb me-1"></i>Klik salah satu kartu kandidat di bawah untuk memilih.';
        return;
    }

    const cand = wizardCandidates.find(c => String(c.id) === String(selectedCandId));
    if (cand) {
        infoEl.innerHTML = `Pilihan Anda untuk <strong>${AppUI.escapeHtml(activeCat.name)}</strong>: <span class="badge bg-success ms-1 px-2 py-1">${AppUI.escapeHtml(cand.name)}</span>`;
    }
}

/**
 * Render Grid 26 Card Kandidat:
 * - Hanya boleh memilih 1 guru di kategori aktif (saat 1 dipilih, kandidat lain di kategori ini terkunci).
 * - Klik ulang kandidat yang sedang terpilih (hijau) untuk membatalkan/mengubah pilihan.
 * - Saat pindah ke kategori berikutnya, semua 26 kandidat terbuka kembali (guru yang sama bebas dipilih lagi).
 */
function renderCandidateCardsGrid() {
    const grid = document.getElementById('wizardCandidatesGrid');
    const activeCat = wizardCategories[currentStepIndex];
    if (!grid || !activeCat) return;

    const query = (document.getElementById('wizardSearchInput')?.value || '').trim().toLowerCase();
    const selectedCandIdInThisStep = voterSelections[activeCat.id];
    const hasSelectionInThisStep = Boolean(selectedCandIdInThisStep);

    const filteredCandidates = wizardCandidates.filter(cand => {
        if (!query) return true;
        return (
            cand.name.toLowerCase().includes(query) ||
            (cand.jabatan && cand.jabatan.toLowerCase().includes(query))
        );
    });

    if (filteredCandidates.length === 0) {
        grid.innerHTML = `
            <div class="col-12 text-center py-5 text-secondary">
                <i class="bi bi-search fs-3 d-block mb-2 opacity-50"></i>
                Tidak ditemukan kandidat dengan kata kunci "<strong>${AppUI.escapeHtml(query)}</strong>".
            </div>
        `;
        return;
    }

    grid.innerHTML = filteredCandidates.map(cand => {
        const isSelectedHere = String(selectedCandIdInThisStep) === String(cand.id);
        // Kunci kandidat LAIN hanya pada kategori yang sedang tampil saat ini
        const isLockedOtherInSameCategory = hasSelectionInThisStep && !isSelectedHere;

        const avatar = cand.photo_url && cand.photo_url.trim() !== ''
            ? cand.photo_url
            : `https://ui-avatars.com/api/?name=${encodeURIComponent(cand.name)}&background=059669&color=fff&size=160`;

        let cardStateClass = '';
        let statusIconHtml = '<i class="bi bi-circle text-secondary fs-5"></i>';
        let helperBadgeHtml = '';

        if (isSelectedHere) {
            cardStateClass = 'state-selected';
            statusIconHtml = '<i class="bi bi-check-circle-fill text-white fs-4"></i>';
            helperBadgeHtml = `<span class="d-inline-block mt-1 text-white opacity-75" style="font-size: 0.7rem;"><i class="bi bi-arrow-counterclockwise me-1"></i>Klik lagi untuk ganti pilihan</span>`;
        } else if (isLockedOtherInSameCategory) {
            cardStateClass = 'state-locked-used';
            statusIconHtml = '<i class="bi bi-dash-circle text-secondary fs-5"></i>';
        }

        return `
            <div class="col-12 col-sm-6 col-lg-4 col-xl-3">
                <button type="button"
                    class="candidate-wizard-card ${cardStateClass}"
                    data-cand-id="${cand.id}"
                    ${isLockedOtherInSameCategory ? 'disabled' : ''}>
                    <img src="${AppUI.escapeHtml(avatar)}" alt="${AppUI.escapeHtml(cand.name)}" class="candidate-wizard-avatar">
                    <div class="candidate-wizard-info">
                        <div class="candidate-wizard-name" title="${AppUI.escapeHtml(cand.name)}">${AppUI.escapeHtml(cand.name)}</div>
                        <div class="candidate-wizard-role" title="${AppUI.escapeHtml(cand.jabatan)}">${AppUI.escapeHtml(cand.jabatan)}</div>
                        ${helperBadgeHtml}
                    </div>
                    <div class="ms-auto ps-1">
                        ${statusIconHtml}
                    </div>
                </button>
            </div>
        `;
    }).join('');

    // Event klik pada Card Kandidat yang aktif
    grid.querySelectorAll('.candidate-wizard-card:not(:disabled)').forEach(cardBtn => {
        cardBtn.addEventListener('click', () => {
            const candId = cardBtn.getAttribute('data-cand-id');
            selectCandidateForCurrentStep(activeCat.id, candId);
        });
    });
}

/**
 * Pilih kandidat pada kategori aktif (atau batalkan jika kandidat yang sudah dipilih diklik ulang)
 */
function selectCandidateForCurrentStep(categoryId, candidateId) {
    if (String(voterSelections[categoryId]) === String(candidateId)) {
        // Klik ulang pada kandidat terpilih -> batalkan pilihan agar 25 kandidat lain bisa dipilih kembali
        delete voterSelections[categoryId];
    } else {
        voterSelections[categoryId] = candidateId;
    }

    const activeCat = wizardCategories[currentStepIndex];
    const hasSelectionNow = Boolean(voterSelections[categoryId]);
    document.getElementById('btnWizardNext').disabled = !hasSelectionNow;

    const totalCategories = wizardCategories.length;
    const filledCount = Object.keys(voterSelections).length;
    const progressPct = totalCategories > 0 ? Math.round((filledCount / totalCategories) * 100) : 0;

    document.getElementById('wizardProgressText').textContent = `${filledCount} / ${totalCategories} Terisi`;
    document.getElementById('wizardProgressBar').style.width = `${progressPct}%`;

    updateCurrentStepSelectionBanner(activeCat);
    renderCandidateCardsGrid();
}

/**
 * Render Halaman Ringkasan (Review Pilihan) setelah semua kategori terisi
 */
function renderReviewSummaryCards() {
    const container = document.getElementById('wizardReviewList');
    if (!container) return;

    container.innerHTML = wizardCategories.map((cat, idx) => {
        const chosenCandId = voterSelections[cat.id];
        const cand = wizardCandidates.find(c => String(c.id) === String(chosenCandId));

        const avatar = cand?.photo_url && cand.photo_url.trim() !== ''
            ? cand.photo_url
            : `https://ui-avatars.com/api/?name=${encodeURIComponent(cand?.name || 'K')}&background=059669&color=fff&size=120`;

        return `
            <div class="col-12 col-md-6">
                <div class="review-item-card d-flex align-items-center justify-content-between gap-3">
                    <div class="d-flex align-items-center gap-3 min-w-0">
                        <img src="${AppUI.escapeHtml(avatar)}" alt="Foto" class="candidate-wizard-avatar" style="width:52px;height:52px;min-width:52px;">
                        <div class="min-w-0">
                            <div class="text-uppercase fw-bold text-success" style="font-size: 0.7rem;">
                                Kategori ${idx + 1}: ${AppUI.escapeHtml(cat.name)}
                            </div>
                            <div class="fw-bold text-dark text-truncate">${AppUI.escapeHtml(cand ? cand.name : 'Belum dipilih')}</div>
                            <div class="small text-muted text-truncate">${AppUI.escapeHtml(cand ? cand.jabatan : '-')}</div>
                        </div>
                    </div>
                    <button type="button" class="btn btn-outline-secondary btn-sm rounded-3 px-3 flex-shrink-0" onclick="jumpToWizardStep(${idx})">
                        <i class="bi bi-pencil-square me-1"></i>Ubah
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Lompat kembali ke kategori tertentu dari halaman Ringkasan
 */
window.jumpToWizardStep = function (stepIdx) {
    currentStepIndex = stepIdx;
    document.getElementById('wizardSearchInput').value = '';
    renderWizardView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

/**
 * Kirim Pilihan Final Secara Anonim ke Supabase
 */
async function submitAnonymousBallotToSupabase() {
    if (!activeVoterSession) return;

    if (Object.keys(voterSelections).length < wizardCategories.length) {
        AppUI.toast('Masih ada kategori yang belum terisi. Silakan lengkapi terlebih dahulu.', 'warning');
        return;
    }

    const btnSubmit = document.getElementById('btnSubmitFinalVote');
    const btnBack = document.getElementById('btnBackFromReview');
    const originalHtml = btnSubmit.innerHTML;

    btnSubmit.disabled = true;
    if (btnBack) btnBack.disabled = true;
    btnSubmit.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Menyimpan Suara Anda...';

    try {
        const choicesPayload = Object.entries(voterSelections).map(([category_id, candidate_id]) => ({
            category_id,
            candidate_id
        }));

        const { data, error } = await db.rpc('submit_anonymous_vote', {
            p_voter_id: activeVoterSession.id,
            p_choices: choicesPayload
        });

        if (error) throw error;

        if (!data || data.success === false) {
            AppUI.toast(data?.message || 'Gagal menyimpan suara.', 'danger');
            btnSubmit.disabled = false;
            if (btnBack) btnBack.disabled = false;
            btnSubmit.innerHTML = originalHtml;
            return;
        }

        AppUI.toast('Terima kasih! Pilihan Anda berhasil disimpan secara rahasia.', 'success');

        setTimeout(() => {
            btnSubmit.disabled = false;
            if (btnBack) btnBack.disabled = false;
            btnSubmit.innerHTML = originalHtml;
            resetVoterLoginScreen();
        }, 1200);

    } catch (err) {
        console.error(err);
        AppUI.toast('Terjadi kesalahan jaringan saat mengirim suara.', 'danger');
        btnSubmit.disabled = false;
        if (btnBack) btnBack.disabled = false;
        btnSubmit.innerHTML = originalHtml;
    }
}