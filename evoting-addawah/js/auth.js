/**
 * js/auth.js
 * Logika Cascading Dropdown Login Pemilih, Validasi Double Vote,
 * & Kombinasi Klik Rahasia menuju Halaman Admin
 */

let allVotersCache = [];
let activeVoterSession = null;
/**
 * Ambil kode bilik laptop dari parameter URL (contoh: index.html?bilik=01)
 */
function getCurrentBoothCode() {
    const params = new URLSearchParams(window.location.search);
    const raw = (params.get('bilik') || '01').trim();
    return raw.padStart(2, '0');
}

async function markBoothActiveInSupabase(voter) {
    const boothCode = getCurrentBoothCode();
    try {
        await db.from('active_booths').upsert({
            booth_code: boothCode,
            booth_name: `Bilik Laptop ${boothCode}`,
            voter_id: voter.id,
            voter_name: voter.nama,
            voter_kelas: voter.kelas,
            status: 'voting',
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }, { onConflict: 'booth_code' });
    } catch (err) {
        console.error('Gagal menandai bilik aktif:', err);
    }
}

async function clearBoothStatusInSupabase() {
    const boothCode = getCurrentBoothCode();
    try {
        await db.from('active_booths').update({
            voter_id: null,
            voter_name: '',
            voter_kelas: '',
            status: 'empty',
            updated_at: new Date().toISOString()
        }).eq('booth_code', boothCode);
    } catch (err) {
        console.error('Gagal mengosongkan status bilik:', err);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    initSecretAdminTrigger();
    await loadVotersForCascadingDropdown();
    bindCascadingLoginEvents();
    initBoothCallAutoFillListener();
});

/**
 * 1. Pemicu Rahasia Admin: Klik Logo Sekolah 5x dalam 3 detik
 */
function initSecretAdminTrigger() {
    const logoTrigger = document.getElementById('secretLogoTrigger');
    if (!logoTrigger) return;

    let clickCount = 0;
    let clickTimer = null;

    logoTrigger.addEventListener('click', () => {
        clickCount++;
        clearTimeout(clickTimer);

        if (clickCount >= 5) {
            clickCount = 0;
            AppUI.toast('Membuka Portal Rahasia Administrator...', 'info');
            setTimeout(() => {
                window.location.href = 'admin.html';
            }, 500);
            return;
        }

        clickTimer = setTimeout(() => {
            clickCount = 0;
        }, 2500);
    });
}

/**
 * 2. Ambil daftar Kelas & Nama Pemilih dari Supabase
 */
async function loadVotersForCascadingDropdown() {
    const selectKelas = document.getElementById('selectKelas');
    if (!selectKelas) return;

    try {
        const { data, error } = await db
            .from('voters')
            .select('id, kelas, nama, has_voted, voted_at')
            .order('kelas', { ascending: true })
            .order('nama', { ascending: true });

        if (error) throw error;
        allVotersCache = data || [];

        // Ambil daftar kelas unik
        const uniqueClasses = [...new Set(allVotersCache.map(v => v.kelas))];

        selectKelas.innerHTML = '<option value="">-- Pilih Kelas / Unit Anda --</option>';
        uniqueClasses.forEach(kls => {
            const opt = document.createElement('option');
            opt.value = kls;
            opt.textContent = kls;
            selectKelas.appendChild(opt);
        });
    } catch (err) {
        console.error(err);
        selectKelas.innerHTML = '<option value="">Gagal memuat daftar kelas</option>';
        AppUI.toast('Gagal terhubung ke database Supabase. Periksa konfigurasi di js/app.js.', 'danger');
    }
}

/**
 * 3. Event Listener Cascading Dropdown (Kelas -> Nama -> Password)
 */
function bindCascadingLoginEvents() {
    const selectKelas = document.getElementById('selectKelas');
    const selectNama = document.getElementById('selectNama');
    const stepNamaWrapper = document.getElementById('stepNamaWrapper');
    const stepPasswordWrapper = document.getElementById('stepPasswordWrapper');
    const inputVoterPassword = document.getElementById('inputVoterPassword');
    const btnVoterLogin = document.getElementById('btnVoterLogin');
    const toggleVoterPass = document.getElementById('toggleVoterPass');
    const voterLoginForm = document.getElementById('voterLoginForm');

    if (!voterLoginForm) return;

    // Saat Kelas dipilih -> Munculkan Dropdown Nama
    selectKelas.addEventListener('change', () => {
        const selectedClass = selectKelas.value;
        inputVoterPassword.value = '';
        btnVoterLogin.disabled = true;
        stepPasswordWrapper.classList.replace('cascade-visible', 'cascade-hidden');

        if (!selectedClass) {
            stepNamaWrapper.classList.replace('cascade-visible', 'cascade-hidden');
            selectNama.disabled = true;
            return;
        }

        const filteredVoters = allVotersCache.filter(v => v.kelas === selectedClass);
        selectNama.innerHTML = '<option value="">-- Pilih Nama Anda --</option>';

        filteredVoters.forEach(voter => {
            const opt = document.createElement('option');
            opt.value = voter.id;
            opt.textContent = voter.nama;
            selectNama.appendChild(opt);
        });

        selectNama.disabled = false;
        stepNamaWrapper.classList.replace('cascade-hidden', 'cascade-visible');
    });

    // Saat Nama dipilih -> Munculkan Input Password
    selectNama.addEventListener('change', () => {
        if (selectNama.value) {
            stepPasswordWrapper.classList.replace('cascade-hidden', 'cascade-visible');
            btnVoterLogin.disabled = false;
            setTimeout(() => inputVoterPassword.focus(), 150);
        } else {
            stepPasswordWrapper.classList.replace('cascade-visible', 'cascade-hidden');
            btnVoterLogin.disabled = true;
        }
    });

    // Toggle lihat/sembunyikan password
    toggleVoterPass.addEventListener('click', () => {
        const isPass = inputVoterPassword.type === 'password';
        inputVoterPassword.type = isPass ? 'text' : 'password';
        toggleVoterPass.innerHTML = isPass ? '<i class="bi bi-eye-slash"></i>' : '<i class="bi bi-eye"></i>';
    });

    // Submit Login Pemilih
    voterLoginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const voterId = selectNama.value;
        const passwordInput = inputVoterPassword.value.trim();

        if (!voterId || !passwordInput) {
            AppUI.toast('Silakan lengkapi kelas, nama, dan kata sandi Anda.', 'warning');
            return;
        }

        const originalBtnHtml = btnVoterLogin.innerHTML;
        btnVoterLogin.disabled = true;
        btnVoterLogin.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Memverifikasi...';

        try {
            // Cek status sesi voting global
            const settings = await AppUI.loadAndApplySettings();
            if (settings && settings.is_voting_open === false) {
                AppUI.toast('Mohon maaf, sesi pemilihan saat ini sedang ditutup oleh panitia.', 'warning');
                btnVoterLogin.disabled = false;
                btnVoterLogin.innerHTML = originalBtnHtml;
                return;
            }

            // Ambil data terbaru pemilih dari Supabase
            const { data: voter, error } = await db
                .from('voters')
                .select('id, kelas, nama, password, has_voted, voted_at')
                .eq('id', voterId)
                .single();

            if (error || !voter) {
                AppUI.toast('Data akun pemilih tidak ditemukan.', 'danger');
                btnVoterLogin.disabled = false;
                btnVoterLogin.innerHTML = originalBtnHtml;
                return;
            }

            // Validasi Password
            if (voter.password !== passwordInput) {
                AppUI.toast('Kata sandi / token yang Anda masukkan salah.', 'danger');
                btnVoterLogin.disabled = false;
                btnVoterLogin.innerHTML = originalBtnHtml;
                return;
            }

            // Validasi Apakah Sudah Memilih
            if (voter.has_voted === true) {
                const modalEl = document.getElementById('alreadyVotedModal');
                const detailEl = document.getElementById('alreadyVotedDetail');
                const waktu = voter.voted_at
                    ? new Date(voter.voted_at).toLocaleString('id-ID')
                    : 'sebelumnya';

                detailEl.innerHTML = `Akun <strong>${AppUI.escapeHtml(voter.nama)} (${AppUI.escapeHtml(voter.kelas)})</strong> tercatat sudah memberikan suara pada <strong>${waktu}</strong>.`;

                const bsModal = bootstrap.Modal.getOrCreateInstance(modalEl);
                bsModal.show();

                // Nonaktifkan tombol login sementara sesuai spesifikasi
                btnVoterLogin.disabled = true;
                btnVoterLogin.innerHTML = '<i class="bi bi-slash-circle me-2"></i>Suara Sudah Digunakan';
                return;
            }

            // Login Berhasil -> Tandai bilik aktif di Live Monitoring & masuk bilik pemilihan
            activeVoterSession = {
                id: voter.id,
                nama: voter.nama,
                kelas: voter.kelas
            };

            await markBoothActiveInSupabase(activeVoterSession);
            AppUI.toast(`Selamat datang, ${voter.nama}. Silakan berikan suara Anda.`, 'success');
            await enterMatrixVotingBooth(activeVoterSession);
            

        } catch (err) {
            console.error(err);
            AppUI.toast('Terjadi kesalahan saat memverifikasi akun.', 'danger');
        } finally {
            if (!activeVoterSession) {
                btnVoterLogin.innerHTML = originalBtnHtml;
            }
        }
    });
}

/**
 * Reset form login untuk pemilih berikutnya
 */
function resetVoterLoginScreen() {
    clearBoothStatusInSupabase();
    activeVoterSession = null;

    const loginSection = document.getElementById('loginSection');
    const votingSection = document.getElementById('votingSection');
    const activeVoterBadge = document.getElementById('activeVoterBadge');
    const selectKelas = document.getElementById('selectKelas');
    const selectNama = document.getElementById('selectNama');
    const inputPass = document.getElementById('inputVoterPassword');
    const stepNama = document.getElementById('stepNamaWrapper');
    const stepPass = document.getElementById('stepPasswordWrapper');
    const btnLogin = document.getElementById('btnVoterLogin');

    votingSection.classList.add('d-none');
    loginSection.classList.remove('d-none');
    activeVoterBadge.classList.add('d-none');
    activeVoterBadge.classList.remove('d-flex');

    selectKelas.value = '';
    selectNama.innerHTML = '<option value="">-- Pilih nama Anda --</option>';
    selectNama.disabled = true;
    inputPass.value = '';

    stepNama.classList.replace('cascade-visible', 'cascade-hidden');
    stepPass.classList.replace('cascade-visible', 'cascade-hidden');

    btnLogin.disabled = true;
    btnLogin.innerHTML = '<i class="bi bi-box-arrow-in-right me-2"></i>Masuk ke Bilik Pemilihan';

    // Muat ulang cache pemilih
    loadVotersForCascadingDropdown();
}

/**
 * Opsi A: Dengarkan panggilan Admin khusus untuk parameter ?bilik=XX ini.
 * Otomatis mengisi dropdown Kelas & Nama siswa, TANPA mengunci dropdown tersebut.
 */
let lastAutoFilledStamp = null;

function initBoothCallAutoFillListener() {
    const boothCode = getCurrentBoothCode();

    const applyCalledStudentToLoginForm = (boothRow) => {
        // Jangan ganggu jika sedang berada di halaman bilik voting
        if (activeVoterSession || !boothRow) return;
        if (boothRow.status !== 'called' || !boothRow.voter_id) return;

        // Hindari menimpa ulang panggilan yang sama (agar siswa bebas mengganti dropdown jika perlu)
        const callStamp = `${boothRow.voter_id}_${boothRow.updated_at}`;
        if (lastAutoFilledStamp === callStamp) return;
        lastAutoFilledStamp = callStamp;

        const selectKelas = document.getElementById('selectKelas');
        const selectNama = document.getElementById('selectNama');
        if (!selectKelas || !selectNama) return;

        // Pilih kelas lalu trigger event change agar dropdown nama terisi (tetap unlocked)
        if ([...selectKelas.options].some(o => o.value === boothRow.voter_kelas)) {
            selectKelas.value = boothRow.voter_kelas;
            selectKelas.dispatchEvent(new Event('change'));

            if ([...selectNama.options].some(o => o.value === boothRow.voter_id)) {
                selectNama.value = boothRow.voter_id;
                selectNama.dispatchEvent(new Event('change'));
                AppUI.toast(`Panggilan Bilik ${boothCode}: ${boothRow.voter_name} (${boothRow.voter_kelas}) silakan masukkan password.`, 'info');
            }
        }
    };

    // Cek awal saat halaman login terbuka
    db.from('active_booths')
        .select('*')
        .eq('booth_code', boothCode)
        .maybeSingle()
        .then(({ data }) => applyCalledStudentToLoginForm(data));

    // Dengarkan panggilan Admin secara real-time khusus untuk kode bilik ini
    db.channel(`booth-autofill-${boothCode}`)
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'active_booths', filter: `booth_code=eq.${boothCode}` },
            (payload) => applyCalledStudentToLoginForm(payload.new)
        )
        .subscribe();
}